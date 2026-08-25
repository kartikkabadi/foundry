import { hostname } from "node:os";
import { lstat, realpath, stat } from "node:fs/promises";
import {
  ExecuteLearning,
  executeLearningEvidence,
  type ExecuteLearningPolicy,
} from "./execute-learning";
import { appendEvent } from "./log";
import { runOmp, type OmpRunResult, type OmpRunSpec, type RunOmpOptions } from "./omp-runner";
import {
  runExecuteDriver,
  type ExecuteDriverEffects,
  type ExecuteDriverResult,
  type FinalizeExecuteInput,
} from "./orchestration-execute-driver";
import { OrchestrationStore } from "./orchestration-store";
import { DEFAULT_TEXT_MODEL, type OrchestrationTask } from "./orchestration-types";
import { resolvePhysicalClaims, type PhysicalFs } from "./physical-claims";
import { schedule, type HostState, type ModelState, type ScheduleOutput } from "./scheduler";
import { clearJob, createLearningStore, failJob, saveArtifact } from "./store";
import { ARTIFACT_KIND, type Issue } from "./types";
import {
  executeVerification,
  verificationPlan,
  type ChangedSurface,
  type DeclaredCheck,
  type ExecFileEffect,
  type TaskKind,
  type VerificationExecutionResult,
  type VerificationExecutorOptions,
  type VerificationGateId,
  type VerificationPlan,
} from "./verification";
import {
  planWorkspace,
  prepareWorkspace,
  type PrepareOptions,
  type WorkspacePlan,
} from "./workspace";

const ORCHESTRATION_LEASE_TTL_MS = 5 * 60 * 1000;
const LEASE_FINALIZATION_MARGIN_MS = 30 * 1000;
const MAX_OMP_TIME_MS = ORCHESTRATION_LEASE_TTL_MS - LEASE_FINALIZATION_MARGIN_MS;

export type ExecuteRuntimeInput = {
  issue: Issue;
  spec: { title: string; spec: string; acceptance: string[] };
  /**
   * Changed work this execute run must verify against. Derives the
   * verification plan (task kind + changed surfaces). When absent, the runtime
   * falls back to a conservative whole-repo code change, since execute
   * produces code changes against the repo.
   */
  changed?: { taskKind: TaskKind; surfaces: ChangedSurface[] };
  /**
   * Required write-path claim strings, relative to the sanctioned workspace
   * root. Resolved to canonical absolute physical identities with
   * `resolvePhysicalClaims` against the existing sanctioned root BEFORE the
   * orchestration task is created or dispatched; the resolved identities are
   * what the durable store persists. A new executable task with no claims
   * fails closed. The runtime also rejects a missing root, an escaping or
   * dangling claim, or a resolver error. Resume/replay reuses the physical
   * claims already persisted on the task and never re-resolves them.
   */
  claims: string[];
  /**
   * Finite wall-clock budget for the OMP run, in milliseconds. Overrides the
   * dependency default (`ExecuteRuntimeDeps.maxTimeMs`), which itself defaults
   * to `DEFAULT_OMP_MAX_TIME_MS` — safely below the five-minute task lease so
   * verification and finalize still fit inside it. Must be a positive finite
   * number; anything else fails closed before any effect runs.
   */
  maxTimeMs?: number;
};

export type ExecuteRuntime = (input: ExecuteRuntimeInput) => Promise<ExecuteDriverResult>;

/**
 * Physical workspace preparation. Backs the workspace sibling's adapter:
 * `prepareWorkspace(plan, options?)` in `lib/foundry/workspace.ts` — argv-based
 * (no shell), contained, idempotent, and never pushes/merges/deploys.
 */
export type PrepareWorkspaceEffect = (
  plan: WorkspacePlan,
  options?: PrepareOptions,
) => Promise<WorkspacePlan>;

/**
 * Independent production verification. Backs the verification sibling's
 * executor: `executeVerification(plan, workspace, options?)` in
 * `lib/foundry/verification.ts`. Runs declared checks against the changed
 * workspace; fails closed when a gate has no check, a check fails, or a gate
 * requires evidence that was not collected.
 */
export type ExecuteVerificationEffect = (
  plan: VerificationPlan,
  workspace: { path: string },
  options?: VerificationExecutorOptions,
) => Promise<VerificationExecutionResult>;

export type ExecuteRuntimeDeps = {
  /** Durable orchestration store; defaults to the SQLite-backed store. */
  store: OrchestrationStore;
  /** Stable executor identity; defaults to `<host>:<pid>:<issueId>`. */
  owner: string;
  /** Injected wall clock; ISO-8601 per driver tick. */
  now: () => string;
  /** Sanctioned root for per-task workspaces. */
  workspaceRoot: string;
  /**
   * Filesystem adapter for physical claim resolution. Defaults to the
   * `node:fs/promises` adapter, so production resolution reads the real
   * filesystem; inject a fake to keep resolution deterministic in tests.
   */
  claimFs?: PhysicalFs;
  /** Git repo owning the worktree (required for git-worktree isolation). */
  repoPath: string;
  /** Worktree branch; defaults to `foundry/<label>` in the preparer. */
  branch?: string;
  /** Scheduler; defaults to the single-VPS text-model schedule. */
  schedule: (input: { runId: string; tasks: OrchestrationTask[]; now: string }) => ScheduleOutput;
  /** Physical workspace preparer; defaults to the workspace sibling adapter. */
  prepareWorkspace: PrepareWorkspaceEffect;
  /** OMP runner; defaults to the no-shell omp-runner adapter. */
  runOmp: (spec: OmpRunSpec, options?: RunOmpOptions) => Promise<OmpRunResult>;
  /**
   * Finite wall-clock budget for the OMP run, in milliseconds. Defaults to
   * `DEFAULT_OMP_MAX_TIME_MS` (4 minutes) — safely below the five-minute task
   * lease so verification and finalize still fit inside it. An input
   * `maxTimeMs` overrides this dependency default.
   */
  maxTimeMs?: number;
  /** Independent verification executor; defaults to the verification sibling. */
  executeVerification: ExecuteVerificationEffect;
  /**
   * Declared local checks for executable verification gates. Defaults to the
   * package-command checks built by `verificationChecks` (e.g. `code_checks`
   * runs `npm run typecheck`). Inject to supply checks or evidence for gates
   * the default never claims (UI/security/independent-review).
   */
  verificationChecks: (plan: VerificationPlan) => DeclaredCheck[];
  /**
   * execFile effect for the production verifier. Defaults to the argv-based
   * no-shell effect in `lib/foundry/verification.ts`.
   */
  verificationExecFile?: ExecFileEffect;
  /** Verification timeout in milliseconds. */
  verificationTimeoutMs: number;
  /** Audit event sink. */
  appendEvent: (issueId: string, kind: string, payload: Record<string, unknown>) => void;
  /** Legacy finalize: save the execute artifact and clear the job once. */
  finalize: (input: FinalizeExecuteInput, evidence: string[]) => void;
  /**
   * Optional explicit runtime learning policy. When present, the finalize
   * path submits the terminal execute evidence to the shared learning adapter
   * exactly once per run; a learning rejection/error is audited separately
   * and never changes the execute outcome. Absent → the runtime never touches
   * learning, preserving the legacy behavior exactly.
   */
  learning?: ExecuteLearningPolicy;
  /** Bounded driver loop budget; defaults to the driver default (100). */
  maxTicks?: number;
};

const VPS_HOST: HostState = {
  id: "vps",
  budget: { cpu: 16, memoryMiB: 16_384, diskMiB: 102_400, concurrency: 20 },
  used: { cpu: 0, memoryMiB: 0, diskMiB: 0, concurrency: 0 },
};

const DEFAULT_MODEL: ModelState = {
  id: DEFAULT_TEXT_MODEL,
  capabilities: ["text"],
  maxConcurrent: 3,
  concurrent: 0,
};

const DEFAULT_TASK_KIND: TaskKind = "code";
const DEFAULT_SURFACES: ChangedSurface[] = [{ kind: "code", path: "." }];

/**
 * Default filesystem adapter for physical claim resolution: the real
 * `node:fs/promises` surface (`realpath`/`stat`/`lstat`), which satisfies the
 * `PhysicalFs` contract. Production resolution therefore reads the actual
 * filesystem; tests inject a fake through `ExecuteRuntimeDeps.claimFs`.
 */
const DEFAULT_CLAIM_FS: PhysicalFs = { realpath, stat, lstat };

/**
 * Default wall-clock budget for one OMP run. The store's default task lease
 * TTL is five minutes; four minutes leaves a full minute of headroom for
 * verification and finalize inside that lease. Configurable through
 * `ExecuteRuntimeInput.maxTimeMs` (input override) and
 * `ExecuteRuntimeDeps.maxTimeMs` (dependency default).
 */
export const DEFAULT_OMP_MAX_TIME_MS = 4 * 60 * 1000;

/**
 * Existing package commands that back executable verification gates. argv
 * index 0 is the executable; a shell is never used (the verification executor
 * rejects a shell command string). Only gates with a real, locally executable
 * command appear here — UI/security/independent-review gates are never
 * claimed by the default plan, so they fail closed unless the caller injects
 * checks or evidence through the runtime deps.
 */
const EXECUTABLE_GATE_COMMANDS: Partial<Record<VerificationGateId, string[]>> = {
  code_checks: ["npm", "run", "typecheck"],
};

/**
 * Declared checks a plan can honestly run with existing package commands.
 * Every returned check names a gate the plan claims and a real argv.
 */
export function verificationChecks(plan: VerificationPlan): DeclaredCheck[] {
  const checks: DeclaredCheck[] = [];
  for (const gate of plan.gates) {
    const argv = EXECUTABLE_GATE_COMMANDS[gate.id];
    if (argv !== undefined) {
      checks.push({ id: `check:${gate.id}`, gate: gate.id, argv: [...argv] });
    }
  }
  return checks;
}

/**
 * Default plan for a code-only change when the caller gives no `changed`
 * detail. Only gates with a real executable package-command check are
 * claimed, so a normal code-only run can succeed with actual code checks
 * instead of failing closed on gates the default cannot honestly execute.
 */
export function defaultVerificationPlan(): VerificationPlan {
  const plan = verificationPlan(DEFAULT_TASK_KIND, DEFAULT_SURFACES);
  return {
    ...plan,
    gates: plan.gates.filter((gate) => EXECUTABLE_GATE_COMMANDS[gate.id] !== undefined),
  };
}

function promptFor(input: ExecuteRuntimeInput): string {
  return [
    `Implement Foundry issue ${input.issue.id}: ${input.issue.idea}`,
    `Target: ${input.issue.targetUrl}`,
    `Specification: ${input.spec.title}`,
    input.spec.spec,
    "Acceptance criteria:",
    ...input.spec.acceptance.map((criterion) => `- ${criterion}`),
    "Do not merge, push, deploy, or delete shared resources. Return evidence for independent verification.",
  ].join("\n");
}

function scheduling(tasks: OrchestrationTask[], now: string): ScheduleOutput {
  return schedule({
    tasks,
    hosts: { vps: VPS_HOST },
    models: { [DEFAULT_TEXT_MODEL]: DEFAULT_MODEL },
    now,
  });
}

/**
 * Resolve write claims before task creation. A persisted task reuses its
 * original physical claims. A new executable task must declare at least one
 * claim, then resolve every claim under the sanctioned workspace root before
 * any effect runs.
 */
async function resolveClaimsBeforeTask(
  resolved: ExecuteRuntimeDeps,
  input: ExecuteRuntimeInput,
): Promise<string[] | undefined> {
  const existingRun = resolved.store
    .listRuns()
    .find((run) => run.issueId === input.issue.id && run.stage === "execute");
  const existingTask = existingRun ? (resolved.store.listTasks(existingRun.id)[0] ?? null) : null;
  if (existingTask !== null) {
    return undefined;
  }
  const requested = input.claims;
  if (requested === undefined || requested.length === 0) {
    throw new Error("orchestrated execute requires at least one write claim before task creation");
  }
  const result = await resolvePhysicalClaims({
    root: resolved.workspaceRoot,
    claims: requested,
    fs: resolved.claimFs ?? DEFAULT_CLAIM_FS,
  });
  if (!result.ok) {
    throw new Error(
      `orchestrated execute rejected before task creation: ${result.error.code} (${result.error.detail})`,
    );
  }
  return result.identities;
}

/**
 * Default opt-in runtime. Feature-on path:
 *   1. prepare-workspace builds the deterministic workspace plan (synchronous,
 *      data-only, matching the driver's WorkspaceEffect contract);
 *   2. run physically prepares the workspace (worktree/container/VM via the
 *      workspace sibling adapter) BEFORE the runner executes inside it, then
 *      runs OMP in the prepared path;
 *   3. verify runs an independent production executor against the prepared
 *      workspace and derives the verdict from structured evidence — runner
 *      stdout alone is never accepted;
 *   4. finalize saves the execute artifact and clears the job exactly once.
 *
 * External work stays behind the injected effects; tests inject fakes so no
 * real git, OMP, filesystem, or network call happens. The runtime never
 * cleans up, pushes, merges, or deploys.
 */
export async function runOrchestratedExecute(
  input: ExecuteRuntimeInput,
  deps: Partial<ExecuteRuntimeDeps> = {},
): Promise<ExecuteDriverResult> {
  const resolved: ExecuteRuntimeDeps = {
    store: deps.store ?? new OrchestrationStore(),
    owner: deps.owner ?? `${hostname()}:${process.pid}:${input.issue.id}`,
    now: deps.now ?? (() => new Date().toISOString()),
    workspaceRoot: deps.workspaceRoot ?? `${process.cwd()}/data/orchestration-workspaces`,
    claimFs: deps.claimFs ?? DEFAULT_CLAIM_FS,
    repoPath: deps.repoPath ?? process.cwd(),
    branch: deps.branch,
    schedule: deps.schedule ?? (({ tasks, now }) => scheduling(tasks, now)),
    prepareWorkspace: deps.prepareWorkspace ?? prepareWorkspace,
    runOmp: deps.runOmp ?? runOmp,
    maxTimeMs: deps.maxTimeMs,
    executeVerification: deps.executeVerification ?? executeVerification,
    verificationChecks: deps.verificationChecks ?? verificationChecks,
    verificationExecFile: deps.verificationExecFile,
    verificationTimeoutMs: deps.verificationTimeoutMs ?? 5 * 60 * 1000,
    appendEvent: deps.appendEvent ?? appendEvent,
    finalize: deps.finalize ?? defaultFinalize,
    learning: deps.learning,
    maxTicks: deps.maxTicks,
  };

  // Optional learning wiring: built only when a policy is configured, so an
  // absent policy preserves the legacy runtime behavior exactly.
  const learningAdapter = resolved.learning
    ? new ExecuteLearning(resolved.learning.store ?? createLearningStore(), {
        threshold: resolved.learning.threshold,
        onAudit:
          resolved.learning.onAudit ??
          ((event) =>
            resolved.appendEvent(event.issueId, event.kind, {
              id: event.record.id,
              key: event.record.key,
            })),
      })
    : null;

  /**
   * Submit the finalized terminal execute outcome to learning exactly once per
   * run. Runs after the legacy finalize, so a learning rejection/error is
   * audited through appendEvent but never changes the execute outcome the run
   * already reached.
   */
  const submitLearning = (finalizeInput: FinalizeExecuteInput, refs: readonly string[]) => {
    if (!learningAdapter || !resolved.learning) return;
    if (finalizeInput.outcome !== "succeeded" && finalizeInput.outcome !== "failed") return;
    try {
      const result = learningAdapter.submit({
        evidence: executeLearningEvidence(
          {
            issueId: finalizeInput.issueId,
            taskId: finalizeInput.taskId,
            runId: finalizeInput.runId,
            outcome: finalizeInput.outcome,
            error: finalizeInput.error,
            evidence: refs,
          },
          { pattern: resolved.learning.pattern, author: resolved.learning.author },
        ),
        review: resolved.learning.review,
        operatorApproved: resolved.learning.operatorApproved,
        now: resolved.learning.now ?? resolved.now,
      });
      if (!result.harvest.ok) {
        resolved.appendEvent(finalizeInput.issueId, "execute.learning.rejected", {
          runId: finalizeInput.runId,
          taskId: finalizeInput.taskId,
          reason: result.harvest.reason,
        });
        return;
      }
      if (!result.promotion.ok) {
        resolved.appendEvent(finalizeInput.issueId, "execute.learning.rejected", {
          runId: finalizeInput.runId,
          taskId: finalizeInput.taskId,
          reason: result.promotion.reason,
        });
      }
    } catch (error) {
      // Learning fails separately: the legacy finalize already ran, so a
      // learning error never changes the execute outcome.
      try {
        resolved.appendEvent(finalizeInput.issueId, "execute.learning.error", {
          runId: finalizeInput.runId,
          taskId: finalizeInput.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // The audit sink itself failed; keep learning silent rather than
        // corrupt the execute finalize.
      }
    }
  };

  const maxTimeMs = input.maxTimeMs ?? resolved.maxTimeMs ?? DEFAULT_OMP_MAX_TIME_MS;
  if (!Number.isFinite(maxTimeMs) || maxTimeMs <= 0) {
    throw new Error(`maxTimeMs must be a positive finite number of milliseconds, got ${maxTimeMs}`);
  }
  if (maxTimeMs > MAX_OMP_TIME_MS) {
    throw new Error(
      `maxTimeMs must be at most ${MAX_OMP_TIME_MS} milliseconds to finish before lease expiry`,
    );
  }

  // Resolve write claims before the driver creates or dispatches a task.
  // New executable tasks without a claim fail closed. Existing durable tasks
  // keep their previously resolved physical identities across retries.
  const claims = await resolveClaimsBeforeTask(resolved, input);

  const prompt = promptFor(input);
  // Explicit surfaces derive the full plan (UI/security gates included, so they
  // fail closed unless checks/evidence are injected). Without `changed`, fall
  // back to the honest default code plan that claims only executable gates.
  const plan = input.changed
    ? verificationPlan(input.changed.taskKind, input.changed.surfaces)
    : defaultVerificationPlan();
  const checks = resolved.verificationChecks(plan);

  // Set in driver order (prepare → run → verify → finalize) and captured by
  // the run/verify effects. Runner stdout is never used as evidence.
  let preparedPath: string | null = null;
  let evidence: string[] = [];

  const effects: ExecuteDriverEffects = {
    store: resolved.store,
    schedule: ({ runId, tasks, now }) => resolved.schedule({ runId, tasks, now }),
    prepareWorkspace: ({ task, decision }) =>
      planWorkspace({
        taskId: task.id,
        root: resolved.workspaceRoot,
        isolation: task.isolation?.kind ?? "git-worktree",
        host: decision.host,
      }),
    run: async ({ taskId, workspace }) => {
      // Physical preparation happens BEFORE the runner: the workspace must
      // exist (worktree added, dirs made) before OMP executes inside it. The
      // adapter is argv-based, no-shell, contained and idempotent.
      const prepared = await resolved.prepareWorkspace(workspace, {
        repoPath: resolved.repoPath,
        branch: resolved.branch,
      });
      preparedPath = prepared.path;

      const result = await resolved.runOmp({
        taskId,
        prompt,
        cwd: prepared.path,
        mode: "json",
        maxTimeMs,
      });
      if (result.timedOut || result.cancelled) {
        return {
          kind: "failed",
          taskId,
          error: result.timedOut ? "OMP run timed out" : "OMP run cancelled",
          retryable: true,
        };
      }
      return result.exitCode === 0
        ? { kind: "completed", taskId }
        : {
            kind: "failed",
            taskId,
            error: result.stderr || `OMP exited ${result.exitCode}`,
            retryable: false,
          };
    },
    verify: async ({ taskId }) => {
      if (preparedPath === null) {
        return {
          taskId,
          verdict: "failed",
          evidence: [],
          error: "workspace not prepared before verification",
        };
      }
      const verdict = await resolved.executeVerification(
        plan,
        { path: preparedPath },
        {
          timeoutMs: resolved.verificationTimeoutMs,
          checks,
          execFile: resolved.verificationExecFile,
        },
      );
      if (!verdict.ok || verdict.evidence.length === 0) {
        evidence = [];
        return {
          taskId,
          verdict: "failed",
          evidence: [],
          error: !verdict.ok
            ? verdict.errors.join("; ") || "verification failed"
            : "verifier produced no evidence",
        };
      }
      evidence = verdict.evidence;
      return { taskId, verdict: "passed", evidence: verdict.evidence, error: null };
    },
    appendEvent: resolved.appendEvent,
    finalize: (finalizeInput) => {
      // Legacy finalize first, unconditionally: a learning failure must never
      // change the execute outcome the run already reached.
      resolved.finalize(finalizeInput, evidence);
      submitLearning(finalizeInput, evidence);
    },
  };

  const result = await runExecuteDriver(effects, {
    issueId: input.issue.id,
    stage: "execute",
    featureEnabled: true,
    owner: resolved.owner,
    now: resolved.now,
    maxTicks: resolved.maxTicks,
    claims,
  });

  // The driver finalizes (and records the legacy job) only when the run
  // reaches a terminal state. A failed/exhausted driver result without a
  // finalized run never fired the finalize callback, so record the legacy
  // execute failure here exactly once.
  if ((result.status === "failed" || result.status === "exhausted") && !result.state.finalized) {
    failJob(
      input.issue.id,
      "execute",
      result.status === "failed" ? result.error : "Orchestrated execute exhausted",
    );
  }

  return result;
}

/** Legacy finalize: save the execute artifact and clear the job once. */
function defaultFinalize(input: FinalizeExecuteInput, evidence: string[]): void {
  if (input.outcome === "succeeded") {
    saveArtifact({
      issueId: input.issueId,
      kind: ARTIFACT_KIND.execute,
      stage: "execute",
      body: JSON.stringify({ outcome: input.outcome, source: "orchestrated", evidence }),
    });
    clearJob(input.issueId, "execute");
    return;
  }
  failJob(input.issueId, "execute", input.error ?? `Orchestrated execute ${input.outcome}`);
}
