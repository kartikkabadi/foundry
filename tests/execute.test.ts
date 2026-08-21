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

// execute.ts shells out to git/gh/npm and calls the eve worker. Both are
// stubbed so runExecute can be driven end-to-end against the real store/log.
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => ""),
  execSync: vi.fn(() => ""),
}));

vi.mock("../lib/foundry/eve-session", () => ({
  runStructured: vi.fn(),
}));

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStructured } from "../lib/foundry/eve-session";
import { isSandboxedWorkDir, removeWorkDir, runExecute } from "../lib/foundry/execute";
import {
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
});

afterEach(() => {
  rmState.shouldThrow = false;
  rmState.error = null;
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
