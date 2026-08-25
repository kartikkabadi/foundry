/**
 * Focused behavioral proof for the durable SQLite supervisor store and the
 * production runtime seam.
 *
 * Uses two independent SQLite connections to the same file to prove the
 * singleton lease is a real cross-connection compare-and-set (only one
 * supervisor acquires and runs), that an expired lease is reclaimable by a
 * second connection, that release and renewal stay owner-fenced, and that a
 * terminal tick id is recorded exactly once and replays as a durable no-op.
 *
 * Also proves the production seam derives the tick's AuthorityProfile from
 * the durable control's `authority` field exactly (observe -> observe only;
 * build -> observe+build; publish -> observe+build+publish), never accepts an
 * injected profile, and that the supervisor itself still cannot publish.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultSupervisorPolicy,
  leaseExpiryAt,
  type SupervisorLease,
  type SupervisorTickEvent,
} from "../lib/foundry/automation-supervisor";
import {
  isAuthorityGranted,
} from "../lib/foundry/authority";
import type { AutomationRuntimeEffects } from "../lib/foundry/automation-runtime";
import type { AutomationIntentOutcome } from "../lib/foundry/automation-driver";
import type { UnattendedSnapshot } from "../lib/foundry/unattended";
import type { Issue } from "../lib/foundry/types";
import { dbPath } from "../lib/foundry/paths";

// Fixed base clock so lease expiry / takeover arithmetic is deterministic.
const NOW = new Date(Date.UTC(2026, 7, 25, 0, 0, 0)).toISOString();

let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "foundry-supervisor-store-"));
  process.env.FOUNDRY_DATA = join(dataDir, "data");
  // store.ts holds a module-level SQLite `db` singleton; a fresh module
  // instance (after vi.resetModules) is what simulates a new connection and
  // proves rows really persisted to disk rather than to a shared cache.
  vi.resetModules();
});

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// Dynamic import is deliberate: see beforeEach.
async function loadStoreModule() {
  return import("../lib/foundry/store");
}

function testClock(start = NOW) {
  let t = Date.parse(start);
  return {
    now: () => new Date(t).toISOString(),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A second independent connection to the same SQLite file. */
function secondConnection(): DatabaseSync {
  const conn = new DatabaseSync(dbPath());
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA busy_timeout = 5000");
  return conn;
}

function makeLease(id: string, owner: string, tickId: string, at: string, ttlMs = 60_000): SupervisorLease {
  return {
    id,
    owner,
    tickId,
    acquiredAt: at,
    expiresAt: leaseExpiryAt(at, ttlMs),
    releasedAt: null,
  };
}

function makeIssue(overrides: Partial<Issue> & { id: string }): Issue {
  return {
    idea: "example idea",
    targetUrl: "https://example.com/repo",
    size: "m",
    currentStage: "research",
    runMode: "hitl",
    walkHold: false,
    oneshotStopReason: null,
    projectId: "project-1",
    cycleId: null,
    moduleId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSnapshot(overrides: { id: string } & Partial<UnattendedSnapshot> = { id: "issue-1" }): UnattendedSnapshot {
  return {
    issue: makeIssue({ id: overrides.id }),
    activeJob: false,
    oneshotWalking: false,
    walkHold: false,
    grillHold: false,
    unresolvedDependencies: false,
    humanGate: false,
    allowedTarget: true,
    ...overrides,
  };
}

function recordingEffects(overrides: Partial<AutomationRuntimeEffects> = {}) {
  const startedIssues: string[] = [];
  const startedCandidates: string[] = [];
  const audited: AutomationIntentOutcome[] = [];
  const effects: AutomationRuntimeEffects = {
    startIssue: (issueId) => {
      startedIssues.push(issueId);
    },
    startImprovement: (candidateId) => {
      startedCandidates.push(candidateId);
    },
    audit: (outcome) => {
      audited.push(outcome);
    },
    ...overrides,
  };
  return { effects, startedIssues, startedCandidates, audited };
}

function createDeferred<T = void>() {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------------------
// Authority derivation from durable control
// ---------------------------------------------------------------------------

describe("supervisorAuthorityProfileFromControl — exhaustive mapping", () => {
  it("observe grants observe only; build and publish stay denied", async () => {
    const { supervisorAuthorityProfileFromControl } = await loadStoreModule();
    const profile = supervisorAuthorityProfileFromControl("observe", NOW);
    expect(profile.kind).toBe("authority-profile");
    expect(isAuthorityGranted(profile, "observe")).toBe(true);
    expect(isAuthorityGranted(profile, "build")).toBe(false);
    expect(isAuthorityGranted(profile, "publish")).toBe(false);
  });

  it("build grants observe and build; publish stays denied", async () => {
    const { supervisorAuthorityProfileFromControl } = await loadStoreModule();
    const profile = supervisorAuthorityProfileFromControl("build", NOW);
    expect(isAuthorityGranted(profile, "observe")).toBe(true);
    expect(isAuthorityGranted(profile, "build")).toBe(true);
    expect(isAuthorityGranted(profile, "publish")).toBe(false);
  });

  it("publish grants observe, build, and publish", async () => {
    const { supervisorAuthorityProfileFromControl } = await loadStoreModule();
    const profile = supervisorAuthorityProfileFromControl("publish", NOW);
    expect(isAuthorityGranted(profile, "observe")).toBe(true);
    expect(isAuthorityGranted(profile, "build")).toBe(true);
    expect(isAuthorityGranted(profile, "publish")).toBe(true);
  });

  it("every denial is explicit with a recorded reason; grants name the durable source", async () => {
    const { supervisorAuthorityProfileFromControl } = await loadStoreModule();
    const profile = supervisorAuthorityProfileFromControl("observe", NOW);
    expect(profile.decisions.build.kind).toBe("denied");
    expect(profile.decisions.build.reason).toBe("no authority granted by default");
    expect(profile.decisions.publish.kind).toBe("denied");
    // The grant reason names the durable control authority as the source, so
    // the profile is derived, never injected.
    expect(profile.decisions.observe.reason).toBe("derived from durable control authority observe");
  });

  it("derives a versioned profile stamped at the given time", async () => {
    const { supervisorAuthorityProfileFromControl } = await loadStoreModule();
    const profile = supervisorAuthorityProfileFromControl("publish", NOW);
    expect(profile.updatedAt).toBe(NOW);
    expect(profile.version).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Durable store: singleton lease CAS across two connections
// ---------------------------------------------------------------------------

describe("durable supervisor store — lease CAS across connections", () => {
  it("acquire is a cross-connection singleton CAS", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const storeA = store.createSupervisorStore({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const storeB = store.createSupervisorStore({ now: clockRef.now, connection: connB });

      const leaseA = makeLease("lease:1", "A", "tick-1", clockRef.now());
      expect(storeA.acquireLease(leaseA)).toBe(true);
      // The lease persisted to disk: a fresh connection sees it.
      expect(storeB.getLease()).toEqual(leaseA);

      // A second acquire from either connection fails while the lease is held.
      const leaseB = makeLease("lease:2", "B", "tick-2", clockRef.now());
      expect(storeB.acquireLease(leaseB)).toBe(false);
      expect(storeA.acquireLease(leaseB)).toBe(false);

      // Releasing opens the row again for the next acquirer.
      expect(storeA.releaseLease("lease:1", "A")).toBe(true);
      expect(storeB.acquireLease(leaseB)).toBe(true);
      expect(storeB.getLease()?.owner).toBe("B");
    } finally {
      connB.close();
    }
  });

  it("an expired lease is reclaimable by a second connection; release stays owner-fenced", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const storeA = store.createSupervisorStore({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const storeB = store.createSupervisorStore({ now: clockRef.now, connection: connB });

      const leaseA = makeLease("lease:1", "A", "tick-1", clockRef.now());
      expect(storeA.acquireLease(leaseA)).toBe(true);

      // Expire the lease by advancing the shared clock past the TTL.
      clockRef.advance(60_001);
      // Takeover names the observed (expired) lease id and installs a fresh
      // replacement lease with its own id.
      const leaseB = makeLease("lease:B", "B", "tick-1", clockRef.now());
      expect(storeB.takeOverLease("lease:1", leaseB)).toBe(true);
      expect(storeB.getLease()).toEqual({ ...leaseB, releasedAt: null });

      // The old owner's release is fenced out: A no longer owns the row.
      expect(storeA.releaseLease("lease:1", "A")).toBe(false);
      // The new owner can release its own lease identity.
      expect(storeB.releaseLease("lease:B", "B")).toBe(true);

      // A released row is never a takeover target; it is re-acquired instead.
      expect(storeA.takeOverLease("lease:B", makeLease("lease:A2", "A", "tick-2", clockRef.now()))).toBe(false);
      expect(storeA.acquireLease(makeLease("lease:A2", "A", "tick-2", clockRef.now()))).toBe(true);
    } finally {
      connB.close();
    }
  });

  it("a stale expected lease id cannot overwrite a newer lease (takeover race)", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const storeA = store.createSupervisorStore({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const storeB = store.createSupervisorStore({ now: clockRef.now, connection: connB });

      // A holds an expired lease; B observes it (stale snapshot).
      const leaseA = makeLease("lease:1", "A", "tick-1", clockRef.now());
      expect(storeA.acquireLease(leaseA)).toBe(true);
      clockRef.advance(60_001);

      // Before B's takeover lands, a third party takes over with a fresh id.
      const leaseC = makeLease("lease:C", "C", "tick-1", clockRef.now());
      expect(storeB.takeOverLease("lease:1", leaseC)).toBe(true);

      // B's stale takeover (still keyed on the observed "lease:1") must fail:
      // the row no longer matches the expected identity, so it can never
      // clobber the newer lease.
      const leaseB = makeLease("lease:B", "B", "tick-1", clockRef.now());
      expect(storeB.takeOverLease("lease:1", leaseB)).toBe(false);
      expect(storeB.getLease()).toEqual({ ...leaseC, releasedAt: null });
    } finally {
      connB.close();
    }
  });

  it("renew is an owner-fenced CAS visible across connections", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const storeA = store.createSupervisorStore({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const storeB = store.createSupervisorStore({ now: clockRef.now, connection: connB });

      const leaseA = makeLease("lease:1", "A", "tick-1", clockRef.now());
      expect(storeA.acquireLease(leaseA)).toBe(true);

      // A non-owner cannot renew.
      expect(storeB.renewLease("lease:1", "B", leaseExpiryAt(clockRef.now(), 120_000))).toBe(false);

      // The owner renews; the new expiry is visible on the other connection.
      const renewed = leaseExpiryAt(clockRef.now(), 120_000);
      expect(storeA.renewLease("lease:1", "A", renewed)).toBe(true);
      expect(storeB.getLease()?.expiresAt).toBe(renewed);
    } finally {
      connB.close();
    }
  });

  it("renew rejects an already-expired lease; a fenced owner cannot revive it (expiry race)", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const storeA = store.createSupervisorStore({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const storeB = store.createSupervisorStore({ now: clockRef.now, connection: connB });

      const leaseA = makeLease("lease:1", "A", "tick-1", clockRef.now());
      expect(storeA.acquireLease(leaseA)).toBe(true);

      // The lease expires while A is away; the takeover window is open.
      clockRef.advance(60_001);

      // A's own renewal now fails: an expired lease is never renewable, so a
      // fenced owner cannot revive it after the expiry/takeover window opens.
      expect(storeA.renewLease("lease:1", "A", leaseExpiryAt(clockRef.now(), 120_000))).toBe(false);

      // B takes over the expired lease and then renews its own fresh lease.
      const leaseB = makeLease("lease:B", "B", "tick-1", clockRef.now());
      expect(storeB.takeOverLease("lease:1", leaseB)).toBe(true);
      expect(storeB.renewLease("lease:B", "B", leaseExpiryAt(clockRef.now(), 120_000))).toBe(true);

      // A's late renewal still fails: the row now carries B's identity.
      expect(storeA.renewLease("lease:1", "A", leaseExpiryAt(clockRef.now(), 120_000))).toBe(false);
      expect(storeB.getLease()?.owner).toBe("B");
    } finally {
      connB.close();
    }
  });

  it("a terminal tick id is recorded exactly once and is replay-safe across connections", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const storeA = store.createSupervisorStore({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const storeB = store.createSupervisorStore({ now: clockRef.now, connection: connB });

      const event: SupervisorTickEvent = {
        kind: "tick",
        tickId: "tick-1",
        owner: "A",
        outcome: "ran",
        reason: "pass ran",
        at: clockRef.now(),
        previousOwner: null,
      };
      storeA.recordTick(event);
      expect(storeA.isTickRecorded("tick-1")).toBe(true);
      expect(storeB.isTickRecorded("tick-1")).toBe(true);
      expect(storeB.isTickRecorded("tick-2")).toBe(false);

      // A duplicate terminal write is a durable no-op (INSERT OR IGNORE): the
      // first writer's outcome wins and the ledger stays single-row.
      storeB.recordTick({ ...event, owner: "B", outcome: "failed", reason: "replayed" });
      const rows = connB
        .prepare("SELECT owner, outcome, reason FROM supervisor_ticks WHERE tick_id = ?")
        .all("tick-1") as Array<{ owner: string; outcome: string; reason: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ owner: "A", outcome: "ran", reason: "pass ran" });
    } finally {
      connB.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Production seam: authority derived from durable control, integration proof
// ---------------------------------------------------------------------------

async function runtimeHarness(authority: "observe" | "build" | "publish") {
  const store = await loadStoreModule();
  const clockRef = testClock();
  const control = store.createAutomationControlStore({ now: clockRef.now });
  // The durable control row is the single source of the authority; enable it
  // so the runtime's own fail-closed gate does not mask the authority test.
  control.update({ authority, enabled: true }, 1);
  const runtime = store.createSupervisorRuntime({ now: clockRef.now });
  const rec = recordingEffects();
  const policy = { ...defaultSupervisorPolicy(), enabled: true, renewDuringPass: false };
  const state = { snapshots: [makeSnapshot()], candidates: [] };
  return { store, clockRef, control, runtime, rec, policy, state };
}

describe("production seam — authority derived from durable control", () => {
  it("observe control denies the default supervisor build scope; no pass runs", async () => {
    const h = await runtimeHarness("observe");
    const result = await h.runtime.tick({
      tickId: "tick-1",
      owner: "A",
      policy: h.policy,
      control: h.control,
      state: h.state,
      effects: h.rec.effects,
    });
    expect(result.outcome).toBe("denied");
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/build/);
    // The pass never ran: no issue was started.
    expect(h.rec.startedIssues).toHaveLength(0);
    // The denial is durable.
    expect(h.runtime.store.isTickRecorded("tick-1")).toBe(true);
  });

  it("build control permits the default pass; one issue starts and the tick runs", async () => {
    const h = await runtimeHarness("build");
    const result = await h.runtime.tick({
      tickId: "tick-1",
      owner: "A",
      policy: h.policy,
      control: h.control,
      state: h.state,
      effects: h.rec.effects,
    });
    expect(result.outcome).toBe("ran");
    expect(result.ran).toBe(true);
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    expect(h.runtime.store.isTickRecorded("tick-1")).toBe(true);
    // The pass released its own lease (owner-fenced best-effort release).
    expect(h.runtime.store.getLease()?.releasedAt).not.toBeNull();
  });

  it("publish control adds publication scope, but the supervisor itself cannot publish", async () => {
    const h = await runtimeHarness("publish");
    // The derived profile for publish grants observe+build+publish.
    const profile = h.store.supervisorAuthorityProfileFromControl("publish", h.clockRef.now());
    expect(isAuthorityGranted(profile, "publish")).toBe(true);
    expect(isAuthorityGranted(profile, "build")).toBe(true);

    // The runtime effects surface has no publish capability at all.
    expect(Object.keys(h.rec.effects).sort()).toEqual(["audit", "startImprovement", "startIssue"]);

    const result = await h.runtime.tick({
      tickId: "tick-1",
      owner: "A",
      policy: h.policy,
      control: h.control,
      state: h.state,
      effects: h.rec.effects,
    });
    expect(result.outcome).toBe("ran");
    // The pass started the issue and never published anything.
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    expect(h.rec.startedCandidates).toHaveLength(0);
    expect(h.rec.audited.some((outcome) => outcome.kind === "start-issue")).toBe(true);
  });

  it("two runtimes on two connections: only one acquires and runs; the loser is busy; replay is a no-op", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const control = store.createAutomationControlStore({ now: clockRef.now });
    control.update({ authority: "build", enabled: true }, 1);
    const runtimeA = store.createSupervisorRuntime({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const runtimeB = store.createSupervisorRuntime({ now: clockRef.now, connection: connB });
      const policy = { ...defaultSupervisorPolicy(), enabled: true, renewDuringPass: false };
      const state = { snapshots: [makeSnapshot()], candidates: [] };

      // A's pass blocks on the audit sink so it stays in-flight while B ticks.
      const deferred = createDeferred<void>();
      const startedA: string[] = [];
      const effectsA: AutomationRuntimeEffects = {
        startIssue: (issueId) => {
          startedA.push(issueId);
        },
        audit: () => deferred.promise,
      };
      const aPromise = runtimeA.tick({
        tickId: "tick-1",
        owner: "A",
        policy,
        control,
        state,
        effects: effectsA,
      });

      // Wait until A's pass is in-flight (startIssue fired) — its lease is held.
      await waitFor(() => startedA.length === 1);

      // B, on a different connection, sees the same-tick lease and is busy.
      const recB = recordingEffects();
      const bResult = await runtimeB.tick({
        tickId: "tick-1",
        owner: "B",
        policy,
        control,
        state,
        effects: recB.effects,
      });
      expect(bResult.outcome).toBe("busy");
      expect(bResult.ran).toBe(false);
      // Busy is nonterminal: B recorded nothing and started nothing.
      expect(recB.startedIssues).toHaveLength(0);

      // A's pass still runs and completes: exactly one start, one terminal outcome.
      expect(startedA).toEqual(["issue-1"]);
      deferred.resolve();
      const aResult = await aPromise;
      expect(aResult.outcome).toBe("ran");
      expect(startedA).toEqual(["issue-1"]);
      expect(runtimeA.store.isTickRecorded("tick-1")).toBe(true);

      // Replaying the completed tick id is a durable no-op: duplicate-tick.
      const recReplay = recordingEffects();
      const replay = await runtimeB.tick({
        tickId: "tick-1",
        owner: "B",
        policy,
        control,
        state,
        effects: recReplay.effects,
      });
      expect(replay.outcome).toBe("duplicate-tick");
      expect(recReplay.startedIssues).toHaveLength(0);
    } finally {
      connB.close();
    }
  });

  it("a crashed supervisor's expired lease lets a second connection run the same tick", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const control = store.createAutomationControlStore({ now: clockRef.now });
    control.update({ authority: "build", enabled: true }, 1);
    const runtimeA = store.createSupervisorRuntime({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const runtimeB = store.createSupervisorRuntime({ now: clockRef.now, connection: connB });
      const policy = { ...defaultSupervisorPolicy(), enabled: true, renewDuringPass: false };
      const state = { snapshots: [makeSnapshot()], candidates: [] };

      // A acquires the lease for tick-1 but "crashes" before running (no release).
      const leaseA = makeLease("lease:1", "A", "tick-1", clockRef.now());
      expect(runtimeA.store.acquireLease(leaseA)).toBe(true);
      expect(runtimeA.store.isTickRecorded("tick-1")).toBe(false);

      // The lease expires while A is gone.
      clockRef.advance(60_001);

      // B reclaims the expired lease and runs the same tick.
      const recB = recordingEffects();
      const result = await runtimeB.tick({
        tickId: "tick-1",
        owner: "B",
        policy,
        control,
        state,
        effects: recB.effects,
      });
      expect(result.outcome).toBe("ran");
      expect(result.previousOwner).toBe("A");
      expect(recB.startedIssues).toEqual(["issue-1"]);
      expect(runtimeB.store.getLease()?.owner).toBe("B");
      expect(runtimeB.store.isTickRecorded("tick-1")).toBe(true);
    } finally {
      connB.close();
    }
  });

  it("a stale owner whose lease was taken over mid-pass performs no mutation and never records ran", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const control = store.createAutomationControlStore({ now: clockRef.now });
    control.update({ authority: "build", enabled: true }, 1);
    const runtimeA = store.createSupervisorRuntime({ now: clockRef.now });
    const connB = secondConnection();
    try {
      const runtimeB = store.createSupervisorRuntime({ now: clockRef.now, connection: connB });
      const policy = { ...defaultSupervisorPolicy(), enabled: true, renewDuringPass: false };
      const state = { snapshots: [makeSnapshot()], candidates: [] };

      // A's pass blocks inside startIssue BEFORE its durable mutation (the
      // guard sits between the await and the mutation).
      const gate = createDeferred<void>();
      const entered: { current: boolean } = { current: false };
      const startedA: string[] = [];
      const effectsA: AutomationRuntimeEffects = {
        startIssue: async (issueId, guard) => {
          entered.current = true;
          await gate.promise;
          // A's durable mutation is guarded: it only happens while A still
          // owns the lease. The lease is B's now, so `guard.run` refuses
          // admission and the mutation is never performed.
          guard.run(() => {
            startedA.push(issueId);
          });
        },
        audit: () => {},
      };
      const aPromise = runtimeA.tick({
        tickId: "tick-1",
        owner: "A",
        policy,
        control,
        state,
        effects: effectsA,
      });

      // Wait until A is blocked inside startIssue, holding its lease.
      await waitFor(() => entered.current);

      // A's lease expires while A is blocked.
      clockRef.advance(60_001);

      // B takes over the expired lease and runs the same tick: B's mutation
      // succeeds and B records the terminal outcome (previousOwner = A).
      const recB = recordingEffects();
      const bResult = await runtimeB.tick({
        tickId: "tick-1",
        owner: "B",
        policy,
        control,
        state,
        effects: recB.effects,
      });
      expect(bResult.outcome).toBe("ran");
      expect(bResult.previousOwner).toBe("A");
      expect(recB.startedIssues).toEqual(["issue-1"]);
      expect(runtimeB.store.isTickRecorded("tick-1")).toBe(true);

      // A resumes: its guard refuses admission, so A performs no mutation and
      // its tick is a truthful failure — never ran.
      gate.resolve();
      const aResult = await aPromise;
      expect(aResult.outcome).toBe("failed");
      expect(aResult.ran).toBe(false);
      expect(startedA).toEqual([]);
      // A never clobbered B's lease (release and record are owner-fenced).
      expect(runtimeA.store.getLease()?.owner).toBe("B");
    } finally {
      connB.close();
    }
  });

  it("the seam threads an injected fast sleep so a long pass renews mid-flight", async () => {
    const store = await loadStoreModule();
    const clockRef = testClock();
    const control = store.createAutomationControlStore({ now: clockRef.now });
    control.update({ authority: "build", enabled: true }, 1);
    // The seam supplies the renewal sleep: a real timer by default, or the
    // caller's injected one. Tests inject a fast sleep so no 30s timer keeps
    // the harness alive while still proving the pass renews mid-flight.
    const sleepResolvers: Array<() => void> = [];
    const sleep = () =>
      new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    const runtime = store.createSupervisorRuntime({ now: clockRef.now, sleep });
    // Count mid-pass renewals on the seam's own store to prove the loop
    // actually renews while the pass is blocked, not merely that sleep ran.
    let renewals = 0;
    const renew = runtime.store.renewLease;
    runtime.store.renewLease = (id, owner, expiresAt) => {
      renewals += 1;
      return renew(id, owner, expiresAt);
    };
    const rec = recordingEffects();
    const policy = {
      ...defaultSupervisorPolicy(),
      enabled: true,
      leaseTtlMs: 1000,
      renewDuringPass: true,
    };
    const state = { snapshots: [makeSnapshot()], candidates: [] };
    const gate = createDeferred<void>();
    const tick = runtime.tick({
      tickId: "tick-1",
      owner: "A",
      policy,
      control,
      state,
      effects: {
        ...rec.effects,
        startIssue: async (issueId) => {
          rec.startedIssues.push(issueId);
          await gate.promise;
        },
      },
    });
    // Pre-pass renew already happened (renewal #1); resolve the renewal-loop
    // sleep so the loop renews again mid-pass (renewal #2).
    await waitFor(() => sleepResolvers.length >= 1);
    sleepResolvers.shift()!();
    await waitFor(() => renewals >= 2);
    gate.resolve();
    const result = await tick;
    expect(result.outcome).toBe("ran");
    expect(rec.startedIssues).toEqual(["issue-1"]);
    expect(runtime.store.getLease()?.releasedAt).not.toBeNull();
  });
});
