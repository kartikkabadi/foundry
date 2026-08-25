import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationRun, ResourceBudget } from "../lib/foundry/orchestration-types";
import type { OrchestrationStore as OrchestrationStoreType } from "../lib/foundry/orchestration-store";
import { logPath } from "../lib/foundry/paths";

const RES: ResourceBudget = { cpu: 1, memoryMiB: 512, diskMiB: 1024, concurrency: 1 };

// Fixed base clock so lease TTL arithmetic is deterministic.
const BASE = new Date(Date.UTC(2026, 7, 25, 0, 0, 0)).toISOString();

let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "foundry-orch-"));
  process.env.FOUNDRY_DATA = join(dataDir, "data");
  vi.resetModules();
});

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

type Ctx = {
  store: OrchestrationStoreType;
  other: OrchestrationStoreType;
  now: () => string;
  advance: (ms: number) => void;
};

async function makeCtx(): Promise<Ctx> {
  const { OrchestrationStore } = await import("../lib/foundry/orchestration-store");
  let t = Date.parse(BASE);
  let n = 0;
  const now = () => {
    return new Date(t).toISOString();
  };
  const advance = (ms: number) => {
    t += ms;
  };
  const id = () => {
    n += 1;
    return `id-${String(n).padStart(3, "0")}`;
  };
  // Both instances share one id counter and one clock so a second instance
  // (proving durability) never collides with the first.
  const store = new OrchestrationStore({ now, id });
  const other = new OrchestrationStore({ now, id });
  return { store, other, now, advance };
}

function makeRun(store: OrchestrationStoreType, suffix = "1"): OrchestrationRun {
  return store.createRun({ issueId: `issue-${suffix}`, stage: "research", name: `run ${suffix}` });
}

describe("run creation and metadata", () => {
  it("creates an active run linked to issueId and stage with version 1", async () => {
    const { store } = await makeCtx();
    const run = store.createRun({ issueId: "issue-9", stage: "spec", name: "spec it" });
    expect(run.status).toBe("active");
    expect(run.version).toBe(1);
    expect(run.issueId).toBe("issue-9");
    expect(run.stage).toBe("spec");
    expect(store.getRun(run.id)).toMatchObject({ id: run.id, status: "active" });
  });

  it("rejects an empty issueId or an unknown stage", async () => {
    const { store } = await makeCtx();
    expect(() => store.createRun({ issueId: "   ", stage: "research", name: "r" })).toThrow(/issueId/);
    expect(() => store.createRun({ issueId: "issue-1", stage: "nope" as never, name: "r" })).toThrow(/unknown stage/);
    expect(() => store.createRun({ issueId: "issue-1", stage: "research", name: "" })).toThrow(/name/);
  });

  it("completes a run only when every task is terminal", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const task = store.createTask(run.id, { name: "a", resources: RES });
    expect(() => store.completeRun(run.id, "succeeded")).toThrow(/unfinished tasks/);
    store.leaseTask(task.id, { host: "mac", owner: "w" });
    store.startTask(task.id, "w");
    store.verifyTask(task.id, "w");
    store.succeedTask(task.id, "w");
    const done = store.completeRun(run.id, "succeeded");
    expect(done.status).toBe("succeeded");
    expect(done.version).toBeGreaterThan(1);
  });
});

describe("graph validation", () => {
  it("rejects a dependency on a missing task and on a task in another run", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    expect(() => store.createTask(run.id, { name: "a", deps: ["ghost"], resources: RES })).toThrow(/does not exist/);
    const otherRun = store.createRun({ issueId: "issue-2", stage: "research", name: "r2" });
    const a = store.createTask(otherRun.id, { name: "a", resources: RES });
    expect(() => store.createTask(run.id, { name: "b", deps: [a.id], resources: RES })).toThrow(/different run/);
  });

  it("rejects a self-dependency and a cycle via addDependency", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    const b = store.createTask(run.id, { name: "b", deps: [a.id], resources: RES });
    expect(() => store.addDependency(a.id, a.id)).toThrow(/itself/);
    expect(() => store.addDependency(a.id, b.id)).toThrow(/cycle/);
  });

  it("validates a well-formed graph and reports missing deps and cycles", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    const b = store.createTask(run.id, { name: "b", deps: [a.id], resources: RES });
    const c = store.createTask(run.id, { name: "c", deps: [b.id], resources: RES });
    expect(store.validateGraph(run.id)).toEqual({ ok: true, errors: [] });

    // Corrupt the graph behind the store's back to exercise the validator.
    const { orchestrationConnection } = await import("../lib/foundry/store");
    const conn = orchestrationConnection();
    conn.prepare("UPDATE orchestration_tasks SET deps = ? WHERE id = ?").run(JSON.stringify([a.id, "ghost"]), b.id);
    conn.prepare("UPDATE orchestration_tasks SET deps = ? WHERE id = ?").run(JSON.stringify([c.id]), a.id);
    const result = store.validateGraph(run.id);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("missing task ghost");
    expect(result.errors.join("\n")).toContain("cycle detected");
  });
});

describe("state transitions", () => {
  it("enforces legal transitions with an actionable allowed-set message", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    // ready -> verifying is illegal; allowed set must be quoted.
    expect(() => store.verifyTask(a.id, "w")).toThrow(
      /illegal transition task .*: ready -> verifying \(allowed: leased, cancelled\)/,
    );
  });

  it("rejects direct state mutation outside domain transitions", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const task = store.createTask(run.id, { name: "a", resources: RES });
    expect("transitionTask" in store).toBe(false);
    store.leaseTask(task.id, { host: "mac", owner: "w" });
    expect(store.getTask(task.id)?.state).toBe("leased");
  });
});

describe("leases", () => {
  it("leases a ready task with the default TTL and links host and owner", async () => {
    const { store, now } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    const leased = store.leaseTask(a.id, { host: "mac", owner: "worker-1" });
    expect(leased.state).toBe("leased");
    expect(leased.host).toBe("mac");
    expect(leased.leaseId).toBeTruthy();
    const leases = store.leases(run.id);
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({ taskId: a.id, host: "mac", owner: "worker-1", releasedAt: null });
    // Default TTL is 5 minutes.
    expect(Date.parse(leases[0].expiresAt) - Date.parse(now())).toBe(5 * 60 * 1000);
  });

  it("rejects a second live lease on the same task", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w1" });
    // Already leased: a second lease is rejected outright (leased -> leased).
    expect(() => store.leaseTask(a.id, { host: "vps", owner: "w2" })).toThrow();
    // Defensive invariant: a task in ready state that still has a live lease
    // row must not be leased again (I6.4: never two live leases per task).
    const c = store.createTask(run.id, { name: "c", resources: RES });
    const { orchestrationConnection } = await import("../lib/foundry/store");
    orchestrationConnection()
      .prepare(
        `INSERT INTO orchestration_leases (id, task_id, host, owner, created_at, expires_at, released_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run("manual-lease", c.id, "mac", "ghost", BASE, new Date(Date.parse(BASE) + 60_000).toISOString());
    expect(() => store.leaseTask(c.id, { host: "vps", owner: "w2" })).toThrow(/already has a live lease/);
  });

  it("rejects renew and start by a non-owner", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w1" });
    expect(() => store.renewLease(a.id, "intruder")).toThrow(/owned by w1, not intruder/);
    expect(() => store.startTask(a.id, "intruder")).toThrow(/owned by w1, not intruder/);
  });

  it("rejects terminal mutations by a foreign owner or a stale lease", async () => {
    const { store, advance, now } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w", ttlMs: 1000 });
    store.startTask(a.id, "w");
    store.verifyTask(a.id, "w");
    // A different owner cannot succeed, fail, or cancel the task.
    expect(() => store.succeedTask(a.id, "intruder")).toThrow(/owned by w, not intruder/);
    expect(() => store.failTask(a.id, "boom", "intruder")).toThrow(/owned by w, not intruder/);
    expect(() => store.cancelTask(a.id, "intruder")).toThrow(/owned by w, not intruder/);
    // An expired lease fences out even the real owner.
    advance(5000);
    expect(() => store.succeedTask(a.id, "w")).toThrow(/expired at/);
    expect(() => store.failTask(a.id, "boom", "w")).toThrow(/expired at/);
    expect(() => store.cancelTask(a.id, "w")).toThrow(/expired at/);
    // After recovery the lease is gone; the stale executor's write is rejected.
    store.expireLeases(now());
    expect(() => store.cancelTask(a.id, "w")).toThrow(/no active lease/);
  });

  it("verifies only with the active unexpired owner lease", async () => {
    const { store, advance, now } = await makeCtx();
    const run = makeRun(store);

    // A foreign owner cannot move the task to verifying.
    const foreign = store.createTask(run.id, { name: "foreign", resources: RES });
    store.leaseTask(foreign.id, { host: "mac", owner: "w", ttlMs: 1000 });
    store.startTask(foreign.id, "w");
    expect(() => store.verifyTask(foreign.id, "intruder")).toThrow(/owned by w, not intruder/);

    // A running task whose lease was released has no lease: verify is rejected.
    const released = store.createTask(run.id, { name: "released", resources: RES });
    store.leaseTask(released.id, { host: "mac", owner: "w", ttlMs: 1000 });
    store.startTask(released.id, "w");
    store.releaseLease(released.id, "w");
    expect(store.getTask(released.id)?.state).toBe("running");
    expect(() => store.verifyTask(released.id, "w")).toThrow(/no active lease/);

    // An expired lease fences out even the real owner.
    const expired = store.createTask(run.id, { name: "expired", resources: RES });
    store.leaseTask(expired.id, { host: "mac", owner: "w", ttlMs: 1000 });
    store.startTask(expired.id, "w");
    advance(2000);
    expect(() => store.verifyTask(expired.id, "w")).toThrow(/expired at/);

    // After recovery the task is back in ready; the stale owner's verify is
    // rejected at the transition gate.
    store.expireLeases(now());
    expect(store.getTask(expired.id)?.state).toBe("ready");
    expect(() => store.verifyTask(expired.id, "w")).toThrow(/illegal transition/);

    // The correct owner with a live lease can verify.
    const ok = store.createTask(run.id, { name: "ok", resources: RES });
    store.leaseTask(ok.id, { host: "mac", owner: "w", ttlMs: 1000 });
    store.startTask(ok.id, "w");
    const verified = store.verifyTask(ok.id, "w");
    expect(verified.state).toBe("verifying");
  });

  it("rejects an expired lease", async () => {
    const { store, advance } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w", ttlMs: 1000 });
    advance(2000);
    expect(() => store.startTask(a.id, "w")).toThrow(/expired at/);
  });

  it("renews a lease and extends its expiry", async () => {
    const { store, now } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w", ttlMs: 1000 });
    const before = store.leases(run.id)[0].expiresAt;
    store.renewLease(a.id, "w", 60_000);
    const after = store.leases(run.id)[0].expiresAt;
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
    expect(Date.parse(after) - Date.parse(now())).toBe(60_000);
  });

  it("renews a lease while the task is running and verifying", async () => {
    const { store, now } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w", ttlMs: 1000 });
    store.startTask(a.id, "w");
    // Renewal is valid while running, not just while leased.
    const runningBefore = store.leases(run.id)[0].expiresAt;
    store.renewLease(a.id, "w", 60_000);
    const runningAfter = store.leases(run.id)[0].expiresAt;
    expect(Date.parse(runningAfter)).toBeGreaterThan(Date.parse(runningBefore));
    expect(Date.parse(runningAfter) - Date.parse(now())).toBe(60_000);
    // Renewal is valid while verifying (the verifier holds the lease).
    store.verifyTask(a.id, "w");
    store.renewLease(a.id, "w", 60_000);
    expect(Date.parse(store.leases(run.id)[0].expiresAt) - Date.parse(now())).toBe(60_000);
    // A non-owner still cannot renew an in-flight task.
    expect(() => store.renewLease(a.id, "intruder")).toThrow(/owned by w, not intruder/);
  });

  it("releases a lease back to ready", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    const released = store.releaseLease(a.id, "w");
    expect(released.state).toBe("ready");
    expect(released.leaseId).toBeNull();
    expect(released.host).toBeNull();
    expect(store.leases(run.id)[0].releasedAt).not.toBeNull();
  });

  it("expires overdue leases, releases them, and fails the running attempt", async () => {
    const { store, advance, now } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w", ttlMs: 1000 });
    store.startTask(a.id, "w");
    advance(5000);
    const expired = store.expireLeases(now());
    expect(expired).toBe(1);
    const task = store.getTask(a.id);
    expect(task?.state).toBe("ready");
    expect(task?.leaseId).toBeNull();
    expect(task?.host).toBeNull();
    expect(store.leases(run.id)[0].releasedAt).not.toBeNull();
    const attempts = store.listAttempts(a.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("failed");
    expect(store.eventsForTask(a.id).some((event) => event.kind === "task.lease_expired")).toBe(true);
  });

  it("keeps expired work terminal-failed when the retry budget is exhausted", async () => {
    const { store, advance, now } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES, maxAttempts: 1 });
    store.leaseTask(a.id, { host: "mac", owner: "w", ttlMs: 1000 });
    store.startTask(a.id, "w");
    advance(5000);
    const expired = store.expireLeases(now());
    expect(expired).toBe(1);
    // One attempt was started; the budget is spent, so the task cannot be
    // reset to ready and must stay terminal-failed.
    const task = store.getTask(a.id);
    expect(task?.state).toBe("failed");
    expect(task?.error).toBe("lease expired");
    expect(task?.completedAt).not.toBeNull();
    expect(task?.leaseId).toBeNull();
    expect(task?.host).toBeNull();
    expect(store.listAttempts(a.id)[0].status).toBe("failed");
    // Terminal: no retry budget remains, so a retry is rejected.
    expect(() => store.retryTask(a.id)).toThrow(/exhausted 1 attempts/);
    // Recovery is idempotent: the released lease is never resurrected.
    expect(store.expireLeases(now())).toBe(0);
  });
});

describe("attempts and retries", () => {
  it("records attempts and closes them on success", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    store.startTask(a.id, "w");
    store.verifyTask(a.id, "w");
    store.succeedTask(a.id, "w");
    const attempts = store.listAttempts(a.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ index: 1, status: "succeeded", error: null });
    expect(attempts[0].endedAt).not.toBeNull();
    expect(store.getTask(a.id)?.attempts).toBe(1);
  });

  it("fails an attempt and retries with a fresh attempt", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES, maxAttempts: 3 });
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    store.startTask(a.id, "w");
    const failed = store.failTask(a.id, "boom", "w");
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("boom");
    expect(store.listAttempts(a.id)[0].status).toBe("failed");

    const retried = store.retryTask(a.id);
    expect(retried.state).toBe("ready");
    expect(retried.error).toBeNull();
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    store.startTask(a.id, "w");
    const attempts = store.listAttempts(a.id);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({ index: 2, status: "running" });
  });
});

describe("file claims", () => {
  it("rejects overlapping claims at creation", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    store.createTask(run.id, { name: "a", resources: RES, claims: ["lib/a.ts"] });
    expect(() => store.createTask(run.id, { name: "b", resources: RES, claims: ["lib/a.ts"] })).toThrow(
      /overlap with other tasks/,
    );
  });

  it("rejects a subdirectory overlap and honors exclusion of the claiming task", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES, claims: ["lib/core"] });
    const b = store.createTask(run.id, { name: "b", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "a-owner" });
    store.leaseTask(b.id, { host: "mac", owner: "b-owner" });
    expect(() => store.claimFiles(b.id, ["lib/core/inner.ts"], "b-owner")).toThrow(/overlap with other tasks/);
    const claimed = store.claimFiles(a.id, ["lib/core"], "a-owner");
    expect(claimed.claims).toEqual(["lib/core"]);
  });

  it("releases claims on success and on explicit release", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES, claims: ["lib/x.ts", "lib/y.ts"] });
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    const released = store.releaseClaims(a.id, "w");
    expect(released.claims).toEqual([]);
    expect(store.conflictingClaims(["lib/x.ts"])).toEqual([]);

    const b = store.createTask(run.id, { name: "b", resources: RES, claims: ["lib/z.ts"] });
    store.leaseTask(b.id, { host: "mac", owner: "w" });
    store.startTask(b.id, "w");
    store.verifyTask(b.id, "w");
    store.succeedTask(b.id, "w");
    expect(store.getTask(b.id)?.claims).toEqual([]);
    expect(store.conflictingClaims(["lib/z.ts"])).toEqual([]);
  });

  it("rejects alias-equivalent claims via shared canonicalization", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    store.createTask(run.id, { name: "a", resources: RES, claims: ["lib/a.ts"] });
    // Backslash and repeated separators alias the same canonical path.
    expect(() => store.createTask(run.id, { name: "b", resources: RES, claims: ["lib\\a.ts"] })).toThrow(
      /overlap with other tasks/,
    );
    expect(() => store.createTask(run.id, { name: "c", resources: RES, claims: ["lib//a.ts"] })).toThrow(
      /overlap with other tasks/,
    );
    // A dot segment is dropped by the canonicalizer, so it still overlaps.
    const d = store.createTask(run.id, { name: "d", resources: RES });
    store.leaseTask(d.id, { host: "mac", owner: "w" });
    expect(() => store.claimFiles(d.id, ["lib/./a.ts"], "w")).toThrow(/overlap with other tasks/);
  });
});

describe("artifacts", () => {
  it("stores path and body artifacts and lists them per task", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    const pathArtifact = store.addArtifact(a.id, { kind: "code", path: "lib/a.ts", body: "export const a = 1;" }, "w");
    const bodyArtifact = store.addArtifact(a.id, { kind: "notes", body: "no path here" }, "w");
    expect(pathArtifact).toMatchObject({ taskId: a.id, kind: "code", path: "lib/a.ts" });
    expect(bodyArtifact).toMatchObject({ kind: "notes", path: null, body: "no path here" });
    expect(store.getArtifact(pathArtifact.id)?.body).toBe("export const a = 1;");
    const listed = store.listArtifacts(a.id);
    expect(listed.map((artifact) => artifact.kind)).toEqual(["code", "notes"]);
    expect(() => store.addArtifact(a.id, { kind: "   " }, "w")).toThrow(/kind/);
  });
});

describe("events (JSONL, no orchestration_events table)", () => {
  it("appends ordered events to the JSONL log scoped to run and task", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    store.startTask(a.id, "w");
    store.verifyTask(a.id, "w");
    store.succeedTask(a.id, "w");

    expect(existsSync(logPath(run.issueId))).toBe(true);
    const events = store.events(run.id);
    expect(events.map((event) => event.kind)).toEqual([
      "run.created",
      "task.created",
      "task.leased",
      "task.started",
      "attempt.started",
      "task.verifying",
      "task.lease_released",
      "task.succeeded",
    ]);
    events.forEach((event, index) => {
      expect(event.seq).toBe(index + 1);
    });
    const taskEvents = store.eventsForTask(a.id);
    expect(taskEvents.length).toBeGreaterThan(0);
    expect(taskEvents.every((event) => event.taskId === a.id)).toBe(true);
  });

  it("never creates an orchestration_events table", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    store.createTask(run.id, { name: "a", resources: RES });
    const { orchestrationConnection } = await import("../lib/foundry/store");
    const tables = orchestrationConnection()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((row) => row.name);
    expect(names).not.toContain("orchestration_events");
    expect(names).toContain("orchestration_runs");
  });
});

describe("durability across store instances", () => {
  it("recovers runs, tasks, attempts, leases, claims, artifacts, and events from a new instance", async () => {
    const { store, other } = await makeCtx();
    const run = makeRun(store, "durable");
    const a = store.createTask(run.id, { name: "a", resources: RES });
    const b = store.createTask(run.id, { name: "b", deps: [a.id], resources: RES, claims: ["lib/x.ts"] });
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    store.addArtifact(a.id, { kind: "code", path: "lib/a.ts", body: "export const a = 1;" }, "w");
    store.startTask(a.id, "w");
    store.verifyTask(a.id, "w");
    store.succeedTask(a.id, "w");
    store.leaseTask(b.id, { host: "mac", owner: "w" });
    store.startTask(b.id, "w");

    // A brand-new instance over the same database sees every entity.
    expect(other.getRun(run.id)).toMatchObject({ issueId: "issue-durable", stage: "research", status: "active" });
    const tasks = other.listTasks(run.id);
    const a2 = tasks.find((task) => task.id === a.id);
    const b2 = tasks.find((task) => task.id === b.id);
    expect(a2?.state).toBe("succeeded");
    expect(b2?.state).toBe("running");
    expect(b2?.claims).toEqual(["lib/x.ts"]);
    expect(other.listAttempts(a.id)[0].status).toBe("succeeded");
    expect(other.listAttempts(b.id)[0].status).toBe("running");
    const artifacts = other.listArtifacts(a.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "code", path: "lib/a.ts" });
    const leases = other.leases(run.id);
    expect(leases).toHaveLength(2);
    expect(leases.some((lease) => lease.taskId === b.id && lease.releasedAt === null)).toBe(true);
    expect(leases.some((lease) => lease.taskId === a.id && lease.releasedAt !== null)).toBe(true);
    expect(other.events(run.id).length).toBeGreaterThan(0);

    // The new instance can finish the recovered run end to end.
    other.verifyTask(b.id, "w");
    other.succeedTask(b.id, "w");
    const done = other.completeRun(run.id, "succeeded");
    expect(done.status).toBe("succeeded");
  });
});

describe("dependency unblocking", () => {
  it("keeps dependents blocked until deps succeed, then cascades", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    const b = store.createTask(run.id, { name: "b", deps: [a.id], resources: RES });
    const c = store.createTask(run.id, { name: "c", deps: [b.id], resources: RES });
    expect(store.getTask(b.id)?.state).toBe("blocked");
    expect(store.getTask(c.id)?.state).toBe("blocked");

    store.leaseTask(a.id, { host: "mac", owner: "w" });
    store.startTask(a.id, "w");
    store.verifyTask(a.id, "w");
    store.succeedTask(a.id, "w");
    expect(store.getTask(b.id)?.state).toBe("ready");
    expect(store.getTask(c.id)?.state).toBe("blocked");

    store.leaseTask(b.id, { host: "mac", owner: "w" });
    store.startTask(b.id, "w");
    store.verifyTask(b.id, "w");
    store.succeedTask(b.id, "w");
    expect(store.getTask(c.id)?.state).toBe("ready");
    expect(store.events(run.id).filter((event) => event.kind === "task.unblocked").length).toBeGreaterThanOrEqual(2);
  });

  it("guards explicit unblock and auto-unblocks dependents on dep success", async () => {
    const { store } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    const b = store.createTask(run.id, { name: "b", deps: [a.id], resources: RES });
    expect(store.getTask(b.id)?.state).toBe("blocked");
    // Unblocking with unsatisfied deps is rejected.
    expect(() => store.unblock(b.id)).toThrow(/cannot be unblocked; unsatisfied deps/);
    // Unblocking a task that is not blocked is rejected.
    expect(() => store.unblock(a.id)).toThrow(/only blocked tasks can be unblocked/);
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    store.startTask(a.id, "w");
    store.verifyTask(a.id, "w");
    store.succeedTask(a.id, "w");
    // Dep success auto-unblocks b; it is already ready, so explicit unblock
    // is now rejected as a non-blocked task.
    expect(store.getTask(b.id)?.state).toBe("ready");
    expect(() => store.unblock(b.id)).toThrow(/only blocked tasks can be unblocked/);
  });
});

describe("stale version writes", () => {
  it("rejects stale or foreign owners at every mutation boundary", async () => {
    const { store, advance } = await makeCtx();
    const run = makeRun(store);
    const task = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(task.id, { host: "mac", owner: "owner" });
    expect(() => store.claimFiles(task.id, ["lib/a.ts"], "foreign")).toThrow(/owned by owner/);
    expect(() => store.addArtifact(task.id, { kind: "code", body: "x" }, "foreign")).toThrow(/owned by owner/);
    advance(5 * 60 * 1000 + 1);
    expect(() => store.releaseClaims(task.id, "owner")).toThrow(/expired/);
  });

  it("fails a run completion when the run changed since read", async () => {
    const { store, other } = await makeCtx();
    const run = makeRun(store);
    const a = store.createTask(run.id, { name: "a", resources: RES });
    store.leaseTask(a.id, { host: "mac", owner: "w" });
    store.startTask(a.id, "w");
    store.verifyTask(a.id, "w");
    store.succeedTask(a.id, "w");
    const done = other.completeRun(run.id, "succeeded");
    expect(done.status).toBe("succeeded");
    expect(() => store.completeRun(run.id, "succeeded")).toThrow(/already succeeded/);
  });
});
