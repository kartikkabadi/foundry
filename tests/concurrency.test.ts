import { describe, expect, it } from "vitest";
import { workerQueueDepth, withWorkerSlot } from "../lib/foundry/concurrency";

describe("concurrency semaphore", () => {
  it("runs work through the semaphore", async () => {
    const result = await withWorkerSlot(async () => 42);
    expect(result).toBe(42);
  });

  it("limits concurrent work", async () => {
    let active = 0;
    let peak = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    };
    await Promise.all(Array.from({ length: 8 }, () => withWorkerSlot(task)));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("reports queue depth while waiting", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const gate1 = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const gate2 = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const first = withWorkerSlot(() => gate1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = withWorkerSlot(() => gate2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const queued = withWorkerSlot(async () => 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(workerQueueDepth()).toBe(1);
    resolveFirst();
    resolveSecond();
    await Promise.all([first, second, queued]);
  });
});
