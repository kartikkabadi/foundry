/**
 * OMP execution adapter for the Foundry multi-agent orchestration layer.
 *
 * Builds argv arrays for non-interactive `omp -p` runs and spawns them with
 * `child_process.spawn` — argv, never shell concatenation. Output is a
 * deterministic envelope: resolved model, argv, parsed JSON (when `--mode json`
 * is used), exit code, and explicit cancellation/timeout metadata.
 *
 * Model selection is enforced at this adapter boundary (policy lives in the
 * model router): text work defaults to the OMP DeepSeek v4 Flash model,
 * image/video analysis is rejected unless the model is vision-capable, and any
 * paid (non-default) model requires an explicit cost ceiling before launch.
 */

import { spawn } from "node:child_process";
import { DEFAULT_TEXT_MODEL } from "./orchestration-types";

import type { ChildProcessByStdio, SpawnOptionsWithStdioTuple, StdioNull, StdioPipe } from "node:child_process";
import type { Readable } from "node:stream";
export type ModelRole = "text" | "vision";
export type ModelCost = "free" | "paid";
export type OmpOutputMode = "json" | "text";

/** Default model for text work: OMP DeepSeek v4 Flash. */
export const DEFAULT_TEXT_MODEL_ID = "particle/deepseek-v4-flash-0731";

/**
 * Stable contract id for the default text model. Derived from
 * `DEFAULT_TEXT_MODEL` in orchestration-types (the single source of truth) so
 * the alias map cannot drift from orchestration. The alias resolver maps this
 * contract id to the concrete deployment id so cost classification and argv
 * stay unified.
 */
export const DEFAULT_TEXT_MODEL_CONTRACT_ID = DEFAULT_TEXT_MODEL;

/** Maps any default text model id to the concrete deployment id. */
export function resolveDefaultTextModelId(id: string): string {
  return id === DEFAULT_TEXT_MODEL_CONTRACT_ID ? DEFAULT_TEXT_MODEL_ID : id;
}

/** Default vision-capable model; overridable via FOUNDRY_VISION_MODEL. */
export const DEFAULT_VISION_MODEL_ID = process.env.FOUNDRY_VISION_MODEL ?? "openai/gpt-5.2";

export interface ModelRef {
  id: string;
  role: ModelRole;
  cost: ModelCost;
}

export interface CostCeiling {
  amount: number;
  currency?: string;
}

export interface OmpRunSpec {
  /** Stable orchestration task id (string id, per the orchestration contract). */
  taskId: string;
  /** Prompt body, passed verbatim as a single argv element. */
  prompt: string;
  /** Working directory for the run. */
  cwd: string;
  /** Routing role; "text" is the default. */
  role?: ModelRole;
  /** Explicit model id. Omitted = default for the role. */
  model?: string;
  /** Extra ids allowed to satisfy the vision role. */
  visionCapableIds?: string[];
  /** Overrides the paid/free classification (e.g. a known-free vision model). */
  cost?: ModelCost;
  /** Maximum wall time before the child is killed. */
  maxTimeMs?: number;
  /** omp session storage dir; deterministic per task. */
  sessionDir?: string;
  /** Output mode; "json" is the default. */
  mode?: OmpOutputMode;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  /** Non-interactive runs cannot answer prompts; default true. */
  autoApprove?: boolean;
  approvalMode?: "always-ask" | "write" | "yolo";
  thinking?: string;
  profile?: string;
  noTools?: boolean;
  noPty?: boolean;
  /** Required when the resolved model is paid (non-default fallback). */
  costCeiling?: CostCeiling;
  /** Extra environment variables merged over the minimal allowlisted environment. */
  env?: Record<string, string>;
  /** Executable; default "omp". */
  bin?: string;
}

/** Whether `modelId` may satisfy the vision role (default vision model or caller-listed). */
export function isVisionCapable(modelId: string, extras: Iterable<string> = []): boolean {
  if (modelId === DEFAULT_VISION_MODEL_ID) return true;
  for (const id of extras) {
    if (id === modelId) return true;
  }
  return false;
}

/**
 * Resolves the model for a role. Text defaults to DeepSeek v4 Flash (free);
 * vision only accepts a vision-capable model and is classified paid unless the
 * caller overrides `cost`. Any non-default text model is paid.
 */
export function resolveModel(
  role: ModelRole,
  opts: { model?: string; visionCapableIds?: string[]; cost?: ModelCost } = {},
): ModelRef {
  const rawId = opts.model ?? (role === "vision" ? DEFAULT_VISION_MODEL_ID : DEFAULT_TEXT_MODEL_ID);
  const id = role === "text" ? resolveDefaultTextModelId(rawId) : rawId;
  if (role === "vision" && !isVisionCapable(id, opts.visionCapableIds)) {
    throw new Error(`model ${id} is not vision-capable; image/video analysis requires a vision-capable model`);
  }
  const cost: ModelCost = opts.cost ?? (role === "text" && id === DEFAULT_TEXT_MODEL_ID ? "free" : "paid");
  return { id, role, cost };
}

/** Paid models are only runnable with an explicit cost ceiling. */
export function assertCostPolicy(
  spec: { taskId: string; costCeiling?: CostCeiling },
  model: ModelRef,
): void {
  if (model.cost === "paid" && !spec.costCeiling) {
    throw new Error(`task ${spec.taskId}: paid model ${model.id} requires an explicit costCeiling`);
  }
}

/** Formats `maxTimeMs` as an integer seconds string for `--max-time`. */
export function formatMaxTimeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`maxTimeMs must be a positive number, got ${ms}`);
  }
  return String(Math.ceil(ms / 1000));
}

/**
 * Deterministic argv builder for a non-interactive `omp -p` run. Pure: the
 * same spec always yields the same argv; no shell concatenation is involved.
 * Policy enforcement (vision capability, cost ceiling) is the job of
 * `planOmpRun`; this function is the mechanical argv shape.
 */
export function buildOmpArgv(spec: OmpRunSpec): string[] {
  const argv: string[] = [];
  if (spec.profile) argv.push("--profile", spec.profile);
  argv.push("-p");
  argv.push("--model", resolveDefaultTextModelId(spec.model ?? (spec.role === "vision" ? DEFAULT_VISION_MODEL_ID : DEFAULT_TEXT_MODEL_ID)));
  argv.push("--cwd", spec.cwd);
  argv.push("--mode", spec.mode === "text" ? "text" : "json");
  if (spec.maxTimeMs) argv.push("--max-time", formatMaxTimeMs(spec.maxTimeMs));
  if (spec.sessionDir) argv.push("--session-dir", spec.sessionDir);
  else argv.push("--no-session");
  if (spec.thinking) argv.push("--thinking", spec.thinking);
  if (spec.systemPrompt) argv.push("--system-prompt", spec.systemPrompt);
  if (spec.appendSystemPrompt) argv.push("--append-system-prompt", spec.appendSystemPrompt);
  if (spec.noTools) argv.push("--no-tools");
  if (spec.noPty !== false) argv.push("--no-pty");
  if (spec.approvalMode) {
    argv.push("--approval-mode", spec.approvalMode);
  } else if (spec.autoApprove !== false) {
    argv.push("--auto-approve");
  }
  argv.push(spec.prompt);
  return argv;
}

export interface OmpRunPlan {
  model: ModelRef;
  argv: string[];
}

/**
 * Sanctioned way to plan a run: resolve the model, enforce the cost policy,
 * then build the argv. Callers that build argv directly bypass policy; use
 * this entry point (or `runOmp`) for real execution.
 */
export function planOmpRun(spec: OmpRunSpec): OmpRunPlan {
  const model = resolveModel(spec.role ?? "text", {
    model: spec.model,
    visionCapableIds: spec.visionCapableIds,
    cost: spec.cost,
  });
  assertCostPolicy(spec, model);
  const argv = buildOmpArgv({ ...spec, model: model.id });
  return { model, argv };
}

/**
 * Parses stdout as a single JSON document; null when empty or unparseable.
 * The raw stdout is always preserved on the result, so a null here loses no
 * information — callers can parse further (e.g. NDJSON) themselves.
 */
export function parseJsonOrNull(text: string): unknown {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    // Deliberate: unparseable output is an observable, documented outcome
    // (null), not a hidden failure; the raw text survives on the result.
    return null;
  }
}

export interface OmpRunResult {
  taskId: string;
  model: string;
  cost: ModelCost;
  costCeiling?: CostCeiling;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Parsed JSON when mode is "json" and stdout parses; else null. */
  json: unknown;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** True when the caller's abort signal fired during the run. */
  cancelled: boolean;
  /** True when `maxTimeMs` elapsed and the child was killed. */
  timedOut: boolean;
}

export interface RunOmpOptions {
  /** Abort cancels the child (SIGTERM) and marks the result `cancelled`. */
  signal?: AbortSignal;
  /**
   * Injectable spawn for tests: a fake child lets tests drive exit codes,
   * stdout/stderr, timeout kills, and abort without any real network use.
   * Defaults to node:child_process.spawn.
   */
  spawnFn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
  ) => ChildProcessByStdio<null, Readable, Readable>;
}

/**
 * Environment variable names inherited from the host process into the child.
 * Deliberately minimal: enough to locate/run `omp` (PATH), honor its config
 * dirs (HOME), scratch space (TMPDIR/TMP/TEMP), locale handling (LANG/LC_*,
 * LANGUAGE), and terminal basics (TERM). Everything else — in particular any
 * credential, token, or key variable — is NOT inherited implicitly. Callers
 * that need more pass it explicitly via `spec.env`.
 */
export const OMP_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_NUMERIC",
  "LC_TIME",
  "LANGUAGE",
  "TERM",
];

/**
 * Builds the child environment: the allowlisted subset of `source` (defaults
 * to the current process env) with `explicit` merged on top. Explicit entries
 * always win and may introduce new names; nothing outside the allowlist is
 * inherited implicitly. The result never contains credential/token/key
 * variables unless the caller supplied them explicitly.
 */
export function buildOmpEnv(
  explicit: Record<string, string> = {},
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of OMP_ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...explicit };
}

/**
 * Runs a non-interactive `omp -p` job via `spawn` (never a shell). The child
 * receives a minimal allowlisted environment (see `buildOmpEnv`) plus any
 * explicit `spec.env` — never the full host environment. Resolves
 * with a deterministic result envelope on exit, including cancellation and
 * timeout metadata. Rejects only if spawning the binary itself fails (e.g. omp
 * is not installed); a timed-out or aborted child still resolves.
 */
export async function runOmp(spec: OmpRunSpec, opts: RunOmpOptions = {}): Promise<OmpRunResult> {
  const { model, argv } = planOmpRun(spec);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let cancelled = false;
  let timedOut = false;

  await new Promise<void>((resolveExit, rejectSpawn) => {
    const doSpawn = opts.spawnFn ?? spawn;
    const child = doSpawn(spec.bin ?? "omp", argv, {
      cwd: spec.cwd,
      // Minimal allowlisted environment + explicit spec.env; never the full
      // host environment, so host credentials/tokens/keys are not inherited.
      env: { NODE_ENV: process.env.NODE_ENV, ...buildOmpEnv(spec.env) },
      stdio: ["ignore", "pipe", "pipe"],
      // Explicit: argv is passed as an array; never routed through a shell.
      shell: false,
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });

    const onAbort = () => {
      cancelled = true;
      child.kill("SIGTERM");
    };
    const timer = spec.maxTimeMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, spec.maxTimeMs)
      : undefined;
    if (timer && typeof timer.unref === "function") timer.unref();
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const finish = () => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };

    child.on("error", (error: Error) => {
      finish();
      // Spawning itself failed (e.g. omp is not installed). Propagate with
      // context; a killed child (timeout/abort) resolves normally instead.
      rejectSpawn(new Error(`failed to spawn ${spec.bin ?? "omp"}: ${error.message}`, { cause: error }));
    });
    child.on("close", (code: number | null) => {
      exitCode = code;
      finish();
      resolveExit();
    });
  });

  const endedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  const json = spec.mode === "text" ? null : parseJsonOrNull(stdout);
  return {
    taskId: spec.taskId,
    model: model.id,
    cost: model.cost,
    costCeiling: spec.costCeiling,
    exitCode,
    stdout,
    stderr,
    json,
    startedAt,
    endedAt,
    durationMs,
    cancelled,
    timedOut,
  };
}
