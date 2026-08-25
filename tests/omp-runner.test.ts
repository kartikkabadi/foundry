import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_MODEL_CONTRACT_ID,
  DEFAULT_TEXT_MODEL_ID,
  DEFAULT_VISION_MODEL_ID,
  OMP_ENV_ALLOWLIST,
  assertCostPolicy,
  buildOmpArgv,
  buildOmpEnv,
  formatMaxTimeMs,
  isVisionCapable,
  parseJsonOrNull,
  planOmpRun,
  resolveDefaultTextModelId,
  resolveModel,
  runOmp,
  type OmpRunSpec,
} from "../lib/foundry/omp-runner";
import { DEFAULT_TEXT_MODEL } from "../lib/foundry/orchestration-types";

const CONCRETE_TEXT_MODEL = "particle/deepseek-v4-flash-0731";

/** Minimal child-process stand-in: tests drive exit, output, and kills. */
class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killedWith: NodeJS.Signals | null = null;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedWith = signal;
    // OS termination: close arrives after the current tick, so any pending
    // stdout/stderr data events flush first.
    setImmediate(() => this.emit("close", null, signal));
    return true;
  }

  exit(code: number | null): void {
    setImmediate(() => this.emit("close", code, null));
  }
}

function fakeSpawn() {
  const child = new FakeChild();
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
  const spawnFn = ((
    command: string,
    args: string[],
    options: Record<string, unknown>,
  ) => {
    calls.push({ command, args, options });
    return child;
  }) as unknown as typeof spawn;
  return { child, calls, spawnFn };
}

function spec(overrides: Partial<OmpRunSpec> = {}): OmpRunSpec {
  return {
    taskId: "task-1",
    prompt: "Do the thing",
    cwd: "/tmp/work",
    ...overrides,
  };
}

function modelArgvOf(argv: string[]): string | undefined {
  const i = argv.indexOf("--model");
  return i >= 0 ? argv[i + 1] : undefined;
}

describe("buildOmpArgv — command construction", () => {
  it("builds a deterministic non-interactive argv for a default text run", () => {
    expect(buildOmpArgv(spec())).toEqual([
      "-p",
      "--model", CONCRETE_TEXT_MODEL,
      "--cwd", "/tmp/work",
      "--mode", "json",
      "--no-session",
      "--no-pty",
      "--auto-approve",
      "Do the thing",
    ]);
  });

  it("maps the contract model id to the concrete deployment in argv", () => {
    const argv = buildOmpArgv(spec({ model: DEFAULT_TEXT_MODEL_CONTRACT_ID }));
    expect(modelArgvOf(argv)).toBe(CONCRETE_TEXT_MODEL);
  });

  it("passes the prompt verbatim as a single argv element (no shell re-parsing)", () => {
    const argv = buildOmpArgv(spec({ prompt: "rm -rf /tmp/x --flag && echo hi" }));
    expect(argv[argv.length - 1]).toBe("rm -rf /tmp/x --flag && echo hi");
    expect(argv).toHaveLength(11);
  });

  it("appends optional flags in a stable order", () => {
    const argv = buildOmpArgv(
      spec({
        profile: "frontend",
        maxTimeMs: 90_000,
        sessionDir: "/tmp/sess",
        thinking: "high",
        systemPrompt: "sys",
        appendSystemPrompt: "app",
        noTools: true,
        approvalMode: "write",
        mode: "text",
      }),
    );
    expect(argv).toEqual([
      "--profile", "frontend",
      "-p",
      "--model", CONCRETE_TEXT_MODEL,
      "--cwd", "/tmp/work",
      "--mode", "text",
      "--max-time", "90",
      "--session-dir", "/tmp/sess",
      "--thinking", "high",
      "--system-prompt", "sys",
      "--append-system-prompt", "app",
      "--no-tools",
      "--no-pty",
      "--approval-mode", "write",
      "Do the thing",
    ]);
  });
});

describe("free model use", () => {
  it("resolves the text default to the free DeepSeek deployment", () => {
    expect(resolveModel("text")).toEqual({
      id: DEFAULT_TEXT_MODEL_ID,
      role: "text",
      cost: "free",
    });
  });

  it("plans a default text run without a cost ceiling", () => {
    const plan = planOmpRun(spec());
    expect(plan.model.cost).toBe("free");
    expect(plan.model.id).toBe(DEFAULT_TEXT_MODEL_ID);
    expect(modelArgvOf(plan.argv)).toBe(DEFAULT_TEXT_MODEL_ID);
  });
});

describe("model alias mapping (omp/deepseek-v4-flash ↔ particle/deepseek-v4-flash-0731)", () => {
  it("derives the contract id from orchestration-types (no drift)", () => {
    expect(DEFAULT_TEXT_MODEL_CONTRACT_ID).toBe("omp/deepseek-v4-flash");
    expect(DEFAULT_TEXT_MODEL_CONTRACT_ID).toBe(DEFAULT_TEXT_MODEL);
  });

  it("resolves the contract id to the concrete deployment id", () => {
    expect(resolveDefaultTextModelId("omp/deepseek-v4-flash")).toBe(CONCRETE_TEXT_MODEL);
  });

  it("leaves unrelated model ids unchanged", () => {
    expect(resolveDefaultTextModelId("openai/gpt-5.2")).toBe("openai/gpt-5.2");
  });

  it("classifies the contract spelling as free text", () => {
    expect(resolveModel("text", { model: "omp/deepseek-v4-flash" })).toEqual({
      id: DEFAULT_TEXT_MODEL_ID,
      role: "text",
      cost: "free",
    });
  });

  it("classifies the concrete spelling as free text", () => {
    expect(resolveModel("text", { model: "particle/deepseek-v4-flash-0731" })).toEqual({
      id: DEFAULT_TEXT_MODEL_ID,
      role: "text",
      cost: "free",
    });
  });

  it("unifies the alias through planOmpRun", () => {
    const plan = planOmpRun(spec({ model: "omp/deepseek-v4-flash" }));
    expect(plan.model.id).toBe(CONCRETE_TEXT_MODEL);
    expect(plan.model.cost).toBe("free");
    expect(modelArgvOf(plan.argv)).toBe(CONCRETE_TEXT_MODEL);
  });
});

describe("paid ceilings", () => {
  it("classifies a non-default text model as paid", () => {
    expect(resolveModel("text", { model: "openai/gpt-5.2" }).cost).toBe("paid");
  });

  it("refuses a paid model without an explicit ceiling", () => {
    const paid: { id: string; role: "text"; cost: "paid" } = {
      id: "openai/gpt-5.2",
      role: "text",
      cost: "paid",
    };
    expect(() => assertCostPolicy(spec(), paid)).toThrow(/costCeiling/i);
  });

  it("accepts a paid model with an explicit ceiling", () => {
    const paid = { id: "openai/gpt-5.2", role: "text" as const, cost: "paid" as const };
    expect(() => assertCostPolicy(spec({ costCeiling: { amount: 0.1 } }), paid)).not.toThrow();
  });

  it("planOmpRun refuses paid models without a ceiling", () => {
    expect(() => planOmpRun(spec({ model: "openai/gpt-5.2" }))).toThrow(/costCeiling/i);
  });

  it("planOmpRun carries the ceiling and paid model into the argv", () => {
    const plan = planOmpRun(spec({ model: "openai/gpt-5.2", costCeiling: { amount: 0.1 } }));
    expect(plan.model.cost).toBe("paid");
    expect(modelArgvOf(plan.argv)).toBe("openai/gpt-5.2");
  });
});

describe("formatMaxTimeMs", () => {
  it("formats milliseconds as ceilinged integer seconds", () => {
    expect(formatMaxTimeMs(1000)).toBe("1");
    expect(formatMaxTimeMs(1500)).toBe("2");
    expect(formatMaxTimeMs(90_000)).toBe("90");
  });

  it("rejects non-positive durations", () => {
    expect(() => formatMaxTimeMs(0)).toThrow();
    expect(() => formatMaxTimeMs(-5)).toThrow();
    expect(() => formatMaxTimeMs(Number.NaN)).toThrow();
  });
});

describe("output parsing", () => {
  it("parses a JSON stdout document", () => {
    expect(parseJsonOrNull('{"ok":true}')).toEqual({ ok: true });
  });

  it("returns null for empty output", () => {
    expect(parseJsonOrNull("")).toBeNull();
    expect(parseJsonOrNull("   \n ")).toBeNull();
  });

  it("returns null for unparseable output", () => {
    expect(parseJsonOrNull("not json")).toBeNull();
  });

  it("parses json mode stdout into the structured result", async () => {
    const { child, spawnFn } = fakeSpawn();
    const pending = runOmp(spec(), { spawnFn });
    child.stdout.end(JSON.stringify({ ok: true }));
    child.exit(0);
    const result = await pending;
    expect(result.json).toEqual({ ok: true });
    expect(result.stdout).toBe(JSON.stringify({ ok: true }));
    expect(result.exitCode).toBe(0);
  });

  it("keeps json null in text mode even with JSON stdout", async () => {
    const { child, spawnFn } = fakeSpawn();
    const pending = runOmp(spec({ mode: "text" }), { spawnFn });
    child.stdout.end(JSON.stringify({ ok: true }));
    child.exit(0);
    const result = await pending;
    expect(result.json).toBeNull();
    expect(result.stdout).toBe(JSON.stringify({ ok: true }));
  });
});

describe("nonzero exit", () => {
  it("records the exit code and stderr", async () => {
    const { child, spawnFn } = fakeSpawn();
    const pending = runOmp(spec(), { spawnFn });
    child.stderr.end("boom");
    child.exit(2);
    const result = await pending;
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
  });
});

describe("timeout", () => {
  it("kills the child when maxTimeMs elapses and marks timedOut", async () => {
    const { child, spawnFn } = fakeSpawn();
    const pending = runOmp(spec({ maxTimeMs: 40 }), { spawnFn });
    const result = await pending;
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(child.killedWith).toBe("SIGTERM");
  });
});

describe("abort", () => {
  it("cancels the child when the abort signal fires", async () => {
    const ac = new AbortController();
    const { child, spawnFn } = fakeSpawn();
    const pending = runOmp(spec(), { signal: ac.signal, spawnFn });
    ac.abort();
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(child.killedWith).toBe("SIGTERM");
  });

  it("handles an already-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const { child, spawnFn } = fakeSpawn();
    const pending = runOmp(spec(), { signal: ac.signal, spawnFn });
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(child.killedWith).toBe("SIGTERM");
  });
});

describe("structured result", () => {
  it("returns the full result envelope", async () => {
    const { child, spawnFn } = fakeSpawn();
    const ceiling = { amount: 0.1 };
    const pending = runOmp(spec({ model: "openai/gpt-5.2", costCeiling: ceiling }), {
      spawnFn,
    });
    child.stdout.end('{"ok":1}');
    child.exit(0);
    const result = await pending;
    expect(result.taskId).toBe("task-1");
    expect(result.model).toBe("openai/gpt-5.2");
    expect(result.cost).toBe("paid");
    expect(result.costCeiling).toBe(ceiling);
    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({ ok: 1 });
    expect(result.cancelled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(Number.isNaN(Date.parse(result.startedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(result.endedAt))).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("shell=false behavior", () => {
  it("spawns with an argv array and shell explicitly disabled", async () => {
    const { child, calls, spawnFn } = fakeSpawn();
    const pending = runOmp(spec(), { spawnFn });
    child.exit(0);
    await pending;
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("omp");
    expect(calls[0].args).toEqual(expect.any(Array));
    expect(calls[0].options.shell).toBe(false);
    expect(calls[0].options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("merges spec env over the allowlisted environment", async () => {
    const { child, calls, spawnFn } = fakeSpawn();
    const pending = runOmp(spec({ env: { FOUNDRY_X: "1" } }), { spawnFn });
    child.exit(0);
    await pending;
    expect((calls[0].options.env as Record<string, string | undefined>).FOUNDRY_X).toBe("1");
  });

  it("uses the configured bin", async () => {
    const { child, calls, spawnFn } = fakeSpawn();
    const pending = runOmp(spec({ bin: "/usr/local/bin/omp" }), { spawnFn });
    child.exit(0);
    await pending;
    expect(calls[0].command).toBe("/usr/local/bin/omp");
  });
});

describe("child environment allowlist", () => {
  it("exports a minimal allowlist covering runtime basics", () => {
    for (const name of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM"]) {
      expect(OMP_ENV_ALLOWLIST).toContain(name);
    }
  });

  it("contains no credential-like variable names", () => {
    for (const name of OMP_ENV_ALLOWLIST) {
      expect(name).not.toMatch(/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|API|AUTH|SIGN/i);
    }
  });

  it("inherits only allowlisted names from the source env", () => {
    const env = buildOmpEnv(
      {},
      {
        PATH: "/usr/bin",
        HOME: "/home/u",
        LANG: "en_US.UTF-8",
        TERM: "xterm-256color",
        GITHUB_TOKEN: "ghs_secret",
        AWS_SECRET_ACCESS_KEY: "aws_secret",
        OPENAI_API_KEY: "sk-123",
        NODE_ENV: "production",
      },
    );
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "en_US.UTF-8",
      TERM: "xterm-256color",
    });
  });

  it("drops non-allowlisted host vars even when explicitly present in the source", () => {
    const env = buildOmpEnv({}, { NO_PROXY: "1", HTTPS_PROXY: "1" });
    expect(env).toEqual({});
  });

  it("merges explicit env over the allowlisted subset and may add new names", () => {
    const env = buildOmpEnv(
      { PATH: "/custom/bin", FOUNDRY_X: "1", GITHUB_TOKEN: "explicit" },
      { PATH: "/usr/bin", HOME: "/home/u", GITHUB_TOKEN: "implicit-secret" },
    );
    expect(env.PATH).toBe("/custom/bin");
    expect(env.FOUNDRY_X).toBe("1");
    expect(env.GITHUB_TOKEN).toBe("explicit");
    expect(env.HOME).toBe("/home/u");
  });

  it("defaults the source to the current process env", () => {
    const env = buildOmpEnv({});
    for (const name of OMP_ENV_ALLOWLIST) {
      expect(env[name]).toBe(process.env[name]);
    }
    expect(env.PATH).toBe(process.env.PATH);
  });
});

describe("runOmp child environment", () => {
  it("excludes secret-like host env vars from the spawned child", async () => {
    const prev = process.env.FOUNDRY_HARDENING_TEST_TOKEN;
    process.env.FOUNDRY_HARDENING_TEST_TOKEN = "sekrit";
    try {
      const { child, calls, spawnFn } = fakeSpawn();
      const pending = runOmp(spec(), { spawnFn });
      child.exit(0);
      await pending;
      const env = calls[0].options.env as Record<string, string | undefined>;
      expect(env.FOUNDRY_HARDENING_TEST_TOKEN).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.FOUNDRY_HARDENING_TEST_TOKEN;
      else process.env.FOUNDRY_HARDENING_TEST_TOKEN = prev;
    }
  });

  it("keeps allowlisted basics like PATH and HOME in the child env", async () => {
    const { child, calls, spawnFn } = fakeSpawn();
    const pending = runOmp(spec(), { spawnFn });
    child.exit(0);
    await pending;
    const env = calls[0].options.env as Record<string, string | undefined>;
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.TMPDIR).toBe(process.env.TMPDIR);
  });

  it("lets explicit spec.env override an allowlisted basic", async () => {
    const { child, calls, spawnFn } = fakeSpawn();
    const pending = runOmp(spec({ env: { PATH: "/custom/bin" } }), { spawnFn });
    child.exit(0);
    await pending;
    const env = calls[0].options.env as Record<string, string | undefined>;
    expect(env.PATH).toBe("/custom/bin");
    expect(env.HOME).toBe(process.env.HOME);
  });
});

describe("spawn failure", () => {
  it("rejects when the binary cannot be spawned", async () => {
    const { child, spawnFn } = fakeSpawn();
    const pending = runOmp(spec(), { spawnFn });
    child.emit("error", new Error("ENOENT"));
    await expect(pending).rejects.toThrow(/failed to spawn omp/);
  });
});

describe("vision role", () => {
  it("classifies the default vision model as paid", () => {
    const model = resolveModel("vision");
    expect(model.role).toBe("vision");
    expect(model.cost).toBe("paid");
  });

  it("accepts caller-listed vision-capable ids", () => {
    const model = resolveModel("vision", {
      model: "openai/gpt-5.2",
      visionCapableIds: ["openai/gpt-5.2"],
      cost: "free",
    });
    expect(model.id).toBe("openai/gpt-5.2");
    expect(model.cost).toBe("free");
  });

  it("isVisionCapable matches the default or extras", () => {
    expect(isVisionCapable(DEFAULT_VISION_MODEL_ID)).toBe(true);
    expect(isVisionCapable("openai/gpt-5.2", ["openai/gpt-5.2"])).toBe(true);
    expect(isVisionCapable("some/other")).toBe(false);
  });

  it("refuses a text model for vision work", () => {
    expect(() => resolveModel("vision", { model: "particle/deepseek-v4-flash-0731" })).toThrow(
      /vision-capable/i,
    );
  });
});
