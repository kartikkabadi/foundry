/**
 * Explicit discriminated authority model for the autonomous engineering
 * system.
 *
 * Authority is expressed as a versioned profile over exactly three scopes —
 * observe, build, and publish. Each scope carries a discriminated decision
 * (`granted` | `denied`) with a recorded reason, never a bare boolean: a
 * denial is a first-class, auditable fact. The scope set is fixed and closed;
 * there is no scope for merge, deploy, cleanup, self-modification, or gate
 * answering, so the type system cannot express those authorities.
 *
 * Defaults are fail-closed: every scope is denied until an operator grants it.
 * Nothing in the system grants authority to itself — the only way a decision
 * changes is an explicit operator patch through `applyAuthorityProfilePatch`,
 * which is a pure CAS-friendly transform (version bump, no hidden state).
 * Persistence and the version compare-and-set live behind the caller's store;
 * this module is the model and validation only.
 */

/** The fixed, closed set of scopes the authority model can express. */
export const AUTHORITY_SCOPES = ["observe", "build", "publish"] as const;

export type AuthorityScope = (typeof AUTHORITY_SCOPES)[number];

/** One discriminated decision for one scope; a denial is explicit, not an
 *  absent boolean. */
export type AuthorityDecision =
  | { kind: "granted"; scope: AuthorityScope; reason: string }
  | { kind: "denied"; scope: AuthorityScope; reason: string };

/** The durable authority record. `version` and `updatedAt` are managed by the
 *  store; every mutation goes through `applyAuthorityProfilePatch`. */
export type AuthorityProfile = {
  kind: "authority-profile";
  /** Integer optimistic-concurrency version; bumped on every mutation. */
  version: number;
  /** ISO timestamp of the last mutation. */
  updatedAt: string;
  /** One explicit decision per scope. The set is fixed; no other scope exists. */
  decisions: Record<AuthorityScope, AuthorityDecision>;
};

/** Operator-editable patch: per-scope `granted` plus the reason to record. */
export type AuthorityProfilePatch = Partial<
  Record<AuthorityScope, { granted: boolean; reason: string }>
>;

/** Thrown when a patch field is outside its legal bounds. */
export class AuthorityProfileValidationError extends Error {
  constructor(message: string) {
    super(`authority profile: ${message}`);
    this.name = "AuthorityProfileValidationError";
  }
}

/** Fail-closed defaults: every scope denied until an operator grants it. */
export function defaultAuthorityProfile(now: string): AuthorityProfile {
  return {
    kind: "authority-profile",
    version: 1,
    updatedAt: now,
    decisions: {
      observe: { kind: "denied", scope: "observe", reason: "no authority granted by default" },
      build: { kind: "denied", scope: "build", reason: "no authority granted by default" },
      publish: { kind: "denied", scope: "publish", reason: "no authority granted by default" },
    },
  };
}

/** True only when the profile explicitly grants `scope`. */
export function isAuthorityGranted(profile: AuthorityProfile, scope: AuthorityScope): boolean {
  return profile.decisions[scope].kind === "granted";
}

function assertDecisionEntry(value: unknown, scope: AuthorityScope): { granted: boolean; reason: string } {
  if (typeof value !== "object" || value === null) {
    throw new AuthorityProfileValidationError(`${scope} patch must be an object`);
  }
  const entry = value as { granted?: unknown; reason?: unknown };
  if (typeof entry.granted !== "boolean") {
    throw new AuthorityProfileValidationError(
      `${scope}.granted must be a boolean, received ${String(entry.granted)}`,
    );
  }
  if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
    throw new AuthorityProfileValidationError(
      `${scope}.reason must be a nonempty string, received ${String(entry.reason)}`,
    );
  }
  return { granted: entry.granted, reason: entry.reason };
}

/**
 * Pure validation: applies `patch` to `current`, producing the next profile
 * with `version` bumped by one and `updatedAt` set to `now`. Only the patched
 * scopes change; every other decision comes from the live record, so a stale
 * snapshot can never clobber newer grants (the caller's CAS on `version`
 * guards that at the store layer). An empty patch is rejected — a mutation
 * must change at least one scope. Granting is explicit: a scope stays denied
 * until an operator patch grants it.
 */
export function applyAuthorityProfilePatch(
  current: AuthorityProfile,
  patch: AuthorityProfilePatch,
  now: string,
): AuthorityProfile {
  if (Object.keys(patch).length === 0) {
    throw new AuthorityProfileValidationError("patch must change at least one scope");
  }

  const next: AuthorityProfile = {
    ...current,
    decisions: { ...current.decisions },
  };

  for (const scope of AUTHORITY_SCOPES) {
    const entry = patch[scope];
    if (entry === undefined) {
      continue;
    }
    const { granted, reason } = assertDecisionEntry(entry, scope);
    next.decisions[scope] = {
      kind: granted ? "granted" : "denied",
      scope,
      reason,
    };
  }

  next.version = current.version + 1;
  next.updatedAt = now;
  return next;
}
