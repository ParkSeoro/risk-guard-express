import { describe, it, expect } from "vitest";
import { printPermitBundle } from "@/lib/printPermitBundle";

describe("printPermitBundle", () => {
  it("exports printPermitBundle (no form scale-to-fit)", () => {
    expect(typeof printPermitBundle).toBe("function");
  });
});
