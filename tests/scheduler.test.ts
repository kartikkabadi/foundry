import { describe, expect, it } from "vitest";
import {
  overlappingPaths,
  schedule,
  type HostState,
  type ModelState,
  type ScheduleInput,
} from "../lib/foundry/scheduler";
import {
  DEFAULT_TEXT_MODEL,
  type HostId,
  type ModelCapability,
  type OrchestrationTask,
} from "../lib/foundry/orchestration-types";

const VPS: HostState = {
  id: "vps",
  budget: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 },
  used: { cpu: 0, memoryMiB: 0, diskMiB: 0, concurrency: 0 },
};
const BOX: HostState = {
  id: "box",
  budget: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 },
  used: { cpu: 0, memoryMiB: 0, diskMiB: 0, concurrency: 0 },
};
const MAC: HostState = {
  id: "mac",
  budget: { cpu: 10, memoryMiB: 16384, diskMiB: 81920, concurrency: 8 },
  used: { cpu: 0, memoryMiB: 0, diskMiB: 0, concurrency: 0 },
};

const TEXT_CAPABILITIES: readonly ModelCapability[] = ["text"];
const TEXT_VISION_CAPABILITIES: readonly ModelCapability[] = ["text", "vision"];

const TEXT_MODEL: ModelState = {
  id: DEFAULT_TEXT_MODEL,
  capabilities: TEXT_CAPABILITIES,
  maxConcurrent: 4,
  concurrent: 0,
};

function at(minute: number): string {
  return new Date(Date.UTC(2026, 7, 25, 9, minute)).toISOString();
}

function makeTask(
  overrides: Partial<OrchestrationTask> & { id: string; createdAt: string },
): OrchestrationTask {
  return {
    runId: "run-1",
    name: overrides.id,
    state: "ready",
    deps: [],
    host: null,
    isolation: null,
    resources: { cpu: 1, memoryMiB: 1024, diskMiB: 1024, concurrency: 1 },
    model: { capability: "text", costCeilingUsd: null },
    route: { primary: DEFAULT_TEXT_MODEL, paidFallback: null, paidCostCeilingUsd: null },
    claims: [],
    updatedAt: overrides.createdAt,
    attempts: 0,
    maxAttempts: 3,
    retryable: false,
    nextRetryAt: null,
    error: null,
    leaseId: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function baseInput(
  tasks: OrchestrationTask[],
  hosts: Partial<Record<HostId, HostState>>,
  models: Record<string, ModelState> = { [DEFAULT_TEXT_MODEL]: TEXT_MODEL },
  now = "2026-08-25T10:00:00.000Z",
): ScheduleInput {
  return { tasks, hosts, models, now };
}

describe("schedule", () => {
  it("blocks a ready task until its dependencies succeed", () => {
    const running = makeTask({ id: "r", createdAt: at(0), state: "running" });
    const waiting = makeTask({ id: "t", createdAt: at(1), deps: ["r"] });
    const out = schedule(baseInput([running, waiting], { vps: VPS }));
    expect(out.dispatched).toEqual([]);
    expect(out.reasons).toContainEqual({
      taskId: "t",
      code: "blocked-by-pending-dependency",
      detail: expect.stringContaining("r"),
    });
  });

  it("reports a failed dependency as permanently blocking", () => {
    const failed = makeTask({ id: "f", createdAt: at(0), state: "failed" });
    const waiting = makeTask({ id: "t", createdAt: at(1), deps: ["f"] });
    const out = schedule(baseInput([failed, waiting], { vps: VPS }));
    expect(out.reasons).toContainEqual({
      taskId: "t",
      code: "blocked-by-failed-dependency",
      detail: expect.stringContaining("f"),
    });
  });

  it("reports a cancelled dependency as blocking", () => {
    const cancelled = makeTask({ id: "c", createdAt: at(0), state: "cancelled" });
    const waiting = makeTask({ id: "t", createdAt: at(1), deps: ["c"] });
    const out = schedule(baseInput([cancelled, waiting], { vps: VPS }));
    expect(out.reasons).toContainEqual({
      taskId: "t",
      code: "blocked-by-cancelled-dependency",
      detail: expect.stringContaining("c"),
    });
  });

  it("dispatches a task once every dependency has succeeded", () => {
    const done = makeTask({ id: "d", createdAt: at(0), state: "succeeded" });
    const ready = makeTask({ id: "t", createdAt: at(1), deps: ["d"] });
    const out = schedule(baseInput([done, ready], { vps: VPS }));
    expect(out.dispatched).toEqual([{ taskId: "t", host: "vps", model: DEFAULT_TEXT_MODEL }]);
  });

  it("reports a blocked task whose dependencies are all satisfied as not-ready", () => {
    const done = makeTask({ id: "d", createdAt: at(0), state: "succeeded" });
    const stillBlocked = makeTask({ id: "t", createdAt: at(1), state: "blocked", deps: ["d"] });
    const out = schedule(baseInput([done, stillBlocked], { vps: VPS }));
    expect(out.reasons).toContainEqual({
      taskId: "t",
      code: "not-ready",
      detail: expect.stringContaining("dependencies"),
    });
  });

  it("never overcommits the 16 GB VPS memory budget", () => {
    const heavy = makeTask({
      id: "a",
      createdAt: at(0),
      resources: { cpu: 1, memoryMiB: 9000, diskMiB: 1024, concurrency: 1 },
    });
    const medium = makeTask({
      id: "b",
      createdAt: at(1),
      resources: { cpu: 1, memoryMiB: 7000, diskMiB: 1024, concurrency: 1 },
    });
    const light = makeTask({
      id: "c",
      createdAt: at(2),
      resources: { cpu: 1, memoryMiB: 1000, diskMiB: 1024, concurrency: 1 },
    });
    // Shuffled input order; dispatch must still follow age order.
    const out = schedule(baseInput([light, heavy, medium], { vps: VPS }));
    expect(out.dispatched.map((decision) => decision.taskId)).toEqual(["a", "b"]);
    expect(out.reasons).toContainEqual({ taskId: "c", code: "no-capacity", detail: expect.any(String) });
  });

  it("accounts for running tasks already occupying host capacity", () => {
    const busyVps: HostState = {
      ...VPS,
      used: { cpu: 2, memoryMiB: 12000, diskMiB: 8192, concurrency: 1 },
    };
    const waiting = makeTask({
      id: "t",
      createdAt: at(0),
      resources: { cpu: 1, memoryMiB: 6000, diskMiB: 1024, concurrency: 1 },
    });
    const out = schedule(baseInput([waiting], { vps: busyVps }));
    expect(out.reasons).toContainEqual({ taskId: "t", code: "no-capacity", detail: expect.any(String) });
  });

  it("rejects overlapping write claims within a dispatch pass", () => {
    const a = makeTask({ id: "a", createdAt: at(0), claims: ["src/a.ts"] });
    const b = makeTask({ id: "b", createdAt: at(1), claims: ["src/a.ts"] });
    const c = makeTask({ id: "c", createdAt: at(2), claims: ["src/b.ts"] });
    const directory = makeTask({ id: "d", createdAt: at(3), claims: ["src"] });
    const out = schedule(baseInput([a, b, c, directory], { vps: VPS }));
    expect(out.dispatched.map((decision) => decision.taskId)).toEqual(["a", "c"]);
    expect(out.reasons).toContainEqual({ taskId: "b", code: "file-conflict", detail: expect.any(String) });
    expect(out.reasons).toContainEqual({ taskId: "d", code: "file-conflict", detail: expect.any(String) });
  });

  it("treats running tasks' write claims as conflicts", () => {
    const running = makeTask({ id: "r", createdAt: at(0), state: "running", claims: ["lib/"] });
    const waiting = makeTask({ id: "t", createdAt: at(1), claims: ["lib/foundry/types.ts"] });
    const out = schedule(baseInput([running, waiting], { vps: VPS }));
    expect(out.reasons).toContainEqual({ taskId: "t", code: "file-conflict", detail: expect.any(String) });
  });

  it("treats alias write claims as conflicts within a dispatch pass", () => {
    const a = makeTask({ id: "a", createdAt: at(0), claims: ["src\\a.ts"] });
    const b = makeTask({ id: "b", createdAt: at(1), claims: ["src/./a.ts"] });
    const c = makeTask({ id: "c", createdAt: at(2), claims: ["src//b.ts"] });
    const out = schedule(baseInput([a, b, c], { vps: VPS }));
    expect(out.dispatched.map((decision) => decision.taskId)).toEqual(["a", "c"]);
    expect(out.reasons).toContainEqual({ taskId: "b", code: "file-conflict", detail: expect.any(String) });
  });

  it("matches running tasks' alias write claims as conflicts", () => {
    const running = makeTask({ id: "r", createdAt: at(0), state: "running", claims: ["lib\\foundry\\"] });
    const waiting = makeTask({ id: "t", createdAt: at(1), claims: ["lib/foundry/types.ts"] });
    const out = schedule(baseInput([running, waiting], { vps: VPS }));
    expect(out.reasons).toContainEqual({ taskId: "t", code: "file-conflict", detail: expect.any(String) });
  });

  it("fails closed when a ready task claims a parent-traversal path", () => {
    const sneaky = makeTask({ id: "s", createdAt: at(0), claims: ["src/../lib"] });
    expect(() => schedule(baseInput([sneaky], { vps: VPS }))).toThrow();
  });

  it("fails closed when an in-flight task claims a parent-traversal path", () => {
    const running = makeTask({ id: "r", createdAt: at(0), state: "running", claims: ["../etc"] });
    expect(() => schedule(baseInput([running], { vps: VPS }))).toThrow();
  });

  it("caps concurrent dispatches per model", () => {
    const capped = { ...TEXT_MODEL, maxConcurrent: 2 };
    const a = makeTask({ id: "a", createdAt: at(0) });
    const b = makeTask({ id: "b", createdAt: at(1) });
    const c = makeTask({ id: "c", createdAt: at(2) });
    const out = schedule(baseInput([a, b, c], { vps: VPS }, { [DEFAULT_TEXT_MODEL]: capped }));
    expect(out.dispatched.map((decision) => decision.taskId)).toEqual(["a", "b"]);
    expect(out.reasons).toContainEqual({
      taskId: "c",
      code: "model-concurrency",
      detail: expect.stringContaining(DEFAULT_TEXT_MODEL),
    });
  });

  it("holds dispatches while the model is cooling down and releases after", () => {
    const cooling = { ...TEXT_MODEL, cooldownUntil: "2026-08-25T10:05:00.000Z" };
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const duringCooldown = schedule(
      baseInput([waiting], { vps: VPS }, { [DEFAULT_TEXT_MODEL]: cooling }, "2026-08-25T10:00:00.000Z"),
    );
    expect(duringCooldown.dispatched).toEqual([]);
    expect(duringCooldown.reasons).toContainEqual({
      taskId: "t",
      code: "model-cooldown",
      detail: expect.stringContaining("10:05"),
    });
    const afterCooldown = schedule(
      baseInput([waiting], { vps: VPS }, { [DEFAULT_TEXT_MODEL]: cooling }, "2026-08-25T10:06:00.000Z"),
    );
    expect(afterCooldown.dispatched).toEqual([{ taskId: "t", host: "vps", model: DEFAULT_TEXT_MODEL }]);
  });

  it("accounts for running tasks in model concurrency", () => {
    const busy = { ...TEXT_MODEL, maxConcurrent: 1, concurrent: 1 };
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const out = schedule(baseInput([waiting], { vps: VPS }, { [DEFAULT_TEXT_MODEL]: busy }));
    expect(out.reasons).toContainEqual({ taskId: "t", code: "model-concurrency", detail: expect.any(String) });
  });

  it("routes visual (mac-pinned) tasks to mac only", () => {
    const visual = makeTask({ id: "v", createdAt: at(0), host: "mac" });
    const out = schedule(baseInput([visual], { vps: VPS, box: BOX, mac: MAC }));
    expect(out.dispatched).toEqual([{ taskId: "v", host: "mac", model: DEFAULT_TEXT_MODEL }]);
  });

  it("never places non-visual tasks on mac even when it has capacity", () => {
    const fullVps: HostState = { ...VPS, used: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 } };
    const fullBox: HostState = { ...BOX, used: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 } };
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const out = schedule(baseInput([waiting], { vps: fullVps, box: fullBox, mac: MAC }));
    expect(out.dispatched).toEqual([]);
    // Box is disabled by default, so the task defers on box rather than
    // spilling onto the mac (which is reserved for visual work).
    expect(out.reasons).toContainEqual({ taskId: "t", code: "box-disabled", detail: expect.any(String) });
  });

  it("fails a visual task when no mac host is registered", () => {
    const visual = makeTask({ id: "v", createdAt: at(0), host: "mac" });
    const out = schedule(baseInput([visual], { vps: VPS, box: BOX }));
    expect(out.reasons).toContainEqual({ taskId: "v", code: "no-eligible-host", detail: expect.any(String) });
  });

  it("overflows to box when vps is at capacity and a positive burst ceiling is set", () => {
    const fullVps: HostState = { ...VPS, used: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 } };
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const input = baseInput([waiting], { vps: fullVps, box: BOX });
    const out = schedule({ ...input, policy: { boxBurstCostCeilingUsd: 1 } });
    expect(out.dispatched).toEqual([{ taskId: "t", host: "box", model: DEFAULT_TEXT_MODEL }]);
  });

  it("defers a box-pinned task when burst is disabled", () => {
    const boxPinned = makeTask({ id: "t", createdAt: at(0), host: "box" });
    const out = schedule(baseInput([boxPinned], { box: BOX }));
    expect(out.dispatched).toEqual([]);
    expect(out.reasons).toContainEqual({ taskId: "t", code: "box-disabled", detail: expect.any(String) });
  });

  it("dispatches a box-pinned task when a positive burst ceiling is set", () => {
    const boxPinned = makeTask({ id: "t", createdAt: at(0), host: "box" });
    const input = baseInput([boxPinned], { box: BOX });
    const out = schedule({ ...input, policy: { boxBurstCostCeilingUsd: 1 } });
    expect(out.dispatched).toEqual([{ taskId: "t", host: "box", model: DEFAULT_TEXT_MODEL }]);
  });

  it("prefers vps over box when both have capacity", () => {
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const out = schedule(baseInput([waiting], { vps: VPS, box: BOX }));
    expect(out.dispatched).toEqual([{ taskId: "t", host: "vps", model: DEFAULT_TEXT_MODEL }]);
  });

  it("defers with box-disabled when only disabled box could run the task", () => {
    const fullVps: HostState = { ...VPS, used: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 } };
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const out = schedule(baseInput([waiting], { vps: fullVps, box: BOX }));
    expect(out.dispatched).toEqual([]);
    expect(out.reasons).toContainEqual({ taskId: "t", code: "box-disabled", detail: expect.any(String) });
  });

  it("keeps box disabled with a zero or negative burst ceiling", () => {
    const fullVps: HostState = { ...VPS, used: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 } };
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const input = baseInput([waiting], { vps: fullVps, box: BOX });
    for (const ceiling of [0, -1]) {
      const out = schedule({ ...input, policy: { boxBurstCostCeilingUsd: ceiling } });
      expect(out.dispatched).toEqual([]);
      expect(out.reasons).toContainEqual({ taskId: "t", code: "box-disabled", detail: expect.any(String) });
    }
  });

  it("reports no-capacity when box is enabled but both hosts are full", () => {
    const fullVps: HostState = { ...VPS, used: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 } };
    const fullBox: HostState = { ...BOX, used: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 } };
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const input = baseInput([waiting], { vps: fullVps, box: fullBox });
    const out = schedule({ ...input, policy: { boxBurstCostCeilingUsd: 1 } });
    expect(out.dispatched).toEqual([]);
    expect(out.reasons).toContainEqual({ taskId: "t", code: "no-capacity", detail: expect.any(String) });
  });

  it("dispatches older tasks first when capacity is tight", () => {
    const young = makeTask({
      id: "young",
      createdAt: at(60),
      resources: { cpu: 1, memoryMiB: 6000, diskMiB: 1024, concurrency: 1 },
    });
    const old = makeTask({
      id: "old",
      createdAt: at(0),
      resources: { cpu: 1, memoryMiB: 6000, diskMiB: 1024, concurrency: 1 },
    });
    const smallVps: HostState = { ...VPS, budget: { ...VPS.budget, memoryMiB: 10000 } };
    const out = schedule(baseInput([young, old], { vps: smallVps }));
    expect(out.dispatched.map((decision) => decision.taskId)).toEqual(["old"]);
    expect(out.reasons).toContainEqual({ taskId: "young", code: "no-capacity", detail: expect.any(String) });
  });

  it("breaks createdAt ties deterministically by task id", () => {
    const a = makeTask({ id: "a", createdAt: at(0) });
    const b = makeTask({ id: "b", createdAt: at(0) });
    const oneSlot: HostState = { ...VPS, budget: { ...VPS.budget, concurrency: 1 } };
    // Input order [b, a]; tie-break must pick "a" regardless.
    const out = schedule(baseInput([b, a], { vps: oneSlot }));
    expect(out.dispatched.map((decision) => decision.taskId)).toEqual(["a"]);
    expect(out.reasons).toContainEqual({ taskId: "b", code: "no-capacity", detail: expect.any(String) });
  });

  it("routes vision work only to a vision-capable model", () => {
    const visionModel: ModelState = {
      id: "claude-vision",
      capabilities: TEXT_VISION_CAPABILITIES,
      maxConcurrent: 2,
      concurrent: 0,
    };
    const vision = makeTask({
      id: "v",
      createdAt: at(0),
      model: { capability: "vision", costCeilingUsd: null },
      route: { primary: "claude-vision", paidFallback: null, paidCostCeilingUsd: null },
    });
    const out = schedule(
      baseInput([vision], { vps: VPS }, { [DEFAULT_TEXT_MODEL]: TEXT_MODEL, "claude-vision": visionModel }),
    );
    expect(out.dispatched).toEqual([{ taskId: "v", host: "vps", model: "claude-vision" }]);
  });

  it("rejects vision work routed to a model without vision capability", () => {
    const vision = makeTask({
      id: "v",
      createdAt: at(0),
      model: { capability: "vision", costCeilingUsd: null },
      route: { primary: DEFAULT_TEXT_MODEL, paidFallback: null, paidCostCeilingUsd: null },
    });
    const out = schedule(baseInput([vision], { vps: VPS }));
    expect(out.reasons).toContainEqual({
      taskId: "v",
      code: "model-unavailable",
      detail: expect.stringContaining("vision"),
    });
  });

  it("refuses a paid fallback without an explicit cost ceiling", () => {
    const busyText = { ...TEXT_MODEL, maxConcurrent: 1, concurrent: 1 };
    const expensive: ModelState = {
      id: "gpt-expensive",
      capabilities: TEXT_VISION_CAPABILITIES,
      maxConcurrent: 2,
      concurrent: 0,
    };
    const paid = makeTask({
      id: "p",
      createdAt: at(0),
      route: { primary: DEFAULT_TEXT_MODEL, paidFallback: "gpt-expensive", paidCostCeilingUsd: null },
    });
    const out = schedule(
      baseInput([paid], { vps: VPS }, { [DEFAULT_TEXT_MODEL]: busyText, "gpt-expensive": expensive }),
    );
    expect(out.reasons).toContainEqual({
      taskId: "p",
      code: "no-cost-ceiling",
      detail: expect.stringContaining("gpt-expensive"),
    });
  });

  it("uses a paid fallback only when the ceiling is explicit", () => {
    const busyText = { ...TEXT_MODEL, maxConcurrent: 1, concurrent: 1 };
    const expensive: ModelState = {
      id: "gpt-expensive",
      capabilities: TEXT_VISION_CAPABILITIES,
      maxConcurrent: 2,
      concurrent: 0,
    };
    const paid = makeTask({
      id: "p",
      createdAt: at(0),
      route: { primary: DEFAULT_TEXT_MODEL, paidFallback: "gpt-expensive", paidCostCeilingUsd: 5 },
    });
    const out = schedule(
      baseInput([paid], { vps: VPS }, { [DEFAULT_TEXT_MODEL]: busyText, "gpt-expensive": expensive }),
    );
    expect(out.dispatched).toEqual([{ taskId: "p", host: "vps", model: "gpt-expensive" }]);
  });

  it("returns a reason for every task it cannot dispatch", () => {
    const running = makeTask({ id: "r", createdAt: at(0), state: "running" });
    const blocked = makeTask({ id: "b", createdAt: at(1), deps: ["r"] });
    const capped = makeTask({ id: "c", createdAt: at(2) });
    const fullVps: HostState = { ...VPS, used: { cpu: 4, memoryMiB: 16384, diskMiB: 40960, concurrency: 4 } };
    const out = schedule(baseInput([running, blocked, capped], { vps: fullVps }));
    expect(out.dispatched).toEqual([]);
    expect(new Set(out.reasons.map((reason) => reason.taskId))).toEqual(new Set(["b", "c"]));
  });

  it("is deterministic for identical inputs", () => {
    const tasks = [
      makeTask({ id: "a", createdAt: at(0), claims: ["src/a.ts"] }),
      makeTask({ id: "b", createdAt: at(1), deps: ["a"] }),
      makeTask({ id: "c", createdAt: at(2), resources: { cpu: 1, memoryMiB: 16300, diskMiB: 1024, concurrency: 1 } }),
    ];
    const input = baseInput(tasks, { vps: VPS });
    expect(schedule(input)).toEqual(schedule(input));
  });

  it("preserves existing behavior when gate input is absent", () => {
    const waiting = makeTask({ id: "t", createdAt: at(0) });
    const out = schedule(baseInput([waiting], { vps: VPS }));
    expect(out.dispatched).toEqual([{ taskId: "t", host: "vps", model: DEFAULT_TEXT_MODEL }]);
    expect(out.reasons).toEqual([]);
  });

  it("defers a ready task when a required gate is pending", () => {
    const gated = makeTask({ id: "t", createdAt: at(0) });
    // Gate state absent entirely: every required gate is pending.
    const out = schedule({ ...baseInput([gated], { vps: VPS }), requiredGatesByTask: { t: ["grill"] } });
    expect(out.dispatched).toEqual([]);
    expect(out.reasons).toContainEqual({
      taskId: "t",
      code: "blocked-by-pending-gate",
      detail: "pending required gates: grill",
    });
  });

  it("treats a gate present as false as pending", () => {
    const gated = makeTask({ id: "t", createdAt: at(0) });
    const out = schedule({
      ...baseInput([gated], { vps: VPS }),
      gates: { grill: false },
      requiredGatesByTask: { t: ["grill"] },
    });
    expect(out.dispatched).toEqual([]);
    expect(out.reasons).toContainEqual({
      taskId: "t",
      code: "blocked-by-pending-gate",
      detail: "pending required gates: grill",
    });
  });

  it("lists pending required gate ids deterministically in sorted order", () => {
    const gated = makeTask({ id: "t", createdAt: at(0) });
    // Unsorted requirement list; plan is satisfied, the rest are pending.
    const out = schedule({
      ...baseInput([gated], { vps: VPS }),
      gates: { plan: true },
      requiredGatesByTask: { t: ["grill", "evidence", "plan"] },
    });
    expect(out.dispatched).toEqual([]);
    expect(out.reasons).toContainEqual({
      taskId: "t",
      code: "blocked-by-pending-gate",
      detail: "pending required gates: evidence, grill",
    });
  });

  it("dispatches a task once all its required gates are satisfied", () => {
    const gated = makeTask({ id: "t", createdAt: at(0) });
    const out = schedule({
      ...baseInput([gated], { vps: VPS }),
      gates: { grill: true, plan: true },
      requiredGatesByTask: { t: ["grill", "plan"] },
    });
    expect(out.dispatched).toEqual([{ taskId: "t", host: "vps", model: DEFAULT_TEXT_MODEL }]);
    expect(out.reasons).toEqual([]);
  });

  it("ignores gate state for tasks without required gates", () => {
    const free = makeTask({ id: "t", createdAt: at(0) });
    const gated = makeTask({ id: "g", createdAt: at(1) });
    const out = schedule({
      ...baseInput([free, gated], { vps: VPS }),
      gates: {},
      requiredGatesByTask: { g: ["grill"] },
    });
    expect(out.dispatched).toEqual([{ taskId: "t", host: "vps", model: DEFAULT_TEXT_MODEL }]);
    expect(out.reasons).toContainEqual({
      taskId: "g",
      code: "blocked-by-pending-gate",
      detail: expect.any(String),
    });
  });
});

describe("overlappingPaths", () => {
  it("detects equality and directory-prefix overlaps", () => {
    expect(overlappingPaths("src", "src")).toBe(true);
    expect(overlappingPaths("src", "src/a.ts")).toBe(true);
    expect(overlappingPaths("src/a.ts", "src")).toBe(true);
    expect(overlappingPaths("src/", "src/a.ts")).toBe(true);
    expect(overlappingPaths("src/a.ts", "src/b.ts")).toBe(false);
    expect(overlappingPaths("src", "srcx")).toBe(false);
    expect(overlappingPaths("lib/a", "lib")).toBe(true);
  });

  it("treats slash-direction aliases as overlapping", () => {
    expect(overlappingPaths("src\\a.ts", "src/a.ts")).toBe(true);
    expect(overlappingPaths("lib\\foundry", "lib/foundry/scheduler.ts")).toBe(true);
    expect(overlappingPaths("src\\a.ts", "src\\b.ts")).toBe(false);
  });

  it("collapses repeated separators and dot segments", () => {
    expect(overlappingPaths("src//a.ts", "src/a.ts")).toBe(true);
    expect(overlappingPaths("src/./a.ts", "src/a.ts")).toBe(true);
    expect(overlappingPaths("./src", "src")).toBe(true);
    expect(overlappingPaths("lib/./foundry/./types.ts", "lib/foundry/types.ts")).toBe(true);
    expect(() => overlappingPaths("src/a.ts", "src/../b.ts")).toThrow();
  });

  it("strips trailing separators from directory claims", () => {
    expect(overlappingPaths("src/", "src")).toBe(true);
    expect(overlappingPaths("src//", "src/a.ts")).toBe(true);
    expect(overlappingPaths("src/", "srcx")).toBe(false);
  });

  it("keeps absolute and relative claims distinct", () => {
    expect(overlappingPaths("/src/a.ts", "/src")).toBe(true);
    expect(overlappingPaths("/src/a.ts", "/src/a.ts")).toBe(true);
    expect(overlappingPaths("/src/a.ts", "src/a.ts")).toBe(false);
    expect(overlappingPaths("/src", "src")).toBe(false);
  });

  it("normalizes Windows drive letters but keeps the tail case-sensitive", () => {
    expect(overlappingPaths("C:\\Users\\Ada\\src", "c:/Users/Ada/src")).toBe(true);
    expect(overlappingPaths("c:/Users/Ada", "C:/Users/Ada/lib.ts")).toBe(true);
    expect(overlappingPaths("C:\\", "c:/")).toBe(true);
    expect(overlappingPaths("C:/Users/Ada/src.ts", "C:/users/ada/src.ts")).toBe(false);
    expect(overlappingPaths("C:/Users", "D:/Users")).toBe(false);
  });

  it("normalizes UNC server and share case-insensitively", () => {
    expect(overlappingPaths("\\\\server\\share\\src", "//SERVER/SHARE/src")).toBe(true);
    expect(overlappingPaths("//server/share", "//SERVER/SHARE/lib/a.ts")).toBe(true);
    expect(overlappingPaths("\\\\server\\share", "\\\\server\\share")).toBe(true);
    expect(overlappingPaths("//server/share/a", "//server/other/a")).toBe(false);
  });

  it("keeps repository-relative POSIX claims case-sensitive", () => {
    expect(overlappingPaths("src/A.ts", "src/a.ts")).toBe(false);
    expect(overlappingPaths("Lib", "lib")).toBe(false);
  });

  it("does not treat a sibling prefix as overlapping", () => {
    expect(overlappingPaths("src", "srcx")).toBe(false);
    expect(overlappingPaths("src/a.ts", "srcx/a.ts")).toBe(false);
    expect(overlappingPaths("lib/a", "lib")).toBe(true);
  });

  it("rejects parent traversal", () => {
    expect(() => overlappingPaths("../secret", "secret")).toThrow();
    expect(() => overlappingPaths("src/../lib", "lib")).toThrow();
    expect(() => overlappingPaths("..", ".")).toThrow();
    expect(() => overlappingPaths("C:\\Users\\..\\etc", "C:/etc")).toThrow();
    expect(() => overlappingPaths("\\\\server\\share\\..\\x", "//SERVER/SHARE")).toThrow();
  });

  it("rejects empty claims", () => {
    expect(() => overlappingPaths("", "src")).toThrow();
    expect(() => overlappingPaths("./", "src")).toThrow();
    expect(() => overlappingPaths(".", "src")).toThrow();
  });

  it("rejects invalid drive-relative and UNC forms", () => {
    expect(() => overlappingPaths("C:foo", "C:/foo")).toThrow();
    expect(() => overlappingPaths("\\\\server", "//server/share")).toThrow();
    expect(() => overlappingPaths("//", "//a/b")).toThrow();
  });
});
