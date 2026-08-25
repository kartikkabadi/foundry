import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OrchestrationStore } from "../lib/foundry/orchestration-store";
import {
  clearJob,
  failJob,
  getArtifact,
  getJob,
  orchestrationConnection,
  saveArtifact,
  tryClaimJob,
} from "../lib/foundry/store";
import { DEFAULT_TEXT_MODEL } from "../lib/foundry/orchestration-types";
import type { HostId, ResourceBudget } from "../lib/foundry/orchestration-types";
import { schedule } from "../lib/foundry/scheduler";
import type { HostState, ModelState } from "../lib/foundry/scheduler";
import type { PrepareOptions, WorkspacePlan } from "../lib/foundry/workspace";
import { ARTIFACT_KIND } from "../lib/foundry/types";
import type { FinalizeExecuteInput } from "../lib/foundry/orchestration-execute-driver";
import { DEFAULT_EXECUTE_RESOURCES, RETRY_BACKOFF_BASE_MS } from "../lib/foundry/orchestration-execute";
import type { ExecuteLearningPolicy } from "../lib/foundry/execute-learning";
import type {
  LearningRecord,
  LearningStoreAdapter,
  LessonRecord,
  PromotionRecord,
} from "../lib/foundry/learning";
import type { OmpRunResult, OmpRunSpec } from "../lib/foundry/omp-runner";
import type { VerificationPlan } from "../lib/foundry/verification";
import type { PhysicalFs } from "../lib/foundry/physical-claims";
import {
  runOrchestratedExecute,
  type ExecuteRuntimeDeps,
  type ExecuteRuntimeInput,
} from "../lib/foundry/orchestration-runtime";

// The durable store writes to dataDir()/foundry.sqlite; point it at a scratch
// dir for this process so the tests never touch the real database, event log,
// jobs or artifacts.
process.env.FOUNDRY_DATA = join(tmpdir(), `foundry-orchestration-runtime-test-${process.pid}`);

const ISSUE = "issue-runtime-1";
const OWNER = "runtime-owner-1";
const NOW = "2026-08-25T10:00:00.000Z";
const ROOT = `/tmp/foundry-orchestration-runtime-test-${process.pid}`;
/** Path the fake physical preparer reports after "preparing" the workspace. */
const PREPARED = `${ROOT}/prepared`;

const EMPTY_BUDGET: ResourceBudget = { cpu: 0, memoryMiB: 0, diskMiB: 0, concurrency: 0 };

const HOSTS: Partial<Record<HostId, HostState>> = {
  vps: {
    id: "vps",
    budget: { cpu: 4, memoryMiB: 8192, diskMiB: 65536, concurrency: 4 },
    used: { ...EMPTY_BUDGET },
  },
};

const MODELS: Record<string, ModelState> = {
  [DEFAULT_TEXT_MODEL]: {
    id: DEFAULT_TEXT_MODEL,
    capabilities: ["text"],
    maxConcurrent: 4,
    concurrent: 0,
  },
};

const INPUT: ExecuteRuntimeInput = {
  issue: {
    id: ISSUE,
    idea: "implement the execute verification gate",
    targetUrl: "https://example.com/issue",
    size: "s",
    currentStage: "execute",
    runMode: "oneshot",
    walkHold: false,
    oneshotStopReason: null,
    projectId: null,
    cycleId: null,
    moduleId: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  spec: { title: "Verify independently", spec: "Run a real check executor.", acceptance: ["evidence present"] },
  changed: { taskKind: "code", surfaces: [{ kind: "code", path: "lib/foundry/orchestration-runtime.ts" }] },
  claims: ["repository"],
};

// Each test gets a clean orchestration and legacy state on the shared scratch db.
beforeEach(() => {
  const conn = orchestrationConnection();
  conn.exec(
    [
      "PRAGMA foreign_keys = OFF",
      "DELETE FROM orchestration_attempts",
      "DELETE FROM orchestration_leases",
      "DELETE FROM orchestration_claims",
      "DELETE FROM orchestration_tasks",
      "DELETE FROM orchestration_runs",
      "DELETE FROM issue_artifacts",
      "DELETE FROM issue_jobs",
      "PRAGMA foreign_keys = ON",
    ].join(";"),
  );
});

type VerifyOutcome = { ok: boolean; errors: string[]; evidence: string[] };

type RuntimeHarness = {
  input: ExecuteRuntimeInput;
  deps: Partial<ExecuteRuntimeDeps>;
  calls: {
    /** Physical preparation invocations, in driver order. */
    prepare: Array<{ plan: WorkspacePlan; options?: PrepareOptions }>;
    run: OmpRunSpec[];
    verify: Array<{ plan: VerificationPlan; workspace: { path: string }; options: unknown }>;
    finalize: FinalizeExecuteInput[];
    events: Array<{ issueId: string; kind: string; payload: Record<string, unknown> }>;
    /** Interleaved order of the two effects whose relative order matters. */
    sequence: Array<"prepare" | "run">;
  };
  advance: (ms: number) => void;
  /** In-memory learning wiring when a policy is configured. */
  learning?: {
    policy: ExecuteLearningPolicy;
    rows: LearningRecord[];
    store: LearningStoreAdapter;
  };
};

function makeHarness(seed: {
  runnerExit?: number | null;
  runnerStderr?: string;
  verify?: VerifyOutcome;
  maxTicks?: number;
  withFinalize?: boolean;
  /** Optional explicit learning policy; `brokenStore` makes appends throw. */
  learning?: { policy?: Partial<ExecuteLearningPolicy>; brokenStore?: boolean };
}): RuntimeHarness {
  let current = NOW;
  const advance = (ms: number) => {
    current = new Date(Date.parse(current) + ms).toISOString();
  };
  const now = () => current;
  const store = new OrchestrationStore({ now });

  const calls: RuntimeHarness["calls"] = {
    prepare: [],
    run: [],
    verify: [],
    finalize: [],
    events: [],
    sequence: [],
  };

  const deps: Partial<ExecuteRuntimeDeps> = {
    store,
    now,
    owner: OWNER,
    workspaceRoot: ROOT,
    repoPath: ROOT,
    claimFs: {
      realpath: async (path) => path,
      stat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    },
    branch: "foundry/runtime-test",
    schedule: ({ tasks, now: at }) => schedule({ tasks, hosts: HOSTS, models: MODELS, now: at }),
    prepareWorkspace: async (plan, options) => {
      calls.sequence.push("prepare");
      calls.prepare.push({ plan, options });
      return { ...plan, path: PREPARED };
    },
    runOmp: async (spec) => {
      calls.sequence.push("run");
      calls.run.push(spec);
      const result: OmpRunResult = {
        taskId: spec.taskId,
        model: DEFAULT_TEXT_MODEL,
        cost: "free",
        exitCode: seed.runnerExit ?? 0,
        stdout: "runner stdout is captured but never verification evidence",
        stderr: seed.runnerStderr ?? "",
        json: null,
        startedAt: now(),
        endedAt: now(),
        durationMs: 0,
        cancelled: false,
        timedOut: false,
      };
      return result;
    },
    executeVerification: async (plan, workspace, options) => {
      calls.verify.push({ plan, workspace, options });
      return seed.verify ?? { ok: true, errors: [], evidence: ["check-record"] };
    },
    appendEvent: (issueId, kind, payload) => calls.events.push({ issueId, kind, payload }),
    // Legacy finalize: success writes the execute artifact and clears the
    // legacy execute job; any other outcome records the failure.
    finalize: (input, _evidence) => {
      calls.finalize.push(input);
      if (input.outcome === "succeeded") {
        saveArtifact({
          issueId: input.issueId,
          kind: ARTIFACT_KIND.execute,
          stage: "execute",
          body: JSON.stringify({ runId: input.runId, taskId: input.taskId }),
        });
        clearJob(input.issueId, "execute");
      } else {
        failJob(input.issueId, "execute", input.error ?? `execute ${input.outcome}`);
      }
    },
    verificationTimeoutMs: 60_000,
    maxTicks: seed.maxTicks,
  };

  if (seed.withFinalize === false) {
    delete deps.finalize; // exercise the runtime's default finalize path
  }

  // Optional explicit learning policy: an in-memory store (never the durable
  // learning table) so tests observe harvest/promotion directly.
  let learning: RuntimeHarness["learning"];
  if (seed.learning) {
    const rows: LearningRecord[] = [];
    const store: LearningStoreAdapter = {
      load: () => rows,
      append: (record) => {
        if (seed.learning?.brokenStore) throw new Error("learning store unavailable");
        rows.push(record);
      },
    };
    const policy: ExecuteLearningPolicy = {
      pattern: "Independent verification with real package checks must pass before merge",
      author: "agent-a",
      review: { reviewer: "agent-b", verdict: "approved" },
      operatorApproved: true,
      threshold: 1,
      store,
      ...seed.learning.policy,
    };
    learning = { policy, rows, store };
    deps.learning = policy;
  }

  return { input: INPUT, deps, calls, advance, learning };
}

describe("orchestration-runtime", () => {
  it("prepares the physical workspace BEFORE running OMP, and runs in the prepared path", async () => {
    const h = makeHarness({});
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");

    // Physical preparation happened exactly once, before the runner.
    expect(callIndex(h, "prepare")).toBeLessThan(callIndex(h, "run"));
    expect(h.calls.prepare).toHaveLength(1);
    const planned = h.calls.prepare[0].plan;
    expect(planned.taskId).toBeTruthy();
    expect(planned.path).toContain("/tasks/git-worktree/vps/");

    // The runner executed inside the prepared path — not the plan path.
    expect(h.calls.run).toHaveLength(1);
    expect(h.calls.run[0].cwd).toBe(PREPARED);
  });

  it("rejects runner budgets that can outlive the task lease", async () => {
    const h = makeHarness({});
    await expect(
      runOrchestratedExecute({ ...h.input, maxTimeMs: 5 * 60 * 1000 }, h.deps),
    ).rejects.toThrow(/finish before lease expiry/);
    expect(h.calls.run).toHaveLength(0);
  });

  it("runner stdout alone is never evidence: an empty-evidence verifier fails closed", async () => {
    const h = makeHarness({
      // The runner exited 0 with stdout; the verifier ran but produced no
      // structured evidence. That must fail the run.
      verify: { ok: true, errors: [], evidence: [] },
    });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    // First call: the verification failure is retryable, so the driver waits
    // out its backoff rather than fail immediately.
    const first = await runOrchestratedExecute(h.input, h.deps);
    expect(first.status).toBe("waiting");
    if (first.status !== "waiting") return;

    // Independent verification ran exactly once, against the prepared path.
    expect(h.calls.verify).toHaveLength(1);
    expect(h.calls.verify[0].workspace.path).toBe(PREPARED);

    // Durable retry metadata survives a fresh invocation. After backoff, the
    // task retries and the same failed verification exhausts its attempt budget.
    h.advance(RETRY_BACKOFF_BASE_MS);
    const second = await runOrchestratedExecute(h.input, h.deps);
    expect(second.status).toBe("waiting");
    h.advance(RETRY_BACKOFF_BASE_MS * 2);
    const third = await runOrchestratedExecute(h.input, h.deps);
    expect(third.status).toBe("done");
    if (third.status !== "done") return;
    expect(third.outcome).toBe("failed");

    // The run failed and its legacy job records the failure exactly once;
    // no execute artifact is written.
    expect(h.calls.finalize).toHaveLength(1);
    expect(h.calls.finalize[0].outcome).toBe("failed");
    expect(h.calls.finalize[0].error).toBe("verifier produced no evidence");
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).toBeNull();
    expect(getJob(ISSUE, "execute")?.status).toBe("failed");
  });

  it("independent verification success passes and finalizes exactly once", async () => {
    const h = makeHarness({ verify: { ok: true, errors: [], evidence: ["check-record:lint", "check-record:test"] } });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");

    // Verification plan derived from the changed work (task kind + surfaces).
    expect(h.calls.verify).toHaveLength(1);
    expect(h.calls.verify[0].plan.taskKind).toBe("code");
    expect(h.calls.verify[0].plan.surfaces).toEqual([
      { kind: "code", path: "lib/foundry/orchestration-runtime.ts" },
    ]);
    expect(h.calls.verify[0].workspace.path).toBe(PREPARED);
    expect(h.calls.verify[0].options).toMatchObject({ timeoutMs: 60_000 });

    // Finalize fired once: the execute artifact exists and the legacy execute
    // job was cleared. The success event is emitted exactly once.
    expect(h.calls.finalize).toHaveLength(1);
    expect(h.calls.finalize[0]).toMatchObject({ issueId: ISSUE, outcome: "succeeded", owner: OWNER });
    const kinds = h.calls.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "execute.finalized")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.failed")).toHaveLength(0);
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).not.toBeNull();
    expect(getJob(ISSUE, "execute")).toBeNull();
  });

  it("independent verification failure fails the run and records the failure", async () => {
    const h = makeHarness({
      verify: { ok: false, errors: ["missing check for gate security_review"], evidence: [] },
    });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    // First call: verification failure is retryable, so the driver waits.
    const first = await runOrchestratedExecute(h.input, h.deps);
    expect(first.status).toBe("waiting");
    if (first.status !== "waiting") return;
    expect(h.calls.verify).toHaveLength(1);

    // Durable retry metadata survives invocations until the attempt budget is exhausted.
    h.advance(RETRY_BACKOFF_BASE_MS);
    const second = await runOrchestratedExecute(h.input, h.deps);
    expect(second.status).toBe("waiting");
    h.advance(RETRY_BACKOFF_BASE_MS * 2);
    const third = await runOrchestratedExecute(h.input, h.deps);
    expect(third.status).toBe("done");
    if (third.status !== "done") return;
    expect(third.outcome).toBe("failed");

    // The verification error surfaces through the legacy failure record.
    expect(h.calls.finalize).toHaveLength(1);
    expect(h.calls.finalize[0].outcome).toBe("failed");
    expect(h.calls.finalize[0].error).toContain("missing check for gate security_review");
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).toBeNull();
    expect(getJob(ISSUE, "execute")?.status).toBe("failed");
  });

  it("exhaustion without a finalized run fails the legacy job exactly once", async () => {
    // One driver tick can only apply one command, so the loop exhausts before
    // any terminal state; the finalize callback never fires. The runtime's
    // post-driver guard must still record the legacy execute failure once.
    const h = makeHarness({ maxTicks: 1 });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("exhausted");
    expect(h.calls.finalize).toHaveLength(0);
    expect(getJob(ISSUE, "execute")?.status).toBe("failed");
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).toBeNull();
  });

  it("default finalize path saves the artifact and clears the job once when injected", async () => {
    // Omit `finalize` so the runtime's defaultFinalize handles the legacy job
    // (real saveArtifact/clearJob/failJob on the scratch store).
    const h = makeHarness({ withFinalize: false });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).not.toBeNull();
    expect(getJob(ISSUE, "execute")).toBeNull();
  });

  it("injected effects mean no real git/OMP/network: every effect is the fake, and the prompt stays fail-closed", async () => {
    const h = makeHarness({});
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    // All external work went through the injected fakes — no real preparer,
    // runner, verifier, scheduler, or store writes to real paths.
    expect(h.calls.prepare).toHaveLength(1);
    expect(h.calls.run).toHaveLength(1);
    expect(h.calls.verify).toHaveLength(1);
    expect(h.calls.run[0].cwd).toBe(PREPARED);
    // The OMP prompt still instructs the agent never to publish or destroy.
    expect(h.calls.run[0].prompt).toContain("Do not merge, push, deploy, or delete shared resources");
    expect(h.calls.run[0].prompt).toContain("Return evidence for independent verification");
  });

  it("rejects a new executable task without write claims before effects", async () => {
    const h = makeHarness({});
    const input = { ...h.input, claims: [] };
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    await expect(runOrchestratedExecute(input, h.deps)).rejects.toThrow(
      "requires at least one write claim before task creation",
    );

    expect(h.deps.store!.listRuns()).toEqual([]);
    expect(h.calls.prepare).toEqual([]);
    expect(h.calls.run).toEqual([]);
  });

  it("resolves alias claim strings to physical identities before createTask (production path)", async () => {
    // Real filesystem, real `node:fs/promises` adapter: a sanctioned root with
    // a work dir, a file, and symlink aliases to the same physical file. The
    // aliases must collapse to one physical identity before the driver creates
    // the orchestration task — no alias string ever reaches the store.
    const root = join(tmpdir(), `foundry-runtime-claims-${process.pid}`);
    const fs = await import("node:fs/promises");
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(join(root, "work"), { recursive: true });
    await fs.writeFile(join(root, "work", "a.txt"), "x");
    await fs.symlink(join(root, "work"), join(root, "work-link"));
    await fs.symlink(join(root, "work", "a.txt"), join(root, "alias.txt"));

    try {
      const h = makeHarness({});
      const input = { ...h.input, claims: ["work/a.txt", "work-link/a.txt", "alias.txt", "work"] };
      const deps = { ...h.deps, workspaceRoot: root, claimFs: undefined };
      // Snapshot the durable task claims while the task is active: the store
      // holds claims during execution and only releases them on a terminal
      // transition, so the post-run claims are expected to be released.
      let seenClaims: string[] | null = null;
      const originalRun = deps.runOmp!;
      deps.runOmp = async (spec) => {
        seenClaims = h.deps.store!.getTask(spec.taskId)?.claims ?? null;
        return originalRun(spec);
      };
      expect(tryClaimJob(ISSUE, "execute")).toBe(true);

      const result = await runOrchestratedExecute(input, deps);

      expect(result.status).toBe("done");
      if (result.status !== "done") return;
      expect(result.outcome).toBe("succeeded");

      // The durable task claims are the collapsed physical identities only.
      // The resolver realpaths the root first, so `/var` → `/private/var` on
      // macOS; derive the expected paths from the canonical root.
      const canonicalRoot = await fs.realpath(root);
      expect(seenClaims).toEqual([join(canonicalRoot, "work", "a.txt"), join(canonicalRoot, "work")]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("injects the filesystem adapter so claim resolution is deterministic", async () => {
    // A fake PhysicalFs resolves against a stable in-memory root: no real
    // filesystem access, and the missing leaf anchors to the nearest existing
    // ancestor exactly like the real adapter.
    const fakeFs: PhysicalFs = {
      realpath: async (p) => (p === ROOT ? ROOT : p),
      stat: async (p) => {
        if (p === ROOT) return { isDirectory: () => true, isSymbolicLink: () => false };
        throw Object.assign(new Error(`stat ${p}: ENOENT`), { code: "ENOENT" });
      },
      lstat: async (p) => {
        if (p === ROOT) return { isDirectory: () => true, isSymbolicLink: () => false };
        throw Object.assign(new Error(`lstat ${p}: ENOENT`), { code: "ENOENT" });
      },
    };
    const h = makeHarness({});
    const input = { ...h.input, claims: ["brand-new/deep/file.txt"] };
    const deps = { ...h.deps, workspaceRoot: ROOT, claimFs: fakeFs };
    let seenClaims: string[] | null = null;
    const originalRun = deps.runOmp!;
    deps.runOmp = async (spec) => {
      seenClaims = h.deps.store!.getTask(spec.taskId)?.claims ?? null;
      return originalRun(spec);
    };
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(input, deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");

    expect(seenClaims).toEqual([`${ROOT}/brand-new/deep/file.txt`]);
  });

  it("fails closed before task creation on a claim that escapes the sanctioned root", async () => {
    const root = join(tmpdir(), `foundry-runtime-escape-${process.pid}`);
    const outside = join(tmpdir(), `foundry-runtime-escape-${process.pid}-outside`);
    const fs = await import("node:fs/promises");
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, join(root, "out"));

    try {
      const h = makeHarness({});
      const input = { ...h.input, claims: ["out/secret.txt"] };
      const deps = { ...h.deps, workspaceRoot: root, claimFs: undefined };
      expect(tryClaimJob(ISSUE, "execute")).toBe(true);

      await expect(runOrchestratedExecute(input, deps)).rejects.toThrow(
        /physical-escape|rejected before task creation/,
      );

      // Fail closed: no orchestration run/task was created and no effect ran,
      // so nothing was dispatched.
      expect(h.deps.store!.listRuns()).toEqual([]);
      expect(h.calls.prepare).toHaveLength(0);
      expect(h.calls.run).toHaveLength(0);
      expect(h.calls.events).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("fails closed before task creation when the sanctioned root is missing", async () => {
    const root = join(tmpdir(), `foundry-runtime-missing-${process.pid}-never-created`);
    const h = makeHarness({});
    const input = { ...h.input, claims: ["work/a.txt"] };
    const deps = { ...h.deps, workspaceRoot: root, claimFs: undefined };
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    await expect(runOrchestratedExecute(input, deps)).rejects.toThrow(
      /missing-root|rejected before task creation/,
    );

    // Fail closed: no orchestration run/task was created and no effect ran.
    expect(h.deps.store!.listRuns()).toEqual([]);
    expect(h.calls.prepare).toHaveLength(0);
    expect(h.calls.run).toHaveLength(0);
    expect(h.calls.events).toEqual([]);
  });

  it("resume/replay reuses durable physical claims without reinterpreting them", async () => {
    const h = makeHarness({});
    // A durable, still-in-flight task already carries its physical claims from
    // creation. The sanctioned root never exists; a naive first-time
    // resolution would fail closed, but resume sees the existing durable task
    // and reuses its claims instead of re-resolving or reinterpreting them.
    const run = h.deps.store!.createRun({ issueId: ISSUE, stage: "execute", name: `execute:${ISSUE}` });
    const task = h.deps.store!.createTask(run.id, {
      name: `execute:${ISSUE}`,
      resources: { ...DEFAULT_EXECUTE_RESOURCES },
      claims: [join(ROOT, "work", "a.txt")],
    });
    h.deps.store!.leaseTask(task.id, { host: "vps", owner: OWNER });
    h.deps.store!.startTask(task.id, OWNER);

    const input = { ...h.input, claims: ["work/a.txt"] };
    const deps = { ...h.deps, workspaceRoot: ROOT }; // root does not exist
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(input, deps);

    // Mid-flight resume: no re-resolution against the missing root (no
    // fail-closed), no re-created task; the durable claims are untouched.
    expect(result.status).toBe("waiting");
    expect(h.deps.store!.listTasks(run.id)[0].claims).toEqual([join(ROOT, "work", "a.txt")]);
  });

  it("harvests a succeeded run to learning exactly once when a policy is configured", async () => {
    const h = makeHarness({ learning: {} });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");

    // Execute finalization is unchanged by learning.
    expect(h.calls.finalize).toHaveLength(1);
    expect(h.calls.finalize[0].outcome).toBe("succeeded");
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).not.toBeNull();

    // Exactly one lesson and one promotion over the injected store.
    const lessons = h.learning!.rows.filter((row): row is LessonRecord => row.kind === "lesson");
    const promotions = h.learning!.rows.filter((row): row is PromotionRecord => row.kind === "promotion");
    expect(lessons).toHaveLength(1);
    expect(promotions).toHaveLength(1);
    expect(lessons[0]).toMatchObject({
      issueId: ISSUE,
      outcome: "succeeded",
      pattern: h.learning!.policy.pattern,
      author: "agent-a",
    });
    // The verifier refs are preserved; canonicalization prepends the run ref.
    expect(lessons[0].refs).toEqual(["run/" + h.calls.finalize[0].runId, "check-record"]);

    // Learning audits flow through the runtime appendEvent sink exactly once.
    const kinds = h.calls.events.map((event) => event.kind);
    expect(kinds.filter((k) => k === "lesson.harvested")).toHaveLength(1);
    expect(kinds.filter((k) => k === "lesson.promoted")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.learning.rejected")).toHaveLength(0);
    expect(kinds.filter((k) => k === "execute.learning.error")).toHaveLength(0);
  });

  it("harvests a terminal failure to learning when configured", async () => {
    const h = makeHarness({
      runnerExit: 1,
      runnerStderr: "build failed: the schema migration ran without the dependency check",
      learning: {},
    });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("failed");

    // Terminal failure is harvested automatically, with the policy pattern and
    // the issue ref standing in for missing verifier evidence.
    const lessons = h.learning!.rows.filter((row): row is LessonRecord => row.kind === "lesson");
    expect(lessons).toHaveLength(1);
    expect(lessons[0].outcome).toBe("failed");
    expect(lessons[0].pattern).toBe(h.learning!.policy.pattern);
    expect(lessons[0].refs).toEqual(["run/" + h.calls.finalize[0].runId, `issue/${ISSUE}`]);

    const kinds = h.calls.events.map((event) => event.kind);
    expect(kinds.filter((k) => k === "lesson.harvested")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.learning.error")).toHaveLength(0);
  });

  it("submits learning exactly once across retried driver invocations", async () => {
    // The same run survives three driver invocations (retryable verification
    // failure); learning must still submit exactly once when the run finalizes.
    const h = makeHarness({
      verify: { ok: true, errors: [], evidence: [] },
      learning: {},
    });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const first = await runOrchestratedExecute(h.input, h.deps);
    expect(first.status).toBe("waiting");
    h.advance(RETRY_BACKOFF_BASE_MS);

    const second = await runOrchestratedExecute(h.input, h.deps);
    expect(second.status).toBe("waiting");
    h.advance(RETRY_BACKOFF_BASE_MS * 2);

    const third = await runOrchestratedExecute(h.input, h.deps);
    expect(third.status).toBe("done");
    if (third.status !== "done") return;
    expect(third.outcome).toBe("failed");

    // Exactly one lesson and one harvest audit despite three invocations.
    const lessons = h.learning!.rows.filter((row): row is LessonRecord => row.kind === "lesson");
    expect(lessons).toHaveLength(1);
    expect(lessons[0].outcome).toBe("failed");
    const kinds = h.calls.events.map((event) => event.kind);
    expect(kinds.filter((k) => k === "lesson.harvested")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.learning.error")).toHaveLength(0);
  });

  it("self-review cannot promote through the runtime", async () => {
    const h = makeHarness({ learning: { policy: { review: { reviewer: "agent-a", verdict: "approved" } } } });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");

    // The lesson is harvested but promotion is rejected and audited.
    const lessons = h.learning!.rows.filter((row): row is LessonRecord => row.kind === "lesson");
    const promotions = h.learning!.rows.filter((row): row is PromotionRecord => row.kind === "promotion");
    expect(lessons).toHaveLength(1);
    expect(promotions).toHaveLength(0);

    const rejected = h.calls.events.filter((event) => event.kind === "execute.learning.rejected");
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].payload.reason)).toMatch(/independent/i);
  });

  it("operator absence cannot promote through the runtime", async () => {
    const h = makeHarness({ learning: { policy: { operatorApproved: false, threshold: 3 } } });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");

    const lessons = h.learning!.rows.filter((row): row is LessonRecord => row.kind === "lesson");
    const promotions = h.learning!.rows.filter((row): row is PromotionRecord => row.kind === "promotion");
    expect(lessons).toHaveLength(1);
    expect(promotions).toHaveLength(0);

    const rejected = h.calls.events.filter((event) => event.kind === "execute.learning.rejected");
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].payload.reason)).toMatch(/recurs across/i);
  });

  it("a learning store failure cannot corrupt execute finalization", async () => {
    const h = makeHarness({ learning: { brokenStore: true } });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runOrchestratedExecute(h.input, h.deps);

    // The execute run still finalized normally.
    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");
    expect(h.calls.finalize).toHaveLength(1);
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).not.toBeNull();

    // The learning failure was isolated and audited through appendEvent.
    const errors = h.calls.events.filter((event) => event.kind === "execute.learning.error");
    expect(errors).toHaveLength(1);
    expect(String(errors[0].payload.error)).toMatch(/learning store unavailable/);
    expect(h.learning!.rows).toHaveLength(0);
  });
});

function callIndex(h: RuntimeHarness, effect: "prepare" | "run"): number {
  const index = h.calls.sequence.indexOf(effect);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}
