import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { printPermitBundle } from "@/lib/printPermitBundle";

describe("printPermitBundle", () => {
  it("exports printPermitBundle (no form scale-to-fit)", () => {
    expect(typeof printPermitBundle).toBe("function");
  });

  it("lets 을지 rows flow across pages instead of breaking after every sheet", () => {
    const src = readFileSync("src/lib/printPermitBundle.ts", "utf8");
    expect(src).toContain("page-break-after: auto !important");
    expect(src).toContain("page-break-inside: avoid !important");
    expect(src).not.toMatch(/\.permit-crew-sheet \{[^}]*page-break-after: always/);
  });
});
