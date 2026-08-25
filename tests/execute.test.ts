import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Toggle whether the mocked fs.rmSync throws, so the swallow-and-log teardown
// path can be exercised without disturbing any other fs call.
const { rmState } = vi.hoisted(() => ({
  rmState: { shouldThrow: false, error: null as Error | null },
}));

vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    rmSync: vi.fn((...args: Parameters<typeof actual.rmSync>) => {
      if (rmState.shouldThrow && rmState.error) throw rmState.error;
      return actual.rmSync(...args);
    }),
  };
});

// execute.ts shells out to git/npm and calls the eve worker. Both are stubbed
// so runExecute can be driven end-to-end against the real store/log. The
// execFileSync mock also lets tests assert that no push/gh publication occurs.
// The real module is spread so transitively imported orchestration modules
// (which use execFile/spawn) keep their bindings.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(() => ""),
    execSync: vi.fn(() => ""),
  };
});

vi.mock("../lib/foundry/eve-session", () => ({
  runStructured: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStructured } from "../lib/foundry/eve-session";
import {
  isSandboxedWorkDir,
  removeWorkDir,
  runExecute,
  writeFileSafe,
} from "../lib/foundry/execute";
import {
  clearJob,
  completeActiveStage,
  createIssue,
  getArtifact,
  getJob,
  saveArtifact,
} from "../lib/foundry/store";
import { readEvents } from "../lib/foundry/log";
import { ARTIFACT_KIND } from "../lib/foundry/types";

let tmpCwd = "";
let originalCwd = "";

beforeAll(() => {
  originalCwd = process.cwd();
  tmpCwd = mkdtempSync(join(tmpdir(), "foundry-exec-test-"));
  process.chdir(tmpCwd);
  process.env.FOUNDRY_DATA = join(tmpCwd, "data");
});

afterAll(() => {
  process.chdir(originalCwd);
  if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmState.shouldThrow = false;
  rmState.error = null;
  vi.mocked(runStructured).mockReset();
  delete process.env.FOUNDRY_MULTIAGENT;
});

afterEach(() => {
  rmState.shouldThrow = false;
  rmState.error = null;
  delete process.env.FOUNDRY_MULTIAGENT;
});

function workDirFor(issueId: string): string {
  return join(process.cwd(), "data", "worktrees", issueId);
}

// xs skips improve/council/architecture, so research -> grill -> spec ->
// plan_pack -> execute is four stage completions.
function setupIssueAtExecute(idea: string): string {
  const issue = createIssue({
    idea,
    targetUrl: "https://github.com/kartikkabadi/foundry.git",
    size: "xs",
  });
  let current = issue.currentStage;
  let guard = 0;
  while (current !== "execute" && guard < 20) {
    current = completeActiveStage(issue.id).currentStage;
    guard += 1;
  }
  if (current !== "execute") {
    throw new Error(`could not advance issue to execute (stuck at ${current})`);
  }
  saveArtifact({
    issueId: issue.id,
    kind: ARTIFACT_KIND.spec,
    stage: "spec",
    body: JSON.stringify({
      title: "Test spec",
      spec: "implement the thing",
      acceptance: ["it works"],
    }),
  });
  return issue.id;
}

it("routes opt-in execute through the injected orchestration runtime", async () => {
  const issueId = setupIssueAtExecute("orchestrated execute");
  process.env.FOUNDRY_MULTIAGENT = "1";
  let receivedIssueId: string | null = null;
  let receivedSpecTitle: string | null = null;
  const runtime = vi.fn(async (input: { issue: { id: string }; spec: { title: string } }) => {
    receivedIssueId = input.issue.id;
    receivedSpecTitle = input.spec.title;
    // The real orchestrated runtime writes the execute artifact and clears the
    // claim during settle; mimic that so the wrapper reconciles a real done.
    saveArtifact({
      issueId: input.issue.id,
      kind: ARTIFACT_KIND.execute,
      stage: "execute",
      body: JSON.stringify({ outcome: "succeeded", source: "orchestrated", evidence: [] }),
    });
    clearJob(input.issue.id, "execute");
    return {
      status: "done" as const,
      outcome: "succeeded" as const,
      ticks: 1,
      state: {
        schedule: null,
        dispatch: null,
        workspace: null,
        runner: null,
        verification: null,
        retry: null,
        finalized: true,
      },
    };
  });

  await runExecute(issueId, runtime);

  expect(runtime).toHaveBeenCalledOnce();
  expect(receivedIssueId).toBe(issueId);
  expect(receivedSpecTitle).toBe("Test spec");
  // Done is reconciled against store state: artifact present, claim released.
  expect(getArtifact(issueId, ARTIFACT_KIND.execute)).not.toBeNull();
  expect(getJob(issueId, "execute")).toBeNull();
  expect(existsSync(workDirFor(issueId))).toBe(false);
});

it("releases the legacy claim when orchestration waits for durable retry", async () => {
  const issueId = setupIssueAtExecute("orchestrated retry wait");
  process.env.FOUNDRY_MULTIAGENT = "1";
  const runtime = vi.fn(async () => ({
    status: "waiting" as const,
    reason: "retry_pending" as const,
    ticks: 1,
    state: {
      schedule: null,
      dispatch: null,
      workspace: null,
      runner: null,
      verification: null,
      finalized: false,
    },
  }));

  await runExecute(issueId, runtime);

  expect(runtime).toHaveBeenCalledOnce();
  expect(getJob(issueId, "execute")).toBeNull();
  expect(readEvents(issueId).at(-1)?.kind).toBe("execute.waiting");
});

it("waits, then reconciles a later successful retry through the real wrapper", async () => {
  const issueId = setupIssueAtExecute("wait then retry succeeds");
  process.env.FOUNDRY_MULTIAGENT = "1";

  // First invocation: the durable run is parked on a retry backoff. The
  // wrapper must release the legacy claim so the issue stays reclaimable.
  const waiting = vi.fn(async () => ({
    status: "waiting" as const,
    reason: "retry_pending" as const,
    ticks: 1,
    state: {
      schedule: null,
      dispatch: null,
      workspace: null,
      runner: null,
      verification: null,
      finalized: false,
    },
  }));
  await runExecute(issueId, waiting);

  expect(waiting).toHaveBeenCalledOnce();
  expect(getJob(issueId, "execute")).toBeNull();
  expect(getArtifact(issueId, ARTIFACT_KIND.execute)).toBeNull();
  expect(readEvents(issueId).at(-1)?.kind).toBe("execute.waiting");

  // Later re-invocation: the backoff elapsed and the run succeeds. The
  // runtime's settle writes the execute artifact and clears the claim, so the
  // wrapper sees a done with real store state behind it.
  const succeeding = vi.fn(async (input: { issue: { id: string } }) => {
    saveArtifact({
      issueId: input.issue.id,
      kind: ARTIFACT_KIND.execute,
      stage: "execute",
      body: JSON.stringify({ outcome: "succeeded", source: "orchestrated", evidence: [] }),
    });
    clearJob(input.issue.id, "execute");
    return {
      status: "done" as const,
      outcome: "succeeded" as const,
      ticks: 2,
      state: {
        schedule: null,
        dispatch: null,
        workspace: null,
        runner: null,
        verification: null,
        finalized: true,
      },
    };
  });
  await runExecute(issueId, succeeding);

  expect(succeeding).toHaveBeenCalledOnce();
  // Success leaves an execute artifact and no running job.
  expect(getArtifact(issueId, ARTIFACT_KIND.execute)).not.toBeNull();
  expect(getJob(issueId, "execute")).toBeNull();
});

it("fails closed when orchestration reports done without an execute artifact", async () => {
  const issueId = setupIssueAtExecute("done without artifact");
  process.env.FOUNDRY_MULTIAGENT = "1";
  // The runtime claims success but never writes an artifact and never clears
  // the claim. The wrapper must not leave the job claimed/running.
  const runtime = vi.fn(async () => ({
    status: "done" as const,
    outcome: "succeeded" as const,
    ticks: 1,
    state: {
      schedule: null,
      dispatch: null,
      workspace: null,
      runner: null,
      verification: null,
      finalized: true,
    },
  }));

  await runExecute(issueId, runtime);

  expect(runtime).toHaveBeenCalledOnce();
  expect(getJob(issueId, "execute")?.status).toBe("failed");
  expect(getJob(issueId, "execute")?.error).toMatch(/still claimed/);
  expect(getArtifact(issueId, ARTIFACT_KIND.execute)).toBeNull();
});

it("clears a lingering claim when the orchestration artifact exists", async () => {
  const issueId = setupIssueAtExecute("lingering claim");
  process.env.FOUNDRY_MULTIAGENT = "1";
  // The runtime saved the artifact but (wrongly) left the job claimed. The
  // wrapper must clear the claim because the artifact proves completion.
  const runtime = vi.fn(async (input: { issue: { id: string } }) => {
    saveArtifact({
      issueId: input.issue.id,
      kind: ARTIFACT_KIND.execute,
      stage: "execute",
      body: JSON.stringify({ outcome: "succeeded", source: "orchestrated", evidence: [] }),
    });
    return {
      status: "done" as const,
      outcome: "succeeded" as const,
      ticks: 1,
      state: {
        schedule: null,
        dispatch: null,
        workspace: null,
        runner: null,
        verification: null,
        finalized: true,
      },
    };
  });

  await runExecute(issueId, runtime);

  expect(runtime).toHaveBeenCalledOnce();
  expect(getArtifact(issueId, ARTIFACT_KIND.execute)).not.toBeNull();
  expect(getJob(issueId, "execute")).toBeNull();
});

it("records an opt-in orchestration driver failure", async () => {
  const issueId = setupIssueAtExecute("orchestrated failure");
  process.env.FOUNDRY_MULTIAGENT = "1";
  const runtime = vi.fn(async () => ({
    status: "failed" as const,
    error: "fenced runtime failure",
    ticks: 1,
    state: {
      schedule: null,
      dispatch: null,
      workspace: null,
      runner: null,
      verification: null,
      retry: null,
      finalized: false,
    },
  }));

  await runExecute(issueId, runtime);

  expect(getJob(issueId, "execute")?.status).toBe("failed");
  expect(getJob(issueId, "execute")?.error).toBe("fenced runtime failure");
  expect(getArtifact(issueId, ARTIFACT_KIND.execute)).toBeNull();
});

const validExecuteOutput = {
  files: [{ path: "hello.txt", content: "hello world\n" }],
  branchName: "foundry/test-branch",
  commitMessage: "test commit",
  prTitle: "Test PR",
  prBody: "test body",
};

function events(issueId: string, kind: string) {
  return readEvents(issueId).filter((event) => event.kind === kind);
}

describe("isSandboxedWorkDir containment guard", () => {
  const root = join(tmpCwd, "data", "worktrees");

  it("accepts a strict descendant under the worktrees root", () => {
    expect(isSandboxedWorkDir(join(root, "some-issue-id"), root)).toBe(true);
  });

  it("rejects the worktrees root itself", () => {
    expect(isSandboxedWorkDir(root, root)).toBe(false);
  });

  it("rejects a path that escapes the root upward", () => {
    const escape = join(root, "..", "..", "escape-attempt");
    expect(isSandboxedWorkDir(escape, root)).toBe(false);
  });

  it("rejects an empty path", () => {
    expect(isSandboxedWorkDir("", root)).toBe(false);
  });

  it("rejects a filesystem root", () => {
    expect(isSandboxedWorkDir("/", root)).toBe(false);
  });

  it("rejects an unrelated absolute path", () => {
    expect(isSandboxedWorkDir("/etc/foundry", root)).toBe(false);
  });
});

describe("writeFileSafe safe model-output writer", () => {
  let sandbox = "";

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "foundry-write-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("rejects parent traversal before normalization", () => {
    expect(() => writeFileSafe(sandbox, "../evil.txt", "x")).toThrow(/parent traversal/);
    expect(() => writeFileSafe(sandbox, "sub/../../evil.txt", "x")).toThrow(/parent traversal/);
    // Nothing landed outside the worktree.
    expect(existsSync(join(sandbox, "..", "evil.txt"))).toBe(false);
    expect(existsSync(join(sandbox, "evil.txt"))).toBe(false);
  });

  it("rejects absolute paths", () => {
    const absoluteOutside = join(sandbox, "..", "foundry-abs-evil.txt");
    expect(() => writeFileSafe(sandbox, absoluteOutside, "x")).toThrow(/absolute path/);
    expect(existsSync(absoluteOutside)).toBe(false);
  });

  it("rejects a write that normalizes to the worktree root", () => {
    expect(() => writeFileSafe(sandbox, "", "x")).toThrow(/outside the worktree/);
  });

  it("rejects a symlinked parent escaping the worktree on the real filesystem", () => {
    const outside = mkdtempSync(join(tmpdir(), "foundry-outside-"));
    try {
      symlinkSync(outside, join(sandbox, "link"));
      expect(() => writeFileSafe(sandbox, "link/evil.txt", "x")).toThrow(/symlink escaping/);
      expect(() => writeFileSafe(sandbox, "link/deep/evil.txt", "x")).toThrow(/symlink escaping/);
      expect(existsSync(join(outside, "evil.txt"))).toBe(false);
      expect(existsSync(join(outside, "deep", "evil.txt"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("writes valid nested files inside the worktree", () => {
    writeFileSafe(sandbox, "src/lib/util.ts", "export const x = 1;\n");
    writeFileSafe(sandbox, "nested/deep/file.txt", "content");
    expect(readFileSync(join(sandbox, "src", "lib", "util.ts"), "utf8")).toBe("export const x = 1;\n");
    expect(readFileSync(join(sandbox, "nested", "deep", "file.txt"), "utf8")).toBe("content");
  });
});

describe("runExecute workDir teardown", () => {
  it("removes the workDir on the success path", async () => {
    const issueId = setupIssueAtExecute("success path deletes workDir");
    vi.mocked(runStructured).mockResolvedValue(validExecuteOutput);

    await runExecute(issueId);

    expect(existsSync(workDirFor(issueId))).toBe(false);
    expect(getArtifact(issueId, ARTIFACT_KIND.execute)).not.toBeNull();
    expect(events(issueId, "execute.completed")).toHaveLength(1);
    expect(events(issueId, "execute.workdir_cleanup_failed")).toHaveLength(0);
  });

  it("removes the workDir on the failure path (thrown error)", async () => {
    const issueId = setupIssueAtExecute("failure path deletes workDir");
    vi.mocked(runStructured).mockRejectedValue(new Error("boom from eve"));

    await runExecute(issueId);

    expect(existsSync(workDirFor(issueId))).toBe(false);
    const job = getJob(issueId, "execute");
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("boom from eve");
    expect(events(issueId, "execute.failed")[0]?.payload.error).toBe("boom from eve");
  });

  it("swallows a removal failure, logs one warning, and keeps the original error", async () => {
    const issueId = setupIssueAtExecute("rm failure is swallowed");
    vi.mocked(runStructured).mockRejectedValue(new Error("boom from eve"));
    rmState.shouldThrow = true;
    rmState.error = new Error("rm failed: disk on fire");

    // Must not throw: the finally swallows the rm error.
    await runExecute(issueId);

    // The original execute error survives unchanged — the rm error does not
    // replace it on the job or the failed event.
    expect(getJob(issueId, "execute")?.error).toBe("boom from eve");
    expect(events(issueId, "execute.failed")[0]?.payload.error).toBe("boom from eve");

    // Exactly one warning Event for the failed removal, carrying the workDir and
    // the caught rm error message.
    const cleanupEvents = events(issueId, "execute.workdir_cleanup_failed");
    expect(cleanupEvents).toHaveLength(1);
    expect(cleanupEvents[0]?.payload.severity).toBe("warning");
    expect(cleanupEvents[0]?.payload.workDir).toBe(workDirFor(issueId));
    expect(cleanupEvents[0]?.payload.error).toBe("rm failed: disk on fire");
  });

  it("refuses to rm a path outside the sanctioned root and logs a warning", () => {
    const issueId = setupIssueAtExecute("containment guard refusal");
    // A real directory that lives OUTSIDE the worktrees root.
    const escapeDir = join(tmpCwd, "..", `foundry-escape-${issueId}`);
    mkdirSync(escapeDir, { recursive: true });
    try {
      removeWorkDir(issueId, escapeDir);

      // The rm was skipped: the directory is still on disk.
      expect(existsSync(escapeDir)).toBe(true);
      // Exactly one warning Event for the refusal, carrying the path.
      const refused = events(issueId, "execute.workdir_cleanup_refused");
      expect(refused).toHaveLength(1);
      expect(refused[0]?.payload.severity).toBe("warning");
      expect(refused[0]?.payload.workDir).toBe(escapeDir);
    } finally {
      rmSync(escapeDir, { recursive: true, force: true });
    }
  });
});

it("generates a local-only execute result with no git push or gh publication", async () => {
  const issueId = setupIssueAtExecute("no remote publication");
  vi.mocked(runStructured).mockResolvedValue(validExecuteOutput);

  await runExecute(issueId);

  // mock.calls already carries the real execFileSync tuple (file, args?, options?),
  // so destructuring gives a typed `args` — no need to widen to unknown.
  const calls = vi.mocked(execFileSync).mock.calls;
  expect(calls.some(([command, args]) => command === "git" && args?.[0] === "push")).toBe(false);
  expect(calls.some(([command]) => command === "gh")).toBe(false);

  // The artifact/job behavior is preserved: local branch/commit/diff recorded,
  // prUrl left empty because nothing was published.
  const artifact = getArtifact(issueId, ARTIFACT_KIND.execute);
  if (!artifact) throw new Error("execute artifact missing after runExecute");
  const parsed = JSON.parse(artifact.body) as {
    prUrl: string;
    branchName: string;
    commitMessage: string;
    filesChanged: string[];
  };
  expect(parsed.prUrl).toBe("");
  expect(parsed.branchName.startsWith("foundry/")).toBe(true);
  expect(parsed.commitMessage).toBe("test commit");
  expect(parsed.filesChanged).toEqual(["hello.txt"]);
  expect(getJob(issueId, "execute")?.status).toBeUndefined();
});
