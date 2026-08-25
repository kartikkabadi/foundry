import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import type { AutomationControl, AutomationControlPatch } from "@/lib/foundry/automation-control";

// Shared mutable harness between the hoisted store mock and the test body: an
// in-memory adapter that reproduces the store's integer-version CAS and patch
// validation on top of the real automation-control pure functions.
const harness = vi.hoisted(() => ({
  control: null as AutomationControl | null,
  adapter: null as {
    get(): AutomationControl;
    update(patch: AutomationControlPatch, expectedVersion: number): AutomationControl;
  } | null,
}));

vi.mock("@/lib/foundry/store", async () => {
  const control = await import("@/lib/foundry/automation-control");
  return {
    createAutomationControlStore: () => {
      if (harness.adapter === null) {
        const adapter: {
          get(): AutomationControl;
          update(patch: AutomationControlPatch, expectedVersion: number): AutomationControl;
        } = {
          get: () => {
            if (harness.control === null) {
              harness.control = control.defaultAutomationControl("2026-08-25T00:00:00.000Z");
            }
            return harness.control;
          },
          update: (patch, expectedVersion) => {
            const current = adapter.get();
            if (current.version !== expectedVersion) {
              throw new control.AutomationControlStaleVersionError(expectedVersion, current.version);
            }
            harness.control = control.applyAutomationControlPatch(
              current,
              patch,
              "2026-08-25T00:00:00.000Z",
            );
            return harness.control;
          },
        };
        harness.adapter = adapter;
      }
      return harness.adapter;
    },
  };
});

import { automationSettingsAction } from "@/app/actions";
import { redirect } from "next/navigation";

function settingsForm(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    data.set(name, value);
  }
  return data;
}

/** A settings submission with every numeric field at the stock defaults. */
function completeForm(overrides: Record<string, string> = {}): FormData {
  return settingsForm({
    version: "1",
    limit: "5",
    maxIterations: "10",
    maxCostUsd: "1",
    perCandidateCeilingUsd: "0.5",
    ...overrides,
  });
}

beforeEach(() => {
  harness.control = null;
  harness.adapter = null;
  vi.mocked(redirect).mockClear();
});

describe("automationSettingsAction numeric parsing", () => {
  it("persists a changed numeric ceiling", async () => {
    await automationSettingsAction(completeForm({ limit: "7", maxCostUsd: "2.5" }));

    const stored = harness.control;
    if (stored === null) throw new Error("expected control to be written");
    expect(stored).toMatchObject({
      limit: 7,
      maxIterations: 10,
      maxCostUsd: 2.5,
      perCandidateCeilingUsd: 0.5,
      version: 2,
    });
    expect(redirect).toHaveBeenCalledWith("/automation");
  });

  it("leaves a cleared numeric field unchanged instead of persisting 0", async () => {
    await automationSettingsAction(completeForm());
    const before = harness.control;
    if (before === null) throw new Error("expected control to be written");

    await automationSettingsAction(
      settingsForm({
        version: String(before.version),
        limit: String(before.limit),
        maxIterations: "",
        maxCostUsd: String(before.maxCostUsd),
        perCandidateCeilingUsd: String(before.perCandidateCeilingUsd),
      }),
    );

    expect(harness.control).not.toBeNull();
    expect(harness.control?.maxIterations).toBe(10);
    expect(harness.control?.maxIterations).not.toBe(0);
    expect(harness.control?.version).toBe(before.version);
  });

  it("skips a cleared field while applying other valid changes", async () => {
    await automationSettingsAction(completeForm());
    const before = harness.control;
    if (before === null) throw new Error("expected control to be written");

    await automationSettingsAction(
      settingsForm({
        version: String(before.version),
        limit: String(before.limit),
        maxIterations: "",
        maxCostUsd: "3",
        perCandidateCeilingUsd: String(before.perCandidateCeilingUsd),
      }),
    );

    expect(harness.control?.maxIterations).toBe(10);
    expect(harness.control?.maxCostUsd).toBe(3);
    expect(harness.control?.version).toBe(before.version + 1);
  });

  it("leaves a non-finite numeric field unchanged", async () => {
    await automationSettingsAction(completeForm({ maxIterations: "abc" }));

    expect(harness.control?.maxIterations).toBe(10);
    expect(harness.control?.version).toBe(1);
  });
});
