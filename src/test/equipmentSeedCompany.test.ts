import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/equipment/EquipmentManager.tsx", "utf8");
const seedStart = src.indexOf("} else if (companyId) {");
const seed = src.slice(seedStart, src.indexOf("setLoading(false)", seedStart));

describe("equipment default seed", () => {
  it("uses the company id and skips the insert when that id is missing", () => {
    expect(seedStart).toBeGreaterThan(0);
    expect(seed).toContain("company_id: companyId");
    expect(seed).not.toContain("company_id: null");
    expect(src).toContain("company_id: companyId || null");
  });
});
