import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { proveOrchestration } from "../scripts/prove-orchestration";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("proveOrchestration", () => {
  it("proves isolated success and durable retry recovery locally", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-proof-test-"));
    roots.push(root);

    const { report, scratch } = await proveOrchestration({ scratchRoot: root });

    expect(report.assertionsPassed).toBe(true);
    expect(report.success).toMatchObject({ outcome: "succeeded", finalizeCalls: 1 });
    expect(report.recovery).toMatchObject({
      firstStatus: "waiting",
      finalOutcome: "succeeded",
      finalAttempts: 2,
      finalizeCalls: 1,
      isRetryableCleared: true,
      isNextRetryAtCleared: true,
    });
    expect(report.workspace).toMatchObject({
      didPrepareBeforeRunner: true,
      isRunnerCwdWorktree: true,
      isMutationInWorktree: true,
      isMainRepoClean: true,
      isMutationAbsentFromMainRepo: true,
    });
    expect(report.verification).toMatchObject({ ok: true, checkExitCode: 0 });
    expect(report.verification.evidenceCount).toBeGreaterThan(0);
    expect(report.containment).toMatchObject({
      hasNoRemotes: true,
      hasNoRemoteTrackingRefs: true,
      publicationCommandCount: 0,
      isMainBranchHeadUnchanged: true,
    });
    expect(scratch.root).toBe(root);
  });
});
