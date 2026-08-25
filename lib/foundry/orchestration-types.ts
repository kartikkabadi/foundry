// Orchestration domain types for the multi-agent engineering system.
// New orchestration primitives use string IDs and ISO-8601 timestamps.
// Scheduler output is a pure dispatch decision; execution stays behind adapters.

import type { StageId } from "./types";

export const HOSTS = ["mac", "vps", "box"] as const;
export type HostId = (typeof HOSTS)[number];

export const TASK_STATES = [
  "blocked",
  "ready",
  "leased",
  "running",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_TASK_STATES = ["succeeded", "failed", "cancelled"] as const;
export type TerminalTaskState = (typeof TERMINAL_TASK_STATES)[number];

export const RUN_STATUSES = ["active", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ISOLATION_KINDS = ["git-worktree", "container", "vm"] as const;
export type IsolationKind = (typeof ISOLATION_KINDS)[number];

export const MODEL_CAPABILITIES = ["text", "vision"] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export type AttemptStatus = "running" | "succeeded" | "failed" | "cancelled";

export type ResourceBudget = {
  cpu: number;
  memoryMiB: number;
  diskMiB: number;
  concurrency: number;
};

export type Isolation = {
  kind: IsolationKind;
  ref: string;
};

export type ModelRequirement = {
  capability: ModelCapability;
  costCeilingUsd: number | null;
};

export type ModelRoute = {
  primary: string;
  paidFallback: string | null;
  paidCostCeilingUsd: number | null;
};

export type FileClaim = {
  taskId: string;
  writePaths: string[];
};

export type OrchestrationTask = {
  id: string;
  runId: string;
  name: string;
  state: TaskState;
  // Integer compare-and-set token. The store stamps version=1 on create and
  // bumps it on every mutation; a write whose expected version no longer
  // matches the row is rejected as stale. Optional only so read-only task
  // fixtures elsewhere can omit it — store-produced tasks always carry one.
  version?: number;
  deps: string[];
  host: HostId | null;
  isolation: Isolation | null;
  resources: ResourceBudget;
  model: ModelRequirement;
  route: ModelRoute;
  claims: string[];
  attempts: number;
  maxAttempts: number;
  // Durable retry decision: whether the last failure was retryable and the
  // ISO timestamp after which the task may be retried. Written atomically with
  // `failTask`, cleared by `retryTask` and every terminal/cancel path. The
  // coordinator reconstructs a due retry from these fields on the task snapshot,
  // so the decision survives driver invocations and store reconnects.
  retryable: boolean;
  nextRetryAt: string | null;
  error: string | null;
  leaseId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type TaskAttempt = {
  id: string;
  taskId: string;
  index: number;
  status: AttemptStatus;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
};

export type TaskLease = {
  id: string;
  taskId: string;
  host: HostId;
  owner: string;
  createdAt: string;
  expiresAt: string;
  releasedAt: string | null;
};

export type TaskArtifact = {
  id: string;
  taskId: string;
  kind: string;
  path: string | null;
  body: string | null;
  createdAt: string;
};

export type OrchestrationRun = {
  id: string;
  issueId: string;
  stage: StageId;
  name: string;
  status: RunStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OrchestrationEvent = {
  seq: number;
  ts: string;
  runId: string;
  taskId: string | null;
  kind: string;
  payload: Record<string, unknown>;
};

export type GraphValidation = {
  ok: boolean;
  errors: string[];
};

export const DEFAULT_TEXT_MODEL = "omp/deepseek-v4-flash";
export const DEFAULT_COST_CEILING_USD = 0.1;
export const DEFAULT_MAX_ATTEMPTS = 3;

export function isTerminalState(state: TaskState): state is TerminalTaskState {
  return (TERMINAL_TASK_STATES as readonly string[]).includes(state);
}

// Legal state transitions for a task. Key is the current state, value is the
// set of states reachable from it. Anything not listed here is illegal and a
// store transition must reject it with an actionable error.
export const LEGAL_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  blocked: ["ready", "cancelled"],
  ready: ["leased", "cancelled"],
  leased: ["running", "ready", "cancelled"],
  // A run cannot succeed without passing through verification; success is
  // only reachable from `verifying`.
  running: ["verifying", "failed", "cancelled"],
  verifying: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["ready", "cancelled"],
  cancelled: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

const SLASH = 47; // "/"
const BACKSLASH = 92; // "\"
const DOT = 46; // "."
const COLON = 58; // ":"

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

// Walks `path` from `start`, collecting segments separated by either slash.
// Drops "." and empty segments; throws on ".." so a claim can never widen its
// write scope above its root.
function collectSegments(path: string, start: number): string[] {
  const segments: string[] = [];
  let segStart = start;
  for (let i = start; i <= path.length; i++) {
    const code = i === path.length ? SLASH : path.charCodeAt(i);
    if (code !== SLASH && code !== BACKSLASH) continue;
    if (i > segStart) {
      const segLen = i - segStart;
      const first = path.charCodeAt(segStart);
      if (segLen === 1 && first === DOT) {
        // "." resolves to the current directory; drop it.
      } else if (segLen === 2 && first === DOT && path.charCodeAt(segStart + 1) === DOT) {
        throw new Error(`claim path ${JSON.stringify(path)} traverses above its root`);
      } else {
        segments.push(path.slice(segStart, i));
      }
    }
    segStart = i + 1;
  }
  return segments;
}

function canonicalizePosix(path: string): string {
  const absolute = path.charCodeAt(0) === SLASH || path.charCodeAt(0) === BACKSLASH;

  // Fast path: a relative repository claim with nothing to normalize returns
  // unchanged, so the scheduler's common case allocates nothing.
  if (!absolute) {
    let segmentBoundary = true;
    let clean = true;
    for (let i = 0; i < path.length; i++) {
      const code = path.charCodeAt(i);
      if (code === SLASH || code === BACKSLASH) {
        if (code === BACKSLASH || segmentBoundary) {
          clean = false;
          break;
        }
        segmentBoundary = true;
      } else if (code === DOT && segmentBoundary) {
        clean = false;
        break;
      } else {
        segmentBoundary = false;
      }
    }
    if (clean && !segmentBoundary) return path;
  }

  const joined = collectSegments(path, absolute ? 1 : 0).join("/");
  if (absolute) return joined === "" ? "/" : `/${joined}`;
  if (joined === "") throw new Error(`claim path ${JSON.stringify(path)} is empty`);
  return joined;
}

function canonicalizeUnc(path: string): string {
  const segments = collectSegments(path, 2);
  if (segments.length < 2) {
    throw new Error(`claim path ${JSON.stringify(path)} is not a valid UNC path`);
  }
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    // Server and share names are case-insensitive on Windows; the tail stays case-sensitive.
    out.push(i < 2 ? segments[i].toUpperCase() : segments[i]);
  }
  return `//${out.join("/")}`;
}

function canonicalizeDrive(path: string): string {
  const drive = `${path[0].toUpperCase()}:`;
  if (path.length === 2) return drive;
  const third = path.charCodeAt(2);
  if (third !== SLASH && third !== BACKSLASH) {
    throw new Error(`claim path ${JSON.stringify(path)} is drive-relative; use an absolute path`);
  }
  const segments = collectSegments(path, 3);
  return segments.length === 0 ? drive : `${drive}/${segments.join("/")}`;
}

/**
 * Canonical form of a write-path claim, so equivalent aliases collide
 * deterministically. Slash direction, repeated separators, "." segments and
 * trailing separators normalize away; Windows drive letters and UNC server +
 * share are case-insensitive. Repository-relative POSIX claims stay
 * case-sensitive. Empty claims and parent traversal ("..") are rejected so
 * malformed input fails closed instead of silently widening a write scope.
 */
export function canonicalClaimPath(path: string): string {
  if (path.length === 0) throw new Error("claim path must not be empty");
  const first = path.charCodeAt(0);
  const second = path.length > 1 ? path.charCodeAt(1) : -1;

  // UNC: \\server\share\... in either slash direction.
  if ((first === SLASH || first === BACKSLASH) && second === first) {
    return canonicalizeUnc(path);
  }
  // Windows drive: X:\... or X:/...
  if (isAsciiLetter(first) && second === COLON) {
    return canonicalizeDrive(path);
  }
  return canonicalizePosix(path);
}
