/**
 * Durable operator control for the autonomous driver.
 *
 * This is the single persisted source of truth for whether autonomous passes
 * may run and under what bounds. It is a control surface, not a driver: it
 * stores state and exposes integer-version compare-and-swap mutations. It
 * never calls `planAutomation`, never reads issue or policy state, never
 * answers a gate, and never starts a worker. UI and control state never start
 * work — the driver consults this record and only then decides.
 *
 * Defaults are fail-closed: automation is disabled, no operator hold, a
 * conservative per-pass issue limit, the improvement loop's stock budget
 * ceilings, and paid work unauthorized. Paid authorization must be granted
 * explicitly by an operator; nothing in the system grants it to itself.
 */

import { UNATTENDED_LIMIT_CAP } from "./unattended";

/** Lowest legal per-pass issue limit. */
export const AUTOMATION_LIMIT_MIN = 1;
/** Highest legal per-pass issue limit; shared with the unattended selector cap. */
export const AUTOMATION_LIMIT_CAP = UNATTENDED_LIMIT_CAP;

/** The durable, operator-owned automation control record. */
export type AutomationControl = {
  /** True while the autonomous driver may run passes. */
  enabled: boolean;
  /** Operator hold: true pauses automation without disabling it. */
  operatorHold: boolean;
  /** Per-pass issue selection limit; integer in [AUTOMATION_LIMIT_MIN, AUTOMATION_LIMIT_CAP]. */
  limit: number;
  /** Recursive-improvement iteration ceiling; finite nonnegative integer. */
  maxIterations: number;
  /** Total improvement-loop spend cap in USD; finite and nonnegative. */
  maxCostUsd: number;
  /** Per-candidate cost ceiling in USD; finite and nonnegative. */
  perCandidateCeilingUsd: number;
  /** True only after an explicit operator authorization for paid work. */
  paidAuthorization: boolean;
  /** Integer optimistic-concurrency version; bumped on every mutation. */
  version: number;
  /** ISO timestamp of the last mutation. */
  updatedAt: string;
};

/** Operator-editable fields. `version` and `updatedAt` are store-managed. */
export type AutomationControlPatch = Partial<
  Pick<
    AutomationControl,
    | "enabled"
    | "operatorHold"
    | "limit"
    | "maxIterations"
    | "maxCostUsd"
    | "perCandidateCeilingUsd"
    | "paidAuthorization"
  >
>;

/** Durable control adapter over the shared SQLite store. */
export type AutomationControlAdapter = {
  /** Read the current control row, materializing fail-closed defaults on first access. */
  get: () => AutomationControl;
  /** CAS mutation: applies `patch` only when the stored `version` equals
   *  `expectedVersion`; throws `AutomationControlStaleVersionError` on
   *  conflict and `AutomationControlValidationError` on an illegal patch. */
  update: (patch: AutomationControlPatch, expectedVersion: number) => AutomationControl;
};

/** Thrown when a CAS mutation targets a version that is no longer current. */
export class AutomationControlStaleVersionError extends Error {
  constructor(expectedVersion: number, currentVersion: number) {
    super(
      `automation control: stale write (expected version ${expectedVersion}, current version ${currentVersion})`,
    );
    this.name = "AutomationControlStaleVersionError";
  }
}

/** Thrown when a patch field is outside its legal bounds. */
export class AutomationControlValidationError extends Error {
  constructor(message: string) {
    super(`automation control: ${message}`);
    this.name = "AutomationControlValidationError";
  }
}

/** Fail-closed defaults; every value is inert until an operator enables it. */
export function defaultAutomationControl(now: string): AutomationControl {
  return {
    enabled: false,
    operatorHold: false,
    limit: 5,
    maxIterations: 10,
    maxCostUsd: 1,
    perCandidateCeilingUsd: 0.5,
    paidAuthorization: false,
    version: 1,
    updatedAt: now,
  };
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new AutomationControlValidationError(`${field} must be a boolean, received ${String(value)}`);
  }
  return value;
}

/**
 * Pure validation: applies `patch` to `current`, producing the next control
 * with `version` bumped by one and `updatedAt` set to `now`. Only the patched
 * fields change; every other field comes from the live record, so a stale
 * snapshot can never clobber newer state (the caller's CAS on `version` guards
 * that at the store layer). An empty patch is rejected — a mutation must change
 * at least one field.
 */
export function applyAutomationControlPatch(
  current: AutomationControl,
  patch: AutomationControlPatch,
  now: string,
): AutomationControl {
  if (Object.keys(patch).length === 0) {
    throw new AutomationControlValidationError("patch must change at least one field");
  }

  const next: AutomationControl = { ...current };

  if (patch.enabled !== undefined) {
    next.enabled = assertBoolean(patch.enabled, "enabled");
  }
  if (patch.operatorHold !== undefined) {
    next.operatorHold = assertBoolean(patch.operatorHold, "operatorHold");
  }
  if (patch.limit !== undefined) {
    if (
      typeof patch.limit !== "number" ||
      !Number.isSafeInteger(patch.limit) ||
      patch.limit < AUTOMATION_LIMIT_MIN ||
      patch.limit > AUTOMATION_LIMIT_CAP
    ) {
      throw new AutomationControlValidationError(
        `limit must be an integer in [${AUTOMATION_LIMIT_MIN}, ${AUTOMATION_LIMIT_CAP}], received ${String(patch.limit)}`,
      );
    }
    next.limit = patch.limit;
  }
  if (patch.maxIterations !== undefined) {
    if (
      typeof patch.maxIterations !== "number" ||
      !Number.isSafeInteger(patch.maxIterations) ||
      patch.maxIterations < 0
    ) {
      throw new AutomationControlValidationError(
        `maxIterations must be a nonnegative integer, received ${String(patch.maxIterations)}`,
      );
    }
    next.maxIterations = patch.maxIterations;
  }
  if (patch.maxCostUsd !== undefined) {
    if (typeof patch.maxCostUsd !== "number" || !isFiniteNonnegative(patch.maxCostUsd)) {
      throw new AutomationControlValidationError(
        `maxCostUsd must be finite and nonnegative, received ${String(patch.maxCostUsd)}`,
      );
    }
    next.maxCostUsd = patch.maxCostUsd;
  }
  if (patch.perCandidateCeilingUsd !== undefined) {
    if (
      typeof patch.perCandidateCeilingUsd !== "number" ||
      !isFiniteNonnegative(patch.perCandidateCeilingUsd)
    ) {
      throw new AutomationControlValidationError(
        `perCandidateCeilingUsd must be finite and nonnegative, received ${String(patch.perCandidateCeilingUsd)}`,
      );
    }
    next.perCandidateCeilingUsd = patch.perCandidateCeilingUsd;
  }
  if (patch.paidAuthorization !== undefined) {
    next.paidAuthorization = assertBoolean(patch.paidAuthorization, "paidAuthorization");
  }

  next.version = current.version + 1;
  next.updatedAt = now;
  return next;
}
