import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendEvent, readEvents, redactSecrets } from "../lib/foundry/log";

// Redirect the event log to a scratch dir so tests never touch real data.
process.env.FOUNDRY_DATA = join(tmpdir(), `foundry-log-test-${process.pid}`);
const SCRATCH = process.env.FOUNDRY_DATA;

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

const SECRETS = {
  apiKey: "sk-test-abcdefghijklmnopqrstuvwxyz0123456789",
  bearer: "Bearer sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
  githubPat: "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0EXAMPLEONLY\n-----END RSA PRIVATE KEY-----",
  password: "hunter2-super-secret",
  queryToken: "8f14e45fceea167a5a36dedd4bea2543",
};

const ALL_SECRETS = Object.values(SECRETS);

function eventLog(issueId: string): string {
  return readFileSync(join(SCRATCH, "logs", `${issueId}.jsonl`), "utf8");
}

describe("redactSecrets", () => {
  it("redacts credential-bearing field names and keeps the keys", () => {
    const out = redactSecrets({
      apiKey: SECRETS.apiKey,
      api_key: SECRETS.apiKey,
      "API-KEY": SECRETS.apiKey,
      password: SECRETS.password,
      meta: { accessToken: SECRETS.bearer, client_secret: SECRETS.apiKey },
      items: [{ token: SECRETS.githubPat }],
      ok: "hello",
    });
    expect(out).toEqual({
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      "API-KEY": "[REDACTED]",
      password: "[REDACTED]",
      meta: { accessToken: "[REDACTED]", client_secret: "[REDACTED]" },
      items: [{ token: "[REDACTED]" }],
      ok: "hello",
    });
  });

  it("scrubs credential-looking values under innocent field names", () => {
    const out = redactSecrets({
      message: `hit ${SECRETS.apiKey} again`,
      error: `HTTP 401: ${SECRETS.bearer} is invalid`,
      raw: SECRETS.awsAccessKeyId,
      jwt: SECRETS.jwt,
      keyMaterial: SECRETS.privateKey,
      url: `https://x.example/api?token=${SECRETS.queryToken}&a=1`,
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(out);
    for (const secret of ALL_SECRETS) {
      expect(serialized).not.toContain(secret);
    }
    expect(out.message).toBe("hit [REDACTED] again");
    expect(out.error).toBe("HTTP 401: Bearer [REDACTED] is invalid");
    expect(out.raw).toBe("[REDACTED]");
    expect(out.jwt).toBe("[REDACTED]");
    expect(out.keyMaterial).toBe("[REDACTED]");
    expect(out.url).toBe(`https://x.example/api?token=[REDACTED]&a=1`);
  });

  it("keeps ordinary evidence and usage counters intact", () => {
    const out = redactSecrets({
      workDir: "/tmp/foundry-worktrees/tasks/git-worktree/host/issue-1",
      targetUrl: "https://github.com/owner/repo",
      branchName: "feature/audit-redaction",
      model: "claude-opus-5-thinking-xhigh",
      error: "ENOENT: no such file or directory, open '/x/y'",
      tokensUsed: 1234,
      tokens_used: 55,
      token_budget: 100000,
      tokens: 42,
      tokenCount: 7,
      inputTokens: 9,
      key: "lesson:issue-1:model-router",
      id: 7,
      runId: "run-9",
      reason: "auto-advance",
    });
    expect(out).toEqual({
      workDir: "/tmp/foundry-worktrees/tasks/git-worktree/host/issue-1",
      targetUrl: "https://github.com/owner/repo",
      branchName: "feature/audit-redaction",
      model: "claude-opus-5-thinking-xhigh",
      error: "ENOENT: no such file or directory, open '/x/y'",
      tokensUsed: 1234,
      tokens_used: 55,
      token_budget: 100000,
      tokens: 42,
      tokenCount: 7,
      inputTokens: 9,
      key: "lesson:issue-1:model-router",
      id: 7,
      runId: "run-9",
      reason: "auto-advance",
    });
    expect(JSON.stringify(out)).not.toContain("[REDACTED]");
  });

  it("never mutates its input", () => {
    const input = {
      apiKey: SECRETS.apiKey,
      meta: { token: SECRETS.githubPat },
      items: [SECRETS.jwt],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    redactSecrets(input);
    expect(input).toEqual(snapshot);
  });

  it("fails closed on cyclic structures", () => {
    const cyclic: Record<string, unknown> = { label: "root" };
    cyclic.self = cyclic;
    cyclic.meta = { back: cyclic };
    expect(redactSecrets(cyclic)).toEqual({
      label: "root",
      self: "[TRUNCATED]",
      meta: { back: "[TRUNCATED]" },
    });
  });

  it("bounds depth and size", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 200; i++) deep = { deep };
    expect(JSON.stringify(redactSecrets(deep)).length).toBeLessThan(2000);

    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 100_000; i++) wide[`f${i}`] = i;
    const wideOut = redactSecrets(wide) as Record<string, unknown>;
    expect(Object.keys(wideOut).length).toBeLessThan(4096);
  });

  it("scrubs credentials inside very long strings", () => {
    const big = `${"a".repeat(100_000)} ${SECRETS.apiKey} ${"b".repeat(100_000)}`;
    const out = redactSecrets({ note: big }) as { note: string };
    expect(out.note).not.toContain(SECRETS.apiKey);
    expect(out.note).toContain("[REDACTED]");
  });
});

describe("appendEvent redaction at the write boundary", () => {
  it("writes no literal secrets to the JSONL", () => {
    appendEvent("issue-redact-1", "execute.failed", {
      apiKey: SECRETS.apiKey,
      message: `call ${SECRETS.apiKey}`,
      error: `HTTP 401: ${SECRETS.bearer} is invalid`,
      headers: { authorization: SECRETS.bearer },
      meta: { token: SECRETS.githubPat, raw: SECRETS.awsAccessKeyId },
      url: `https://x.example/api?token=${SECRETS.queryToken}&a=1`,
      cert: SECRETS.privateKey,
    });
    const raw = eventLog("issue-redact-1");
    for (const secret of ALL_SECRETS) {
      expect(raw).not.toContain(secret);
    }
    const [event] = readEvents("issue-redact-1");
    const headers = event.payload.headers as Record<string, unknown>;
    const meta = event.payload.meta as Record<string, unknown>;
    expect(event.kind).toBe("execute.failed");
    expect(event.payload.apiKey).toBe("[REDACTED]");
    expect(headers.authorization).toBe("[REDACTED]");
    expect(meta.token).toBe("[REDACTED]");
    expect(meta.raw).toBe("[REDACTED]");
    expect(event.payload.cert).toBe("[REDACTED]");
    expect(event.payload.message).toBe("call [REDACTED]");
    expect(event.payload.error).toBe("HTTP 401: Bearer [REDACTED] is invalid");
    expect(event.payload.url).toBe(`https://x.example/api?token=[REDACTED]&a=1`);
    expect(event.payload.source).toBe("system");
    expect(event.payload.reason).toBeNull();
  });

  it("keeps ordinary paths, model ids and errors intact", () => {
    appendEvent("issue-evidence-1", "test.kind", {
      workDir: "/tmp/foundry-worktrees/tasks/git-worktree/host/issue-1",
      targetUrl: "https://github.com/owner/repo",
      branchName: "feature/audit-redaction",
      model: "claude-opus-5-thinking-xhigh",
      error: "ENOENT: no such file or directory, open '/x/y'",
      tokens_used: 1234,
      token_budget: 100000,
      key: "lesson:issue-1:model-router",
      count: 2,
    });
    const raw = eventLog("issue-evidence-1");
    expect(raw).not.toContain("[REDACTED]");
    const [event] = readEvents("issue-evidence-1");
    expect(event.payload).toMatchObject({
      workDir: "/tmp/foundry-worktrees/tasks/git-worktree/host/issue-1",
      targetUrl: "https://github.com/owner/repo",
      branchName: "feature/audit-redaction",
      model: "claude-opus-5-thinking-xhigh",
      error: "ENOENT: no such file or directory, open '/x/y'",
      tokens_used: 1234,
      token_budget: 100000,
      key: "lesson:issue-1:model-router",
      count: 2,
      source: "system",
      reason: null,
    });
  });

  it("does not mutate the caller's payload", () => {
    const payload = {
      apiKey: SECRETS.apiKey,
      meta: { token: SECRETS.githubPat },
      items: [SECRETS.jwt],
    };
    const snapshot = JSON.parse(JSON.stringify(payload));
    appendEvent("issue-mut-1", "test.kind", payload);
    expect(payload).toEqual(snapshot);
  });

  it("accepts deeply frozen payloads", () => {
    const frozen = Object.freeze({
      apiKey: SECRETS.apiKey,
      meta: Object.freeze({ token: SECRETS.githubPat }),
    });
    expect(() => appendEvent("issue-frozen-1", "test.kind", frozen)).not.toThrow();
  });

  it("fails closed on cyclic payloads and stays valid JSONL", () => {
    const cyclic: Record<string, unknown> = { label: "root" };
    cyclic.self = cyclic;
    cyclic.meta = { back: cyclic };
    expect(() => appendEvent("issue-cycle-1", "test.kind", cyclic)).not.toThrow();
    // Parsing the row back proves the written line is valid JSON.
    const [event] = readEvents("issue-cycle-1");
    const self = event.payload.self as Record<string, unknown>;
    const meta = event.payload.meta;
    expect(event.payload.label).toBe("root");
    expect(self.self).toBe("[TRUNCATED]");
    expect(meta).toBe("[TRUNCATED]");
  });

  it("returns the redacted event and preserves actor metadata", () => {
    const event = appendEvent(
      "issue-actor-1",
      "test.kind",
      { round: 3, apiKey: SECRETS.apiKey },
      { source: "operator", reason: "manual-advance" },
    );
    expect(event.payload.apiKey).toBe("[REDACTED]");
    expect(event.payload.round).toBe(3);
    expect(event.payload.source).toBe("operator");
    expect(event.payload.reason).toBe("manual-advance");
    const [read] = readEvents("issue-actor-1");
    expect(read.payload.round).toBe(3);
    expect(read.payload.source).toBe("operator");
    expect(read.payload.reason).toBe("manual-advance");
  });
});
