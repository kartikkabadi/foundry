/**
 * Durable background supervisor seam for the autonomous automation runtime.
 *
 * A tick is the smallest unit of supervision: given an injected durable store
 * adapter, an operator-owned policy, an authority profile, and the existing
 * one-pass runtime seam (`runAutomationRuntime`), one tick performs at most
 * one bounded pass and records its outcome durably.
 *
 * Fail-closed gates, in order:
 *   1. Policy gate — the supervisor is disabled by default; a disabled or
 *      operator-held policy records a terminal outcome and never touches a
 *      lease or a pass.
 *   2. Authority gate — every scope the pass requires must be explicitly
 *      granted by the injected `AuthorityProfile`. The profile can express
 *      only observe/build/publish, so merge, deploy, cleanup, self-modification,
 *      and gate answering are structurally impossible here.
 *   3. Duplicate-tick gate — a tick id already recorded in the durable ledger
 *      is a no-op, so crash re-entry or a replayed message can never run a
 *      second pass.
 *   4. Singleton lease — the pass runs only while this supervisor holds the
 *      durable singleton lease, acquired by compare-and-set. A live lease
 *      blocks the tick, whoever holds it; a lease belonging to this same tick
 *      id (an at-least-once redelivery or a crash mid-pass) returns a
 *      nonterminal `busy` result without recording the tick, so the original
 *      pass's replay stays eligible. An expired lease is reclaimed by CAS
 *      regardless of owner, so a crashed instance's lease is taken over by
 *      the next instance and a restarted instance reclaims its own expired
 *      lease. The lease is renewed before and during a pass so a long pass
 *      cannot be taken over mid-flight; a renewal that returns false or
 *      throws is lease loss, and the pass is aborted as a truthful `failed`
 *      outcome (raced against the lease-loss signal during the pass), never
 *      reported as success, with an owner-fenced best-effort release. The
 *      lease is the fence that prevents overlapping passes. A takeover is
 *      recorded only with the terminal tick outcome (as `previousOwner`), so
 *      a crash after takeover never suppresses replay of the same tick id.
 *   5. Mutation guard — every mutation-capable effect receives a `LeaseGuard`
 *      bound to the lease id and owner; the only way an effect may mutate is
 *      `guard.run(mutate)`, which executes the mutation inside the store's
 *      atomic `withLiveLease` critical section (lease-live check and mutation
 *      on the same connection/transaction). A lost lease makes admission
 *      fail, throwing `LeaseFenceError`, which aborts the pass (never a
 *      per-intent failure) so the tick records a truthful `failed`, never
 *      `ran`. The terminal success record is gated by the same `withLiveLease`
 *      boundary.
 *
 * The supervisor never merges, deploys, cleans, self-modifies, or answers a
 * gate: its only effects are the injected runtime effects (issue/candidate
 * starts plus the audit sink) and the injected store adapter (lease and tick
 * ledger). Inputs are never mutated; every input is read-only and injected.
 * Clock (`now`) and sleep are injected so ticks are deterministic in tests.
 *
 * The `SupervisorStoreAdapter` is the durable boundary: the caller supplies a
 * SQLite-backed (or otherwise durable) implementation with the same
 * synchronous CAS semantics. This module is the pure seam and validation.
 */

import {
  runAutomationRuntime,
  type AutomationRuntimeEffects,
  type AutomationRuntimeResult,
  type AutomationRuntimeState,
} from "./automation-runtime";
import { LeaseFenceError, type LeaseGuard } from "./automation-driver";
import type { AutomationControlAdapter } from "./automation-control";
import { isAuthorityGranted, type AuthorityProfile, type AuthorityScope } from "./authority";

/** Scopes the autonomous runtime pass touches: it observes and builds, and it
 *  never publishes, merges, deploys, or cleans. */
export const DEFAULT_SUPERVISOR_REQUIRED_SCOPES: readonly AuthorityScope[] = ["observe", "build"];

/** Default singleton-lease TTL. A pass is bounded well below this; renewal
 *  keeps the lease alive for passes that approach it. */
export const SUPERVISOR_LEASE_TTL_MS = 60_000;

/** Operator-owned, injected supervision policy. Fail-closed by default. */
export type SupervisorPolicy = {
  /** True while the supervisor may run passes; false by default. */
  enabled: boolean;
  /** Operator hold: true pauses supervision without disabling it. */
  operatorHold: boolean;
  /** Singleton-lease TTL in milliseconds; finite and positive. */
  leaseTtlMs: number;
  /** Scopes a pass requires; every one must be granted by the authority
   *  profile or the tick is denied. */
  requiredScopes: readonly AuthorityScope[];
  /** Renew the lease at half-TTL intervals while a pass runs. */
  renewDuringPass: boolean;
};

/** Fail-closed defaults: disabled, no hold, no required scope granted yet. */
export function defaultSupervisorPolicy(): SupervisorPolicy {
  return {
    enabled: false,
    operatorHold: false,
    leaseTtlMs: SUPERVISOR_LEASE_TTL_MS,
    requiredScopes: [...DEFAULT_SUPERVISOR_REQUIRED_SCOPES],
    renewDuringPass: true,
  };
}

/** Thrown when the injected policy is not a legal, bounded policy. */
export class SupervisorPolicyError extends Error {
  constructor(message: string) {
    super(`automation supervisor policy: ${message}`);
    this.name = "SupervisorPolicyError";
  }
}

/** Thrown when the singleton lease is lost: a renewal returned false or threw,
 *  meaning another supervisor took the lease over. A `LeaseFenceError`
 *  subclass, so the driver and the tick both recognize it as lease loss; the
 *  pass is aborted as a truthful failure and is never reported as success. */
export class SupervisorLeaseLostError extends LeaseFenceError {
  constructor(leaseId: string) {
    super(leaseId);
    this.name = "SupervisorLeaseLostError";
  }
}

/** One durable singleton lease. The store owns the row; this is the shape. */
export type SupervisorLease = {
  /** Lease identity; fresh per acquisition and per takeover. The backing row
   *  is a singleton; this is the application-level identity used for CAS,
   *  renewal, and release, and it changes on every takeover. */
  id: string;
  /** Supervisor instance identity that owns the lease; the fencing subject. */
  owner: string;
  /** The tick this lease was acquired for. */
  tickId: string;
  /** ISO timestamp of acquisition. */
  acquiredAt: string;
  /** ISO timestamp at which the lease expires; `<= now` means expired. */
  expiresAt: string;
  /** ISO timestamp of release, or null while live. */
  releasedAt: string | null;
};

/** Outcome of one tick. All outcomes except `busy` are terminal and written
 *  to the durable ledger; `busy` is a nonterminal signal returned when the
 *  tick cannot run because the same tick id is already active, and is never
 *  recorded so a later replay stays eligible. */
export type SupervisorTickOutcome =
  | "disabled"
  | "held"
  | "denied"
  | "duplicate-tick"
  | "lease-held"
  | "busy"
  | "ran"
  | "idle"
  | "failed";

/** One durable audit record for a tick. */
export type SupervisorTickEvent = {
  kind: "tick";
  tickId: string;
  owner: string;
  outcome: SupervisorTickOutcome;
  reason: string;
  at: string;
  /** Owner of the expired lease this tick reclaimed, or null. Written only
   *  with the terminal outcome so a crash after takeover never suppresses
   *  replay of the same tick id. */
  previousOwner: string | null;
};

/** Durable store adapter for the singleton lease and the tick ledger. All
 *  operations are synchronous compare-and-set; the caller supplies the durable
 *  backing (SQLite). The pure semantics are defined here and enforced by the
 *  tests' in-memory double. */
export type SupervisorStoreAdapter = {
  /** Read the current lease row, or null when none exists. */
  getLease: () => SupervisorLease | null;
  /** CAS acquire: succeeds only when no held lease row exists (no row, or a
   *  released row). An expired held lease is NOT silently overwritten — it
   *  must be reclaimed through `takeOverLease`. On success the store holds
   *  `lease`. */
  acquireLease: (lease: SupervisorLease) => boolean;
  /** CAS takeover: succeeds only when a held lease row matching
   *  `expectedLeaseId` exists and is expired (released rows are never
   *  takeover targets). On success the store replaces that row with
   *  `replacementLease` — a fresh lease identity — and returns true. The
   *  expected identity is the lease observed before the attempt, so a stale
   *  observer can never overwrite a lease that was already taken over or
   *  re-acquired. */
  takeOverLease: (expectedLeaseId: string, replacementLease: SupervisorLease) => boolean;
  /** Renew a lease: succeeds only when the row matches `id`, is owned by
   *  `owner`, is still live, and has not yet expired at the store clock
   *  (`expires_at > now`). An expired lease is never renewable — the takeover
   *  window stays open — so a fenced owner cannot revive it after expiry. */
  renewLease: (id: string, owner: string, expiresAt: string) => boolean;
  /** Fence check: true only when the row still matches `id` and `owner` and
   *  is live (not released, not expired) at the store clock. The supervisor
   *  uses this for the terminal liveness gate; per-mutation admission goes
   *  through `withLiveLease`. */
  isLeaseLive: (id: string, owner: string) => boolean;
  /** Atomic mutation admission: runs `mutate` inside a critical section
   *  (same SQLite connection/transaction) in which the lease-live predicate
   *  and the mutation are one unit. When the row still matches `id` and
   *  `owner` and is live at the store clock, `mutate` runs and the result is
   *  committed atomically with the check; otherwise `mutate` never runs and
   *  the call returns `{ admitted: false }`. `mutate` must be synchronous: a
   *  transaction cannot span awaits. This is the supervisor's mutation
   *  boundary — effects never mutate outside it. */
  withLiveLease: <T>(
    id: string,
    owner: string,
    mutate: () => T,
  ) => { admitted: true; value: T } | { admitted: false };
  /** Release a lease: succeeds only when the row matches `id` and is owned by
   *  `owner`; marks `releasedAt`. */
  releaseLease: (id: string, owner: string) => boolean;
  /** True when `tickId` already produced a recorded terminal outcome. */
  isTickRecorded: (tickId: string) => boolean;
  /** Durably record one tick outcome. */
  recordTick: (event: SupervisorTickEvent) => void;
};

/** Result of one tick. `outcome` is the terminal verdict; `ran` is true only
 *  when a pass actually reached the runtime. */
export type SupervisorTickResult = {
  outcome: SupervisorTickOutcome;
  ran: boolean;
  reason: string;
  /** Runtime pass result when the pass ran or was idle; null when skipped. */
  pass: AutomationRuntimeResult | null;
  /** Failure message when the pass threw; null otherwise. */
  error: string | null;
  /** Previous owner when this tick took over an expired lease; else null. */
  previousOwner: string | null;
};

/** Everything one tick needs; all state and effects are injected. */
export type SupervisorTickInput = {
  /** Stable tick id; a replayed id is a durable no-op. */
  tickId: string;
  /** Supervisor instance identity; the lease fencing subject. */
  owner: string;
  /** Operator-owned policy; disabled by default. */
  policy: SupervisorPolicy;
  /** Authority profile; every required scope must be granted. */
  authority: AuthorityProfile;
  /** Durable operator control the runtime consults. */
  control: AutomationControlAdapter;
  /** Live loop state handed to the runtime; never mutated. */
  state: AutomationRuntimeState;
  /** Runtime effects (issue/candidate starts plus the audit sink). */
  effects: AutomationRuntimeEffects;
  /** Durable singleton-lease and tick-ledger adapter. */
  store: SupervisorStoreAdapter;
  /** Injected clock; ISO-8601 wall clock, deterministic per tick. */
  now: () => string;
  /** Injected sleep for lease renewal pacing; absent disables mid-pass renewal. */
  sleep?: (ms: number) => Promise<void>;
};

/** ISO expiry `ttlMs` after `at`. Both ends are ISO-8601, so `<=` compares
 *  lexicographically. */
export function leaseExpiryAt(at: string, ttlMs: number): string {
  return new Date(new Date(at).getTime() + ttlMs).toISOString();
}

/** True when the lease is held and not yet expired at `at`. */
export function isLeaseLive(lease: SupervisorLease, at: string): boolean {
  return lease.releasedAt === null && lease.expiresAt > at;
}

/** True when the lease is held but expired at `at` (a takeover candidate). */
export function isLeaseExpired(lease: SupervisorLease, at: string): boolean {
  return lease.releasedAt === null && lease.expiresAt <= at;
}

function validatePolicy(policy: SupervisorPolicy): void {
  if (typeof policy.enabled !== "boolean") {
    throw new SupervisorPolicyError("enabled must be a boolean");
  }
  if (typeof policy.operatorHold !== "boolean") {
    throw new SupervisorPolicyError("operatorHold must be a boolean");
  }
  if (typeof policy.leaseTtlMs !== "number" || !Number.isFinite(policy.leaseTtlMs) || policy.leaseTtlMs <= 0) {
    throw new SupervisorPolicyError("leaseTtlMs must be finite and positive");
  }
  if (!Array.isArray(policy.requiredScopes) || policy.requiredScopes.length === 0) {
    throw new SupervisorPolicyError("requiredScopes must be a nonempty array");
  }
  for (const scope of policy.requiredScopes) {
    if (scope !== "observe" && scope !== "build" && scope !== "publish") {
      throw new SupervisorPolicyError(`requiredScopes contains unknown scope ${String(scope)}`);
    }
  }
  if (typeof policy.renewDuringPass !== "boolean") {
    throw new SupervisorPolicyError("renewDuringPass must be a boolean");
  }
}

function makeLease(tickId: string, owner: string, at: string, ttlMs: number): SupervisorLease {
  return {
    id: `lease:${tickId}`,
    owner,
    tickId,
    acquiredAt: at,
    expiresAt: leaseExpiryAt(at, ttlMs),
    releasedAt: null,
  };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build the lease guard for a held lease. `run` is the ONLY mutation path a
 *  supervised effect may use: it executes the mutation inside the store's
 *  atomic `withLiveLease` critical section (lease-live check and mutation on
 *  the same connection/transaction) and throws `LeaseFenceError` when the
 *  lease is no longer live — released, expired, or taken over — so a stale
 *  owner's mutation never runs. The supervisor owns admission; effects never
 *  mutate directly. */
function makeGuard(store: SupervisorStoreAdapter, lease: SupervisorLease): LeaseGuard {
  return {
    leaseId: lease.id,
    owner: lease.owner,
    run: <T>(mutate: () => T): T => {
      const result = store.withLiveLease(lease.id, lease.owner, mutate);
      if (!result.admitted) {
        throw new LeaseFenceError(lease.id);
      }
      return result.value;
    },
  };
}

/** Best-effort, owner-fenced lease release. A false return (lease already
 *  taken over or released) or a throwing store must never turn a handled
 *  outcome into a thrown one or clobber another owner's lease. */
function releaseSafely(store: SupervisorStoreAdapter, lease: SupervisorLease, owner: string): void {
  try {
    store.releaseLease(lease.id, owner);
  } catch {
    // The store is the durable boundary; a failing release is surfaced by the
    // next tick's lease state, not by throwing out of finalization.
  }
}

/** Best-effort tick-level audit; a throwing sink never aborts the tick. */
async function auditSafely(
  effects: AutomationRuntimeEffects,
  outcome: { kind: "wait" | "stop"; reason: string },
): Promise<void> {
  try {
    await effects.audit(outcome);
  } catch {
    // The audit sink is a side channel; a throwing sink never aborts the tick.
  }
}

function record(
  store: SupervisorStoreAdapter,
  tickId: string,
  owner: string,
  outcome: SupervisorTickOutcome,
  reason: string,
  at: string,
  previousOwner: string | null,
): void {
  store.recordTick({ kind: "tick", tickId, owner, outcome, reason, at, previousOwner });
}

/** Run the single bounded pass, renewing the lease before and (optionally)
 *  during the pass so it cannot be taken over mid-flight. A renewal that
 *  returns false or throws is lease loss: the pass must not run unfenced, so
 *  it aborts as a `SupervisorLeaseLostError` (or the store error), which the
 *  tick isolates into a truthful `failed` outcome. The pass runs under
 *  `guard`, handed to each effect as the atomic mutation admission boundary. */
async function runBoundedPass(
  input: SupervisorTickInput,
  lease: SupervisorLease,
  sleep: ((ms: number) => Promise<void>) | undefined,
  guard: LeaseGuard,
): Promise<AutomationRuntimeResult> {
  const renewed = input.store.renewLease(
    lease.id,
    lease.owner,
    leaseExpiryAt(input.now(), input.policy.leaseTtlMs),
  );
  if (!renewed) {
    throw new SupervisorLeaseLostError(lease.id);
  }
  if (input.policy.renewDuringPass && sleep !== undefined) {
    return runPassWithRenewal(input, lease, sleep, guard);
  }
  return runAutomationRuntime(input.control, input.state, input.effects, guard);
}

/** Run the pass while a background loop renews the lease at half-TTL
 *  intervals. A failing sleep stops renewal (the lease still has TTL headroom);
 *  the loop never outlives the pass. A renewal that returns false or throws is
 *  lease loss: the loop rejects a shared signal and the pass is raced against
 *  it, so the tick fails instead of continuing unfenced. Renewal errors are
 *  contained inside the loop (never an unhandled rejection) and the pass wins
 *  the race when it completes first. */
async function runPassWithRenewal(
  input: SupervisorTickInput,
  lease: SupervisorLease,
  sleep: (ms: number) => Promise<void>,
  guard: LeaseGuard,
): Promise<AutomationRuntimeResult> {
  const { store, now, policy } = input;
  let running = true;
  let rejectLeaseLost!: (error: Error) => void;
  const leaseLost = new Promise<never>((_, reject) => {
    rejectLeaseLost = reject;
  });
  const renewal = (async () => {
    while (running) {
      try {
        await sleep(policy.leaseTtlMs / 2);
      } catch {
        return;
      }
      if (!running) {
        return;
      }
      let renewed: boolean;
      try {
        renewed = store.renewLease(lease.id, lease.owner, leaseExpiryAt(now(), policy.leaseTtlMs));
      } catch (error) {
        rejectLeaseLost(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (!renewed) {
        rejectLeaseLost(new SupervisorLeaseLostError(lease.id));
        return;
      }
    }
  })();
  try {
    // The pass and the lease-loss signal race: a lost lease aborts the tick
    // as a failure even though the underlying one-pass runtime cannot itself
    // be cancelled mid-flight.
    return await Promise.race([runAutomationRuntime(input.control, input.state, input.effects, guard), leaseLost]);
  } finally {
    running = false;
  }
}

/**
 * Run exactly one bounded supervision tick.
 *
 * Returns a terminal `SupervisorTickResult` and records one durable tick
 * event. When the tick runs a pass, the pass result is returned with `ran`
 * true; an idle pass (disabled control at the runtime level) returns `ran`
 * false with the pass result. Any throwing pass is isolated: the lease is
 * released, the failure is recorded durably, and the tick returns `failed`
 * without corrupting the store or the inputs.
 */
export async function runSupervisorTick(input: SupervisorTickInput): Promise<SupervisorTickResult> {
  const { tickId, owner, policy, authority, control, state, effects, store, now } = input;
  validatePolicy(policy);
  const at = now();

  if (!policy.enabled) {
    const reason = "automation supervisor disabled by policy";
    record(store, tickId, owner, "disabled", reason, at, null);
    await auditSafely(effects, { kind: "stop", reason });
    return { outcome: "disabled", ran: false, reason, pass: null, error: null, previousOwner: null };
  }

  if (policy.operatorHold) {
    const reason = "automation supervisor held by operator";
    record(store, tickId, owner, "held", reason, at, null);
    await auditSafely(effects, { kind: "wait", reason });
    return { outcome: "held", ran: false, reason, pass: null, error: null, previousOwner: null };
  }

  for (const scope of policy.requiredScopes) {
    if (!isAuthorityGranted(authority, scope)) {
      const reason = `authority denied for required scope ${scope}`;
      record(store, tickId, owner, "denied", reason, at, null);
      await auditSafely(effects, { kind: "stop", reason });
      return { outcome: "denied", ran: false, reason, pass: null, error: null, previousOwner: null };
    }
  }

  if (store.isTickRecorded(tickId)) {
    const reason = `tick ${tickId} already recorded; no second pass`;
    record(store, tickId, owner, "duplicate-tick", reason, at, null);
    return { outcome: "duplicate-tick", ran: false, reason, pass: null, error: null, previousOwner: null };
  }

  let lease = makeLease(tickId, owner, at, policy.leaseTtlMs);
  let previousOwner: string | null = null;
  let held = store.acquireLease(lease);
  if (!held) {
    const current = store.getLease();
    if (current !== null && isLeaseExpired(current, at)) {
      // CAS on the observed lease identity: `lease` keeps its own fresh id,
      // so a stale takeover (row already replaced) fails the match.
      if (store.takeOverLease(current.id, lease)) {
        held = true;
        previousOwner = current.owner;
        // The takeover is written only with the terminal outcome below (as
        // `previousOwner`); recording it here would mark the tick terminal
        // before the pass runs, so a crash after takeover would suppress
        // replay of this tick id.
      } else if (current.tickId === tickId) {
        // The raced lease belongs to this same tick id: the tick is busy, not
        // terminal. Recording it would suppress a later replay after the
        // winning supervisor crashes.
        const reason = `lease ${current.id} busy for this tick; retry later`;
        await auditSafely(effects, { kind: "wait", reason });
        return { outcome: "busy", ran: false, reason, pass: null, error: null, previousOwner: null };
      } else {
        const reason = `lease takeover raced for ${current.id}`;
        record(store, tickId, owner, "lease-held", reason, at, null);
        await auditSafely(effects, { kind: "wait", reason });
        return { outcome: "lease-held", ran: false, reason, pass: null, error: null, previousOwner: null };
      }
    } else if (current !== null && current.tickId === tickId) {
      // A live lease for this same tick id: the tick is already active (an
      // at-least-once redelivery or a crash mid-pass). The tick is busy and
      // nonterminal so the original pass's replay stays eligible.
      const reason = `lease ${current.id} active for this same tick; busy`;
      await auditSafely(effects, { kind: "wait", reason });
      return { outcome: "busy", ran: false, reason, pass: null, error: null, previousOwner: null };
    } else {
      const reason =
        current !== null
          ? `lease ${current.id} held by ${current.owner}`
          : "lease acquisition raced";
      record(store, tickId, owner, "lease-held", reason, at, null);
      await auditSafely(effects, { kind: "wait", reason });
      return { outcome: "lease-held", ran: false, reason, pass: null, error: null, previousOwner: null };
    }
  }

  const guard = makeGuard(store, lease);
  try {
    const pass = await runBoundedPass(input, lease, input.sleep, guard);
    // The terminal success record is itself a lease-guarded mutation: the
    // "ran"/"idle" verdict is written only inside `withLiveLease`, so the
    // lease-live predicate and the record commit atomically. If the lease was
    // lost (released, expired, or taken over) while the pass ran, admission
    // fails, the success record never writes, and the tick records a truthful
    // failure — never ran. Effect mutations are separately admitted by the
    // same boundary; this gate also covers a pass that completed without any
    // effect mutation.
    const outcome: SupervisorTickOutcome = pass.ran ? "ran" : "idle";
    const reason = pass.ran ? "pass ran" : "pass idle";
    const terminal = store.withLiveLease(lease.id, lease.owner, () => {
      record(store, tickId, owner, outcome, reason, now(), previousOwner);
    });
    if (!terminal.admitted) {
      const message = `lease ${lease.id} lost before terminal record; pass result not accepted`;
      releaseSafely(store, lease, owner);
      record(store, tickId, owner, "failed", message, now(), previousOwner);
      await auditSafely(effects, { kind: "stop", reason: `supervisor pass failed: ${message}` });
      return {
        outcome: "failed",
        ran: false,
        reason: "supervisor pass failed",
        pass: null,
        error: message,
        previousOwner,
      };
    }
    // Record-then-release keeps the replay path a durable no-op: a crash
    // between release and record would leave the tick unrecorded with a free
    // lease, so a replay would re-run the pass and duplicate mutations. The
    // guarded terminal record above is the strong ownership gate; the release
    // is best-effort owner-fenced cleanup whose failure is observed by the
    // next tick's lease state.
    releaseSafely(store, lease, owner);
    return { outcome, ran: pass.ran, reason, pass, error: null, previousOwner };
  } catch (error) {
    const message = failureMessage(error);
    releaseSafely(store, lease, owner);
    record(store, tickId, owner, "failed", message, now(), previousOwner);
    await auditSafely(effects, { kind: "stop", reason: `supervisor pass failed: ${message}` });
    return {
      outcome: "failed",
      ran: false,
      reason: "supervisor pass failed",
      pass: null,
      error: message,
      previousOwner,
    };
  }
}
