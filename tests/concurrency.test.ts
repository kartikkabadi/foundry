import { describe, expect, it } from "vitest";
import { MAX_CONCURRENT_WORKERS, workerQueueDepth, withWorkerSlot } from "../lib/foundry/concurrency";

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
    await Promise.all(Array.from({ length: MAX_CONCURRENT_WORKERS * 2 }, () => withWorkerSlot(task)));
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_WORKERS);
  });

  it("reports queue depth while waiting", async () => {
    let resolveFirst!: () => void;
    const gate1 = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const tasks = Array.from({ length: MAX_CONCURRENT_WORKERS }, () => withWorkerSlot(() => gate1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const queued = withWorkerSlot(async () => 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(workerQueueDepth()).toBe(1);
    resolveFirst();
    await Promise.all([...tasks, queued]);
  });
});
