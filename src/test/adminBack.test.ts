import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_BACK_PARENTS, adminBackTarget } from "@/lib/adminBack";
import { ADMIN_APP_BASE } from "@/lib/adminNav";

function routePatterns(): string[] {
  const src = readFileSync("src/routes/AdminAppRoutes.tsx", "utf8");
  const found = [...src.matchAll(/<Route\b[^>]*\bpath="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(found)];
}

describe("admin back registry", () => {
  it("sends the dashboard nowhere and lists back to the dashboard", () => {
    expect(adminBackTarget(ADMIN_APP_BASE)).toBeNull();
    expect(adminBackTarget(`${ADMIN_APP_BASE}/`)).toBeNull();
    expect(adminBackTarget(`${ADMIN_APP_BASE}/work-permits`)).toBe(ADMIN_APP_BASE);
    expect(adminBackTarget(`${ADMIN_APP_BASE}/work-permits/abc`)).toBe(`${ADMIN_APP_BASE}/work-permits`);
    expect(adminBackTarget(`${ADMIN_APP_BASE}/work-plan/abc`)).toBe(`${ADMIN_APP_BASE}/work-plans`);
    expect(adminBackTarget(`${ADMIN_APP_BASE}/assessment-run/abc`)).toBe(`${ADMIN_APP_BASE}/risk-assessment`);
    expect(adminBackTarget(`${ADMIN_APP_BASE}/workers/legal-mapping`)).toBe(`${ADMIN_APP_BASE}/workers`);
    expect(adminBackTarget(`${ADMIN_APP_BASE}/workers/uuid`)).toBe(`${ADMIN_APP_BASE}/workers`);
    expect(adminBackTarget(`${ADMIN_APP_BASE}/health/checkups`)).toBe(`${ADMIN_APP_BASE}/health`);
    expect(adminBackTarget(`${ADMIN_APP_BASE}/settings/account`)).toBe(`${ADMIN_APP_BASE}/settings`);
  });

  it("fails when a new admin route has no parent", () => {
    const patterns = routePatterns();
    expect(patterns.length).toBeGreaterThan(20);
    const missing = patterns.filter((pattern) => !(pattern in ADMIN_BACK_PARENTS));
    expect(missing).toEqual([]);
    expect(ADMIN_BACK_PARENTS.index).toBeNull();
  });
});
