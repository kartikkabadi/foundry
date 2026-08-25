import { describe, expect, it } from "vitest";
import {
  defaultExecFileEffect,
  executeVerification,
  gateIds,
  isSecuritySensitiveSurface,
  SMALL_PR_LIMITS,
  smallPrViolation,
  shortVideoOnlyForUi,
  shortVideoRequired,
  verificationPlan,
  type ChangedSurface,
  type DeclaredCheck,
  type ExecFileEffect,
  type VerificationExecutionResult,
} from "../lib/foundry/verification";

describe("deriveVerificationGates", () => {
  it("requires code checks, logs, independent grade, and small-PR for code changes", () => {
    const plan = verificationPlan("code", [{ kind: "code", path: "lib/foo.ts" }]);
    const ids = gateIds(plan);
    expect(ids).toContain("code_checks");
    expect(ids).toContain("logs");
    expect(ids).toContain("independent_grade");
    expect(ids).toContain("small_pr");
    expect(ids).not.toContain("ui_browser_flow");
    expect(ids).not.toContain("short_video");
    expect(ids).not.toContain("package_tests");
  });

  it("scopes package tests to the changed packages", () => {
    const plan = verificationPlan("test", [{ kind: "package", scope: "@foundry/scheduler" }]);
    const pkg = plan.gates.find((gate) => gate.id === "package_tests");
    expect(pkg).toBeDefined();
    expect(pkg?.scopes).toEqual(["@foundry/scheduler"]);
  });

  it("requires the UI browser flow, annotated stills, and a short video for UI work", () => {
    const plan = verificationPlan("ui", [{ kind: "ui", path: "app/page.tsx", motion: true }]);
    const ids = gateIds(plan);
    expect(ids).toContain("ui_browser_flow");
    expect(ids).toContain("annotated_stills");
    expect(ids).toContain("short_video");
    expect(ids).toContain("logs");
  });

  it("drops the short video when the UI change is static", () => {
    const surfaces: ChangedSurface[] = [{ kind: "ui", path: "app/page.tsx", motion: false }];
    expect(shortVideoRequired("ui", surfaces)).toBe(false);
    expect(gateIds(verificationPlan("ui", surfaces))).not.toContain("short_video");
  });

  it("requires a short video by default for UI tasks without surface detail", () => {
    expect(shortVideoRequired("ui", [])).toBe(true);
  });

  it("requires security review for security-sensitive surfaces", () => {
    const plan = verificationPlan("code", [{ kind: "code", path: "lib/auth/session.ts" }]);
    expect(gateIds(plan)).toContain("security_review");
    expect(isSecuritySensitiveSurface({ kind: "security" })).toBe(true);
  });

  it("does not require security review for ordinary code", () => {
    const plan = verificationPlan("code", [{ kind: "code", path: "lib/foundry/scheduler.ts" }]);
    expect(gateIds(plan)).not.toContain("security_review");
  });

  it("requires logs when the logs surface changed", () => {
    const plan = verificationPlan("docs", [{ kind: "logs" }]);
    expect(gateIds(plan)).toContain("logs");
  });

  it("derives no gates for a docs-only change", () => {
    const plan = verificationPlan("docs", [{ kind: "docs" }]);
    expect(gateIds(plan)).toEqual([]);
  });
});

describe("short video policy", () => {
  it("allows short video only when UI is involved", () => {
    expect(shortVideoOnlyForUi(["short_video"], "ui", [{ kind: "ui", path: "a.tsx" }])).toBe(true);
    expect(shortVideoOnlyForUi(["short_video"], "code", [{ kind: "code", path: "a.ts" }])).toBe(false);
    expect(shortVideoOnlyForUi(["code_checks"], "code", [{ kind: "code", path: "a.ts" }])).toBe(true);
  });

  it("never derives short_video for non-UI work", () => {
    expect(gateIds(verificationPlan("code", [{ kind: "code", path: "a.ts" }]))).not.toContain("short_video");
  });
});

describe("small-PR limits", () => {
  it("accepts a small diff", () => {
    expect(smallPrViolation({ files: 3, insertions: 40, deletions: 10 })).toBeNull();
  });

  it("flags too many files", () => {
    expect(
      smallPrViolation({ files: SMALL_PR_LIMITS.maxFiles + 1, insertions: 10, deletions: 10 }),
    ).toMatch(/files/);
  });

  it("flags oversized insertions", () => {
    expect(
      smallPrViolation({ files: 3, insertions: SMALL_PR_LIMITS.maxInsertions + 1, deletions: 10 }),
    ).toMatch(/adds/);
  });

  it("flags oversized deletions", () => {
    expect(
      smallPrViolation({ files: 3, insertions: 10, deletions: SMALL_PR_LIMITS.maxDeletions + 1 }),
    ).toMatch(/deletes/);
  });
});

describe("executeVerification", () => {
  // code plan gates: code_checks, logs, independent_grade, small_pr
  const CODE_PLAN = verificationPlan("code", [{ kind: "code", path: "lib/foo.ts" }]);
  // ui plan (static, no short_video): code_checks, ui_browser_flow,
  // annotated_stills, logs, independent_grade, small_pr
  const UI_PLAN = verificationPlan("ui", [{ kind: "ui", path: "app/page.tsx", motion: false }]);
  // code plan with a security-sensitive surface adds security_review.
  const SEC_PLAN = verificationPlan("code", [{ kind: "code", path: "lib/auth/session.ts" }]);

  const passAll: ExecFileEffect = async (argv) => ({
    exitCode: 0,
    stdout: `ran: ${argv.join(" ")}`,
    stderr: "",
  });

  const codeChecks = (): DeclaredCheck[] => [
    { id: "static", gate: "code_checks", argv: ["npm", "run", "check"] },
    { id: "logs", gate: "logs", argv: ["node", "collect-logs.mjs"] },
    { id: "grade", gate: "independent_grade", argv: ["node", "grade.mjs"] },
    { id: "pr-size", gate: "small_pr", argv: ["node", "pr-size.mjs"] },
  ];

  const uiChecks = (): DeclaredCheck[] => [
    { id: "static", gate: "code_checks", argv: ["npm", "run", "check"] },
    { id: "browser", gate: "ui_browser_flow", argv: ["node", "drive-browser.mjs"] },
    { id: "stills", gate: "annotated_stills", argv: ["node", "snap.mjs"] },
    { id: "logs", gate: "logs", argv: ["node", "collect-logs.mjs"] },
    { id: "grade", gate: "independent_grade", argv: ["node", "grade.mjs"] },
    { id: "pr-size", gate: "small_pr", argv: ["node", "pr-size.mjs"] },
  ];

  const secChecks = (): DeclaredCheck[] => [
    { id: "static", gate: "code_checks", argv: ["npm", "run", "check"] },
    { id: "logs", gate: "logs", argv: ["node", "collect-logs.mjs"] },
    { id: "sec", gate: "security_review", argv: ["node", "review-security.mjs"] },
    { id: "grade", gate: "independent_grade", argv: ["node", "grade.mjs"] },
    { id: "pr-size", gate: "small_pr", argv: ["node", "pr-size.mjs"] },
  ];

  const records = (outcome: VerificationExecutionResult): Array<Record<string, unknown>> =>
    outcome.evidence.map((line) => JSON.parse(line) as Record<string, unknown>);

  it("passes when every declared check exits zero and captures explicit evidence", async () => {
    const outcome = await executeVerification(CODE_PLAN, { path: "/ws" }, {
      checks: codeChecks(),
      execFile: passAll,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.errors).toEqual([]);
    const recs = records(outcome);
    expect(recs).toHaveLength(4);
    expect(recs[0]).toMatchObject({
      checkId: "static",
      gate: "code_checks",
      exitCode: 0,
      cwd: "/ws",
      error: null,
      evidence: [],
    });
    expect(recs[0].argv).toEqual(["npm", "run", "check"]);
    expect(recs[0].stdout).toBe("ran: npm run check");
  });

  it("fails closed on a nonzero exit and still captures the evidence", async () => {
    const failOnLogs: ExecFileEffect = async (argv) =>
      argv[0] === "node" && argv[1] === "collect-logs.mjs"
        ? { exitCode: 2, stdout: "", stderr: "no log stream" }
        : { exitCode: 0, stdout: "", stderr: "" };
    const outcome = await executeVerification(CODE_PLAN, { path: "/ws" }, {
      checks: codeChecks(),
      execFile: failOnLogs,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join("\n")).toMatch(/logs \(logs\): exited 2/);
    const logsRecord = records(outcome).find((r) => r.checkId === "logs");
    expect(logsRecord?.stderr).toBe("no log stream");
    expect(logsRecord?.exitCode).toBe(2);
  });

  it("fails closed on a timeout or exec error", async () => {
    const timedOut: ExecFileEffect = async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      error: "timed out",
    });
    const outcome = await executeVerification(CODE_PLAN, { path: "/ws" }, {
      checks: codeChecks(),
      execFile: timedOut,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join("\n")).toMatch(/timed out/);
  });

  it("fails closed when required UI evidence is not collected, even on exit zero", async () => {
    const outcome = await executeVerification(UI_PLAN, { path: "/ws" }, {
      checks: uiChecks(),
      execFile: passAll,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join("\n")).toMatch(
      /required ui_browser_flow evidence was not collected/,
    );
    expect(outcome.errors.join("\n")).toMatch(
      /required annotated_stills evidence was not collected/,
    );
  });

  it("passes a UI plan once stills/video evidence is collected", async () => {
    const withStills = uiChecks().map((check) => {
      if (check.gate === "ui_browser_flow") return { ...check, evidence: ["flow:/ws/evidence/flow.json"] };
      if (check.gate === "annotated_stills") {
        return { ...check, evidence: ["/ws/evidence/still-1.png", "/ws/evidence/still-2.png"] };
      }
      return check;
    });
    const outcome = await executeVerification(UI_PLAN, { path: "/ws" }, {
      checks: withStills,
      execFile: passAll,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.errors).toEqual([]);
  });

  it("never accepts runner stdout as verification for evidence gates", async () => {
    // The process exits zero and brags in stdout, but no stills/video/review
    // were collected: the captured stdout is recorded yet never satisfies the
    // UI/security evidence requirement.
    const bragging: ExecFileEffect = async () => ({
      exitCode: 0,
      stdout: "All UI checks passed, screenshots verified",
      stderr: "",
    });
    const outcome = await executeVerification(UI_PLAN, { path: "/ws" }, {
      checks: uiChecks(),
      execFile: bragging,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join("\n")).toMatch(/evidence was not collected/);
    const browserRecord = records(outcome).find((r) => r.checkId === "browser");
    expect(browserRecord?.stdout).toBe("All UI checks passed, screenshots verified");
  });

  it("fails closed on missing security review evidence, passes with a review note", async () => {
    const withoutNote = await executeVerification(SEC_PLAN, { path: "/ws" }, {
      checks: secChecks(),
      execFile: passAll,
    });
    expect(withoutNote.ok).toBe(false);
    expect(withoutNote.errors.join("\n")).toMatch(
      /required security_review evidence was not collected/,
    );

    const withNote = secChecks().map((check) =>
      check.gate === "security_review"
        ? { ...check, evidence: ["review:/ws/evidence/security-review.md"] }
        : check,
    );
    const passed = await executeVerification(SEC_PLAN, { path: "/ws" }, {
      checks: withNote,
      execFile: passAll,
    });
    expect(passed.ok).toBe(true);
  });

  it("fails closed on a missing declared check for a plan gate", async () => {
    const outcome = await executeVerification(CODE_PLAN, { path: "/ws" }, {
      checks: codeChecks().slice(0, 3),
      execFile: passAll,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join("\n")).toMatch(/missing check for gate small_pr/);
    // Nothing runs: the check set is structurally invalid.
    expect(outcome.evidence).toEqual([]);
  });

  it("rejects a declared check for a gate the plan does not require", async () => {
    const extra: DeclaredCheck = { id: "video", gate: "short_video", argv: ["node", "record.mjs"] };
    const outcome = await executeVerification(CODE_PLAN, { path: "/ws" }, {
      checks: [...codeChecks(), extra],
      execFile: passAll,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join("\n")).toMatch(
      /check for gate short_video is not required by the plan/,
    );
  });

  it("rejects an empty argv and a workspace without a path", async () => {
    const emptyArgv = await executeVerification(CODE_PLAN, { path: "/ws" }, {
      checks: [{ id: "bad", gate: "code_checks", argv: [] }],
      execFile: passAll,
    });
    expect(emptyArgv.ok).toBe(false);
    expect(emptyArgv.errors.join("\n")).toMatch(/argv must name an executable/);

    const noPath = await executeVerification(CODE_PLAN, { path: "" }, {
      checks: codeChecks(),
      execFile: passAll,
    });
    expect(noPath.ok).toBe(false);
    expect(noPath.errors.join("\n")).toMatch(/prepared workspace has no path/);
  });

  it("runs each check via argv with no shell", async () => {
    const calls: Array<{ argv: string[]; options?: { cwd?: string; timeoutMs?: number } }> = [];
    const recorder: ExecFileEffect = async (argv, options) => {
      calls.push({ argv, options });
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const outcome = await executeVerification(CODE_PLAN, { path: "/ws" }, {
      checks: codeChecks(),
      execFile: recorder,
      timeoutMs: 5000,
    });
    expect(outcome.ok).toBe(true);
    expect(calls.map((call) => call.argv)).toEqual([
      ["npm", "run", "check"],
      ["node", "collect-logs.mjs"],
      ["node", "grade.mjs"],
      ["node", "pr-size.mjs"],
    ]);
    for (const call of calls) {
      // argv is an argument array, never a shell command string.
      expect(Array.isArray(call.argv)).toBe(true);
      expect(typeof call.argv[0]).toBe("string");
      expect(call.options).not.toHaveProperty("shell");
      expect(call.options?.cwd).toBe("/ws");
      expect(call.options?.timeoutMs).toBe(5000);
    }
  });

  it("produces deterministic evidence across runs", async () => {
    const withStills = uiChecks().map((check) =>
      check.gate === "ui_browser_flow"
        ? { ...check, evidence: ["flow:/ws/evidence/flow.json"] }
        : check.gate === "annotated_stills"
          ? { ...check, evidence: ["/ws/evidence/still-1.png", "/ws/evidence/still-2.png"] }
          : check,
    );
    const run = () =>
      executeVerification(UI_PLAN, { path: "/ws" }, { checks: withStills, execFile: passAll });
    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
  });
});

describe("defaultExecFileEffect", () => {
  it("runs argv without a shell and captures stdout", async () => {
    const result = await defaultExecFileEffect([
      process.execPath,
      "-e",
      "process.stdout.write('hello')",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
    expect(result.error).toBeUndefined();
  });

  it("reports a nonzero exit code", async () => {
    const result = await defaultExecFileEffect([process.execPath, "-e", "process.exit(7)"]);
    expect(result.exitCode).toBe(7);
    expect(result.error).toBeUndefined();
  });

  it("fails closed when the executable is missing", async () => {
    const result = await defaultExecFileEffect(["foundry-no-such-binary-xyz", "--flag"]);
    expect(result.error).toMatch(/ENOENT|failed/i);
  });
});

