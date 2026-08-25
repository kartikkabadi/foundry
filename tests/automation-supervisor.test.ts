/**
 * Focused behavioral proof for the durable automation supervisor seam.
 *
 * Drives `runSupervisorTick` against an in-memory durable store double that
 * enforces the same synchronous compare-and-set semantics as the production
 * SQLite adapter (singleton lease, expired-lease takeover, tick ledger), plus
 * fake injected runtime effects. Every claim is about observable behavior:
 * which outcomes were returned, which effects ran, whether the lease was held
 * or released, and whether inputs were mutated. No assertions on source text.
 */

import { describe, expect, it } from "vitest";
import {
  defaultSupervisorPolicy,
  isLeaseExpired,
  isLeaseLive,
  leaseExpiryAt,
  runSupervisorTick,
  SupervisorPolicyError,
  type SupervisorLease,
  type SupervisorStoreAdapter,
  type SupervisorTickEvent,
  type SupervisorTickInput,
  type SupervisorTickOutcome,
} from "../lib/foundry/automation-supervisor";
import {
  AUTHORITY_SCOPES,
  applyAuthorityProfilePatch,
  defaultAuthorityProfile,
  AuthorityProfileValidationError,
  isAuthorityGranted,
  type AuthorityProfile,
} from "../lib/foundry/authority";
import type { AutomationControl, AutomationControlAdapter } from "../lib/foundry/automation-control";
import type { AutomationRuntimeEffects, AutomationRuntimeState } from "../lib/foundry/automation-runtime";
import type { AutomationIntentOutcome } from "../lib/foundry/automation-driver";
import type { UnattendedSnapshot } from "../lib/foundry/unattended";
import type { Issue } from "../lib/foundry/types";

const NOW = "2026-08-25T00:00:00.000Z";

// ---------------------------------------------------------------------------
// In-memory durable store double
// ---------------------------------------------------------------------------

function memoryStore(now: () => string) {
  let lease: SupervisorLease | null = null;
  const recordedTicks = new Set<string>();
  const events: SupervisorTickEvent[] = [];
  const store: SupervisorStoreAdapter = {
    getLease: () => lease,
    acquireLease: (candidate) => {
      if (lease !== null && lease.releasedAt === null) return false;
      lease = candidate;
      return true;
    },
    takeOverLease: (expectedLeaseId, replacementLease) => {
      if (lease === null || lease.id !== expectedLeaseId) return false;
      if (lease.releasedAt !== null) return false;
      if (!isLeaseExpired(lease, now())) return false;
      lease = replacementLease;
      return true;
    },
    renewLease: (id, owner, expiresAt) => {
      if (lease === null || lease.id !== id || lease.owner !== owner) return false;
      if (lease.releasedAt !== null) return false;
      if (isLeaseExpired(lease, now())) return false;
      lease = { ...lease, expiresAt };
      return true;
    },
    isLeaseLive: (id, owner) => {
      if (lease === null || lease.id !== id || lease.owner !== owner) return false;
      if (lease.releasedAt !== null) return false;
      return !isLeaseExpired(lease, now());
    },
    withLiveLease: (id, owner, mutate) => {
      if (lease === null || lease.id !== id || lease.owner !== owner) return { admitted: false } as const;
      if (lease.releasedAt !== null) return { admitted: false } as const;
      if (isLeaseExpired(lease, now())) return { admitted: false } as const;
      return { admitted: true, value: mutate() };
    },
    releaseLease: (id, owner) => {
      if (lease === null || lease.id !== id || lease.owner !== owner) return false;
      lease = { ...lease, releasedAt: now() };
      return true;
    },
    isTickRecorded: (tickId) => recordedTicks.has(tickId),
    recordTick: (event) => {
      recordedTicks.add(event.tickId);
      events.push(event);
    },
  };
  return { store, events, getLease: () => lease, forceLease: (next: SupervisorLease) => { lease = next; } };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function controlAdapter(overrides: Record<string, unknown> = {}): AutomationControlAdapter {
  let current = { ...defaultControl(), ...overrides } as AutomationControl;
  return {
    get: () => current,
    update: (patch, expectedVersion) => {
      if (current.version !== expectedVersion) {
        throw new Error(`stale version: expected ${expectedVersion}, got ${current.version}`);
      }
      current = applyControlPatch(current, patch);
      return current;
    },
  };
}

// The control shape is intentionally kept local so this test file owns no
// store; a disabled control exercises the runtime's own fail-closed gate.
function defaultControl(): AutomationControl {
  return {
    enabled: true,
    authority: "observe",
    operatorHold: false,
    limit: 1,
    maxIterations: 1,
    maxCostUsd: 1,
    perCandidateCeilingUsd: 0.5,
    paidAuthorization: false,
    version: 1,
    updatedAt: NOW,
  };
}
function applyControlPatch(current: AutomationControl, patch: Record<string, unknown>): AutomationControl {
  return { ...current, ...patch, version: current.version + 1, updatedAt: NOW };
}

function grantedAuthority(now: string): AuthorityProfile {
  return applyAuthorityProfilePatch(defaultAuthorityProfile(now), {
    observe: { granted: true, reason: "test grants observe" },
    build: { granted: true, reason: "test grants build" },
  }, now);
}

function recordingEffects(overrides: Partial<AutomationRuntimeEffects> = {}) {
  const startedIssues: string[] = [];
  const startedCandidates: string[] = [];
  const audited: AutomationIntentOutcome[] = [];
  const effects: AutomationRuntimeEffects = {
    startIssue: (issueId, guard) => {
      guard.run(() => {
        startedIssues.push(issueId);
      });
    },
    startImprovement: (candidateId, guard) => {
      guard.run(() => {
        startedCandidates.push(candidateId);
      });
    },
    audit: (outcome) => {
      audited.push(outcome);
    },
    ...overrides,
  };
  return { effects, startedIssues, startedCandidates, audited };
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Shared harness: fresh store, clock, effects, control, and a ready input. */
function harness(overrides: Partial<SupervisorTickInput> = {}) {
  let clock = NOW;
  const now = () => clock;
  const store = memoryStore(now);
  const rec = recordingEffects();
  const control = controlAdapter();
  const authority = grantedAuthority(NOW);
  const policy = { ...defaultSupervisorPolicy(), enabled: true };
  const state = { snapshots: [makeSnapshot()], candidates: [] };
  const input: SupervisorTickInput = {
    tickId: "tick-1",
    owner: "A",
    policy,
    authority,
    control,
    state,
    effects: rec.effects,
    store: store.store,
    now,
    ...overrides,
  };
  return {
    input,
    store,
    rec,
    control,
    now,
    setClock: (value: string) => {
      clock = value;
    },
  };
}

function outcomesOf(h: ReturnType<typeof harness>): SupervisorTickOutcome[] {
  return h.store.events.map((event) => event.outcome);
}

// ---------------------------------------------------------------------------
// Authority model
// ---------------------------------------------------------------------------

describe("authority profile", () => {
  it("defaults fail-closed: every scope denied with a recorded reason", () => {
    const profile = defaultAuthorityProfile(NOW);
    expect(profile.kind).toBe("authority-profile");
    expect(profile.version).toBe(1);
    for (const scope of AUTHORITY_SCOPES) {
      expect(profile.decisions[scope].kind).toBe("denied");
      expect(isAuthorityGranted(profile, scope)).toBe(false);
    }
  });

  it("grants a scope only through an explicit patch that records a reason", () => {
    const profile = applyAuthorityProfilePatch(defaultAuthorityProfile(NOW), {
      observe: { granted: true, reason: "operator enables observation" },
    }, NOW);
    expect(isAuthorityGranted(profile, "observe")).toBe(true);
    expect(profile.decisions.observe).toEqual({
      kind: "granted",
      scope: "observe",
      reason: "operator enables observation",
    });
    expect(isAuthorityGranted(profile, "build")).toBe(false);
    expect(isAuthorityGranted(profile, "publish")).toBe(false);
  });

  it("bumps version and changes only the patched scopes", () => {
    const base = applyAuthorityProfilePatch(defaultAuthorityProfile(NOW), {
      observe: { granted: true, reason: "observe on" },
    }, NOW);
    const next = applyAuthorityProfilePatch(base, {
      publish: { granted: true, reason: "publish on" },
    }, "2026-08-25T00:00:01.000Z");
    expect(next.version).toBe(base.version + 1);
    expect(next.updatedAt).toBe("2026-08-25T00:00:01.000Z");
    expect(next.decisions.observe.kind).toBe("granted");
    expect(next.decisions.build.kind).toBe("denied");
    expect(next.decisions.publish.kind).toBe("granted");
  });

  it("rejects an empty patch and an invalid patch", () => {
    expect(() => applyAuthorityProfilePatch(defaultAuthorityProfile(NOW), {}, NOW)).toThrow(
      AuthorityProfileValidationError,
    );
    expect(() =>
      applyAuthorityProfilePatch(defaultAuthorityProfile(NOW), {
        observe: { granted: "yes" as unknown as boolean, reason: "r" },
      }, NOW),
    ).toThrow(AuthorityProfileValidationError);
    expect(() =>
      applyAuthorityProfilePatch(defaultAuthorityProfile(NOW), {
        observe: { granted: true, reason: "" },
      }, NOW),
    ).toThrow(AuthorityProfileValidationError);
  });

  it("expresses exactly observe, build, and publish — never merge, deploy, clean, self-modify, or gates", () => {
    expect(AUTHORITY_SCOPES).toEqual(["observe", "build", "publish"]);
    const profile = defaultAuthorityProfile(NOW);
    expect(Object.keys(profile.decisions).sort()).toEqual(["build", "observe", "publish"]);
  });
});

// ---------------------------------------------------------------------------
// Supervisor policy
// ---------------------------------------------------------------------------

describe("supervisor policy", () => {
  it("defaults disabled with observe+build required", () => {
    const policy = defaultSupervisorPolicy();
    expect(policy.enabled).toBe(false);
    expect(policy.operatorHold).toBe(false);
    expect(policy.leaseTtlMs).toBeGreaterThan(0);
    expect(policy.requiredScopes).toEqual(["observe", "build"]);
  });

  it("rejects a non-positive lease TTL before any effect", async () => {
    const h = harness({
      policy: { ...defaultSupervisorPolicy(), enabled: true, leaseTtlMs: 0 },
    });
    await expect(runSupervisorTick(h.input)).rejects.toThrow(SupervisorPolicyError);
    expect(h.store.getLease()).toBeNull();
    expect(h.store.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runSupervisorTick
// ---------------------------------------------------------------------------

describe("runSupervisorTick", () => {
  it("disabled inertness: no lease, no pass, audit stop, terminal tick recorded", async () => {
    const h = harness({
      policy: { ...defaultSupervisorPolicy(), enabled: false },
    });
    const result = await runSupervisorTick(h.input);
    expect(result.outcome).toBe("disabled");
    expect(result.ran).toBe(false);
    expect(result.pass).toBeNull();
    expect(h.store.getLease()).toBeNull();
    expect(h.rec.startedIssues).toEqual([]);
    expect(h.rec.audited).toEqual([{ kind: "stop", reason: "automation supervisor disabled by policy" }]);
    expect(h.store.store.isTickRecorded("tick-1")).toBe(true);
  });

  it("operator hold pauses supervision without touching a lease", async () => {
    const h = harness({
      policy: { ...defaultSupervisorPolicy(), enabled: true, operatorHold: true },
    });
    const result = await runSupervisorTick(h.input);
    expect(result.outcome).toBe("held");
    expect(result.ran).toBe(false);
    expect(h.store.getLease()).toBeNull();
    expect(h.rec.audited).toEqual([{ kind: "wait", reason: "automation supervisor held by operator" }]);
  });

  it("authority denied: no pass, no lease, audit stop naming the scope", async () => {
    const h = harness({ authority: defaultAuthorityProfile(NOW) });
    const result = await runSupervisorTick(h.input);
    expect(result.outcome).toBe("denied");
    expect(result.ran).toBe(false);
    expect(h.store.getLease()).toBeNull();
    expect(h.rec.startedIssues).toEqual([]);
    expect(h.rec.audited).toEqual([{ kind: "stop", reason: "authority denied for required scope observe" }]);
  });

  it("runs one bounded pass when enabled and authorized, then releases the lease", async () => {
    const h = harness();
    const result = await runSupervisorTick(h.input);
    expect(result.outcome).toBe("ran");
    expect(result.ran).toBe(true);
    expect(result.pass).not.toBeNull();
    expect(result.pass!.ran).toBe(true);
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    expect(h.store.getLease()!.releasedAt).not.toBeNull();
    expect(h.store.store.isTickRecorded("tick-1")).toBe(true);
  });

  it("records idle when the runtime's own control is disabled despite the supervisor being enabled", async () => {
    const h = harness({ control: controlAdapter({ enabled: false }) });
    const result = await runSupervisorTick(h.input);
    expect(result.outcome).toBe("idle");
    expect(result.ran).toBe(false);
    expect(result.pass).not.toBeNull();
    expect(result.pass!.ran).toBe(false);
    expect(h.rec.startedIssues).toEqual([]);
    expect(h.store.getLease()!.releasedAt).not.toBeNull();
  });

  it("single lease ownership: a second owner is lease-held and cannot run", async () => {
    const h = harness();
    const liveLease: SupervisorLease = {
      id: "lease:live",
      owner: "A",
      tickId: "tick-1",
      acquiredAt: NOW,
      expiresAt: "2026-08-25T00:00:30.000Z",
      releasedAt: null,
    };
    expect(h.store.store.acquireLease(liveLease)).toBe(true);
    const result = await runSupervisorTick({ ...h.input, tickId: "tick-2", owner: "B" });
    expect(result.outcome).toBe("lease-held");
    expect(result.ran).toBe(false);
    expect(h.store.getLease()!.owner).toBe("A");
    expect(h.rec.startedIssues).toEqual([]);
  });

  it("duplicate tick idempotency: the same tickId runs at most one pass", async () => {
    const h = harness();
    const first = await runSupervisorTick(h.input);
    expect(first.outcome).toBe("ran");
    const replay = await runSupervisorTick(h.input);
    expect(replay.outcome).toBe("duplicate-tick");
    expect(replay.ran).toBe(false);
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    expect(outcomesOf(h)).toContain("duplicate-tick");
  });

  it("expired lease takeover: a crashed owner's expired lease is reclaimed by CAS", async () => {
    const h = harness();
    const crashed: SupervisorLease = {
      id: "lease:stale",
      owner: "A",
      tickId: "tick-stale",
      acquiredAt: NOW,
      expiresAt: "2026-08-25T00:00:05.000Z",
      releasedAt: null,
    };
    expect(h.store.store.acquireLease(crashed)).toBe(true);
    h.setClock("2026-08-25T00:00:10.000Z");
    const result = await runSupervisorTick({ ...h.input, tickId: "tick-2", owner: "B" });
    expect(result.outcome).toBe("ran");
    expect(result.ran).toBe(true);
    expect(result.previousOwner).toBe("A");
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    // The takeover is recorded only with the terminal outcome, not before the
    // pass: the durable event carries the reclaimed owner.
    const terminal = h.store.events[h.store.events.length - 1];
    expect(terminal.outcome).toBe("ran");
    expect(terminal.previousOwner).toBe("A");
    expect(h.store.getLease()!.owner).toBe("B");
    expect(h.store.getLease()!.releasedAt).not.toBeNull();
  });

  it("crash restart with the same owner identity reclaims its own expired lease", async () => {
    const h = harness();
    // Instance A acquired a lease, then crashed without releasing it.
    const stale: SupervisorLease = {
      id: "lease:stale",
      owner: "A",
      tickId: "tick-stale",
      acquiredAt: NOW,
      expiresAt: "2026-08-25T00:00:05.000Z",
      releasedAt: null,
    };
    expect(h.store.store.acquireLease(stale)).toBe(true);
    h.setClock("2026-08-25T00:00:10.000Z");
    // The restarted instance A ticks a fresh id; its own expired lease is
    // reclaimed by CAS even though the owner identity matches.
    const result = await runSupervisorTick({ ...h.input, tickId: "tick-2", owner: "A" });
    expect(result.outcome).toBe("ran");
    expect(result.ran).toBe(true);
    expect(result.previousOwner).toBe("A");
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    const terminal = h.store.events[h.store.events.length - 1];
    expect(terminal.outcome).toBe("ran");
    expect(terminal.previousOwner).toBe("A");
    expect(h.store.getLease()!.owner).toBe("A");
    expect(h.store.getLease()!.releasedAt).not.toBeNull();
  });

  it("crash after takeover: no terminal record is written, so replay of the same tick id runs the pass", async () => {
    const h = harness();
    const stale: SupervisorLease = {
      id: "lease:stale",
      owner: "ghost",
      tickId: "tick-stale",
      acquiredAt: NOW,
      expiresAt: "2026-08-25T00:00:05.000Z",
      releasedAt: null,
    };
    expect(h.store.store.acquireLease(stale)).toBe(true);
    h.setClock("2026-08-25T00:00:10.000Z");
    // Tick 1 takes over the stale lease and starts a pass that never returns
    // (the process crashes mid-pass).
    const deferred = createDeferred<void>();
    // The pass is abandoned mid-flight (the process crashes); the returned
    // promise is intentionally never awaited or resolved.
    runSupervisorTick({
      ...h.input,
      tickId: "tick-1",
      owner: "A",
      effects: {
        ...h.rec.effects,
        startIssue: (issueId, guard) => {
          guard.run(() => {
            h.rec.startedIssues.push(issueId);
          });
          return deferred.promise;
        },
      },
    });
    await waitFor(() => h.store.getLease() !== null && h.store.getLease()!.owner === "A");
    // The crash happened after takeover but before completion: the tick id is
    // NOT terminal, so replay is not suppressed by the duplicate-tick gate.
    expect(h.store.store.isTickRecorded("tick-1")).toBe(false);
    // Once the crashed lease expires, replaying the same tick id reclaims it
    // (same owner) and runs the pass.
    h.setClock("2026-08-25T00:01:30.000Z");
    const replay = await runSupervisorTick({ ...h.input, tickId: "tick-1", owner: "A" });
    expect(replay.outcome).toBe("ran");
    expect(replay.ran).toBe(true);
    expect(replay.previousOwner).toBe("A");
    // Two pass attempts: the crashed one and the replay that recovered it.
    expect(h.rec.startedIssues).toEqual(["issue-1", "issue-1"]);
    expect(h.store.store.isTickRecorded("tick-1")).toBe(true);
    const terminal = h.store.events[h.store.events.length - 1];
    expect(terminal.outcome).toBe("ran");
    expect(terminal.previousOwner).toBe("A");
  });

  it("at-least-once redelivery: a same-tick busy replay is nonterminal and recovery still runs", async () => {
    const h = harness();
    const deferred = createDeferred<void>();
    // Instance A is actively running tick-1 (pass in flight, lease held).
    runSupervisorTick({
      ...h.input,
      tickId: "tick-1",
      owner: "A",
      effects: {
        ...h.rec.effects,
        startIssue: (issueId, guard) => {
          guard.run(() => {
            h.rec.startedIssues.push(issueId);
          });
          return deferred.promise;
        },
      },
    });
    await waitFor(() => h.store.getLease() !== null && h.store.getLease()!.owner === "A");
    // A redelivered copy of the same tick-1 while it is active: busy, and NOT
    // recorded, so the tick id stays eligible for replay.
    const redelivery = await runSupervisorTick({ ...h.input, tickId: "tick-1", owner: "A" });
    expect(redelivery.outcome).toBe("busy");
    expect(redelivery.ran).toBe(false);
    expect(h.store.store.isTickRecorded("tick-1")).toBe(false);
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    // The active pass crashes (abandoned); once its lease expires, replaying
    // the same tick id recovers and runs the pass.
    h.setClock("2026-08-25T00:01:30.000Z");
    const replay = await runSupervisorTick({ ...h.input, tickId: "tick-1", owner: "A" });
    expect(replay.outcome).toBe("ran");
    expect(replay.ran).toBe(true);
    expect(h.rec.startedIssues).toEqual(["issue-1", "issue-1"]);
    expect(h.store.store.isTickRecorded("tick-1")).toBe(true);
  });

  it("renewLease returning false mid-pass aborts the pass as failed; release stays owner-fenced", async () => {
    const h = harness();
    const deferred = createDeferred<void>();
    let renewals = 0;
    const renew = h.store.store.renewLease;
    h.store.store.renewLease = (id, owner, expiresAt) => {
      renewals += 1;
      // Renewal #1 is the pre-pass renew; #2 is the first loop renewal; #3 is
      // the second loop renewal, at which point another supervisor's CAS wins.
      if (renewals >= 3) {
        const current = h.store.getLease();
        if (current === null) {
          throw new Error("expected a held lease before the takeover");
        }
        h.store.forceLease({ ...current, owner: "B", tickId: "tick-other" });
        return false;
      }
      return renew(id, owner, expiresAt);
    };
    const sleepResolvers: Array<() => void> = [];
    const sleep = () =>
      new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    const tick = runSupervisorTick({
      ...h.input,
      policy: { ...h.input.policy, leaseTtlMs: 1000 },
      effects: {
        ...h.rec.effects,
        startIssue: (issueId, guard) => {
          guard.run(() => {
            h.rec.startedIssues.push(issueId);
          });
          return deferred.promise;
        },
      },
      sleep,
    });
    await waitFor(() => h.store.getLease() !== null);
    expect(sleepResolvers.length).toBeGreaterThanOrEqual(1);
    sleepResolvers.shift()!();
    await waitFor(() => renewals >= 2);
    sleepResolvers.shift()!();
    const result = await tick;
    expect(result.outcome).toBe("failed");
    expect(result.ran).toBe(false);
    expect(result.error).toContain("lease");
    // The pass started one issue before the lease was lost and no second pass
    // succeeded: no overlapping success.
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    const terminal = h.store.events[h.store.events.length - 1];
    expect(terminal.outcome).toBe("failed");
    // The failed tick's finalization is owner-fenced: B's lease is untouched.
    expect(h.store.getLease()!.owner).toBe("B");
    expect(h.store.getLease()!.releasedAt).toBeNull();
  });

  it("renewLease throwing mid-pass aborts as failed with no unhandled rejection", async () => {
    const h = harness();
    const deferred = createDeferred<void>();
    let renewals = 0;
    const renew = h.store.store.renewLease;
    h.store.store.renewLease = (id, owner, expiresAt) => {
      renewals += 1;
      if (renewals >= 3) {
        throw new Error("renewal store crashed");
      }
      return renew(id, owner, expiresAt);
    };
    const sleepResolvers: Array<() => void> = [];
    const sleep = () =>
      new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    const tick = runSupervisorTick({
      ...h.input,
      policy: { ...h.input.policy, leaseTtlMs: 1000 },
      effects: {
        ...h.rec.effects,
        startIssue: (issueId, guard) => {
          guard.run(() => {
            h.rec.startedIssues.push(issueId);
          });
          return deferred.promise;
        },
      },
      sleep,
    });
    await waitFor(() => h.store.getLease() !== null);
    expect(sleepResolvers.length).toBeGreaterThanOrEqual(1);
    sleepResolvers.shift()!();
    await waitFor(() => renewals >= 2);
    sleepResolvers.shift()!();
    const result = await tick;
    expect(result.outcome).toBe("failed");
    expect(result.ran).toBe(false);
    expect(result.error).toContain("renewal store crashed");
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    // The lease was not lost (the store threw, it did not take it over); the
    // owner-fenced release still finalizes it.
    expect(h.store.getLease()!.owner).toBe("A");
    expect(h.store.getLease()!.releasedAt).not.toBeNull();
  });

  it("a lease lost while an effect is blocked aborts before the mutation: failed, never ran", async () => {
    const h = harness();
    const gate = createDeferred<void>();
    const entered: { current: boolean } = { current: false };
    const tick = runSupervisorTick({
      ...h.input,
      effects: {
        ...h.rec.effects,
        startIssue: async (issueId, guard) => {
          entered.current = true;
          await gate.promise;
          // The durable mutation is guarded: it happens only while the lease is
          // still live. The lease was taken over while we blocked, so
          // `guard.run` refuses admission and the mutation is never performed.
          guard.run(() => {
            h.rec.startedIssues.push(issueId);
          });
        },
      },
    });
    await waitFor(() => entered.current);
    // Another supervisor takes the lease over while this pass is blocked.
    const current = h.store.getLease();
    expect(current).not.toBeNull();
    h.store.forceLease({ ...current!, owner: "B", tickId: "tick-other" });
    gate.resolve();
    const result = await tick;
    expect(result.outcome).toBe("failed");
    expect(result.ran).toBe(false);
    expect(result.error).toContain("lease");
    // The guarded mutation never ran.
    expect(h.rec.startedIssues).toEqual([]);
    const terminal = h.store.events[h.store.events.length - 1];
    expect(terminal.outcome).toBe("failed");
    // A's failed finalization never clobbered B's lease.
    expect(h.store.getLease()!.owner).toBe("B");
    expect(h.store.getLease()!.releasedAt).toBeNull();
  });

  it("a lease lost between mutations aborts before the next mutation: failed, never ran", async () => {
    const h = harness();
    const state = {
      snapshots: [makeSnapshot({ id: "issue-1" }), makeSnapshot({ id: "issue-2" })],
      candidates: [],
    };
    const gate = createDeferred<void>();
    const tick = runSupervisorTick({
      ...h.input,
      state,
      effects: {
        ...h.rec.effects,
        startIssue: async (issueId, guard) => {
          guard.run(() => {
            h.rec.startedIssues.push(issueId);
          });
          if (issueId === "issue-1") {
            await gate.promise;
          }
          // Each mutation re-validates ownership immediately before it lands:
          // the lease was taken over while issue-1 blocked, so the next
          // guarded mutation is refused before it runs.
          guard.run(() => {
            h.rec.startedIssues.push(issueId);
          });
        },
      },
    });
    await waitFor(() => h.rec.startedIssues.length === 1);
    // The lease is taken over after the first mutation, before the second.
    const current = h.store.getLease();
    expect(current).not.toBeNull();
    h.store.forceLease({ ...current!, owner: "B", tickId: "tick-other" });
    gate.resolve();
    const result = await tick;
    expect(result.outcome).toBe("failed");
    expect(result.ran).toBe(false);
    // The first mutation ran while the lease was live; the second never did.
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    const terminal = h.store.events[h.store.events.length - 1];
    expect(terminal.outcome).toBe("failed");
  });

  it("terminal revalidation backstops a stale mutation: lease lost during the pass records failed, never ran", async () => {
    const h = harness();
    const gate = createDeferred<void>();
    const entered: { current: boolean } = { current: false };
    const tick = runSupervisorTick({
      ...h.input,
      effects: {
        ...h.rec.effects,
        startIssue: async (issueId) => {
          entered.current = true;
          await gate.promise;
          // A naive effect mutates WITHOUT the lease guard, so the
          // mutation is stale. The terminal revalidation must still refuse to
          // bless the pass as success: the tick records failed, never ran.
          h.rec.startedIssues.push(issueId);
        },
      },
    });
    await waitFor(() => entered.current);
    const current = h.store.getLease();
    expect(current).not.toBeNull();
    h.store.forceLease({ ...current!, owner: "B", tickId: "tick-other" });
    gate.resolve();
    const result = await tick;
    expect(result.outcome).toBe("failed");
    expect(result.ran).toBe(false);
    expect(result.error).toContain("lost before terminal record");
    // The stale mutation happened, but the tick never records ran.
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    const terminal = h.store.events[h.store.events.length - 1];
    expect(terminal.outcome).toBe("failed");
  });

  it("does not take over a live lease; only expired held leases are reclaimable", async () => {
    const h = harness();
    const live: SupervisorLease = {
      id: "lease:live",
      owner: "A",
      tickId: "tick-1",
      acquiredAt: NOW,
      expiresAt: "2026-08-25T00:00:30.000Z",
      releasedAt: null,
    };
    expect(h.store.store.acquireLease(live)).toBe(true);
    expect(isLeaseLive(live, NOW)).toBe(true);
    expect(isLeaseExpired(live, NOW)).toBe(false);
    // Takeover of a live lease must fail at the store CAS, even with the
    // correct expected identity.
    const replacement: SupervisorLease = { ...live, id: "lease:B", owner: "B", tickId: "tick-2" };
    expect(h.store.store.takeOverLease("lease:live", replacement)).toBe(false);
    expect(h.store.getLease()!.owner).toBe("A");
    // A released lease is not a takeover target either; it is simply free.
    expect(h.store.store.releaseLease("lease:live", "A")).toBe(true);
    const afterRelease: SupervisorLease = { ...live, id: "lease:B", owner: "B", tickId: "tick-2" };
    expect(h.store.store.takeOverLease("lease:live", afterRelease)).toBe(false);
    expect(h.store.store.acquireLease(afterRelease)).toBe(true);
    expect(h.store.getLease()!.owner).toBe("B");
  });

  it("pass failure isolation: releases the lease, records failed, and the next tick recovers", async () => {
    const h = harness();
    const throwingControl: AutomationControlAdapter = {
      get: () => {
        throw new Error("control read failed");
      },
      update: () => {
        throw new Error("unreachable");
      },
    };
    const first = await runSupervisorTick({ ...h.input, control: throwingControl });
    expect(first.outcome).toBe("failed");
    expect(first.ran).toBe(false);
    expect(first.error).toContain("control read failed");
    expect(h.store.getLease()!.releasedAt).not.toBeNull();
    expect(outcomesOf(h)).toContain("failed");
    // A fresh tick with a healthy control runs normally after the failure.
    const second = await runSupervisorTick({ ...h.input, tickId: "tick-2", control: h.control });
    expect(second.outcome).toBe("ran");
    expect(second.ran).toBe(true);
  });

  it("no overlapping passes: a concurrent tick is lease-held while a pass is in flight", async () => {
    const h = harness();
    const deferred = createDeferred<void>();
    const tickA = runSupervisorTick({
      ...h.input,
      tickId: "tick-1",
      owner: "A",
      effects: {
        ...h.rec.effects,
        startIssue: (issueId, guard) => {
          guard.run(() => {
            h.rec.startedIssues.push(issueId);
          });
          return deferred.promise;
        },
      },
    });
    await waitFor(() => {
      const lease = h.store.getLease();
      return lease !== null && lease.owner === "A" && h.rec.startedIssues.length === 1;
    });
    const tickB = await runSupervisorTick({ ...h.input, tickId: "tick-2", owner: "B" });
    expect(tickB.outcome).toBe("lease-held");
    expect(tickB.ran).toBe(false);
    expect(h.rec.startedIssues).toEqual(["issue-1"]);
    deferred.resolve();
    const resultA = await tickA;
    expect(resultA.outcome).toBe("ran");
    expect(h.store.getLease()!.releasedAt).not.toBeNull();
  });

  it("renews the lease during a long pass and releases it on completion", async () => {
    const h = harness();
    let renewals = 0;
    const renew = h.store.store.renewLease;
    h.store.store.renewLease = (id, owner, expiresAt) => {
      renewals += 1;
      return renew(id, owner, expiresAt);
    };
    const deferred = createDeferred<void>();
    const sleepResolvers: Array<() => void> = [];
    const sleep = () =>
      new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    const tick = runSupervisorTick({
      ...h.input,
      policy: { ...h.input.policy, leaseTtlMs: 1000 },
      effects: { ...h.rec.effects, startIssue: () => deferred.promise },
      sleep,
    });
    await waitFor(() => h.store.getLease() !== null);
    // Pre-pass renew already happened; resolve one renewal-loop sleep so the
    // loop renews again mid-pass.
    expect(sleepResolvers.length).toBeGreaterThanOrEqual(1);
    sleepResolvers.shift()!();
    await waitFor(() => renewals >= 2);
    deferred.resolve();
    const result = await tick;
    expect(result.outcome).toBe("ran");
    expect(h.store.getLease()!.releasedAt).not.toBeNull();
  });

  it("immutable inputs: frozen policy, authority, and state are never mutated", async () => {
    const h = harness();
    const policy = Object.freeze({ ...defaultSupervisorPolicy(), enabled: true });
    const authority = deepFreeze(grantedAuthority(NOW));
    const snapshot = Object.freeze(makeSnapshot());
    const state = deepFreeze({
      snapshots: Object.freeze([snapshot]),
      candidates: Object.freeze([]),
    }) as unknown as AutomationRuntimeState;
    const before = JSON.stringify({ policy, authority, state });
    const result = await runSupervisorTick({ ...h.input, policy, authority, state });
    expect(result.outcome).toBe("ran");
    expect(JSON.stringify({ policy, authority, state })).toBe(before);
  });

  it("never merges, deploys, cleans, self-modifies, or answers gates: effects stay within the closed set", async () => {
    const h = harness();
    const result = await runSupervisorTick(h.input);
    expect(result.outcome).toBe("ran");
    const allowedAuditKinds = new Set(["start-issue", "start-improvement", "wait", "stop"]);
    for (const outcome of h.rec.audited) {
      expect(allowedAuditKinds.has(outcome.kind)).toBe(true);
    }
    // The supervisor's effect surface is only the runtime start/audit effects
    // and the store lease/tick adapter; the authority scope set is closed.
    expect(AUTHORITY_SCOPES).toEqual(["observe", "build", "publish"]);
  });
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
