import { describe, expect, it } from "vitest";
import { startWatchdog, stopWatchdog, watchdogTick } from "../lib/foundry/watchdog";

describe("watchdog", () => {
  it("runs a tick without throwing", () => {
    const result = watchdogTick();
    expect(typeof result.stale).toBe("number");
    expect(typeof result.drained).toBe("number");
    expect(typeof result.kicked).toBe("number");
  });

  it("starts and stops the timer", () => {
    stopWatchdog();
    startWatchdog(1_000_000);
    stopWatchdog();
  });
});
