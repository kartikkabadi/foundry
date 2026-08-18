import { describe, expect, it } from "vitest";

describe("verify-baseline", () => {
  it("runs a trivial test", () => {
    expect(1 + 1).toBe(2);
  });
});
