import { describe, expect, it } from "vitest";
import { CONSENT_DOCS, consentItemsForRoles } from "@/lib/legal/consentDocs";
import { HEALTH_PLEDGE, NO_ACCIDENT_PLEDGE, WORK_ACK_PLEDGE } from "@/lib/legal/dailyPledges";
import { LEGAL_OPERATOR } from "@/lib/legal/operator";
import { tbmInAppPath, tbmPublicUrl } from "@/lib/tbmUrls";

describe("consent legal copy", () => {
  it("requires health consent for workers and not for admins", () => {
    expect(consentItemsForRoles(false)).toContain("health");
    expect(consentItemsForRoles(false)).toContain("location");
    expect(consentItemsForRoles(true)).not.toContain("health");
    expect(consentItemsForRoles(true)).toContain("admin_security");
  });

  it("names a location-info manager and DPO contact", () => {
    expect(CONSENT_DOCS.location.body).toContain("위치정보 관리책임자");
    expect(CONSENT_DOCS.location.body).toContain(LEGAL_OPERATOR.dpoName);
    expect(CONSENT_DOCS.privacy.body).toContain("개인정보 보호책임자");
    expect(CONSENT_DOCS.health.body).toContain("제23조");
  });

  it("keeps daily pledges as signed operational statements", () => {
    expect(WORK_ACK_PLEDGE.length).toBeGreaterThan(80);
    expect(NO_ACCIDENT_PLEDGE).toMatch(/무재해/);
    expect(HEALTH_PLEDGE).toMatch(/건강/);
  });
});

describe("tbm urls", () => {
  it("keeps public QR on safenex.org and in-app path in the worker shell", () => {
    expect(tbmPublicUrl("abc")).toBe("https://safenex.org/tbm/abc");
    expect(tbmInAppPath("abc")).toBe("/app/worker/tbm/abc");
  });
});
