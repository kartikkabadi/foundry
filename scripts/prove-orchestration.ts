#!/usr/bin/env node
/**
 * Rerunnable local live-proof harness for Foundry's orchestration runtime.
 *
 * Proves, against the production modules, that an orchestrated execute run:
 *   - prepares an isolated git worktree BEFORE the model runner executes in it;
 *   - runs a deterministic injected model boundary (the runOmp stub) that
 *     writes a small valid source change inside the prepared cwd;
 *   - verifies that change with a real local command (`git status`) through the
 *     real executeVerification adapter and its argv-only execFile effect;
 *   - finalizes exactly once (saveArtifact + clearJob) on success;
 *   - persists a retryable failure, survives a store reopen and a full runtime
 *     rebuild, and succeeds on the next attempt once the persisted backoff
 *     elapses on the injected clock;
 *   - never touches a remote and issues no publication git commands.
 *
 * Substitution: only runOmp is injected, as a deterministic local model
 * boundary (success writes the change file; recovery fails once with a
 * simulated timeout). Everything else is the real implementation:
 * OrchestrationStore (SQLite), scheduler, prepareWorkspace (git-worktree),
 * executeVerification (real execFile), execute driver, and finalization.
 *
 * Direct run:  npx tsx scripts/prove-orchestration.ts
 * Exits 0 and prints the structured JSON report; exits 1 on failure. The
 * direct-run wrapper removes only its own temp scratch in finally, after a
 * containment check.
 *
 * Importable: proveOrchestration(options?) returns { report, scratch } and
 * does NOT clean up, so callers (tests) can inspect the real artifacts. A
 * process may run it once (the store connection follows FOUNDRY_DATA, set
 * here before any store use).
 */
import { execFile as execFileNode } from "node:child_process";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { OrchestrationStore } from "../lib/foundry/orchestration-store";
import { RETRY_BACKOFF_BASE_MS } from "../lib/foundry/orchestration-execute";
import type { FinalizeExecuteInput } from "../lib/foundry/orchestration-execute-driver";
import {
  runOrchestratedExecute,
  type ExecuteRuntimeDeps,
  type ExecuteRuntimeInput,
} from "../lib/foundry/orchestration-runtime";
import { DEFAULT_TEXT_MODEL } from "../lib/foundry/orchestration-types";
import type { OrchestrationTask } from "../lib/foundry/orchestration-types";
import type { OmpRunResult, OmpRunSpec } from "../lib/foundry/omp-runner";
import { schedule, type HostState, type ModelState } from "../lib/foundry/scheduler";
import { clearJob, failJob, getArtifact, getJob, saveArtifact, tryClaimJob } from "../lib/foundry/store";
import { ARTIFACT_KIND, type Issue } from "../lib/foundry/types";
import type { DeclaredCheck, VerificationExecutionResult, VerificationPlan } from "../lib/foundry/verification";
import { executeVerification } from "../lib/foundry/verification";
import { prepareWorkspace } from "../lib/foundry/workspace";

// ---------------------------------------------------------------------------
// Deterministic constants
// ---------------------------------------------------------------------------

const DEFAULT_START_TIME = "2026-08-25T10:00:00.000Z";
const VERIFICATION_TIMEOUT_MS = 60_000;
const MAX_TICKS = 100;
const RETRY_ADVANCE_SLACK_MS = 1_000;
const OWNER = "prove-orchestration";

const PROOF_CHANGE_DIR = "src";
const PROOF_CHANGE_FILE = ["src", "proof-change.ts"];
const PROOF_CHANGE_CONTENT = "export const provenByFoundry = true;\n";
const BASELINE_SRC = ["src", "index.ts"];
const BASELINE_SRC_CONTENT = "export const baseline = 'foundry-live-proof-baseline';\n";
const BASELINE_README = "README.md";
const BASELINE_README_CONTENT =
  "# Foundry live-proof disposable repository\n\nCreated and removed by scripts/prove-orchestration.ts.\n";
const GIT_INIT_DEFAULT_BRANCH = "main";

/** Git subcommands the harness must never issue (checked in the report). */
const PUBLICATION_COMMANDS = new Set(["push", "merge", "deploy"]);

const VPS_HOST: HostState = {
  id: "vps",
  budget: { cpu: 16, memoryMiB: 16_384, diskMiB: 102_400, concurrency: 20 },
  used: { cpu: 0, memoryMiB: 0, diskMiB: 0, concurrency: 0 },
};

const TEXT_MODEL: ModelState = {
  id: DEFAULT_TEXT_MODEL,
  capabilities: ["text"],
  maxConcurrent: 3,
  concurrent: 0,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProveOptions = {
  /** Sanctioned scratch root; defaults to a fresh mkdtemp under os.tmpdir(). */
  scratchRoot?: string;
  /** SQLite data dir (FOUNDRY_DATA). Defaults to <scratchRoot>/data. */
  dataDir?: string;
  /** Workspace root passed to prepareWorkspace. Defaults to <scratchRoot>/workspaces. */
  workspaceRoot?: string;
  /** Disposable git repo owning the worktrees. Defaults to <scratchRoot>/repo. */
  repoPath?: string;
  /** Fixed clock start (ISO-8601). Defaults to a deterministic constant. */
  startTime?: string;
};

export type ProofScratch = {
  root: string;
  dataDir: string;
  workspaceRoot: string;
  repoPath: string;
};

export type SuccessFacts = {
  status: string;
  outcome: string | null;
  attempts: number;
  isRetryable: boolean;
  nextRetryAt: string | null;
  finalizeCalls: number;
  isArtifactSaved: boolean;
  isJobCleared: boolean;
};

export type WorkspaceFacts = {
  preparedPath: string;
  didPrepareBeforeRunner: boolean;
  isRunnerCwdWorktree: boolean;
  isMutationInWorktree: boolean;
  isMainRepoClean: boolean;
  isMutationAbsentFromMainRepo: boolean;
};

export type VerificationFacts = {
  ok: boolean;
  evidenceCount: number;
  checkExitCode: number | null;
  checkCwd: string | null;
  checkStdout: string;
};

export type RecoveryFacts = {
  firstStatus: string;
  firstReason: string | null;
  persisted: { isRetryable: boolean; nextRetryAt: string | null; attempts: number };
  finalStatus: string;
  finalOutcome: string | null;
  finalAttempts: number;
  isRetryableCleared: boolean;
  isNextRetryAtCleared: boolean;
  finalizeCalls: number;
};

export type ContainmentFacts = {
  hasNoRemotes: boolean;
  hasNoRemoteTrackingRefs: boolean;
  publicationCommandCount: number;
  isMainBranchHeadUnchanged: boolean;
};

export type ProofReport = {
  assertionsPassed: boolean;
  success: SuccessFacts;
  recovery: RecoveryFacts;
  workspace: WorkspaceFacts;
  verification: VerificationFacts;
  finalization: { successCalls: number; recoveryCalls: number };
  containment: ContainmentFacts;
};

export type ProveOutcome = { report: ProofReport; scratch: ProofScratch };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Clock = { now: () => string; advance: (ms: number) => void };

function makeClock(startIso: string): Clock {
  let current = startIso;
  return {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(Date.parse(current) + ms).toISOString();
    },
  };
}

const execFileAsync = promisify(execFileNode) as (
  file: string,
  args: string[],
  options: { cwd?: string; encoding: "utf8" },
) => Promise<{ stdout: string; stderr: string }>;

type GitResult = { stdout: string; stderr: string };

/** Every argv the harness passes to git, so the report can prove none publish. */
const harnessGitCommands: string[][] = [];

async function git(argv: string[], options: { cwd?: string } = {}): Promise<GitResult> {
  const [command, ...args] = argv;
  harnessGitCommands.push([...argv]);
  try {
    const result = await execFileAsync(command, args, { cwd: options.cwd, encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { stderr?: unknown; message?: string };
    const detail = String(failure.stderr ?? failure.message ?? "unknown git error").trim();
    throw new Error(`git ${argv.join(" ")} failed: ${detail}`);
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    const failure = error as { code?: string };
    if (failure.code !== "ENOENT") throw error;
    return false;
  }
}

async function cwdIsRegisteredWorktree(cwd: string): Promise<boolean> {
  const { stdout } = await git(["git", "worktree", "list", "--porcelain"], { cwd });
  const target = await fs.realpath(cwd);
  for (const line of stdout.split("\n")) {
    const match = /^worktree (.+)$/.exec(line.trim());
    if (match === null) continue;
    const listed = await fs.realpath(match[1]).catch(() => match[1]);
    if (listed === target) return true;
  }
  return false;
}

async function createDisposableRepo(repoPath: string): Promise<string> {
  await fs.mkdir(join(repoPath, PROOF_CHANGE_DIR), { recursive: true });
  await fs.writeFile(join(repoPath, ...BASELINE_SRC), BASELINE_SRC_CONTENT, "utf8");
  await fs.writeFile(join(repoPath, BASELINE_README), BASELINE_README_CONTENT, "utf8");
  await git(["git", "init", repoPath]);
  // Point HEAD at a stable branch name regardless of the environment's
  // init.defaultBranch, so assertions compare against a known ref.
  await git(["git", "symbolic-ref", "HEAD", `refs/heads/${GIT_INIT_DEFAULT_BRANCH}`], { cwd: repoPath });
  await git(["git", "config", "user.name", "Foundry Live Proof"], { cwd: repoPath });
  await git(["git", "config", "user.email", "live-proof@foundry.local"], { cwd: repoPath });
  await git(["git", "config", "commit.gpgsign", "false"], { cwd: repoPath });
  await git(["git", "add", "."], { cwd: repoPath });
  await git(["git", "commit", "-m", "baseline"], { cwd: repoPath });
  const head = await git(["git", "rev-parse", "HEAD"], { cwd: repoPath });
  return head.stdout.trim();
}

// ---------------------------------------------------------------------------
// Scenario wiring
// ---------------------------------------------------------------------------

type ScenarioStub = "write-change" | "timeout-once";

type ScenarioContext = {
  issue: Issue;
  clock: Clock;
  workspaceRoot: string;
  repoPath: string;
  trace: Array<"prepare" | "run">;
  runCalls: Array<{ spec: OmpRunSpec; isWorktree: boolean }>;
  verifyCalls: Array<{ workspace: { path: string }; result: VerificationExecutionResult }>;
  finalizeCalls: Array<{ input: FinalizeExecuteInput; evidence: string[] }>;
  stub: ScenarioStub;
};

function makeContext(
  issueId: string,
  startIso: string,
  workspaceRoot: string,
  repoPath: string,
  stub: ScenarioStub,
): ScenarioContext {
  return {
    issue: {
      id: issueId,
      idea: "Prove orchestrated execute end to end with a live disposable workspace",
      targetUrl: "https://foundry.local/live-proof",
      size: "s",
      currentStage: "execute",
      runMode: "oneshot",
      walkHold: false,
      oneshotStopReason: null,
      projectId: null,
      cycleId: null,
      moduleId: null,
      createdAt: startIso,
      updatedAt: startIso,
    },
    clock: makeClock(startIso),
    workspaceRoot,
    repoPath,
    trace: [],
    runCalls: [],
    verifyCalls: [],
    finalizeCalls: [],
    stub,
  };
}

function inputFor(issue: Issue): ExecuteRuntimeInput {
  return {
    issue,
    spec: {
      title: "Live-proof orchestrated execute",
      spec: "Prove the real orchestration runtime with a disposable git worktree, a deterministic stub model boundary, real verification, and durable retry.",
      acceptance: ["structured proof report", "workspace mutation isolated", "no remote publication"],
    },
    claims: ["repository"],
    maxTimeMs: VERIFICATION_TIMEOUT_MS,
  };
}

function codeStatusChecks(plan: VerificationPlan): DeclaredCheck[] {
  return plan.gates.map((gate) => ({
    id: `check:${gate.id}`,
    gate: gate.id,
    argv: ["git", "status", "--porcelain"],
  }));
}

/** Mirrors the runtime's legacy finalize: save the execute artifact once. */
function finalizeLikeRuntime(input: FinalizeExecuteInput, evidence: string[]): void {
  if (input.outcome === "succeeded") {
    saveArtifact({
      issueId: input.issueId,
      kind: ARTIFACT_KIND.execute,
      stage: "execute",
      body: JSON.stringify({ outcome: input.outcome, source: "prove-orchestration", evidence }),
    });
    clearJob(input.issueId, "execute");
    return;
  }
  failJob(input.issueId, "execute", input.error ?? `execute ${input.outcome}`);
}

/**
 * Injected deterministic model boundary. Each invocation builds a fresh
 * store, so the two recovery invocations also prove durability across a
 * store reopen and a full runtime rebuild (empty driver state).
 */
function buildDeps(ctx: ScenarioContext): ExecuteRuntimeDeps {
  return {
    store: new OrchestrationStore({ now: ctx.clock.now }),
    owner: OWNER,
    now: ctx.clock.now,
    workspaceRoot: ctx.workspaceRoot,
    repoPath: ctx.repoPath,
    schedule: ({ tasks, now }) => schedule({ tasks, hosts: { vps: VPS_HOST }, models: { [DEFAULT_TEXT_MODEL]: TEXT_MODEL }, now }),
    prepareWorkspace: async (plan, options) => {
      ctx.trace.push("prepare");
      return prepareWorkspace(plan, options);
    },
    runOmp: (spec) => stubRunOmp(spec, ctx),
    executeVerification: async (plan, workspace, options) => {
      const result = await executeVerification(plan, workspace, options);
      ctx.verifyCalls.push({ workspace, result });
      return result;
    },
    verificationChecks: (plan) => codeStatusChecks(plan),
    appendEvent: () => {},
    verificationTimeoutMs: VERIFICATION_TIMEOUT_MS,
    finalize: (input, evidence) => {
      ctx.finalizeCalls.push({ input, evidence });
      finalizeLikeRuntime(input, evidence);
    },
    maxTicks: MAX_TICKS,
  };
}

async function stubRunOmp(spec: OmpRunSpec, ctx: ScenarioContext): Promise<OmpRunResult> {
  ctx.trace.push("run");
  const isWorktree = await cwdIsRegisteredWorktree(spec.cwd);
  ctx.runCalls.push({ spec, isWorktree });
  const startedAt = ctx.clock.now();
  const base: OmpRunResult = {
    taskId: spec.taskId,
    model: DEFAULT_TEXT_MODEL,
    cost: "free",
    exitCode: 0,
    stdout: "stub model completed without network",
    stderr: "",
    json: { proven: true },
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    cancelled: false,
    timedOut: false,
  };
  if (ctx.stub === "timeout-once") {
    ctx.stub = "write-change";
    return {
      ...base,
      exitCode: null,
      stdout: "",
      stderr: "simulated OMP timeout; retryable",
      json: null,
      durationMs: VERIFICATION_TIMEOUT_MS,
      timedOut: true,
    };
  }
  // Success boundary: write a small valid source change inside the prepared cwd.
  await fs.mkdir(join(spec.cwd, PROOF_CHANGE_DIR), { recursive: true });
  await fs.writeFile(join(spec.cwd, ...PROOF_CHANGE_FILE), PROOF_CHANGE_CONTENT, "utf8");
  return base;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

type FactCheck = { name: string; passed: boolean };

/** Fresh store over the same SQLite file: a durable, independent re-read. */
async function readTaskFacts(ctx: ScenarioContext): Promise<{ task: OrchestrationTask | null }> {
  const fresh = new OrchestrationStore({ now: ctx.clock.now });
  const run = fresh.listRuns().find((candidate) => candidate.issueId === ctx.issue.id);
  if (run === undefined) throw new Error(`no orchestration run for ${ctx.issue.id}`);
  const tasks = fresh.listTasks(run.id);
  if (tasks.length !== 1) throw new Error(`expected exactly one task for ${ctx.issue.id}`);
  return { task: tasks[0] };
}

async function runSuccessScenario(
  ctx: ScenarioContext,
): Promise<{ facts: SuccessFacts; workspace: WorkspaceFacts; verification: VerificationFacts; checks: FactCheck[] }> {
  tryClaimJob(ctx.issue.id, "execute");
  const result = await runOrchestratedExecute(inputFor(ctx.issue), buildDeps(ctx));

  const { task } = await readTaskFacts(ctx);
  const isArtifactSaved = getArtifact(ctx.issue.id, ARTIFACT_KIND.execute) !== null;
  const isJobCleared = getJob(ctx.issue.id, "execute") === null;

  const preparedPath = ctx.runCalls[0]?.spec.cwd ?? "";
  const isRunnerCwdWorktree = ctx.runCalls[0]?.isWorktree ?? false;
  const prepareIndex = ctx.trace.indexOf("prepare");
  const runIndex = ctx.trace.indexOf("run");
  const didPrepareBeforeRunner = prepareIndex !== -1 && runIndex !== -1 && prepareIndex < runIndex;
  const isMutationInWorktree = await pathExists(join(preparedPath, ...PROOF_CHANGE_FILE));
  const isMutationAbsentFromMainRepo = !(await pathExists(join(ctx.repoPath, ...PROOF_CHANGE_FILE)));
  const mainStatus = await git(["git", "status", "--porcelain"], { cwd: ctx.repoPath });
  const isMainRepoClean = mainStatus.stdout.trim() === "";

  const verifyCall = ctx.verifyCalls[0];
  const verification: VerificationFacts = {
    ok: verifyCall?.result.ok ?? false,
    evidenceCount: verifyCall?.result.evidence.length ?? 0,
    checkExitCode: null,
    checkCwd: null,
    checkStdout: "",
  };
  if (verifyCall !== undefined && verifyCall.result.evidence.length > 0) {
    const parsed: unknown = JSON.parse(verifyCall.result.evidence[0]);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      verification.checkExitCode = typeof record.exitCode === "number" ? record.exitCode : null;
      verification.checkCwd = typeof record.cwd === "string" ? record.cwd : null;
      verification.checkStdout = typeof record.stdout === "string" ? record.stdout : "";
    }
  }

  const facts: SuccessFacts = {
    status: result.status,
    outcome: result.status === "done" ? result.outcome : null,
    attempts: task?.attempts ?? 0,
    isRetryable: task?.retryable ?? false,
    nextRetryAt: task?.nextRetryAt ?? null,
    finalizeCalls: ctx.finalizeCalls.length,
    isArtifactSaved,
    isJobCleared,
  };

  const checks: FactCheck[] = [
    { name: "success.status is done", passed: result.status === "done" },
    { name: "success.outcome is succeeded", passed: result.status === "done" && result.outcome === "succeeded" },
    { name: "success.task attempts == 1", passed: facts.attempts === 1 },
    { name: "success.task not retryable", passed: facts.isRetryable === false },
    { name: "success.task has no nextRetryAt", passed: facts.nextRetryAt === null },
    { name: "success finalize fired exactly once", passed: facts.finalizeCalls === 1 },
    { name: "success artifact saved", passed: isArtifactSaved },
    { name: "success job cleared", passed: isJobCleared },
    { name: "workspace prepared before runner", passed: didPrepareBeforeRunner },
    { name: "runner cwd is a registered worktree", passed: isRunnerCwdWorktree },
    { name: "mutation present in worktree", passed: isMutationInWorktree },
    { name: "main repo clean after run", passed: isMainRepoClean },
    { name: "mutation absent from main repo", passed: isMutationAbsentFromMainRepo },
    { name: "verification passed", passed: verification.ok },
    { name: "verification collected evidence", passed: verification.evidenceCount >= 1 },
    { name: "verification check exited 0", passed: verification.checkExitCode === 0 },
    { name: "verification check ran in prepared path", passed: verification.checkCwd === preparedPath },
  ];

  return {
    facts,
    workspace: {
      preparedPath,
      didPrepareBeforeRunner,
      isRunnerCwdWorktree,
      isMutationInWorktree,
      isMainRepoClean,
      isMutationAbsentFromMainRepo,
    },
    verification,
    checks,
  };
}

async function runRecoveryScenario(ctx: ScenarioContext): Promise<{ facts: RecoveryFacts; checks: FactCheck[] }> {
  tryClaimJob(ctx.issue.id, "execute");
  const first = await runOrchestratedExecute(inputFor(ctx.issue), buildDeps(ctx));

  const firstState = await readTaskFacts(ctx);
  const persisted = {
    isRetryable: firstState.task?.retryable ?? false,
    nextRetryAt: firstState.task?.nextRetryAt ?? null,
    attempts: firstState.task?.attempts ?? 0,
  };

  // Advance the injected clock past the persisted backoff so the retry is due.
  const backoffRemainingMs =
    persisted.nextRetryAt === null
      ? RETRY_BACKOFF_BASE_MS + RETRY_ADVANCE_SLACK_MS
      : Date.parse(persisted.nextRetryAt) - Date.parse(ctx.clock.now()) + RETRY_ADVANCE_SLACK_MS;
  ctx.clock.advance(Math.max(backoffRemainingMs, 0));

  // Reopen: buildDeps constructs a fresh store over the same SQLite file and
  // rebuilds the runtime with empty driver state.
  const second = await runOrchestratedExecute(inputFor(ctx.issue), buildDeps(ctx));

  const secondState = await readTaskFacts(ctx);
  const isArtifactSaved = getArtifact(ctx.issue.id, ARTIFACT_KIND.execute) !== null;
  const isJobCleared = getJob(ctx.issue.id, "execute") === null;

  const facts: RecoveryFacts = {
    firstStatus: first.status,
    firstReason: first.status === "waiting" ? first.reason : null,
    persisted,
    finalStatus: second.status,
    finalOutcome: second.status === "done" ? second.outcome : null,
    finalAttempts: secondState.task?.attempts ?? 0,
    isRetryableCleared: secondState.task?.retryable === false,
    isNextRetryAtCleared: secondState.task?.nextRetryAt === null,
    finalizeCalls: ctx.finalizeCalls.length,
  };

  const checks: FactCheck[] = [
    { name: "recovery first invocation waits on retry", passed: first.status === "waiting" && first.reason === "retry_pending" },
    { name: "recovery failure persisted retryable", passed: persisted.isRetryable === true },
    { name: "recovery failure persisted nextRetryAt", passed: persisted.nextRetryAt !== null },
    { name: "recovery failure recorded one attempt", passed: persisted.attempts === 1 },
    { name: "recovery second invocation succeeds", passed: second.status === "done" && second.outcome === "succeeded" },
    { name: "recovery task completed on attempt 2", passed: facts.finalAttempts === 2 },
    { name: "recovery retryable cleared", passed: facts.isRetryableCleared },
    { name: "recovery nextRetryAt cleared", passed: facts.isNextRetryAtCleared },
    { name: "recovery finalize fired exactly once", passed: facts.finalizeCalls === 1 },
    { name: "recovery artifact saved", passed: isArtifactSaved },
    { name: "recovery job cleared", passed: isJobCleared },
  ];

  return { facts, checks };
}

// ---------------------------------------------------------------------------
// Proof entry point
// ---------------------------------------------------------------------------

export async function proveOrchestration(options: ProveOptions = {}): Promise<ProveOutcome> {
  const scratchRoot = options.scratchRoot ?? (await mkdtemp(join(tmpdir(), "foundry-prove-orch-")));
  const dataDir = options.dataDir ?? join(scratchRoot, "data");
  const workspaceRoot = options.workspaceRoot ?? join(scratchRoot, "workspaces");
  const repoPath = options.repoPath ?? join(scratchRoot, "repo");
  const startTime = options.startTime ?? DEFAULT_START_TIME;

  process.env.FOUNDRY_DATA = dataDir;
  await fs.mkdir(dataDir, { recursive: true });
  // Pre-create the sanctioned root so the adapter's realpath containment check
  // resolves consistently on macOS (/var vs /private/var).
  await fs.mkdir(workspaceRoot, { recursive: true });

  const baselineHead = await createDisposableRepo(repoPath);

  const successCtx = makeContext("issue-prove-success", startTime, workspaceRoot, repoPath, "write-change");
  const success = await runSuccessScenario(successCtx);

  const recoveryCtx = makeContext("issue-prove-recovery", startTime, workspaceRoot, repoPath, "timeout-once");
  const recovery = await runRecoveryScenario(recoveryCtx);

  const remoteList = await git(["git", "remote"], { cwd: repoPath });
  const hasNoRemotes = remoteList.stdout.trim() === "";
  const remoteRefs = await git(["git", "for-each-ref", "refs/remotes"], { cwd: repoPath });
  const hasNoRemoteTrackingRefs = remoteRefs.stdout.trim() === "";
  const headAfter = await git(["git", "rev-parse", "HEAD"], { cwd: repoPath });
  const isMainBranchHeadUnchanged = headAfter.stdout.trim() === baselineHead;
  const publicationCommandCount = harnessGitCommands.filter(
    (argv) => argv.length >= 2 && PUBLICATION_COMMANDS.has(argv[1]),
  ).length;

  const containment: ContainmentFacts = {
    hasNoRemotes,
    hasNoRemoteTrackingRefs,
    publicationCommandCount,
    isMainBranchHeadUnchanged,
  };

  const checks: FactCheck[] = [
    ...success.checks,
    ...recovery.checks,
    { name: "no git remotes configured", passed: hasNoRemotes },
    { name: "no remote-tracking refs", passed: hasNoRemoteTrackingRefs },
    { name: "main branch HEAD unchanged", passed: isMainBranchHeadUnchanged },
    { name: "no publication git commands issued", passed: publicationCommandCount === 0 },
  ];

  const assertionsPassed = checks.every((check) => check.passed);
  for (const check of checks) {
    if (!check.passed) process.stderr.write(`prove-orchestration fact failed: ${check.name}\n`);
  }

  const report: ProofReport = {
    assertionsPassed,
    success: success.facts,
    recovery: recovery.facts,
    workspace: success.workspace,
    verification: success.verification,
    finalization: { successCalls: success.facts.finalizeCalls, recoveryCalls: recovery.facts.finalizeCalls },
    containment,
  };

  return { report, scratch: { root: scratchRoot, dataDir, workspaceRoot, repoPath } };
}

// ---------------------------------------------------------------------------
// Direct-run wrapper
// ---------------------------------------------------------------------------

function isPathInside(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

/** Removes only the scratch this wrapper created, after a containment check. */
async function removeScratchOnly(root: string): Promise<void> {
  const resolvedRoot = await fs.realpath(root).catch(() => null);
  if (resolvedRoot === null) return;
  const resolvedTmp = await fs.realpath(tmpdir());
  if (!isPathInside(resolvedRoot, resolvedTmp)) {
    throw new Error(`refusing to remove scratch outside tmpdir: ${resolvedRoot}`);
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const scratchRoot = await mkdtemp(join(tmpdir(), "foundry-prove-orch-"));
  const dataDir = join(scratchRoot, "data");
  const workspaceRoot = join(scratchRoot, "workspaces");
  const repoPath = join(scratchRoot, "repo");
  try {
    const outcome = await proveOrchestration({ scratchRoot, dataDir, workspaceRoot, repoPath });
    process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
    process.exitCode = outcome.report.assertionsPassed ? 0 : 1;
  } finally {
    await removeScratchOnly(scratchRoot);
  }
}

const scriptPath = process.argv[1] === undefined ? "" : pathToFileURL(resolve(process.argv[1])).href;
const isDirectRun =
  import.meta.url === scriptPath || (process.argv[1]?.endsWith("prove-orchestration.ts") ?? false);

if (isDirectRun) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`prove-orchestration failed: ${message}\n`);
    process.exitCode = 1;
  });
}
