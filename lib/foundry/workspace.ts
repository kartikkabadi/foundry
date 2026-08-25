/**
 * Safe workspace adapters for the Foundry multi-agent orchestration layer.
 *
 * This module is a pure adapter boundary. It derives deterministic, contained
 * workspace paths for git worktrees, containers, and Box VMs; validates path
 * containment and task ownership; and emits idempotent prepare/cleanup PLANS.
 * It never executes filesystem or process mutation itself: destructive work is
 * always represented as guarded data and released only through the single async
 * `releaseCleanupSteps` boundary, which re-checks ownership and physically
 * re-validates containment before any step can be executed.
 *
 * Path semantics are modelled explicitly with the `node:path` posix and win32
 * variants so the same plan language works for macOS / Linux and Windows hosts.
 * Plan-time containment is lexical (no symlink resolution), mirroring the
 * existing `isSandboxedWorkDir` guard in execute.ts. Before destructive steps
 * run, `validateCleanupContainment` closes the symlink gap with a read-only
 * realpath boundary: internal links pass, escaping links fail, missing targets
 * are idempotent no-ops. `releaseCleanupSteps` additionally fails closed when
 * the sanctioned root itself is missing: execution is authorized only when the
 * physical containment root is proven to exist.
 *
 * `prepareWorkspace` is the one concrete executor here, and it is the
 * exception to the pure-data rule. It is strictly non-destructive: it creates
 * only the sanctioned parent chain (`root/tasks/<isolation>/<host>`), never
 * the worktree target (git creates that and requires it absent), and never
 * deletes or cleans. Every filesystem and process effect is injectable
 * (`WorkspaceEffects`), production uses `execFile` with argv only (no shell),
 * and unsupported isolation kinds fail closed unless an explicit adapter is
 * supplied.
 */

import { execFile as nodeExecFile } from "node:child_process";
import { access as fsAccess, mkdir as fsMkdir, realpath as realpathAsync } from "node:fs/promises";
import { posix as posixPath, win32 as win32Path } from "node:path";
import { promisify } from "node:util";

export const HOSTS = ["mac", "vps", "box"] as const;
export type Host = (typeof HOSTS)[number];

export const ISOLATION_KINDS = ["git-worktree", "container", "vm"] as const;
export type IsolationKind = (typeof ISOLATION_KINDS)[number];

export const PATH_FLAVORS = ["posix", "win32"] as const;
export type PathFlavor = (typeof PATH_FLAVORS)[number];

/** Structural subset of a `node:path` implementation (posix or win32). */
export interface PathApi {
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  isAbsolute(path: string): boolean;
  join(...parts: string[]): string;
  basename(path: string): string;
  readonly sep: string;
}

const POSIX: PathApi = posixPath;
const WIN32: PathApi = win32Path;

export function pathApiFor(flavor: PathFlavor): PathApi {
  return flavor === "win32" ? WIN32 : POSIX;
}

/**
 * True when `p` contains a raw `..` path segment. `node:path` normalizes such
 * segments away, so a check that only compares normalized paths would accept
 * `${root}/tasks/../etc/passwd` as "contained". We reject raw `..` before
 * normalization: traversal intent must fail closed regardless of how the path
 * normalizes. Split on both separators so the same rule holds for posix and
 * win32 inputs.
 */
function hasRawParentSegment(p: string): boolean {
  return p.split(/[\\/]/).some((part) => part === "..");
}

/**
 * Path-containment guard, parameterized by a path implementation so the same
 * rule holds for POSIX and Windows paths. Returns true only when `target`
 * resolves to a strict descendant of `root`, and rejects raw `..` segments,
 * the root itself, filesystem roots (both the target and the root), upward
 * traversal, and unrelated absolute paths (e.g. a different drive letter on
 * win32).
 *
 * This is the check that blocks traversal and root deletion: no caller may
 * touch a path this function rejects.
 */
export function isContainedWithin(target: string, root: string, api: PathApi = POSIX): boolean {
  if (!target || !root) return false;
  if (hasRawParentSegment(target)) return false; // reject `..` before normalization
  const resolvedTarget = api.resolve(target);
  const resolvedRoot = api.resolve(root);
  if (resolvedTarget === resolvedRoot) return false; // the root itself: never remove the root
  if (resolvedTarget === api.dirname(resolvedTarget)) return false; // a filesystem root
  if (resolvedRoot === api.dirname(resolvedRoot)) return false; // root is a filesystem root
  const rel = api.relative(resolvedRoot, resolvedTarget);
  if (rel === "") return false; // == root (already rejected above)
  if (rel === ".." || rel.startsWith(`..${api.sep}`)) return false; // escapes upward
  if (api.isAbsolute(rel)) return false; // unrelated absolute path (e.g. other drive)
  return true;
}

const UNSAFE_LABEL_CHARS = /[^A-Za-z0-9._-]+/g;
const MAX_LABEL_LENGTH = 63; // docker container-name ceiling

/**
 * Reduces an arbitrary task id to a single safe path/name segment. Runs of
 * unsafe characters collapse to `-`, leading/trailing separators are trimmed,
 * and the result is capped to 63 chars. Traversal tokens ("..", ".")
 * cannot survive, so a hostile task id cannot escape the workspace root.
 * Collisions are possible for different ids; callers must keep task ids unique.
 */
export function sanitizeTaskId(taskId: string): string {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    throw new Error("taskId must be a non-empty string");
  }
  const label = taskId
    .replace(UNSAFE_LABEL_CHARS, "-")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .slice(0, MAX_LABEL_LENGTH);
  if (label === "" || label === "." || label === "..") {
    throw new Error(`taskId does not produce a safe workspace label: ${JSON.stringify(taskId)}`);
  }
  return label;
}

export interface WorkspaceSpec {
  /** Stable orchestration task id (string id, per the orchestration contract). */
  taskId: string;
  /** Host the task runs on. */
  host: Host;
  /** Isolation mechanism. */
  isolation: IsolationKind;
  /** Sanctioned root; the derived path must resolve strictly under it. */
  root: string;
  /**
   * Path semantics for this workspace. Defaults to "posix" (macOS, Linux VPS,
   * Linux Box VMs). Set "win32" for Windows VMs/hosts so drive letters and
   * backslashes are handled correctly.
   */
  pathFlavor?: PathFlavor;
}

/**
 * Deterministic contained path for a workspace. Pure: the same spec always
 * yields the same path. Validation (root safety, containment) is enforced by
 * `planWorkspace`; this function is the raw derivation.
 */
export function deriveWorkspacePath(spec: WorkspaceSpec): string {
  const api = pathApiFor(spec.pathFlavor ?? "posix");
  const label = sanitizeTaskId(spec.taskId);
  return api.resolve(spec.root, "tasks", spec.isolation, spec.host, label);
}

export interface WorkspacePlan {
  /** Deterministic id: `foundry-<host>-<isolation>-<label>`. */
  workspaceId: string;
  taskId: string;
  host: Host;
  isolation: IsolationKind;
  pathFlavor: PathFlavor;
  root: string;
  /** Deterministic contained path under `root`. */
  path: string;
  /** Sanitized task id; the name used for worktrees/containers/VMs. */
  label: string;
}

export function planWorkspace(spec: WorkspaceSpec): WorkspacePlan {
  const api = pathApiFor(spec.pathFlavor ?? "posix");
  const label = sanitizeTaskId(spec.taskId);
  const root = api.resolve(spec.root);
  if (root === api.dirname(root)) {
    throw new Error(`workspace root must not be a filesystem root: ${root}`);
  }
  const path = api.join(root, "tasks", spec.isolation, spec.host, label);
  if (!isContainedWithin(path, root, api)) {
    throw new Error(`workspace path escapes sanctioned root: ${path} (root ${root})`);
  }
  const workspaceId = `foundry-${spec.host}-${spec.isolation}-${label}`;
  return {
    workspaceId,
    taskId: spec.taskId,
    host: spec.host,
    isolation: spec.isolation,
    pathFlavor: spec.pathFlavor ?? "posix",
    root,
    path,
    label,
  };
}

/** Shape shared by workspace-derived objects that can be owned by a task. */
export interface OwnedWorkspaceRef {
  workspaceId: string;
  taskId: string;
  path: string;
  root: string;
  pathFlavor: PathFlavor;
}

export interface OwnershipProof {
  workspaceId: string;
  taskId: string;
  path: string;
  /** ISO 8601 timestamp. */
  issuedAt: string;
}

export function proveOwnership(ref: OwnedWorkspaceRef): OwnershipProof {
  return {
    workspaceId: ref.workspaceId,
    taskId: ref.taskId,
    path: ref.path,
    issuedAt: new Date().toISOString(),
  };
}

/**
 * Ownership check for a workspace-derived ref. The proof must match the ref's
 * deterministic id, task, and path, and the path must still be contained.
 * Because ids/paths are derived deterministically from the task, a proof cannot
 * be valid for a workspace the task does not own. This is a discipline gate,
 * not a cryptographic one: cleanup refuses to run without a matching proof.
 */
export function verifyOwnership(ref: OwnedWorkspaceRef, proof: OwnershipProof): boolean {
  if (proof.workspaceId !== ref.workspaceId) return false;
  if (proof.taskId !== ref.taskId) return false;
  if (proof.path !== ref.path) return false;
  return isContainedWithin(ref.path, ref.root, pathApiFor(ref.pathFlavor));
}

/**
 * Idempotency guard for a plan step: the executor re-checks it before running
 * the step so re-applying a plan converges to the same end state.
 */
export type StepGuard =
  | { type: "path-missing"; path: string }
  | { type: "path-present"; path: string }
  | { type: "name-absent"; name: string }
  | { type: "name-present"; name: string };

export type PrepareStep =
  | { kind: "mkdir"; path: string; guard: { type: "path-missing"; path: string } }
  | { kind: "run"; argv: string[]; cwd?: string; guard?: StepGuard };

export interface PreparePlan extends OwnedWorkspaceRef {
  /** `${workspaceId}:prepare`. */
  id: string;
  host: Host;
  isolation: IsolationKind;
  steps: PrepareStep[];
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface PrepareOptions {
  /** Git repo owning the worktree (required for git-worktree isolation). */
  repoPath?: string;
  /** Worktree branch; defaults to `foundry/<label>`. */
  branch?: string;
  /** Container image (required for container isolation). */
  image?: string;
  /** Container command, placed after the image. */
  command?: string[];
  /** Overrides the VM launch argv (default: `multipass launch --name <label>`). */
  vmLaunchArgs?: string[];
  extraSteps?: PrepareStep[];
  /**
   * Injected filesystem/process effects for the concrete `prepareWorkspace`
   * adapter. Defaults to the real `node:fs/promises` and
   * `child_process.execFile` implementations. Tests inject fakes so the
   * adapter is provable without touching the real filesystem, git, or the
   * network.
   */
  effects?: Partial<WorkspaceEffects>;
  /**
   * Explicit adapter for isolation kinds this module does not execute
   * natively. `git-worktree` is always executed natively via argv.
   * `container` and `vm` fail closed (throw) unless an adapter is supplied;
   * nothing is faked.
   */
  adapter?: PrepareAdapter;
}

/**
 * Idempotent prepare plan for a workspace. Data only: nothing is executed.
 * Each step has a guard the executor re-checks before running, so re-applying
 * the plan converges to the same end state.
 * Prepare never emits destructive commands.
 */
export function preparePlan(plan: WorkspacePlan, opts: PrepareOptions = {}): PreparePlan {
  const steps: PrepareStep[] = [];
  switch (plan.isolation) {
    case "git-worktree": {
      if (!opts.repoPath) {
        throw new Error("preparePlan: repoPath is required for git-worktree isolation");
      }
      const branch = opts.branch ?? `foundry/${plan.label}`;
      // `git worktree add <path>` creates the target directory itself and
      // requires the path to be absent, so the plan must NOT mkdir it first:
      // a pre-existing directory makes the add fail, and the step's own
      // path-missing guard already protects against a non-empty target.
      steps.push({
        kind: "run",
        argv: ["git", "worktree", "add", plan.path, branch],
        cwd: opts.repoPath,
        guard: { type: "path-missing", path: plan.path },
      });
      break;
    }
    case "container": {
      steps.push({ kind: "mkdir", path: plan.path, guard: { type: "path-missing", path: plan.path } });
      if (!opts.image) {
        throw new Error("preparePlan: image is required for container isolation");
      }
      steps.push({
        kind: "run",
        argv: ["docker", "create", "--name", plan.label, "--workdir", plan.path, opts.image, ...(opts.command ?? [])],
        guard: { type: "name-absent", name: plan.label },
      });
      break;
    }
    case "vm": {
      steps.push({ kind: "mkdir", path: plan.path, guard: { type: "path-missing", path: plan.path } });
      const launch = opts.vmLaunchArgs ?? ["multipass", "launch", "--name", plan.label];
      steps.push({ kind: "run", argv: launch, guard: { type: "name-absent", name: plan.label } });
      break;
    }
  }
  if (opts.extraSteps) steps.push(...opts.extraSteps);
  return {
    id: `${plan.workspaceId}:prepare`,
    workspaceId: plan.workspaceId,
    taskId: plan.taskId,
    host: plan.host,
    isolation: plan.isolation,
    pathFlavor: plan.pathFlavor,
    root: plan.root,
    path: plan.path,
    steps,
    createdAt: new Date().toISOString(),
  };
}

export type CleanupStep =
  | { kind: "remove"; path: string; guard: { type: "path-present"; path: string } }
  | { kind: "run"; argv: string[]; cwd?: string; guard?: StepGuard };

export interface CleanupPlan extends OwnedWorkspaceRef {
  /** `${workspaceId}:cleanup`. */
  id: string;
  host: Host;
  isolation: IsolationKind;
  steps: CleanupStep[];
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Cleanup is inert until a matching ownership proof is supplied. */
  requiresOwnershipProof: true;
}

export interface CleanupOptions {
  /** Git repo owning the worktree (only used for git-worktree isolation). */
  repoPath?: string;
  /** Overrides the VM delete argv (default: `multipass delete --purge <label>`). */
  vmDeleteArgs?: string[];
  extraSteps?: CleanupStep[];
}

/**
 * Cleanup plan for a workspace. Data only: nothing is executed, and the plan is
 * inert — steps are released only through the async `releaseCleanupSteps`
 * boundary (physical containment), or the pure lexical
 * `resolveCleanupStepsLexical` whose output is never executable. Each remove
 * step is checked as contained when the plan is built.
 */
export function cleanupPlan(plan: WorkspacePlan, opts: CleanupOptions = {}): CleanupPlan {
  const api = pathApiFor(plan.pathFlavor);
  const steps: CleanupStep[] = [];
  switch (plan.isolation) {
    case "git-worktree":
      if (opts.repoPath) {
        steps.push({
          kind: "run",
          argv: ["git", "worktree", "remove", "--force", plan.path],
          cwd: opts.repoPath,
          guard: { type: "path-present", path: plan.path },
        });
      }
      break;
    case "container":
      steps.push({
        kind: "run",
        argv: ["docker", "rm", "--force", plan.label],
        guard: { type: "name-present", name: plan.label },
      });
      break;
    case "vm":
      steps.push({
        kind: "run",
        argv: opts.vmDeleteArgs ?? ["multipass", "delete", "--purge", plan.label],
        guard: { type: "name-present", name: plan.label },
      });
      break;
  }
  steps.push({ kind: "remove", path: plan.path, guard: { type: "path-present", path: plan.path } });
  for (const step of steps) {
    if (step.kind === "remove" && !isContainedWithin(step.path, plan.root, api)) {
      throw new Error(`cleanupPlan: remove path escapes sanctioned root: ${step.path} (root ${plan.root})`);
    }
  }
  return {
    id: `${plan.workspaceId}:cleanup`,
    workspaceId: plan.workspaceId,
    taskId: plan.taskId,
    host: plan.host,
    isolation: plan.isolation,
    pathFlavor: plan.pathFlavor,
    root: plan.root,
    path: plan.path,
    steps,
    createdAt: new Date().toISOString(),
    requiresOwnershipProof: true,
  };
}

/**
 * Lexically validated cleanup steps. Ownership and path containment are proven
 * as pure string rules only; physical containment (symlinks, real paths) has
 * NOT been proven, so the steps are not executable. This is the internal,
 * synchronous planning surface — callers that intend to execute destructive
 * steps MUST go through the async `releaseCleanupSteps` boundary instead.
 */
export interface LexicalCleanupSteps {
  /** Steps passing the ownership and lexical containment gates only. */
  steps: CleanupStep[];
  /** Always false: nothing here is executable without physical proof. */
  executable: false;
}

/**
 * Pure lexical gate over a cleanup plan. Throws unless the ownership proof
 * matches the cleanup plan and each remove step is still lexically contained.
 * Returns a non-executable marker, never raw `CleanupStep[]` — use
 * `releaseCleanupSteps` for the physically validated, executable release.
 */
export function resolveCleanupStepsLexical(cleanup: CleanupPlan, proof: OwnershipProof): LexicalCleanupSteps {
  if (!verifyOwnership(cleanup, proof)) {
    throw new Error(`cleanup refused: ownership proof does not match workspace ${cleanup.workspaceId}`);
  }
  const api = pathApiFor(cleanup.pathFlavor);
  for (const step of cleanup.steps) {
    if (step.kind === "remove" && !isContainedWithin(step.path, cleanup.root, api)) {
      throw new Error(`cleanup refused: remove path escapes sanctioned root: ${step.path}`);
    }
  }
  return { steps: cleanup.steps, executable: false };
}

/**
 * Physical cleanup containment boundary.
 *
 * The plan-time checks (`cleanupPlan`, `resolveCleanupStepsLexical`) are pure
 * lexical string rules, so a `remove` step whose path is a symlink pointing
 * outside the sanctioned root would pass them. This async boundary closes that
 * gap with the filesystem: it resolves the sanctioned root and each existing
 * remove target with realpath and rejects any target whose physical path
 * escapes the physical root.
 *
 * - Internal symlinks (realpath stays under the physical root) pass.
 * - Escaping symlinks (realpath leaves the physical root, resolves to the root
 *   itself, or crosses to another drive) fail.
 * - A missing target is an idempotent no-op (nothing exists to remove), never
 *   a reason to weaken the checks.
 * - Raw `..` segments are rejected before any resolution, so the lexical guard
 *   is preserved inside the physical boundary too.
 * - `rootStatus` distinguishes a missing or unresolvable sanctioned root from
 *   a missing target. The validator itself treats a missing root as an
 *   idempotent no-op; the `releaseCleanupSteps` boundary is stricter and fails
 *   closed on it, because execution can only be authorized when the physical
 *   containment root is proven to exist.
 *
 * The executing host must match the plan's `pathFlavor` (realpath returns
 * host-native paths). The function is read-only: it never mutates the
 * filesystem and never deletes anything; the caller decides how to act on the
 * result.
 */
export interface CleanupContainmentOptions {
  /**
   * Filesystem boundary. Defaults to `fs.promises.realpath`. Inject a fake
   * for pure tests or non-native hosts. Must resolve `path` to its physical
   * path and reject with `code === "ENOENT"` when `path` does not exist; any
   * other rejection is treated as unresolvable and fails closed.
   */
  realpath?: (path: string) => Promise<string>;
}

export interface CleanupContainmentResult {
  /** True only when no remove target escapes and every existing target resolved. */
  ok: boolean;
  /** Remove targets that must not be deleted (lexical escape, physical escape, or the root itself). */
  escaped: string[];
  /** Remove targets that do not exist: idempotent no-op, not a violation. */
  missing: string[];
  /** Paths (targets or the root) that failed to resolve for a non-ENOENT reason: fails closed. */
  unresolvable: string[];
  /**
   * Outcome of resolving the sanctioned root. "missing" is an idempotent no-op
   * for the validator but fails closed at the `releaseCleanupSteps` boundary.
   */
  rootStatus: "resolved" | "missing" | "unresolvable";
}

export async function validateCleanupContainment(
  cleanup: CleanupPlan,
  opts: CleanupContainmentOptions = {}
): Promise<CleanupContainmentResult> {
  const realpath = opts.realpath ?? realpathAsync;
  const api = pathApiFor(cleanup.pathFlavor);
  const escaped: string[] = [];
  const missing: string[] = [];
  const unresolvable: string[] = [];

  const targets = cleanup.steps
    .filter((step): step is Extract<CleanupStep, { kind: "remove" }> => step.kind === "remove")
    .map((step) => step.path);

  let physicalRoot: string;
  try {
    physicalRoot = await realpath(cleanup.root);
  } catch (err) {
    // ENOENT means the root (and therefore every target under it) is absent:
    // nothing to clean, so the plan is an idempotent no-op, never a violation.
    // The release boundary is stricter and fails closed on this state.
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      return { ok: true, escaped, missing: targets, unresolvable, rootStatus: "missing" };
    }
    unresolvable.push(cleanup.root);
    return { ok: false, escaped, missing, unresolvable, rootStatus: "unresolvable" };
  }

  for (const target of targets) {
    if (!isContainedWithin(target, cleanup.root, api)) {
      // Lexical guard preserved inside the physical boundary: raw `..`, the
      // root itself, and unrelated absolute paths are hard rejects.
      escaped.push(target);
      continue;
    }
    let physicalTarget: string;
    try {
      physicalTarget = await realpath(target);
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
        missing.push(target); // already gone: idempotent no-op
        continue;
      }
      unresolvable.push(target);
      continue;
    }
    // realpath output is normalized (no `..`), so this is the strict physical
    // descendant rule: the root itself, filesystem roots, and cross-drive
    // targets all fail closed.
    if (!isContainedWithin(physicalTarget, physicalRoot, api)) {
      escaped.push(target);
    }
  }
  return { ok: escaped.length === 0 && unresolvable.length === 0, escaped, missing, unresolvable, rootStatus: "resolved" };
}

/**
 * Single public async release boundary for cleanup steps.
 *
 * Authorizes destructive execution only after two independent gates pass:
 * 1. Ownership: the proof must match the cleanup plan (task id, workspace id,
 *    and path), otherwise this throws and no step is released.
 * 2. Physical containment: the sanctioned root must exist and resolve, and
 *    every remove target must resolve to a physical path strictly inside it
 *    (`validateCleanupContainment`).
 *
 * Fail-closed rules that would otherwise be no-ops at the validator level are
 * hard rejects here: a sanctioned root that does not exist (or cannot be
 * resolved) means no physical containment can be proven, so nothing is
 * released. Missing individual targets remain idempotent no-ops (nothing
 * exists to remove).
 *
 * The function is read-only: it never deletes anything. It returns the raw
 * executable `CleanupStep[]` for an executor adapter, and it is the only
 * function that does so — the pure lexical surface
 * (`resolveCleanupStepsLexical`) returns a non-executable marker.
 */
export async function releaseCleanupSteps(
  cleanup: CleanupPlan,
  proof: OwnershipProof,
  opts: CleanupContainmentOptions = {},
): Promise<CleanupStep[]> {
  if (!verifyOwnership(cleanup, proof)) {
    throw new Error(`cleanup refused: ownership proof does not match workspace ${cleanup.workspaceId}`);
  }
  const result = await validateCleanupContainment(cleanup, opts);
  if (result.rootStatus !== "resolved") {
    throw new Error(
      result.rootStatus === "unresolvable"
        ? `cleanup refused: sanctioned root could not be resolved: ${cleanup.root}`
        : `cleanup refused: sanctioned root does not exist: ${cleanup.root}`,
    );
  }
  if (!result.ok) {
    const violations = [...result.escaped, ...result.unresolvable];
    throw new Error(
      `cleanup refused: ${violations.length} destructive target(s) failed physical containment: ${violations.join(", ")}`,
    );
  }
  return cleanup.steps;
}

// ---------------------------------------------------------------------------
// Concrete prepare adapter (executes git-worktree preparation)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
const PREPARE_CONTAINMENT_MSG = "physically escapes sanctioned root";

const execFileAsync = promisify(nodeExecFile) as (
  file: string,
  args: string[],
  options: { cwd?: string; encoding: "utf8"; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

/** Filesystem effects the concrete prepare adapter can inject (tests). */
export interface WorkspaceFs {
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  realpath(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

/**
 * Injectable process effect. Receives a full argv array — index 0 is the
 * executable — so a shell string can never be built from task input. Resolves
 * with stdout/stderr on success and rejects (fails closed) on a nonzero exit
 * or a spawn error. Defaults to `child_process.execFile` (argv, never shell).
 */
export type WorkspaceRun = (
  argv: string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export interface WorkspaceEffects {
  fs: WorkspaceFs;
  run: WorkspaceRun;
}

/**
 * Production process effect: argv-only (never a shell string). Fails closed:
 * a nonzero exit or a spawn error rejects, so a failed `git worktree add` can
 * never be mistaken for a prepared workspace.
 */
export async function defaultWorkspaceRun(
  argv: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const [command, ...args] = argv;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: DEFAULT_MAX_BUFFER,
    });
    return { stdout: textOf(stdout), stderr: textOf(stderr) };
  } catch (err) {
    const failure = err as { code?: number | string; message?: string; stderr?: unknown };
    const stderr = textOf(failure.stderr);
    if (typeof failure.code === "number") {
      throw new Error(`command failed (exit ${failure.code}): ${stderr || failure.message || argv.join(" ")}`);
    }
    throw new Error(`command failed to spawn: ${failure.message ?? command}`);
  }
}

/** Production filesystem/process effects: real fs and real git via execFile. */
export const defaultWorkspaceEffects: WorkspaceEffects = {
  fs: {
    mkdir: async (path, opts) => {
      await fsMkdir(path, { recursive: opts?.recursive ?? false });
    },
    realpath: realpathAsync,
    exists: async (path) => {
      try {
        await fsAccess(path);
        return true;
      } catch {
        return false;
      }
    },
  },
  run: defaultWorkspaceRun,
};

/**
 * Explicit preparation adapter for isolation kinds this module does not
 * execute natively (`container`, `vm`). Receives the same plan and options as
 * `prepareWorkspace` and resolves once the workspace is physically ready.
 */
export type PrepareAdapter = (plan: WorkspacePlan, options: PrepareOptions) => Promise<WorkspacePlan>;

/** `path === root` or a strict physical descendant of `root`. */
function containedUnder(path: string, root: string, api: PathApi): boolean {
  return path === root || isContainedWithin(path, root, api);
}

/**
 * Physical path of the deepest ancestor of `parent` (inclusive) that already
 * exists, or null when nothing from `parent` up to `root` exists. Non-ENOENT
 * resolution failures propagate (fail closed).
 */
async function deepestExistingPhysical(
  root: string,
  parent: string,
  realpath: (path: string) => Promise<string>,
  api: PathApi,
): Promise<string | null> {
  const chain: string[] = [parent];
  let cursor = parent;
  while (cursor !== root) {
    cursor = api.dirname(cursor);
    chain.push(cursor);
  }
  for (const path of chain) {
    try {
      return await realpath(path);
    } catch (err) {
      if (isEnoent(err)) continue;
      throw err;
    }
  }
  return null;
}

/** True when `git worktree list --porcelain` registers `target` for this repo. */
function listsWorktree(porcelain: string, target: string, physicalTarget: string, api: PathApi): boolean {
  const resolvedTarget = api.resolve(target);
  const resolvedPhysical = api.resolve(physicalTarget);
  for (const line of porcelain.split("\n")) {
    const match = /^worktree (.+)$/.exec(line.trim());
    if (match) {
      const listed = api.resolve(match[1].trim());
      // git normalizes registered paths through realpath (resolving symlink
      // aliases like /var -> /private/var), so compare both forms.
      if (listed === resolvedTarget || listed === resolvedPhysical) return true;
    }
  }
  return false;
}

/**
 * Concrete workspace preparation for `git-worktree` isolation. Executes
 * effects through the injectable `WorkspaceEffects` (argv via `execFile`,
 * never a shell) and resolves with the same plan once the workspace is
 * physically ready. Idempotent: an already-valid workspace is detected and
 * reused, never recreated and never deleted.
 *
 * - Creates ONLY the sanctioned parent chain (`root/tasks/<isolation>/<host>`);
 *   the worktree target directory is left to `git worktree add`, which
 *   requires it to be absent.
 * - Rejects physical containment escape before and after creation, including
 *   a symlinked root (the physical root becomes the boundary) and symlinked
 *   intermediate/target paths that resolve outside it.
 * - `container` and `vm` isolation FAIL CLOSED: throws unless an explicit
 *   adapter is supplied; nothing is faked.
 *
 * The executing host must match the plan's `pathFlavor` (realpath returns
 * host-native paths), same as the cleanup validator.
 */
export async function prepareWorkspace(
  plan: WorkspacePlan,
  options: PrepareOptions = {},
): Promise<WorkspacePlan> {
  if (plan.isolation !== "git-worktree") {
    if (options.adapter) return options.adapter(plan, options);
    throw new Error(
      `prepareWorkspace: isolation kind ${plan.isolation} is not supported without an explicit adapter; refusing to fake it`,
    );
  }
  const effects: WorkspaceEffects = {
    fs: { ...defaultWorkspaceEffects.fs, ...options.effects?.fs },
    run: options.effects?.run ?? defaultWorkspaceEffects.run,
  };
  const api = pathApiFor(plan.pathFlavor);
  const repoPath = options.repoPath;
  if (!repoPath) {
    throw new Error("prepareWorkspace: repoPath is required for git-worktree isolation");
  }
  const branch = options.branch ?? `foundry/${plan.label}`;
  const target = plan.path;
  const parent = api.dirname(target);

  // Lexical containment first: the adapter is a hard boundary, so it re-checks
  // what planWorkspace guaranteed (raw `..`, root equality, unrelated roots).
  if (!isContainedWithin(target, plan.root, api)) {
    throw new Error(`prepareWorkspace: workspace path escapes sanctioned root: ${target} (root ${plan.root})`);
  }
  if (!isContainedWithin(parent, plan.root, api)) {
    throw new Error(`prepareWorkspace: workspace parent escapes sanctioned root: ${parent} (root ${plan.root})`);
  }

  // Physical root: realpath, so a symlinked sanctioned root resolves to its
  // physical location, which becomes the containment boundary.
  let physicalRoot: string;
  try {
    physicalRoot = await effects.fs.realpath(plan.root);
  } catch (err) {
    if (!isEnoent(err)) {
      throw new Error(`prepareWorkspace: cannot resolve sanctioned root ${plan.root}: ${String(err)}`);
    }
    physicalRoot = plan.root; // absent; created below
  }

  // Reject an escaping symlink in the existing ancestor chain BEFORE creating
  // anything: the deepest existing ancestor must stay under the physical root.
  const deepest = await deepestExistingPhysical(plan.root, parent, effects.fs.realpath, api);
  if (deepest !== null && !containedUnder(deepest, physicalRoot, api)) {
    throw new Error(
      `prepareWorkspace: workspace parent ${PREPARE_CONTAINMENT_MSG}: ${parent} (physical root ${physicalRoot})`,
    );
  }

  // Create ONLY the sanctioned parent chain (root/tasks/<isolation>/<host>).
  // The worktree target is deliberately NOT created here: `git worktree add`
  // creates it and requires it to be absent.
  await effects.fs.mkdir(parent, { recursive: true });

  // Re-resolve the physical root (may have just been created) and verify the
  // created parent is physically contained.
  try {
    physicalRoot = await effects.fs.realpath(plan.root);
  } catch (err) {
    if (!isEnoent(err)) {
      throw new Error(`prepareWorkspace: cannot resolve sanctioned root ${plan.root}: ${String(err)}`);
    }
  }
  let physicalParent: string;
  try {
    physicalParent = await effects.fs.realpath(parent);
  } catch (err) {
    throw new Error(`prepareWorkspace: cannot resolve workspace parent ${parent}: ${String(err)}`);
  }
  if (!containedUnder(physicalParent, physicalRoot, api)) {
    throw new Error(
      `prepareWorkspace: workspace parent ${PREPARE_CONTAINMENT_MSG}: ${parent} (physical root ${physicalRoot})`,
    );
  }

  // Idempotency: an already-valid workspace is reused, never recreated and
  // never deleted. "Valid" means the target is physically contained AND
  // registered as a worktree of this repo (porcelain check).
  if (await effects.fs.exists(target)) {
    let physicalTarget: string;
    try {
      physicalTarget = await effects.fs.realpath(target);
    } catch (err) {
      throw new Error(`prepareWorkspace: cannot resolve workspace target ${target}: ${String(err)}`);
    }
    if (!containedUnder(physicalTarget, physicalRoot, api)) {
      throw new Error(
        `prepareWorkspace: workspace target ${PREPARE_CONTAINMENT_MSG}: ${target} (physical root ${physicalRoot})`,
      );
    }
    const { stdout } = await effects.run(["git", "worktree", "list", "--porcelain"], { cwd: repoPath });
    if (!listsWorktree(stdout, target, physicalTarget, api)) {
      throw new Error(
        `prepareWorkspace: target exists but is not a registered git worktree of ${repoPath}: ${target}`,
      );
    }
    return plan;
  }

  // Create the worktree. git creates the target directory itself. argv only,
  // never a shell string; no --force, no cleanup, nothing destructive.
  await effects.run(["git", "worktree", "add", "-b", branch, target], { cwd: repoPath });

  // Post-condition: git created the directory and it is physically contained.
  if (!(await effects.fs.exists(target))) {
    throw new Error(`prepareWorkspace: git worktree add succeeded but ${target} was not created`);
  }
  const physicalTarget = await effects.fs.realpath(target);
  if (!containedUnder(physicalTarget, physicalRoot, api)) {
    throw new Error(
      `prepareWorkspace: workspace target ${PREPARE_CONTAINMENT_MSG}: ${target} (physical root ${physicalRoot})`,
    );
  }
  return plan;
}
