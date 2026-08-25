import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CleanupPlan, OwnershipProof, PathFlavor, PrepareAdapter, WorkspaceEffects } from "../lib/foundry/workspace";
import {
  cleanupPlan,
  defaultWorkspaceEffects,
  deriveWorkspacePath,
  isContainedWithin,
  pathApiFor,
  planWorkspace,
  preparePlan,
  prepareWorkspace,
  proveOwnership,
  releaseCleanupSteps,
  resolveCleanupStepsLexical,
  sanitizeTaskId,
  validateCleanupContainment,
  verifyOwnership,
} from "../lib/foundry/workspace";

// Sanctioned root for tests: a /tmp path that must NOT be created by any plan
// function. Proves the module is data-only (no filesystem mutation).
const ROOT = `/tmp/foundry-workspace-test-${process.pid}`;

const spec = {
  taskId: "task-123",
  host: "vps",
  isolation: "git-worktree",
  root: ROOT,
} as const;

describe("sanitizeTaskId", () => {
  it("keeps a safe id unchanged", () => {
    expect(sanitizeTaskId("task-123.abc_x")).toBe("task-123.abc_x");
  });

  it("collapses unsafe characters and traversal tokens into a safe segment", () => {
    const label = sanitizeTaskId("../../etc/passwd  task");
    expect(label).not.toMatch(/[/\\]/);
    expect(label).not.toContain("..");
    expect(label).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("is deterministic", () => {
    expect(sanitizeTaskId("My Task #4!")).toBe(sanitizeTaskId("My Task #4!"));
  });

  it("rejects empty or all-unsafe ids", () => {
    expect(() => sanitizeTaskId("")).toThrow();
    expect(() => sanitizeTaskId("///")).toThrow();
    expect(() => sanitizeTaskId("..")).toThrow();
    expect(() => sanitizeTaskId("...")).toThrow();
  });
});

describe("isContainedWithin (posix)", () => {
  const api = pathApiFor("posix");

  it("accepts a strict descendant", () => {
    expect(isContainedWithin(`${ROOT}/tasks/git-worktree/vps/task-123`, ROOT, api)).toBe(true);
  });

  it("rejects the root itself", () => {
    expect(isContainedWithin(ROOT, ROOT, api)).toBe(false);
  });

  it("rejects a parent or sibling", () => {
    expect(isContainedWithin("/tmp", ROOT, api)).toBe(false);
    expect(isContainedWithin(`${ROOT}-other/tasks/x`, ROOT, api)).toBe(false);
  });

  it("rejects upward traversal", () => {
    expect(isContainedWithin(`${ROOT}/tasks/../etc/passwd`, ROOT, api)).toBe(false);
    expect(isContainedWithin(`${ROOT}/..`, ROOT, api)).toBe(false);
  });

  it("rejects filesystem roots as target and as root", () => {
    expect(isContainedWithin("/", ROOT, api)).toBe(false);
    expect(isContainedWithin("/etc", "/", api)).toBe(false); // root = "/" is unsafe
  });

  it("rejects empty inputs", () => {
    expect(isContainedWithin("", ROOT, api)).toBe(false);
    expect(isContainedWithin(ROOT, "", api)).toBe(false);
  });
});

describe("isContainedWithin (win32)", () => {
  const api = pathApiFor("win32");
  const winRoot = "C:\\foundry\\workspaces";

  it("accepts a strict descendant on the same drive", () => {
    expect(isContainedWithin("C:\\foundry\\workspaces\\tasks\\vm\\box\\task-1", winRoot, api)).toBe(true);
  });

  it("accepts forward slashes and drive-case differences", () => {
    expect(isContainedWithin("C:/foundry/workspaces/tasks/vm/box/task-1", winRoot, api)).toBe(true);
    expect(isContainedWithin("c:\\foundry\\workspaces\\tasks\\vm\\box\\task-1", winRoot, api)).toBe(true);
  });

  it("rejects the root itself, a sibling prefix, and a different drive", () => {
    expect(isContainedWithin(winRoot, winRoot, api)).toBe(false);
    expect(isContainedWithin("C:\\foundry\\workspaces2\\x", winRoot, api)).toBe(false);
    expect(isContainedWithin("D:\\foundry\\workspaces\\x", winRoot, api)).toBe(false);
  });

  it("rejects a filesystem drive root", () => {
    expect(isContainedWithin("C:\\", winRoot, api)).toBe(false);
    expect(isContainedWithin("C:\\x", "C:\\", api)).toBe(false);
  });
});

describe("planWorkspace / deriveWorkspacePath", () => {
  it("derives a deterministic contained path for posix hosts", () => {
    const plan = planWorkspace(spec);
    expect(plan.path).toBe(deriveWorkspacePath(spec));
    expect(plan.path).toBe(`${ROOT}/tasks/git-worktree/vps/task-123`);
    expect(plan.workspaceId).toBe("foundry-vps-git-worktree-task-123");
    expect(plan.label).toBe("task-123");
    expect(plan.pathFlavor).toBe("posix");
    expect(isContainedWithin(plan.path, plan.root, pathApiFor(plan.pathFlavor))).toBe(true);
  });

  it("is deterministic across calls", () => {
    expect(planWorkspace(spec).path).toBe(planWorkspace(spec).path);
    expect(planWorkspace(spec).workspaceId).toBe(planWorkspace(spec).workspaceId);
  });

  it("supports win32 flavor with backslash paths", () => {
    const win = planWorkspace({
      ...spec,
      root: "C:\\foundry\\workspaces",
      host: "box",
      isolation: "vm",
      pathFlavor: "win32",
    });
    expect(win.path).toBe("C:\\foundry\\workspaces\\tasks\\vm\\box\\task-123");
    expect(win.pathFlavor).toBe("win32");
    expect(isContainedWithin(win.path, win.root, pathApiFor("win32"))).toBe(true);
  });

  it("throws when the root is a filesystem root", () => {
    expect(() => planWorkspace({ ...spec, root: "/" })).toThrow(/filesystem root/);
    expect(() => planWorkspace({ ...spec, root: "C:\\", pathFlavor: "win32" })).toThrow(/filesystem root/);
  });

  it("throws when the task id cannot produce a safe label", () => {
    expect(() => planWorkspace({ ...spec, taskId: "..." })).toThrow();
  });
});

describe("ownership proof", () => {
  it("round-trips a matching proof", () => {
    const plan = planWorkspace(spec);
    expect(verifyOwnership(plan, proveOwnership(plan))).toBe(true);
  });

  it("rejects a proof for a different task or workspace", () => {
    const plan = planWorkspace(spec);
    const proof = proveOwnership(plan);
    expect(verifyOwnership(plan, { ...proof, taskId: "other" })).toBe(false);
    expect(verifyOwnership(plan, { ...proof, workspaceId: "foundry-vps-git-worktree-other" })).toBe(false);
    expect(verifyOwnership(plan, { ...proof, path: `${ROOT}/tasks/../other` })).toBe(false);
  });

  it("rejects a proof whose path is not contained", () => {
    const plan = planWorkspace(spec);
    const proof = proveOwnership(plan);
    expect(verifyOwnership(plan, { ...proof, path: `${ROOT}/escaped` })).toBe(false);
  });
});

describe("preparePlan", () => {
  it("is idempotent: the same plan yields identical steps", () => {
    const plan = planWorkspace(spec);
    const a = preparePlan(plan, { repoPath: `${ROOT}/repo` });
    const b = preparePlan(plan, { repoPath: `${ROOT}/repo` });
    expect(a.steps).toEqual(b.steps);
    expect(a.id).toBe(`${plan.workspaceId}:prepare`);
  });

  it("builds a guarded git worktree plan and requires repoPath", () => {
    const plan = planWorkspace(spec);
    expect(() => preparePlan(plan)).toThrow(/repoPath/);
    const prepared = preparePlan(plan, { repoPath: `${ROOT}/repo` });
    // Executable step order: the run step is first and NO mkdir precedes it.
    // `git worktree add <path>` creates the target directory itself and
    // requires the path to be absent, so a plan that mkdir's first cannot
    // create a worktree on a missing path.
    expect(prepared.steps).toHaveLength(1);
    expect(prepared.steps[0]).toMatchObject({
      kind: "run",
      cwd: `${ROOT}/repo`,
      argv: ["git", "worktree", "add", plan.path, `foundry/${plan.label}`],
      guard: { type: "path-missing", path: plan.path },
    });
  });

  it("builds a guarded container plan and requires an image", () => {
    const plan = planWorkspace({ ...spec, isolation: "container" });
    expect(() => preparePlan(plan)).toThrow(/image/);
    const prepared = preparePlan(plan, { image: "node:24" });
    expect(prepared.steps[1]).toMatchObject({
      kind: "run",
      argv: ["docker", "create", "--name", plan.label, "--workdir", plan.path, "node:24"],
      guard: { type: "name-absent", name: plan.label },
    });
  });

  it("builds a guarded VM launch plan", () => {
    const plan = planWorkspace({ ...spec, isolation: "vm" });
    const prepared = preparePlan(plan);
    expect(prepared.steps[1]).toMatchObject({
      kind: "run",
      argv: ["multipass", "launch", "--name", plan.label],
      guard: { type: "name-absent", name: plan.label },
    });
  });

  it("never emits destructive commands", () => {
    for (const isolation of ["git-worktree", "container", "vm"] as const) {
      const plan = planWorkspace({ ...spec, isolation });
      const opts =
        isolation === "git-worktree" ? { repoPath: `${ROOT}/repo` } : isolation === "container" ? { image: "node:24" } : {};
      for (const step of preparePlan(plan, opts).steps) {
        if (step.kind === "run") {
          expect(step.argv.join(" ")).not.toMatch(/\b(rm|delete|remove|destroy)\b/);
        }
      }
    }
  });
});

describe("cleanupPlan / resolveCleanupStepsLexical", () => {
  const plan = planWorkspace(spec);

  it("is a plan requiring ownership proof and performs no fs writes", () => {
    const cleanup = cleanupPlan(plan, { repoPath: `${ROOT}/repo` });
    expect(cleanup.requiresOwnershipProof).toBe(true);
    expect(cleanup.id).toBe(`${plan.workspaceId}:cleanup`);
    expect(existsSync(plan.path)).toBe(false);
    expect(existsSync(plan.root)).toBe(false);
  });

  it("refuses lexically without a valid ownership proof", () => {
    const cleanup = cleanupPlan(plan, { repoPath: `${ROOT}/repo` });
    const forged = proveOwnership(planWorkspace({ ...spec, taskId: "other" }));
    expect(() => resolveCleanupStepsLexical(cleanup, forged)).toThrow(/ownership proof/);
  });

  it("returns a non-executable marker, all remove paths contained", () => {
    const cleanup = cleanupPlan(plan, { repoPath: `${ROOT}/repo` });
    const { steps, executable } = resolveCleanupStepsLexical(cleanup, proveOwnership(plan));
    expect(executable).toBe(false);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      if (step.kind === "remove") {
        expect(step.path).toBe(plan.path);
        expect(isContainedWithin(step.path, plan.root, pathApiFor(plan.pathFlavor))).toBe(true);
        expect(step.path).not.toBe(plan.root);
      }
    }
  });

  it("never targets the root or above for any isolation kind", () => {
    for (const isolation of ["git-worktree", "container", "vm"] as const) {
      const p = planWorkspace({ ...spec, isolation });
      const cleanup = cleanupPlan(p, { repoPath: `${ROOT}/repo` });
      for (const step of resolveCleanupStepsLexical(cleanup, proveOwnership(p)).steps) {
        if (step.kind === "remove") {
          expect(isContainedWithin(step.path, p.root, pathApiFor(p.pathFlavor))).toBe(true);
        }
      }
    }
  });
});

describe("validateCleanupContainment (real filesystem symlinks)", () => {
  // Real temp tree so the default fs.promises.realpath resolves actual
  // symlinks. The validator itself stays read-only; only test setup mutates.
  const physRoot = mkdtempSync(join(tmpdir(), "foundry-ws-phys-"));
  const plan = planWorkspace({ taskId: "phys-1", host: "vps", isolation: "git-worktree", root: physRoot });
  const parentDir = join(physRoot, "tasks", "git-worktree", "vps");
  // A real directory inside the root an internal symlink can point at.
  const insideTarget = join(physRoot, "data", "phys-1");
  // A real directory outside the root an escaping symlink can point at.
  const outsideTarget = mkdtempSync(join(tmpdir(), "foundry-ws-outside-"));
  mkdirSync(parentDir, { recursive: true });
  mkdirSync(insideTarget, { recursive: true });

  afterAll(() => {
    rmSync(physRoot, { recursive: true, force: true });
    rmSync(outsideTarget, { recursive: true, force: true });
  });

  it("allows an internal symlink that stays under the physical root", async () => {
    symlinkSync(insideTarget, plan.path);
    const cleanup = cleanupPlan(plan, { repoPath: join(physRoot, "repo") });
    const result = await validateCleanupContainment(cleanup);
    expect(result.ok).toBe(true);
    expect(result.escaped).toEqual([]);
    expect(result.missing).toEqual([]);
    rmSync(plan.path); // removes the symlink itself, never its target
  });

  it("rejects an external symlink that escapes the physical root", async () => {
    symlinkSync(outsideTarget, plan.path);
    const cleanup = cleanupPlan(plan);
    const result = await validateCleanupContainment(cleanup);
    expect(result.ok).toBe(false);
    expect(result.escaped).toEqual([plan.path]);
    expect(result.missing).toEqual([]);
    rmSync(plan.path);
  });

  it("treats a missing target as an idempotent no-op", async () => {
    if (existsSync(plan.path)) rmSync(plan.path);
    const cleanup = cleanupPlan(plan);
    const result = await validateCleanupContainment(cleanup);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([plan.path]);
    expect(result.escaped).toEqual([]);
  });

  it("rejects a symlink that resolves to the physical root itself", async () => {
    symlinkSync(physRoot, plan.path);
    const cleanup = cleanupPlan(plan);
    const result = await validateCleanupContainment(cleanup);
    expect(result.ok).toBe(false);
    expect(result.escaped).toEqual([plan.path]);
    rmSync(plan.path);
  });
});

describe("validateCleanupContainment (injected realpath)", () => {
  // A data-only filesystem boundary: maps path -> physical path, ENOENT when
  // absent. No real fs needed, so POSIX and Win32 lexemes are testable here.
  const fakeRealpath =
    (map: Record<string, string>) =>
    async (p: string): Promise<string> => {
      if (!(p in map)) {
        throw Object.assign(new Error(`no such file: ${p}`), { code: "ENOENT" });
      }
      return map[p];
    };

  const makeCleanup = (root: string, target: string, pathFlavor: PathFlavor = "posix"): CleanupPlan => ({
    id: "foundry-vps-git-worktree-t-1:cleanup",
    workspaceId: "foundry-vps-git-worktree-t-1",
    taskId: "t-1",
    host: "vps",
    isolation: "git-worktree",
    pathFlavor,
    root,
    path: target,
    createdAt: "2026-01-01T00:00:00.000Z",
    requiresOwnershipProof: true,
    steps: [{ kind: "remove", path: target, guard: { type: "path-present", path: target } }],
  });

  it("POSIX: allows a target physically contained under the root", async () => {
    const root = "/srv/foundry/workspaces";
    const target = `${root}/tasks/git-worktree/vps/t-1`;
    const result = await validateCleanupContainment(makeCleanup(root, target), {
      realpath: fakeRealpath({ [root]: root, [target]: target }),
    });
    expect(result.ok).toBe(true);
    expect(result.escaped).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("POSIX: rejects a target whose physical path escapes the root", async () => {
    const root = "/srv/foundry/workspaces";
    const target = `${root}/tasks/git-worktree/vps/t-1`;
    const result = await validateCleanupContainment(makeCleanup(root, target), {
      realpath: fakeRealpath({ [root]: root, [target]: "/etc/passwd" }),
    });
    expect(result.ok).toBe(false);
    expect(result.escaped).toEqual([target]);
  });

  it("POSIX: treats a missing target as an idempotent no-op", async () => {
    const root = "/srv/foundry/workspaces";
    const target = `${root}/tasks/git-worktree/vps/t-1`;
    const result = await validateCleanupContainment(makeCleanup(root, target), {
      realpath: fakeRealpath({ [root]: root }), // target is absent
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([target]);
    expect(result.escaped).toEqual([]);
  });

  it("POSIX: rejects a raw .. target before any resolution", async () => {
    const root = "/srv/foundry/workspaces";
    const target = `${root}/tasks/../etc/passwd`;
    const result = await validateCleanupContainment(makeCleanup(root, target), {
      realpath: fakeRealpath({ [root]: root }),
    });
    expect(result.ok).toBe(false);
    expect(result.escaped).toEqual([target]);
  });

  it("POSIX: a missing root is an idempotent no-op", async () => {
    const root = "/srv/foundry/workspaces";
    const target = `${root}/tasks/git-worktree/vps/t-1`;
    const result = await validateCleanupContainment(makeCleanup(root, target), {
      realpath: fakeRealpath({}), // neither root nor target exists
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([target]);
  });

  it("POSIX: a non-ENOENT resolution failure fails closed", async () => {
    const root = "/srv/foundry/workspaces";
    const target = `${root}/tasks/git-worktree/vps/t-1`;
    const result = await validateCleanupContainment(makeCleanup(root, target), {
      realpath: async () => {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      },
    });
    expect(result.ok).toBe(false);
    expect(result.unresolvable).toContain(root);
  });

  it("Win32: allows a contained target on the same drive", async () => {
    const root = "C:\\foundry\\workspaces";
    const target = "C:\\foundry\\workspaces\\tasks\\vm\\box\\t-1";
    const result = await validateCleanupContainment(makeCleanup(root, target, "win32"), {
      realpath: fakeRealpath({ [root]: root, [target]: target }),
    });
    expect(result.ok).toBe(true);
  });

  it("Win32: rejects a target that physically escapes to another drive", async () => {
    const root = "C:\\foundry\\workspaces";
    const target = "C:\\foundry\\workspaces\\tasks\\vm\\box\\t-1";
    const result = await validateCleanupContainment(makeCleanup(root, target, "win32"), {
      realpath: fakeRealpath({ [root]: root, [target]: "D:\\escaped" }),
    });
    expect(result.ok).toBe(false);
    expect(result.escaped).toEqual([target]);
  });

  it("Win32: treats a missing target as a no-op", async () => {
    const root = "C:\\foundry\\workspaces";
    const target = "C:\\foundry\\workspaces\\tasks\\vm\\box\\t-1";
    const result = await validateCleanupContainment(makeCleanup(root, target, "win32"), {
      realpath: fakeRealpath({ [root]: root }),
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([target]);
  });
});

describe("releaseCleanupSteps (injected realpath)", () => {
  const fakeRealpath =
    (map: Record<string, string>) =>
    async (p: string): Promise<string> => {
      if (!(p in map)) {
        throw Object.assign(new Error(`no such file: ${p}`), { code: "ENOENT" });
      }
      return map[p];
    };

  const makeCleanup = (root: string, target: string, pathFlavor: PathFlavor = "posix"): CleanupPlan => ({
    id: "foundry-vps-git-worktree-t-1:cleanup",
    workspaceId: "foundry-vps-git-worktree-t-1",
    taskId: "t-1",
    host: "vps",
    isolation: "git-worktree",
    pathFlavor,
    root,
    path: target,
    createdAt: "2026-01-01T00:00:00.000Z",
    requiresOwnershipProof: true,
    steps: [{ kind: "remove", path: target, guard: { type: "path-present", path: target } }],
  });

  const root = "/srv/foundry/workspaces";
  const target = `${root}/tasks/git-worktree/vps/t-1`;

  it("releases executable steps only after ownership and physical containment pass", async () => {
    const cleanup = makeCleanup(root, target);
    const steps = await releaseCleanupSteps(cleanup, proveOwnership(cleanup), {
      realpath: fakeRealpath({ [root]: root, [target]: target }),
    });
    expect(steps).toEqual(cleanup.steps);
  });

  it("fails closed on an ownership mismatch before any physical check", async () => {
    const cleanup = makeCleanup(root, target);
    const forged: OwnershipProof = {
      workspaceId: "foundry-vps-git-worktree-t-1",
      taskId: "t-1",
      path: `${root}/tasks/git-worktree/vps/other`,
      issuedAt: "2026-01-01T00:00:00.000Z",
    };
    // The realpath map would pass physical containment; only the ownership gate
    // can be the cause of this refusal, proving it runs first.
    await expect(
      releaseCleanupSteps(cleanup, forged, {
        realpath: fakeRealpath({ [root]: root, [target]: target }),
      }),
    ).rejects.toThrow(/ownership proof/);
  });

  it("fails closed when the sanctioned root is missing", async () => {
    const cleanup = makeCleanup(root, target);
    await expect(
      releaseCleanupSteps(cleanup, proveOwnership(cleanup), { realpath: fakeRealpath({}) }),
    ).rejects.toThrow(/sanctioned root does not exist/);
  });

  it("fails closed when the sanctioned root cannot be resolved", async () => {
    const cleanup = makeCleanup(root, target);
    await expect(
      releaseCleanupSteps(cleanup, proveOwnership(cleanup), {
        realpath: async () => {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
      }),
    ).rejects.toThrow(/sanctioned root could not be resolved/);
  });

  it("fails closed when a remove target physically escapes the root", async () => {
    const cleanup = makeCleanup(root, target);
    await expect(
      releaseCleanupSteps(cleanup, proveOwnership(cleanup), {
        realpath: fakeRealpath({ [root]: root, [target]: "/etc/passwd" }),
      }),
    ).rejects.toThrow(/physical containment/);
  });

  it("releases no-op steps when the root exists but the target is already gone", async () => {
    const cleanup = makeCleanup(root, target);
    const steps = await releaseCleanupSteps(cleanup, proveOwnership(cleanup), {
      realpath: fakeRealpath({ [root]: root }), // target absent
    });
    expect(steps).toEqual(cleanup.steps);
  });
});

describe("releaseCleanupSteps (real filesystem)", () => {
  // Real temp tree so the default fs.promises.realpath resolves actual
  // symlinks. The release boundary itself stays read-only; only test setup
  // mutates.
  const physRoot = mkdtempSync(join(tmpdir(), "foundry-ws-release-"));
  const plan = planWorkspace({ taskId: "release-1", host: "vps", isolation: "git-worktree", root: physRoot });
  const parentDir = join(physRoot, "tasks", "git-worktree", "vps");
  // A real directory inside the root an internal symlink can point at.
  const insideTarget = join(physRoot, "data", "release-1");
  // A real directory outside the root an escaping symlink can point at.
  const outsideTarget = mkdtempSync(join(tmpdir(), "foundry-ws-release-out-"));
  mkdirSync(parentDir, { recursive: true });
  mkdirSync(insideTarget, { recursive: true });

  afterAll(() => {
    rmSync(physRoot, { recursive: true, force: true });
    rmSync(outsideTarget, { recursive: true, force: true });
  });

  it("releases executable steps for an internal real directory and deletes nothing", async () => {
    mkdirSync(plan.path, { recursive: true });
    const cleanup = cleanupPlan(plan, { repoPath: join(physRoot, "repo") });
    const steps = await releaseCleanupSteps(cleanup, proveOwnership(plan));
    expect(steps.some((s) => s.kind === "remove" && s.path === plan.path)).toBe(true);
    // No deletion occurred: the released target still exists afterwards.
    expect(existsSync(plan.path)).toBe(true);
    rmSync(plan.path, { recursive: true, force: true });
  });

  it("releases executable steps for an internal symlink that stays under the root", async () => {
    rmSync(plan.path, { recursive: true, force: true }); // clear any leftover dir
    symlinkSync(insideTarget, plan.path);
    const cleanup = cleanupPlan(plan, { repoPath: join(physRoot, "repo") });
    const steps = await releaseCleanupSteps(cleanup, proveOwnership(plan));
    expect(steps.some((s) => s.kind === "remove" && s.path === plan.path)).toBe(true);
    // The symlink itself was not deleted or replaced.
    expect(lstatSync(plan.path).isSymbolicLink()).toBe(true);
    rmSync(plan.path, { recursive: true, force: true });
  });

  it("fails closed on an escaping symlink and never releases steps", async () => {
    rmSync(plan.path, { recursive: true, force: true }); // clear any leftover dir
    symlinkSync(outsideTarget, plan.path);
    const cleanup = cleanupPlan(plan, { repoPath: join(physRoot, "repo") });
    await expect(releaseCleanupSteps(cleanup, proveOwnership(plan))).rejects.toThrow(/physical containment/);
    // The outside target is untouched: no deletion, no step release.
    expect(existsSync(outsideTarget)).toBe(true);
    rmSync(plan.path, { recursive: true, force: true });
  });

  it("fails closed when the sanctioned root is missing", async () => {
    const missingRoot = join(tmpdir(), `foundry-ws-release-missing-${process.pid}`);
    const p = planWorkspace({ taskId: "release-2", host: "vps", isolation: "git-worktree", root: missingRoot });
    const cleanup = cleanupPlan(p, { repoPath: join(missingRoot, "repo") });
    expect(existsSync(missingRoot)).toBe(false);
    await expect(releaseCleanupSteps(cleanup, proveOwnership(p))).rejects.toThrow(/sanctioned root does not exist/);
  });

  it("fails closed on an ownership mismatch and performs no deletion", async () => {
    mkdirSync(plan.path, { recursive: true });
    const cleanup = cleanupPlan(plan, { repoPath: join(physRoot, "repo") });
    const forged = proveOwnership(
      planWorkspace({ taskId: "release-other", host: "vps", isolation: "git-worktree", root: physRoot }),
    );
    await expect(releaseCleanupSteps(cleanup, forged)).rejects.toThrow(/ownership proof/);
    expect(existsSync(plan.path)).toBe(true);
    rmSync(plan.path, { recursive: true, force: true });
  });
});

type RecordedRun = { argv: string[]; cwd?: string };

/**
 * Injectable effects fake for `prepareWorkspace`. Records every mkdir/run so
 * tests can prove argv, parent-only creation, and idempotency without touching
 * the real filesystem, git, or the network. Models git's side effect: a
 * `worktree add` makes the target "appear" in exists/realpath.
 */
function makeFakeEffects(init: {
  exists?: Record<string, boolean>;
  realpath?: Record<string, string>;
  porcelain?: string;
} = {}) {
  const mkdirCalls: string[] = [];
  const runCalls: RecordedRun[] = [];
  const existsMap: Record<string, boolean> = { ...(init.exists ?? {}) };
  const realpathMap: Record<string, string> = { ...(init.realpath ?? {}) };
  let porcelain = init.porcelain ?? "";
  const effects: WorkspaceEffects = {
    fs: {
      mkdir: async (path: string) => {
        mkdirCalls.push(path);
        // The created directory now resolves to itself (a real fs would too).
        if (!(path in realpathMap)) realpathMap[path] = path;
      },
      realpath: async (path: string) => {
        if (!(path in realpathMap)) {
          throw Object.assign(new Error(`no such file: ${path}`), { code: "ENOENT" });
        }
        return realpathMap[path];
      },
      exists: async (path: string) => existsMap[path] === true,
    },
    run: async (argv: string[], opts?: { cwd?: string }) => {
      runCalls.push({ argv, cwd: opts?.cwd });
      if (argv[0] === "git" && argv[1] === "worktree" && argv[2] === "add") {
        // git creates the target directory. Resolve it through the physical
        // parent so a symlinked root is modeled correctly.
        const target = argv[argv.length - 1];
        existsMap[target] = true;
        const i = target.lastIndexOf("/");
        const lexicalParent = target.slice(0, i);
        const physicalParent = realpathMap[lexicalParent] ?? lexicalParent;
        realpathMap[target] = `${physicalParent}${target.slice(i)}`;
        return { stdout: "", stderr: "" };
      }
      if (argv[0] === "git" && argv[1] === "worktree" && argv[2] === "list") {
        return { stdout: porcelain, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  };
  return { effects, mkdirCalls, runCalls };
}

const PREPARE_ROOT = "/srv/foundry/workspaces";
const PREPARE_PLAN = planWorkspace({ taskId: "t-1", host: "vps", isolation: "git-worktree", root: PREPARE_ROOT });
const PREPARE_TARGET = PREPARE_PLAN.path;
const PREPARE_PARENT = `${PREPARE_ROOT}/tasks/git-worktree/vps`;

describe("prepareWorkspace (injected effects, git-worktree)", () => {
  it("creates only the sanctioned parent and runs git via argv, never a shell", async () => {
    const fake = makeFakeEffects({ realpath: { [PREPARE_ROOT]: PREPARE_ROOT } });
    const prepared = await prepareWorkspace(PREPARE_PLAN, { repoPath: "/srv/repo", effects: fake.effects });
    expect(prepared).toBe(PREPARE_PLAN);
    // mkdir was called exactly once, for the parent chain, NEVER the target.
    expect(fake.mkdirCalls).toEqual([PREPARE_PARENT]);
    expect(fake.mkdirCalls).not.toContain(PREPARE_TARGET);
    // git runs through a single argv array; index 0 is the executable.
    expect(fake.runCalls).toHaveLength(1);
    expect(fake.runCalls[0].cwd).toBe("/srv/repo");
    expect(fake.runCalls[0].argv).toEqual(["git", "worktree", "add", "-b", "foundry/t-1", PREPARE_TARGET]);
    // No destructive, push/merge/deploy, or force vocabulary anywhere.
    const flat = fake.runCalls.map((r) => r.argv.join(" ")).join(" | ");
    expect(flat).not.toMatch(/\b(rm|delete|remove|destroy|push|merge|deploy|--force)\b/);
  });

  it("requires repoPath for git-worktree isolation", async () => {
    await expect(prepareWorkspace(PREPARE_PLAN)).rejects.toThrow(/repoPath/);
  });

  it("is idempotent: a valid existing workspace is detected and never recreated", async () => {
    const fake = makeFakeEffects({
      realpath: { [PREPARE_ROOT]: PREPARE_ROOT, [PREPARE_PARENT]: PREPARE_PARENT, [PREPARE_TARGET]: PREPARE_TARGET },
      exists: { [PREPARE_TARGET]: true },
      porcelain: `worktree ${PREPARE_TARGET}\nHEAD 9d44eeb\nbranch refs/heads/foundry/t-1\n`,
    });
    const first = await prepareWorkspace(PREPARE_PLAN, { repoPath: "/srv/repo", effects: fake.effects });
    const second = await prepareWorkspace(PREPARE_PLAN, { repoPath: "/srv/repo", effects: fake.effects });
    expect(second).toBe(first);
    expect(second.path).toBe(PREPARE_TARGET);
    // Only porcelain listing ran each time; never a `worktree add`.
    expect(fake.runCalls).toHaveLength(2);
    for (const call of fake.runCalls) {
      expect(call.argv).toEqual(["git", "worktree", "list", "--porcelain"]);
      expect(call.cwd).toBe("/srv/repo");
    }
    expect(fake.mkdirCalls).not.toContain(PREPARE_TARGET);
  });

  it("rejects a target symlink that physically escapes the root", async () => {
    const fake = makeFakeEffects({
      realpath: { [PREPARE_ROOT]: PREPARE_ROOT, [PREPARE_PARENT]: PREPARE_PARENT, [PREPARE_TARGET]: "/etc/passwd" },
      exists: { [PREPARE_TARGET]: true },
    });
    await expect(prepareWorkspace(PREPARE_PLAN, { repoPath: "/srv/repo", effects: fake.effects })).rejects.toThrow(
      /physically escapes/,
    );
    expect(fake.runCalls).toHaveLength(0); // rejected before any git invocation
  });

  it("rejects an escaping symlink in the parent chain before creating anything", async () => {
    const fake = makeFakeEffects({
      realpath: { [PREPARE_ROOT]: PREPARE_ROOT, [`${PREPARE_ROOT}/tasks`]: "/etc" },
    });
    await expect(prepareWorkspace(PREPARE_PLAN, { repoPath: "/srv/repo", effects: fake.effects })).rejects.toThrow(
      /physically escapes/,
    );
    expect(fake.mkdirCalls).toHaveLength(0); // rejected BEFORE any mutation
    expect(fake.runCalls).toHaveLength(0);
  });

  it("uses the physical root as the containment boundary when the root is a symlink", async () => {
    const fake = makeFakeEffects({
      realpath: {
        [PREPARE_ROOT]: "/real/root",
        [PREPARE_PARENT]: "/real/root/tasks/git-worktree/vps",
      },
    });
    const prepared = await prepareWorkspace(PREPARE_PLAN, { repoPath: "/srv/repo", effects: fake.effects });
    expect(prepared.path).toBe(PREPARE_TARGET);
    // Everything physically resolved under /real/root, so it is contained.
    expect(fake.runCalls[0].argv).toEqual(["git", "worktree", "add", "-b", "foundry/t-1", PREPARE_TARGET]);
  });

  it("rejects a target that physically escapes even when the root is a symlink", async () => {
    const fake = makeFakeEffects({
      realpath: {
        [PREPARE_ROOT]: "/real/root",
        [PREPARE_PARENT]: "/real/root/tasks/git-worktree/vps",
        [PREPARE_TARGET]: "/etc/passwd",
      },
      exists: { [PREPARE_TARGET]: true },
    });
    await expect(prepareWorkspace(PREPARE_PLAN, { repoPath: "/srv/repo", effects: fake.effects })).rejects.toThrow(
      /physically escapes/,
    );
    expect(fake.runCalls).toHaveLength(0);
  });

  it("fails closed when the target exists but is not a registered worktree", async () => {
    const fake = makeFakeEffects({
      realpath: { [PREPARE_ROOT]: PREPARE_ROOT, [PREPARE_PARENT]: PREPARE_PARENT, [PREPARE_TARGET]: PREPARE_TARGET },
      exists: { [PREPARE_TARGET]: true },
      porcelain: `worktree /srv/repo\nHEAD 9d44eeb\nbranch refs/heads/main\n`,
    });
    await expect(prepareWorkspace(PREPARE_PLAN, { repoPath: "/srv/repo", effects: fake.effects })).rejects.toThrow(
      /not a registered git worktree/,
    );
    // It must never delete or overwrite the occupied path: only the listing ran.
    expect(fake.runCalls).toHaveLength(1);
    expect(fake.runCalls[0].argv[2]).toBe("list");
  });
});

describe("prepareWorkspace (fail closed unsupported isolation)", () => {
  it("refuses container isolation without an explicit adapter", async () => {
    const plan = planWorkspace({ taskId: "c-1", host: "vps", isolation: "container", root: PREPARE_ROOT });
    await expect(prepareWorkspace(plan)).rejects.toThrow(/without an explicit adapter/);
  });

  it("refuses vm isolation without an explicit adapter", async () => {
    const plan = planWorkspace({ taskId: "v-1", host: "box", isolation: "vm", root: PREPARE_ROOT });
    await expect(prepareWorkspace(plan)).rejects.toThrow(/without an explicit adapter/);
  });

  it("delegates to an explicitly provided adapter instead of faking", async () => {
    const plan = planWorkspace({ taskId: "c-2", host: "vps", isolation: "container", root: PREPARE_ROOT });
    let received: unknown = null;
    const adapter: PrepareAdapter = async (p, options) => {
      received = { plan: p, repoPath: options.repoPath };
      return p;
    };
    const result = await prepareWorkspace(plan, { adapter, repoPath: "/srv/repo" });
    expect(received).toEqual({ plan, repoPath: "/srv/repo" });
    expect(result).toBe(plan);
  });
});

describe("prepareWorkspace (real git)", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "foundry-prep-git-"));
  const repo = join(tempRoot, "repo");
  const wsRoot = join(tempRoot, "ws");
  const plan = planWorkspace({ taskId: "t-real", host: "vps", isolation: "git-worktree", root: wsRoot });

  beforeAll(() => {
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@foundry"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Foundry Test"], { cwd: repo });
    writeFileSync(join(repo, "file.txt"), "hello\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: repo });
  });

  afterAll(() => {
    try {
      execFileSync("git", ["worktree", "remove", "--force", plan.path], { cwd: repo, stdio: "pipe" });
    } catch {
      // worktree may not exist; cleanup is best-effort
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("prepares a real worktree, lets git create the target, and re-applies idempotently", async () => {
    expect(existsSync(plan.path)).toBe(false);
    let adds = 0;
    const effects: Partial<WorkspaceEffects> = {
      run: async (argv, opts) => {
        if (argv[0] === "git" && argv[1] === "worktree" && argv[2] === "add") adds += 1;
        return defaultWorkspaceEffects.run(argv, opts);
      },
    };
    const prepared = await prepareWorkspace(plan, { repoPath: repo, effects });
    expect(prepared.path).toBe(plan.path);
    // git created the target directory and checked out content into it.
    expect(existsSync(plan.path)).toBe(true);
    expect(existsSync(join(plan.path, "file.txt"))).toBe(true);
    // The adapter created the sanctioned parent chain.
    expect(existsSync(join(wsRoot, "tasks", "git-worktree", "vps"))).toBe(true);
    // The worktree branch was created at HEAD.
    const branch = execFileSync("git", ["branch", "--show-current"], { cwd: plan.path, encoding: "utf8" }).trim();
    expect(branch).toBe(`foundry/${plan.label}`);

    const again = await prepareWorkspace(plan, { repoPath: repo, effects });
    expect(again.path).toBe(plan.path);
    expect(adds).toBe(1); // second call only verified; it did not re-add
  });
});
