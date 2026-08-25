import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOMATION_LIMIT_CAP,
  AUTOMATION_LIMIT_MIN,
  applyAutomationControlPatch,
  defaultAutomationControl,
  type AutomationControl,
  type AutomationControlAdapter,
} from "../lib/foundry/automation-control";

// Fixed base clock so updatedAt / version arithmetic is deterministic.
const BASE = new Date(Date.UTC(2026, 7, 25, 0, 0, 0)).toISOString();

let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "foundry-control-"));
  process.env.FOUNDRY_DATA = join(dataDir, "data");
  vi.resetModules();
});

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function clock() {
  let t = Date.parse(BASE);
  return {
    stamp: () => new Date(t).toISOString(),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

// Dynamic import is deliberate: store.ts holds a module-level SQLite `db`
// singleton, so a fresh module instance (after vi.resetModules) is what
// simulates a new connection and proves rows really persisted to disk rather
// than to a shared cache. Static import cannot work here.
async function loadStore(options?: { now?: () => string }): Promise<AutomationControlAdapter> {
  const { createAutomationControlStore } = await import("../lib/foundry/store");
  return createAutomationControlStore(options);
}

// The store is loaded through a fresh module instance (see loadStore), which
// re-evaluates automation-control too, so its thrown error classes have a
// different identity than the statically-imported ones. Assert on the stable
// `name` and message instead of `instanceof`.
function expectThrowsNamed(fn: () => unknown, name: string, message?: RegExp): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const err = caught as Error;
  expect(err.name).toBe(name);
  if (message) expect(err.message).toMatch(message);
}

const STALE_NAME = "AutomationControlStaleVersionError";
const VALIDATION_NAME = "AutomationControlValidationError";

const EXPECTED_DEFAULTS = {
  enabled: false,
  authority: "observe",
  operatorHold: false,
  limit: 5,
  maxIterations: 10,
  maxCostUsd: 1,
  perCandidateCeilingUsd: 0.5,
  paidAuthorization: false,
  version: 1,
};

describe("automation control defaults", () => {
  it("materializes fail-closed defaults on first read", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    const control = store.get();
    expect(control).toEqual({ ...EXPECTED_DEFAULTS, updatedAt: BASE });
    expect(control.enabled).toBe(false);
    expect(control.authority).toBe("observe");
    expect(control.paidAuthorization).toBe(false);
  });

  it("is a single singleton row shared by every adapter", async () => {
    const { stamp } = clock();
    const first = await loadStore({ now: stamp });
    const second = await loadStore({ now: stamp });
    expect(first.get()).toEqual(second.get());
    expect(first.get().version).toBe(1);
  });

  it("exposes only read and CAS-update operations, never a start/run path", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expect(Object.keys(store).sort()).toEqual(["get", "update"]);
  });
});

describe("automation control durability", () => {
  it("persists a mutation across adapter instances and a fresh connection", async () => {
    const { stamp } = clock();
    const first = await loadStore({ now: stamp });
    expect(first.get().version).toBe(1);
    const updated = first.update({ enabled: true, limit: 7 }, 1);
    expect(updated.enabled).toBe(true);
    expect(updated.limit).toBe(7);
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).toBe(BASE);

    // A second adapter over the same connection reads the same row.
    const second = await loadStore({ now: stamp });
    expect(second.get()).toMatchObject({ enabled: true, limit: 7, version: 2 });

    // A truly fresh connection (new module) reads the same row from disk.
    vi.resetModules();
    const fresh = await loadStore({ now: stamp });
    expect(fresh.get()).toMatchObject({ enabled: true, limit: 7, version: 2 });
  });

  it("applies a patch as a delta on top of live state, never a full-row write", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    store.update({ enabled: true }, 1);
    // The caller sends only the changed field; live state survives.
    const updated = store.update({ limit: 9 }, 2);
    expect(updated).toMatchObject({ enabled: true, limit: 9, operatorHold: false, version: 3 });
    expect(store.get()).toMatchObject({ enabled: true, limit: 9, version: 3 });
  });
});

describe("automation control CAS conflicts", () => {
  it("rejects a write whose expected version is no longer current", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    store.update({ enabled: true }, 1);
    expectThrowsNamed(
      () => store.update({ limit: 3 }, 1),
      STALE_NAME,
      /expected version 1, current version 2/,
    );
    // The failed write changed nothing.
    expect(store.get()).toMatchObject({ enabled: true, limit: 5, version: 2 });
  });

  it("succeeds once the caller retries with the current version", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    store.update({ enabled: true }, 1);
    const control = store.get();
    expect(() => store.update({ limit: 3 }, control.version)).not.toThrow();
    expect(store.get()).toMatchObject({ enabled: true, limit: 3, version: 3 });
  });

  it("detects a conflict across two live adapter instances", async () => {
    const { stamp } = clock();
    const first = await loadStore({ now: stamp });
    const second = await loadStore({ now: stamp });
    first.update({ enabled: true }, 1);
    // The second instance still holds version 1 and must fail.
    expectThrowsNamed(() => second.update({ limit: 12 }, 1), STALE_NAME, /expected version 1/);
    expect(first.get()).toMatchObject({ enabled: true, limit: 5, version: 2 });
  });

  it("rejects a non-integer expected version before touching the row", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expectThrowsNamed(
      () => store.update({ enabled: true }, 1.5),
      VALIDATION_NAME,
      /expectedVersion must be an integer/,
    );
    expectThrowsNamed(
      () => store.update({ enabled: true }, Number.NaN),
      VALIDATION_NAME,
      /expectedVersion must be an integer/,
    );
    expect(store.get().version).toBe(1);
  });
});

describe("automation control validation", () => {
  it.each([
    ["below minimum", 0],
    ["negative", -1],
    ["above cap", AUTOMATION_LIMIT_CAP + 1],
    ["non-integer", 2.5],
    ["not a number", Number.NaN],
    ["string", "5"],
  ])("rejects a limit %s", async (_name, limit) => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expectThrowsNamed(
      () => store.update({ limit: limit as number }, 1),
      VALIDATION_NAME,
      /limit must be an integer in \[1, 20\]/,
    );
    expect(store.get().version).toBe(1);
  });

  it("accepts a limit at both bounds", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    store.update({ limit: AUTOMATION_LIMIT_MIN }, 1);
    expect(store.get().limit).toBe(AUTOMATION_LIMIT_MIN);
    store.update({ limit: AUTOMATION_LIMIT_CAP }, 2);
    expect(store.get().limit).toBe(AUTOMATION_LIMIT_CAP);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["not a number", Number.NaN],
  ])("rejects a non-nonnegative-integer maxIterations (%s)", async (_name, value) => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expectThrowsNamed(
      () => store.update({ maxIterations: value as number }, 1),
      VALIDATION_NAME,
      /maxIterations must be a nonnegative integer/,
    );
    expect(store.get().version).toBe(1);
  });

  it.each([
    ["negative", -0.01],
    ["infinite", Number.POSITIVE_INFINITY],
    ["not a number", Number.NaN],
  ])("rejects a non-finite-nonnegative maxCostUsd (%s)", async (_name, value) => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expectThrowsNamed(
      () => store.update({ maxCostUsd: value as number }, 1),
      VALIDATION_NAME,
      /maxCostUsd must be finite and nonnegative/,
    );
    expect(store.get().version).toBe(1);
  });

  it("rejects non-boolean boolean fields", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expectThrowsNamed(
      () => store.update({ enabled: 1 as unknown as boolean }, 1),
      VALIDATION_NAME,
      /enabled must be a boolean/,
    );
    expectThrowsNamed(
      () => store.update({ operatorHold: "yes" as unknown as boolean }, 1),
      VALIDATION_NAME,
      /operatorHold must be a boolean/,
    );
    expectThrowsNamed(
      () => store.update({ paidAuthorization: 0 as unknown as boolean }, 1),
      VALIDATION_NAME,
      /paidAuthorization must be a boolean/,
    );
    expect(store.get().version).toBe(1);
  });

  it("rejects an empty patch", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expectThrowsNamed(() => store.update({}, 1), VALIDATION_NAME, /patch must change at least one field/);
    expect(store.get().version).toBe(1);
  });

  it("rejects a failing patch without bumping the version", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    store.update({ enabled: true }, 1);
    expectThrowsNamed(() => store.update({ enabled: false, limit: 99 }, 2), VALIDATION_NAME, /limit must be an integer/);
    expect(store.get()).toMatchObject({ enabled: true, limit: 5, version: 2 });
  });
});

describe("automation control hold and disable", () => {
  it("sets and clears an operator hold, preserving every other field", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    store.update({ enabled: true, limit: 3 }, 1);
    const held = store.update({ operatorHold: true }, 2);
    expect(held.operatorHold).toBe(true);
    expect(held.enabled).toBe(true);
    expect(held.limit).toBe(3);
    store.update({ operatorHold: false }, 3);
    expect(store.get()).toMatchObject({ enabled: true, limit: 3, operatorHold: false });
  });

  it("disables and re-enables automation durably", async () => {
    const { stamp, advance } = clock();
    const first = await loadStore({ now: stamp });
    first.update({ enabled: true }, 1);
    advance(1_000);
    const disabled = first.update({ enabled: false }, 2);
    expect(disabled.enabled).toBe(false);
    expect(disabled.updatedAt).toBe(new Date(Date.parse(BASE) + 1_000).toISOString());

    vi.resetModules();
    const fresh = await loadStore({ now: stamp });
    expect(fresh.get()).toMatchObject({ enabled: false, version: 3 });
    fresh.update({ enabled: true }, 3);
    expect(fresh.get().enabled).toBe(true);
  });
});

describe("automation control paid authorization", () => {
  it("defaults paid authorization to false", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expect(store.get().paidAuthorization).toBe(false);
  });

  it("grants paid authorization only through an explicit patch", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    const granted = store.update({ paidAuthorization: true }, 1);
    expect(granted.paidAuthorization).toBe(true);
    expect(store.get().paidAuthorization).toBe(true);

    vi.resetModules();
    const fresh = await loadStore({ now: stamp });
    expect(fresh.get().paidAuthorization).toBe(true);
  });

  it("never turns paid authorization on implicitly", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    // Enabling, raising budgets, or releasing a hold never grants paid work.
    store.update({ enabled: true }, 1);
    store.update({ operatorHold: true }, 2);
    store.update({ maxCostUsd: 100, maxIterations: 50, perCandidateCeilingUsd: 10, limit: 20 }, 3);
    expect(store.get().paidAuthorization).toBe(false);
  });

  it("lets an operator revoke paid authorization explicitly", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    store.update({ paidAuthorization: true }, 1);
    store.update({ paidAuthorization: false }, 2);
    expect(store.get().paidAuthorization).toBe(false);
  });
});

describe("automation control authority", () => {
  it("defaults authority to observe (read-only) even when enabled", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    expect(store.get().authority).toBe("observe");
    store.update({ enabled: true }, 1);
    // Enabling never escalates authority; it stays observe until an explicit patch.
    expect(store.get().authority).toBe("observe");
  });

  it.each(["merge", "admin", "deploy", "", "PUBLISH", "publish "])(
    "rejects an invalid authority %j",
    async (value) => {
      const { stamp } = clock();
      const store = await loadStore({ now: stamp });
      expectThrowsNamed(
        () => store.update({ authority: value as never }, 1),
        VALIDATION_NAME,
        /authority must be one of observe, build, publish/,
      );
      expect(store.get()).toMatchObject({ authority: "observe", version: 1 });
    },
  );

  it("accepts every authority in the closed set", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    for (const [authority, version] of [
      ["build", 2],
      ["publish", 3],
      ["observe", 4],
    ] as const) {
      store.update({ authority }, version - 1);
      expect(store.get()).toMatchObject({ authority, version });
    }
  });

  it("persists an authority change durably across a fresh connection", async () => {
    const { stamp } = clock();
    const first = await loadStore({ now: stamp });
    const updated = first.update({ authority: "build" }, 1);
    expect(updated).toMatchObject({ authority: "build", version: 2 });
    expect(updated.enabled).toBe(false);

    vi.resetModules();
    const fresh = await loadStore({ now: stamp });
    expect(fresh.get()).toMatchObject({ authority: "build", version: 2 });
  });

  it("guards an authority change with the same integer CAS as every other field", async () => {
    const { stamp } = clock();
    const store = await loadStore({ now: stamp });
    store.update({ authority: "build" }, 1);
    expectThrowsNamed(
      () => store.update({ authority: "publish" }, 1),
      STALE_NAME,
      /expected version 1, current version 2/,
    );
    expect(store.get()).toMatchObject({ authority: "build", version: 2 });
  });

  it("changes only the patched field in the pure patch", () => {
    const current = { ...defaultAutomationControl(BASE), enabled: true, limit: 9, version: 7 };
    const next = applyAutomationControlPatch(current, { authority: "publish" }, BASE);
    expect(next.authority).toBe("publish");
    expect(next.enabled).toBe(true);
    expect(next.limit).toBe(9);
    expect(next.operatorHold).toBe(false);
    expect(next.paidAuthorization).toBe(false);
    expect(next.version).toBe(8);
  });
});

describe("automation control pure patch", () => {
  it("bumps version and updatedAt and only changes patched fields", () => {
    const current = defaultAutomationControl(BASE);
    const next = applyAutomationControlPatch(
      current,
      { maxIterations: 4, maxCostUsd: 2.5 },
      "2026-08-25T09:01:00.000Z",
    );
    expect(next.maxIterations).toBe(4);
    expect(next.maxCostUsd).toBe(2.5);
    expect(next.enabled).toBe(false);
    expect(next.operatorHold).toBe(false);
    expect(next.limit).toBe(5);
    expect(next.perCandidateCeilingUsd).toBe(0.5);
    expect(next.paidAuthorization).toBe(false);
    expect(next.version).toBe(2);
    expect(next.updatedAt).toBe("2026-08-25T09:01:00.000Z");
  });

  it("leaves unrelated live fields untouched on a later patch", () => {
    const current = { ...defaultAutomationControl(BASE), enabled: true, version: 7 };
    const next = applyAutomationControlPatch(current, { operatorHold: true }, BASE);
    expect(next.enabled).toBe(true);
    expect(next.operatorHold).toBe(true);
    expect(next.version).toBe(8);
  });

  it("preserves the type across a full round trip", () => {
    const control: AutomationControl = defaultAutomationControl(BASE);
    expect(typeof control.enabled).toBe("boolean");
    expect(typeof control.version).toBe("number");
    expect(typeof control.updatedAt).toBe("string");
  });
});
