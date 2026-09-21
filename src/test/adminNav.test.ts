import { describe, expect, it } from "vitest";
import { ADMIN_APP_BASE, toAdminUrl } from "@/lib/adminNav";

describe("toAdminUrl", () => {
  it("prefixes admin pages and leaves public /manual alone", () => {
    expect(toAdminUrl("/")).toBe(ADMIN_APP_BASE);
    expect(toAdminUrl("/settings")).toBe("/app/admin/settings");
    expect(toAdminUrl("/app/admin/workers")).toBe("/app/admin/workers");
    expect(toAdminUrl("/manual")).toBe("/manual");
    expect(toAdminUrl("/privacy")).toBe("/privacy");
    expect(toAdminUrl("https://example.com/x")).toBe("https://example.com/x");
  });
});
