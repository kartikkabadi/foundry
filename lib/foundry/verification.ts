// Verification policy for the multi-agent engineering system.
// Pure: derives the required gate set from a task kind and its changed
// surfaces. Executing gates stays behind verifier adapters, never here.

import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

export const VERIFICATION_GATES = [
  "code_checks",
  "package_tests",
  "ui_browser_flow",
  "annotated_stills",
  "short_video",
  "logs",
  "security_review",
  "independent_grade",
  "small_pr",
] as const;

export type VerificationGateId = (typeof VERIFICATION_GATES)[number];

export const TASK_KINDS = [
  "code",
  "test",
  "ui",
  "infra",
  "docs",
  "research",
  "review",
  "learning",
  "vision",
  "video",
  "design",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export const SURFACE_KINDS = [
  "code",
  "package",
  "ui",
  "docs",
  "config",
  "data",
  "logs",
  "security",
] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export type ChangedSurface = {
  kind: SurfaceKind;
  /** Package scope, required when kind is "package" (e.g. "@foundry/scheduler"). */
  scope?: string;
  /** Changed file path; used to detect security-sensitive code surfaces. */
  path?: string;
  /** UI surfaces only: true means the change shows motion beyond stills. */
  motion?: boolean;
};

export type VerificationGate = {
  id: VerificationGateId;
  reason: string;
  /** Package scopes the package-scoped tests must cover. */
  scopes?: string[];
};

export type VerificationPlan = {
  taskKind: TaskKind;
  surfaces: ChangedSurface[];
  gates: VerificationGate[];
};

export const VERIFICATION_GATE_LABELS: Record<VerificationGateId, string> = {
  code_checks: "Static and build checks on changed code",
  package_tests: "Tests scoped to the changed packages",
  ui_browser_flow: "Browser-driven flow through the changed UI",
  annotated_stills: "Annotated screenshots of the UI",
  short_video: "Short screen recording of the UI flow",
  logs: "Captured execution and runtime logs",
  security_review: "Security review of sensitive surfaces",
  independent_grade: "Fresh independent verifier grades the artifact",
  small_pr: "Change stays within small-PR limits",
};

// Task kinds that always execute code, so they must capture logs.
const EXECUTION_TASK_KINDS: ReadonlySet<TaskKind> = new Set(["code", "test", "infra", "ui", "vision", "video"]);

// Task kinds that touch source files, so code checks and PR limits apply.
const CODE_TASK_KINDS: ReadonlySet<TaskKind> = new Set(["code", "test", "infra", "ui"]);

const SECURITY_SURFACE_MARKERS = [
  "auth",
  "secret",
  "credential",
  "token",
  "password",
  "apikey",
  "api_key",
  ".env",
  "oauth",
  "cookie",
  "ssl",
  "cert",
  "ssh",
  "keychain",
  "crypto",
  "sql",
  "exec",
  "shell",
  "network",
  "http",
  "socket",
];

export function isSecuritySensitiveSurface(surface: ChangedSurface): boolean {
  if (surface.kind === "security") return true;
  if (surface.kind !== "code") return false;
  const path = (surface.path ?? "").toLowerCase();
  return SECURITY_SURFACE_MARKERS.some((marker) => path.includes(marker));
}

export type SmallPrLimits = {
  maxFiles: number;
  maxInsertions: number;
  maxDeletions: number;
};

export const SMALL_PR_LIMITS: SmallPrLimits = {
  maxFiles: 10,
  maxInsertions: 400,
  maxDeletions: 200,
};

export type PrDiff = {
  files: number;
  insertions: number;
  deletions: number;
};

export function smallPrViolation(diff: PrDiff, limits: SmallPrLimits = SMALL_PR_LIMITS): string | null {
  if (diff.files > limits.maxFiles) return `PR touches ${diff.files} files (limit ${limits.maxFiles})`;
  if (diff.insertions > limits.maxInsertions)
    return `PR adds ${diff.insertions} lines (limit ${limits.maxInsertions})`;
  if (diff.deletions > limits.maxDeletions)
    return `PR deletes ${diff.deletions} lines (limit ${limits.maxDeletions})`;
  return null;
}

function hasSurface(surfaces: ChangedSurface[], kind: SurfaceKind): boolean {
  return surfaces.some((surface) => surface.kind === kind);
}

function uiInvolved(taskKind: TaskKind, surfaces: ChangedSurface[]): boolean {
  return taskKind === "ui" || hasSurface(surfaces, "ui");
}

function codeInvolved(taskKind: TaskKind, surfaces: ChangedSurface[]): boolean {
  return CODE_TASK_KINDS.has(taskKind) || hasSurface(surfaces, "code") || hasSurface(surfaces, "ui");
}

export function shortVideoRequired(taskKind: TaskKind, surfaces: ChangedSurface[]): boolean {
  if (!uiInvolved(taskKind, surfaces)) return false;
  const uiSurfaces = surfaces.filter((surface) => surface.kind === "ui");
  if (uiSurfaces.length === 0) return true;
  // A UI change marked static (motion: false) is proven by stills alone.
  return uiSurfaces.some((surface) => surface.motion !== false);
}

/** Guard: a gate set claiming short_video must involve a UI surface. */
export function shortVideoOnlyForUi(
  gateIdsToCheck: readonly VerificationGateId[],
  taskKind: TaskKind,
  surfaces: ChangedSurface[],
): boolean {
  if (!gateIdsToCheck.includes("short_video")) return true;
  return uiInvolved(taskKind, surfaces);
}

export function deriveVerificationGates(taskKind: TaskKind, surfaces: ChangedSurface[] = []): VerificationGate[] {
  const gates: VerificationGate[] = [];
  const ui = uiInvolved(taskKind, surfaces);
  const code = codeInvolved(taskKind, surfaces);
  const packages = surfaces.filter((surface) => surface.kind === "package");

  if (code) {
    gates.push({ id: "code_checks", reason: "Changed source must pass static and build checks" });
  }

  if (packages.length > 0) {
    const scopes = packages
      .map((surface) => surface.scope)
      .filter((scope): scope is string => Boolean(scope));
    const gate: VerificationGate = {
      id: "package_tests",
      reason: scopes.length > 0 ? `Tests scoped to ${scopes.join(", ")}` : "Changed packages must be tested",
    };
    if (scopes.length > 0) gate.scopes = scopes;
    gates.push(gate);
  }

  if (ui) {
    gates.push({ id: "ui_browser_flow", reason: "Changed UI must be exercised in a real browser flow" });
    gates.push({ id: "annotated_stills", reason: "UI evidence requires annotated stills" });
  }

  if (shortVideoRequired(taskKind, surfaces)) {
    gates.push({ id: "short_video", reason: "UI motion requires a short screen recording" });
  }

  if (EXECUTION_TASK_KINDS.has(taskKind) || hasSurface(surfaces, "logs")) {
    gates.push({ id: "logs", reason: "Execution must capture runtime logs" });
  }

  if (surfaces.some(isSecuritySensitiveSurface)) {
    gates.push({ id: "security_review", reason: "Security-sensitive surfaces require a security review" });
  }

  if (code || ui) {
    gates.push({ id: "independent_grade", reason: "Non-trivial work requires an independent grade" });
  }

  if (code || ui) {
    gates.push({
      id: "small_pr",
      reason: `Change must stay within ${SMALL_PR_LIMITS.maxFiles} files / ${SMALL_PR_LIMITS.maxInsertions}+${SMALL_PR_LIMITS.maxDeletions} lines`,
    });
  }

  return gates;
}

export function verificationPlan(taskKind: TaskKind, surfaces: ChangedSurface[] = []): VerificationPlan {
  return { taskKind, surfaces, gates: deriveVerificationGates(taskKind, surfaces) };
}

export function gateIds(plan: VerificationPlan): VerificationGateId[] {
  return plan.gates.map((gate) => gate.id);
}

// ---------------------------------------------------------------------------
// Production verification executor.
//
// Planning above is pure. This is the fail-closed executor that runs the
// declared local checks of a plan inside a prepared workspace. Every check
// runs through an injectable execFile argv effect (a shell is never used),
// and its exit code, stdout, and stderr are captured as explicit evidence.
//
// It never accepts a runner's self-reported output as verification: there is
// no runner input at all, and for UI/security gates a zero exit with a
// glowing stdout still fails unless separate evidence (stills/video paths, a
// review note) was actually collected. It also fails closed on a missing
// declared check, a nonzero exit, a timeout or exec error, an argv that does
// not name an executable, and a prepared workspace without a path.
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export type CheckExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Set when the effect hit a spawn error or timeout; always fails closed. */
  error?: string;
};

export type ExecFileOptions = {
  cwd?: string;
  timeoutMs?: number;
};

/** Injectable execFile effect. Receives an argv array; a shell is never used. */
export type ExecFileEffect = (
  argv: string[],
  options?: ExecFileOptions,
) => CheckExecResult | Promise<CheckExecResult>;

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

const execFileAsync = promisify(nodeExecFile);

/**
 * Production execFile effect: argv-only (never a shell string), captures
 * stdout/stderr as utf-8 text, and fails closed on a nonzero exit, a timeout,
 * or a spawn error. A nonzero exit is reported through `exitCode` alone; a
 * timeout or spawn error is reported through `error` because no process exit
 * code exists.
 */
export async function defaultExecFileEffect(
  argv: string[],
  options: ExecFileOptions = {},
): Promise<CheckExecResult> {
  const [command, ...args] = argv;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: DEFAULT_MAX_BUFFER,
      timeout: options.timeoutMs,
    });
    return { exitCode: 0, stdout: textOf(stdout), stderr: textOf(stderr) };
  } catch (err) {
    const failure = err as {
      code?: number | string;
      killed?: boolean;
      message?: string;
      stdout?: unknown;
      stderr?: unknown;
    };
    const stdout = textOf(failure.stdout);
    const stderr = textOf(failure.stderr);
    if (typeof failure.code === "number") {
      return { exitCode: failure.code, stdout, stderr };
    }
    const message = failure.message ?? "execFile failed";
    return {
      exitCode: 0,
      stdout,
      stderr: stderr === "" ? message : stderr,
      error: failure.killed ? "timed out" : message,
    };
  }
}

export type DeclaredCheck = {
  /** Stable id used in evidence records and failure messages. */
  id: string;
  /** Gate in the plan this check satisfies. One check per plan gate. */
  gate: VerificationGateId;
  /** execFile argv; index 0 is the executable. Never a shell command string. */
  argv: string[];
  /** Working directory; defaults to the prepared workspace path. */
  cwd?: string;
  /** Per-check timeout in milliseconds; overrides the executor default. */
  timeoutMs?: number;
  /**
   * Evidence items the caller collected for this check (artifact paths or
   * notes). Required for UI/security gates: a zero exit alone is not evidence,
   * and captured stdout never satisfies these gates.
   */
  evidence?: string[];
};

export type VerificationExecutorOptions = {
  /** Declared local checks. One per plan gate; missing gates fail closed. */
  checks?: readonly DeclaredCheck[];
  /** execFile effect; defaults to `defaultExecFileEffect`. */
  execFile?: ExecFileEffect;
  /**
   * Gates that require collected evidence beyond a zero exit. Defaults to
   * `EVIDENCE_REQUIRED_GATES` (UI and security gates).
   */
  evidenceRequiredGates?: ReadonlySet<VerificationGateId>;
  /** Default per-check timeout in milliseconds. */
  timeoutMs?: number;
};

export type VerificationExecutionResult = {
  ok: boolean;
  /** Deterministic, human-readable failure reasons. */
  errors: string[];
  /**
   * One deterministic JSON record per declared check, in declaration order.
   * Each record captures the check's argv, cwd, exit code, stdout, stderr,
   * error, and the collected evidence — this is the explicit evidence of
   * verification. Captured stdout is evidence that a check ran, never proof
   * that a UI/security gate passed.
   */
  evidence: string[];
};

/** Gates whose evidence cannot be proven by a process exit code alone. */
export const EVIDENCE_REQUIRED_GATES: ReadonlySet<VerificationGateId> = new Set([
  "ui_browser_flow",
  "annotated_stills",
  "short_video",
  "security_review",
]);

export async function executeVerification(
  plan: VerificationPlan,
  workspace: { path: string },
  options: VerificationExecutorOptions = {},
): Promise<VerificationExecutionResult> {
  const execFile = options.execFile ?? defaultExecFileEffect;
  const evidenceGates = options.evidenceRequiredGates ?? EVIDENCE_REQUIRED_GATES;
  const checks = options.checks ?? [];
  const errors: string[] = [];

  // Fail closed on a structurally invalid input before anything runs.
  if (typeof workspace.path !== "string" || workspace.path === "") {
    errors.push("prepared workspace has no path");
  }
  const planGates = new Set(plan.gates.map((gate) => gate.id));
  const byGate = new Map<VerificationGateId, DeclaredCheck>();
  for (const check of checks) {
    if (!Array.isArray(check.argv) || check.argv.length === 0) {
      errors.push(`check ${check.id}: argv must name an executable`);
    }
    if (byGate.has(check.gate)) {
      errors.push(`check ${check.id}: duplicate check for gate ${check.gate}`);
    } else {
      byGate.set(check.gate, check);
    }
  }
  for (const gate of plan.gates) {
    if (!byGate.has(gate.id)) {
      errors.push(`missing check for gate ${gate.id}`);
    }
  }
  for (const gate of byGate.keys()) {
    if (!planGates.has(gate)) {
      errors.push(`check for gate ${gate} is not required by the plan`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, evidence: [] };
  }

  // Run declared checks in declaration order: deterministic evidence.
  const evidence: string[] = [];
  for (const check of checks) {
    const cwd = check.cwd ?? workspace.path;
    const result = await execFile(check.argv, {
      cwd,
      timeoutMs: check.timeoutMs ?? options.timeoutMs,
    });
    const collected = check.evidence ?? [];
    evidence.push(
      JSON.stringify({
        checkId: check.id,
        gate: check.gate,
        argv: [...check.argv],
        cwd,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error ?? null,
        evidence: [...collected],
      }),
    );

    if (result.error !== undefined) {
      errors.push(`check ${check.id} (${check.gate}): ${result.error}`);
      continue;
    }
    if (result.exitCode !== 0) {
      errors.push(`check ${check.id} (${check.gate}): exited ${result.exitCode}`);
      continue;
    }
    if (evidenceGates.has(check.gate) && collected.length === 0) {
      errors.push(`check ${check.id} (${check.gate}): required ${check.gate} evidence was not collected`);
    }
  }

  return { ok: errors.length === 0, errors, evidence };
}
