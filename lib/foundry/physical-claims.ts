/**
 * Physical identity resolution for write-path claims.
 *
 * The pure scheduler normalizes claim strings lexically (`canonicalClaimPath`)
 * but cannot see the filesystem. Before a claim string reaches scheduling or
 * the durable store, this adapter replaces it with a canonical absolute
 * physical path:
 *
 * - the sanctioned root is resolved with `realpath` and must be an existing
 *   directory;
 * - each relative claim is resolved beneath it, following symlinks;
 * - a not-yet-created leaf file anchors to its nearest existing ancestor,
 *   whose `realpath` is taken and the missing suffix reattached;
 * - a dangling symlink on the path is rejected: its target may appear later
 *   and change the physical identity, so it is not a stable anchor;
 * - any claim that would escape the root — absolutely, by traversal, or
 *   through a symlink — is rejected, as is a missing or unresolvable root.
 *
 * The adapter never mutates the filesystem and never shells out; every
 * filesystem read goes through the injected `PhysicalFs` so resolution is
 * deterministic in tests.
 */

import { basename, dirname, join } from "node:path/posix";

const SLASH = 47; // "/"
const BACKSLASH = 92; // "\"
const COLON = 58; // ":"
const UPPERCASE_A = 65; // "A"
const UPPERCASE_Z = 90; // "Z"
const LOWERCASE_A = 97; // "a"
const LOWERCASE_Z = 122; // "z"

/** Filesystem surface the adapter needs; satisfied by `node:fs/promises`. */
export interface PhysicalFs {
  /** Resolve `path` to its physical location, following symlinks. */
  realpath(path: string): Promise<string>;
  /** Stat `path` following symlinks; `isDirectory()` must be truthful. */
  stat(path: string): Promise<PhysicalFsStats>;
  /** Stat `path` without following symlinks, so dangling links are visible. */
  lstat(path: string): Promise<PhysicalFsStats>;
}

/** Minimal stat shape the adapter relies on. */
export interface PhysicalFsStats {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export type PhysicalClaimErrorCode =
  | "missing-root"
  | "unresolvable-root"
  | "root-not-directory"
  | "empty-claim"
  | "absolute-claim"
  | "traversal-claim"
  | "physical-escape"
  | "unresolvable-claim";

export interface PhysicalClaimError {
  code: PhysicalClaimErrorCode;
  /** The offending claim string, or null for root-level errors. */
  claim: string | null;
  detail: string;
}

export interface PhysicalClaimsInput {
  /** Existing directory the claims are sanctioned to write within. */
  root: string;
  /** Relative write-path claims to resolve, in order. */
  claims: readonly string[];
  /** Injected filesystem effects, so resolution is deterministic. */
  fs: PhysicalFs;
}

export type PhysicalClaimsResult =
  | { ok: true; root: string; identities: string[] }
  | { ok: false; error: PhysicalClaimError };

function fail(
  code: PhysicalClaimErrorCode,
  claim: string | null,
  detail: string,
): { ok: false; error: PhysicalClaimError } {
  return { ok: false, error: { code, claim, detail } };
}

function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return typeof err.code === "string" ? err.code : undefined;
  }
  return undefined;
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True for A–Z and a–z, used to recognize drive-letter prefixes. */
function isAsciiLetter(code: number): boolean {
  return (code >= UPPERCASE_A && code <= UPPERCASE_Z) || (code >= LOWERCASE_A && code <= LOWERCASE_Z);
}

type ParsedClaim =
  | { ok: true; segments: string[] }
  | { ok: false; error: PhysicalClaimError };

/**
 * Splits a claim into path segments. Mirrors `canonicalClaimPath`'s lexical
 * rules: both slash directions separate, "." and empty segments drop, ".."
 * and every absolute form (POSIX `/...` or `\...`, UNC, drive) are rejected
 * so a claim can never widen its write scope above the root.
 */
function parseClaimSegments(claim: string): ParsedClaim {
  if (claim.length === 0) {
    return fail("empty-claim", claim, "claim path must not be empty");
  }
  const first = claim.charCodeAt(0);
  const second = claim.length > 1 ? claim.charCodeAt(1) : -1;
  const absolute = first === SLASH || first === BACKSLASH;
  const drive = second === COLON && isAsciiLetter(first);
  if (absolute || drive) {
    return fail("absolute-claim", claim, `claim ${JSON.stringify(claim)} must be relative to the sanctioned root`);
  }
  const segments: string[] = [];
  let segStart = 0;
  for (let i = 0; i <= claim.length; i++) {
    const code = i === claim.length ? SLASH : claim.charCodeAt(i);
    if (code !== SLASH && code !== BACKSLASH) continue;
    if (i > segStart) {
      const raw = claim.slice(segStart, i);
      if (raw === "..") {
        return fail("traversal-claim", claim, `claim ${JSON.stringify(claim)} must not traverse above the sanctioned root`);
      }
      if (raw !== ".") segments.push(raw);
    }
    segStart = i + 1;
  }
  if (segments.length === 0) {
    return fail("empty-claim", claim, `claim ${JSON.stringify(claim)} normalizes to nothing`);
  }
  return { ok: true, segments };
}

function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const prefix = root === "/" ? root : `${root}/`;
  return candidate.startsWith(prefix);
}

async function resolveRoot(
  root: string,
  fs: PhysicalFs,
): Promise<{ ok: true; root: string } | { ok: false; error: PhysicalClaimError }> {
  let physical: string;
  try {
    physical = await fs.realpath(root);
  } catch (err) {
    const code = errorCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return fail("missing-root", null, `sanctioned root ${JSON.stringify(root)} does not exist`);
    }
    return fail("unresolvable-root", null, `cannot resolve sanctioned root ${JSON.stringify(root)}: ${errorDetail(err)}`);
  }
  try {
    const stats = await fs.stat(physical);
    if (!stats.isDirectory()) {
      return fail("root-not-directory", null, `sanctioned root ${JSON.stringify(root)} is not a directory`);
    }
  } catch (err) {
    return fail("unresolvable-root", null, `cannot stat sanctioned root ${JSON.stringify(root)}: ${errorDetail(err)}`);
  }
  return { ok: true, root: physical };
}

async function resolveSingle(
  root: string,
  claim: string,
  fs: PhysicalFs,
): Promise<{ ok: true; identity: string } | { ok: false; error: PhysicalClaimError }> {
  const parsed = parseClaimSegments(claim);
  if (!parsed.ok) return parsed;

  const missing: string[] = [];
  let current = join(root, ...parsed.segments);

  for (;;) {
    let exists = true;
    try {
      await fs.stat(current);
    } catch (err) {
      const code = errorCode(err);
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return fail("unresolvable-claim", claim, `cannot stat ${JSON.stringify(current)}: ${errorDetail(err)}`);
      }
      // `stat` (following links) cannot reach this path. If `lstat` still sees
      // a symlink entry there, it is dangling: its target may appear later and
      // change the physical identity, so it cannot be a stable anchor.
      let lexical: PhysicalFsStats | null = null;
      try {
        lexical = await fs.lstat(current);
      } catch (lstatError) {
        const lstatCode = errorCode(lstatError);
        if (lstatCode !== "ENOENT" && lstatCode !== "ENOTDIR") {
          return fail(
            "unresolvable-claim",
            claim,
            `cannot lstat ${JSON.stringify(current)}: ${errorDetail(lstatError)}`,
          );
        }
        // ENOENT/ENOTDIR means the entry is genuinely missing; walk up.
      }
      if (lexical !== null && lexical.isSymbolicLink()) {
        return fail(
          "unresolvable-claim",
          claim,
          `claim ${JSON.stringify(claim)} passes through dangling symlink ${JSON.stringify(current)}`,
        );
      }
      exists = false;
    }

    if (exists) {
      let physical: string;
      try {
        physical = await fs.realpath(current);
      } catch (err) {
        return fail("unresolvable-claim", claim, `cannot resolve ${JSON.stringify(current)}: ${errorDetail(err)}`);
      }
      let identity = physical;
      for (let i = missing.length - 1; i >= 0; i--) {
        identity = join(identity, missing[i]);
      }
      if (!isWithin(root, identity)) {
        return fail(
          "physical-escape",
          claim,
          `claim ${JSON.stringify(claim)} resolves to ${JSON.stringify(identity)}, outside sanctioned root ${JSON.stringify(root)}`,
        );
      }
      return { ok: true, identity };
    }

    const parent = dirname(current);
    if (parent === current) {
      // Unreachable: the sanctioned root exists and is an ancestor, so the
      // walk always terminates there before reaching the filesystem root.
      return fail("unresolvable-claim", claim, `no existing ancestor found for ${JSON.stringify(claim)}`);
    }
    missing.push(basename(current));
    current = parent;
  }
}

/**
 * Replaces claim strings with canonical absolute physical identities.
 *
 * Fails closed on a missing, unresolvable, or non-directory root and on any
 * claim that is absolute, traverses above the root, passes through a dangling
 * symlink, or physically escapes the root through a symlink. On success,
 * `identities` is aligned with the input `claims` in the same order, ready to
 * replace the claim strings before scheduling or store creation.
 */
export async function resolvePhysicalClaims(input: PhysicalClaimsInput): Promise<PhysicalClaimsResult> {
  const rootResult = await resolveRoot(input.root, input.fs);
  if (!rootResult.ok) return rootResult;

  const identities: string[] = [];
  for (const claim of input.claims) {
    const resolved = await resolveSingle(rootResult.root, claim, input.fs);
    if (!resolved.ok) return resolved;
    identities.push(resolved.identity);
  }
  return { ok: true, root: rootResult.root, identities };
}
