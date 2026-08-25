/**
 * Thin one-pass runtime over the autonomous automation driver.
 *
 * Reads the durable operator control and only then decides whether a pass may
 * run. A disabled or operator-held control returns immediately with no
 * planning and no start effects, recording a single wait/stop audit event. An
 * enabled control caps the per-pass issue limit and the improvement-loop
 * policy ceilings from the durable record (issue limit, iteration ceiling,
 * spend cap, per-candidate ceiling, paid authorization) and delegates the
 * pass to `runAutomationDriver`.
 *
 * This is the runtime seam, not a control surface: it never answers a gate,
 * never starts a worker on its own, and never mutates state. Operator action
 * changes only the durable control record; the pass is a separate step that
 * consults this record and only then runs.
 */

import { type AutomationControl, type AutomationControlAdapter } from "./automation-control";
import type { AutomationInput } from "./automation";
import {
  runAutomationDriver,
  type AutomationDriverEffects,
  type AutomationDriverResult,
  type AutomationIntentOutcome,
  type LeaseGuard,
} from "./automation-driver";
import type { ImprovementCandidate, ImprovementPolicyState } from "./improvement-loop";
import { UNATTENDED_LIMIT_CAP, type UnattendedSnapshot } from "./unattended";

/** Live loop state the control record does not own; injected by the caller. */
export type AutomationRuntimeState = {
  /** Candidate issues with derived runtime booleans. */
  snapshots: UnattendedSnapshot[];
  /** Evidence-backed recursive-improvement candidates. */
  candidates: ImprovementCandidate[];
  /** Iterations already consumed by the improvement loop. */
  iterationsUsed?: number;
  /** USD already spent by the improvement loop. */
  spentCostUsd?: number;
  /** True while a human gate is open; the loop must wait. */
  humanGatePending?: boolean;
  /** Refs currently available: promoted lesson IDs, evidence refs, done
   *  candidate ids. */
  availableRefs?: ReadonlySet<string> | readonly string[];
};

/** Same effect seam as the driver: start effects plus a required audit sink. */
export type AutomationRuntimeEffects = AutomationDriverEffects;

export type AutomationRuntimeResult = {
  /** True only when the pass actually reached the driver. */
  ran: boolean;
  /** The durable control this pass consulted. */
  control: AutomationControl;
  /** Driver pass result when `ran`; null when disabled or held. */
  driver: AutomationDriverResult | null;
};

/**
 * Run one bounded automation pass under durable operator control.
 *
 * Read the control record once. When it is disabled or held, the runtime
 * returns with no planning and no start effects, auditing a single terminal
 * outcome: `wait` under an operator hold (a transient pause), `stop` when
 * disabled. When enabled, the durable record's limits and policy ceilings are
 * applied to the driver input and the pass is delegated to
 * `runAutomationDriver` with the injected effects unchanged. `guard` is the
 * lease guard handed to each start effect — the supervisor's atomic mutation
 * admission boundary; a lease-less (standalone) pass passes `noLeaseGuard()`.
 */
export async function runAutomationRuntime(
  control: AutomationControlAdapter,
  state: AutomationRuntimeState,
  effects: AutomationRuntimeEffects,
  guard: LeaseGuard,
): Promise<AutomationRuntimeResult> {
  const controlRecord = control.get();

  if (!controlRecord.enabled || controlRecord.operatorHold) {
    const outcome: AutomationIntentOutcome = controlRecord.operatorHold
      ? { kind: "wait", reason: "automation held by operator" }
      : { kind: "stop", reason: "automation disabled" };
    try {
      await effects.audit(outcome);
    } catch (error) {
      // The audit sink is a side channel; a throwing sink never aborts the runtime.
      void error;
    }
    return { ran: false, control: controlRecord, driver: null };
  }

  const policy: ImprovementPolicyState = {
    maxIterations: controlRecord.maxIterations,
    maxCostUsd: controlRecord.maxCostUsd,
    perCandidateCeilingUsd: controlRecord.perCandidateCeilingUsd,
    paidAuthorization: controlRecord.paidAuthorization,
    iterationsUsed: state.iterationsUsed ?? 0,
    spentCostUsd: state.spentCostUsd ?? 0,
    humanGatePending: state.humanGatePending ?? false,
    availableRefs: state.availableRefs ?? [],
  };

  const input: AutomationInput = {
    snapshots: state.snapshots,
    unattendedLimit: Math.min(controlRecord.limit, UNATTENDED_LIMIT_CAP),
    candidates: state.candidates,
    policy,
  };

  const driver = await runAutomationDriver(input, effects, guard);
  return { ran: true, control: controlRecord, driver };
}
