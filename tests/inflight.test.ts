import { afterEach, describe, expect, it } from "vitest";
import { createInflightMap } from "../lib/foundry/inflight";

// Sentinel keys scoped to these tests so production globals can never leak in.
// Mirrors the per-stage shape (__foundryX) but uniquely named; deleted in
// afterEach so no Map survives between tests or files.
const KEY_A = "__foundryInflightTest_a";
const KEY_B = "__foundryInflightTest_b";

afterEach(() => {
  const store = globalThis as Record<string, unknown>;
  delete store[KEY_A];
  delete store[KEY_B];
});

describe("createInflightMap", () => {
  it("stores the Map on globalThis under the exact key passed", () => {
    const store = globalThis as Record<string, unknown>;
    const inflight = createInflightMap("a", KEY_A);

    expect(store[KEY_A]).toBe(inflight);
    expect(store[KEY_A]).toBeInstanceOf(Map);
  });

  it("returns the SAME Map instance on a second call with the same key (once-only ??= init = HMR durability)", () => {
    // A different `name` label must NOT change which global is touched: only
    // `key` drives property access, so the second call returns the same Map.
    const first = createInflightMap("a", KEY_A);
    const second = createInflightMap("a-different-label", KEY_A);

    expect(second).toBe(first);
    // Same reference: a mutation through one is visible through the other.
    first.set("shared-key", Promise.resolve());
    expect(second.has("shared-key")).toBe(true);
  });

  it("returns independent Maps for different keys", () => {
    const a = createInflightMap("a", KEY_A);
    const b = createInflightMap("b", KEY_B);

    expect(b).not.toBe(a);
    a.set("only-in-a", Promise.resolve());
    expect(a.has("only-in-a")).toBe(true);
    expect(b.has("only-in-a")).toBe(false);
  });

  it("round-trips as Map<string, Promise<void>> via set/has/delete", async () => {
    const inflight = createInflightMap("a", KEY_A);

    expect(inflight.has("issue-1")).toBe(false);
    const work = Promise.resolve();
    inflight.set("issue-1", work);
    expect(inflight.has("issue-1")).toBe(true);
    expect(inflight.get("issue-1")).toBe(work);
    inflight.delete("issue-1");
    expect(inflight.has("issue-1")).toBe(false);
  });
});
