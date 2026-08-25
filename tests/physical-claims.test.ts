import { describe, expect, it } from "vitest";
import {
  resolvePhysicalClaims,
  type PhysicalClaimError,
  type PhysicalClaimErrorCode,
  type PhysicalClaimsResult,
  type PhysicalFs,
  type PhysicalFsStats,
} from "../lib/foundry/physical-claims";

type FsEntry = { type: "dir" } | { type: "file" } | { type: "link"; target: string };

// Collapses "." and ".." lexically; produces a canonical absolute path.
function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

/**
 * In-memory filesystem backing `PhysicalFs`. `realpath` resolves symlinks
 * component-wise (loop-safe); `stat` follows symlinks, so a broken link or a
 * missing leaf raises ENOENT exactly like the real filesystem.
 */
class FakeFs implements PhysicalFs {
  private readonly entries = new Map<string, FsEntry>();
  private readonly failOn = new Set<string>();

  dir(path: string): this {
    this.entries.set(normalize(path), { type: "dir" });
    return this;
  }

  file(path: string): this {
    this.entries.set(normalize(path), { type: "file" });
    return this;
  }

  link(from: string, to: string): this {
    // `to` may be relative to the link's directory, as with real symlinks;
    // it is resolved when the link is followed.
    this.entries.set(normalize(from), { type: "link", target: to });
    return this;
  }

  /** Make every stat/lstat/realpath on `path` raise EACCES (unreadable path). */
  unreadable(path: string): this {
    this.failOn.add(normalize(path));
    return this;
  }

  async realpath(path: string): Promise<string> {
    if (this.failOn.has(normalize(path))) throw this.error("EACCES", `realpath ${path}`);
    const result = this.resolvePath(path);
    if (!result.ok) throw this.error(result.code, `realpath ${path}`);
    return result.path;
  }

  async stat(path: string): Promise<PhysicalFsStats> {
    if (this.failOn.has(normalize(path))) throw this.error("EACCES", `stat ${path}`);
    const result = this.resolvePath(path);
    if (!result.ok) throw this.error(result.code, `stat ${path}`);
    const entry = this.entries.get(result.path);
    if (!entry) throw this.error("ENOENT", `stat ${path}`);
    return {
      isDirectory: () => entry.type === "dir",
      isSymbolicLink: () => entry.type === "link",
    };
  }

  async lstat(path: string): Promise<PhysicalFsStats> {
    if (this.failOn.has(normalize(path))) throw this.error("EACCES", `lstat ${path}`);
    const entry = this.entries.get(normalize(path));
    if (!entry) throw this.error("ENOENT", `lstat ${path}`);
    return {
      isDirectory: () => entry.type === "dir",
      isSymbolicLink: () => entry.type === "link",
    };
  }

  private error(code: string, at: string): Error & { code: string } {
    return Object.assign(new Error(`${at}: ${code}`), { code });
  }

  private resolvePath(start: string): { ok: true; path: string } | { ok: false; code: string } {
    let pending: string[] = [];
    for (const seg of normalize(start).split("/")) {
      if (seg !== "" && seg !== ".") pending.push(seg);
    }
    let resolved: string[] = [];
    const visitedLinks = new Set<string>();
    let i = 0;
    while (i < pending.length) {
      const seg = pending[i];
      if (seg === "..") {
        if (resolved.length > 0) resolved.pop();
        i++;
        continue;
      }
      const candidate = `/${[...resolved, seg].join("/")}`;
      const entry = this.entries.get(candidate);
      if (!entry) return { ok: false, code: "ENOENT" };
      if (entry.type === "link") {
        if (visitedLinks.has(candidate)) return { ok: false, code: "ELOOP" };
        visitedLinks.add(candidate);
        const targetSegs: string[] = [];
        for (const targetSeg of entry.target.split("/")) {
          if (targetSeg !== "" && targetSeg !== ".") targetSegs.push(targetSeg);
        }
        if (entry.target.startsWith("/")) {
          // Absolute target: restart from the filesystem root.
          resolved = [];
          pending = [...targetSegs, ...pending.slice(i + 1)];
          i = 0;
        } else {
          // Relative target: continue from the current base.
          pending.splice(i, 1, ...targetSegs);
        }
        continue;
      }
      resolved.push(seg);
      i++;
    }
    const path = `/${resolved.join("/")}`;
    return { ok: true, path: path === "/" ? "/" : path };
  }
}

function expectError(result: PhysicalClaimsResult, code: PhysicalClaimErrorCode): PhysicalClaimError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`expected ${code} but resolution succeeded`);
  expect(result.error.code).toBe(code);
  return result.error;
}

describe("resolvePhysicalClaims", () => {
  it("resolves an existing root to its canonical physical form and plain relative claims beneath it", async () => {
    const fs = new FakeFs().dir("/repo").dir("/repo/work").file("/repo/work/a.txt");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["work/a.txt", "work"], fs });
    expect(result).toEqual({ ok: true, root: "/repo", identities: ["/repo/work/a.txt", "/repo/work"] });
  });

  it("resolves a root that is itself a symlink to its physical location", async () => {
    const fs = new FakeFs().dir("/real").file("/real/a.txt").link("/repo-link", "/real");
    const result = await resolvePhysicalClaims({ root: "/repo-link", claims: ["a.txt"], fs });
    expect(result).toEqual({ ok: true, root: "/real", identities: ["/real/a.txt"] });
  });

  it("fails closed when the sanctioned root is missing", async () => {
    const fs = new FakeFs().dir("/repo");
    const result = await resolvePhysicalClaims({ root: "/nope", claims: ["a.txt"], fs });
    expectError(result, "missing-root");
  });

  it("fails closed when the sanctioned root is a file, not a directory", async () => {
    const fs = new FakeFs().file("/repo");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["a.txt"], fs });
    expectError(result, "root-not-directory");
  });

  it("fails closed when the sanctioned root is unresolvable", async () => {
    const fs = new FakeFs().dir("/repo").unreadable("/repo");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["a.txt"], fs });
    expectError(result, "unresolvable-root");
  });

  it("rejects empty claims", async () => {
    const fs = new FakeFs().dir("/repo");
    const empty = await resolvePhysicalClaims({ root: "/repo", claims: [""], fs });
    expectError(empty, "empty-claim");
    const dot = await resolvePhysicalClaims({ root: "/repo", claims: ["./"], fs });
    expectError(dot, "empty-claim");
  });

  it("rejects absolute claims in every form", async () => {
    const fs = new FakeFs().dir("/repo");
    const posix = await resolvePhysicalClaims({ root: "/repo", claims: ["/etc/passwd"], fs });
    expectError(posix, "absolute-claim");
    const backslash = await resolvePhysicalClaims({ root: "/repo", claims: ["\\etc\\passwd"], fs });
    expectError(backslash, "absolute-claim");
    const drive = await resolvePhysicalClaims({ root: "/repo", claims: ["C:\\repo\\a.txt"], fs });
    expectError(drive, "absolute-claim");
    const unc = await resolvePhysicalClaims({ root: "/repo", claims: ["\\\\server\\share\\a.txt"], fs });
    expectError(unc, "absolute-claim");
  });

  it("rejects traversal claims", async () => {
    const fs = new FakeFs().dir("/repo");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["../a.txt"], fs });
    expectError(result, "traversal-claim");
    const nested = await resolvePhysicalClaims({ root: "/repo", claims: ["work/../../a.txt"], fs });
    expectError(nested, "traversal-claim");
  });

  it("treats backslash as a separator, so backslash traversal is rejected", async () => {
    const fs = new FakeFs().dir("/repo");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["a\\..\\secret"], fs });
    expectError(result, "traversal-claim");
  });

  it("resolves backslash-separated claims the same as forward slashes", async () => {
    const fs = new FakeFs().dir("/repo").dir("/repo/work").file("/repo/work/a.txt");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["work\\a.txt"], fs });
    expect(result).toEqual({ ok: true, root: "/repo", identities: ["/repo/work/a.txt"] });
  });

  it("walks to the nearest existing ancestor for not-yet-created leaf files", async () => {
    const fs = new FakeFs().dir("/repo").dir("/repo/a");
    const result = await resolvePhysicalClaims({
      root: "/repo",
      claims: ["a/b/c.txt", "brand-new/deep/file.txt"],
      fs,
    });
    expect(result).toEqual({
      ok: true,
      root: "/repo",
      identities: ["/repo/a/b/c.txt", "/repo/brand-new/deep/file.txt"],
    });
  });

  it("rejects a dangling symlink: its target may appear later and change the identity", async () => {
    const fs = new FakeFs().dir("/repo").link("/repo/planned", "/repo/work");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["planned/a.txt"], fs });
    expectError(result, "unresolvable-claim");
  });

  it("rejects a dangling symlink as the leaf itself", async () => {
    const fs = new FakeFs().dir("/repo").link("/repo/link.txt", "/repo/missing.txt");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["link.txt"], fs });
    expectError(result, "unresolvable-claim");
  });

  it("collapses internal symlink aliases to one physical identity", async () => {
    const fs = new FakeFs()
      .dir("/repo")
      .dir("/repo/work")
      .file("/repo/work/a.txt")
      .link("/repo/work-link", "/repo/work")
      .link("/repo/alias.txt", "/repo/work/a.txt");
    const result = await resolvePhysicalClaims({
      root: "/repo",
      claims: ["work/a.txt", "work-link/a.txt", "alias.txt"],
      fs,
    });
    expect(result).toEqual({
      ok: true,
      root: "/repo",
      identities: ["/repo/work/a.txt", "/repo/work/a.txt", "/repo/work/a.txt"],
    });
  });

  it("rejects a symlink that escapes the root when its leaf does not exist yet", async () => {
    const fs = new FakeFs().dir("/repo").dir("/etc").link("/repo/out", "/etc");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["out/passwd"], fs });
    expectError(result, "physical-escape");
  });

  it("rejects a symlink that escapes the root when its leaf already exists", async () => {
    const fs = new FakeFs().dir("/repo").dir("/etc").file("/etc/passwd").link("/repo/out", "/etc");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["out/passwd"], fs });
    expectError(result, "physical-escape");
  });

  it("rejects a symlink that escapes through a nested existing ancestor", async () => {
    const fs = new FakeFs().dir("/repo").dir("/repo/sub").dir("/etc").link("/repo/sub/out", "/etc");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["sub/out/secret.txt"], fs });
    expectError(result, "physical-escape");
  });

  it("fails closed on an unresolvable claim path", async () => {
    const fs = new FakeFs().dir("/repo").dir("/repo/denied").unreadable("/repo/denied");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["denied/a.txt"], fs });
    expectError(result, "unresolvable-claim");
  });

  it("fails closed on a symlink loop", async () => {
    const fs = new FakeFs().dir("/repo").link("/repo/loop-a", "/repo/loop-b").link("/repo/loop-b", "/repo/loop-a");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["loop-a/a.txt"], fs });
    expectError(result, "unresolvable-claim");
  });

  it("returns identities aligned with the input claims in order", async () => {
    const fs = new FakeFs().dir("/repo").dir("/repo/work").file("/repo/work/a.txt");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: ["work", "work/a.txt", "new.txt"], fs });
    expect(result).toEqual({
      ok: true,
      root: "/repo",
      identities: ["/repo/work", "/repo/work/a.txt", "/repo/new.txt"],
    });
  });

  it("accepts an empty claim list", async () => {
    const fs = new FakeFs().dir("/repo");
    const result = await resolvePhysicalClaims({ root: "/repo", claims: [], fs });
    expect(result).toEqual({ ok: true, root: "/repo", identities: [] });
  });
});
