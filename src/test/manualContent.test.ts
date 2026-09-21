import { describe, expect, it } from "vitest";
import { calculateRiskGrade, GRADES } from "@/lib/riskGrade";
import {
  filterManualFaqs,
  filterManualSections,
  MANUAL_FAQS,
  MANUAL_SECTIONS,
  MANUAL_TERMS,
  manualCorpusText,
} from "@/lib/manualContent";

describe("manual content SSOT", () => {
  const corpus = manualCorpusText();

  it("uses 가능성×중대성 and 상/중/하, not 빈도×강도 or 저/중/고", () => {
    expect(corpus).toContain("가능성");
    expect(corpus).toContain("중대성");
    expect(corpus).toContain("상 / 중 / 하");
    expect(corpus).not.toMatch(/빈도\s*[×xX]\s*강도/);
    expect(corpus).not.toMatch(/저\/중\/고/);
    expect(MANUAL_SECTIONS.some((s) => s.showMatrix)).toBe(true);
    expect(calculateRiskGrade("상", "상")).toBe("상");
    expect(GRADES).toEqual(["상", "중", "하"]);
  });

  it("explains residual (개선후) grades", () => {
    expect(corpus).toContain("개선후");
    expect(corpus).toContain("잔여");
  });

  it("does not say worker entry is QR-only", () => {
    const worker = MANUAL_SECTIONS.filter((s) => s.audience.includes("worker"));
    const text = worker.flatMap((s) => s.bullets).join("\n");
    expect(text).toContain("GPS");
    expect(text).toContain("출근은 자동으로 찍히지 않습니다");
    expect(text).not.toMatch(/매일 출근.*QR만/);
  });

  it("keeps login FAQ aligned with QR-active / manager-pending", () => {
    const login = MANUAL_FAQS.find((f) => f.id === "login");
    expect(login?.a).toContain("승인 없이");
    expect(login?.a).toContain("승인 대기");
  });

  it("derives GPS FAQs from gpsStatusUi block reasons, including identity_mismatch", () => {
    const gps = MANUAL_FAQS.filter((f) => f.id.startsWith("gps-"));
    expect(gps.map((f) => f.id).sort()).toEqual([
      "gps-checkin",
      "gps-consent",
      "gps-fence",
      "gps-identity",
      "gps-permission",
    ]);
    expect(gps.every((f) => f.source.includes("gpsStatusUi"))).toBe(true);
  });

  it("points RA / cost / push FAQs at the code gates", () => {
    expect(MANUAL_FAQS.find((f) => f.id === "ra-preflight")?.source).toContain("assessmentSubmitPreflight");
    expect(MANUAL_FAQS.find((f) => f.id === "cost-preflight")?.source).toContain("SafetyCost.tsx");
    expect(MANUAL_FAQS.find((f) => f.id === "push-quiet")?.source).toContain("should_push_notify");
  });

  it("has the glossary terms requested in the work brief", () => {
    const terms = MANUAL_TERMS.map((t) => t.term);
    for (const need of [
      "TBM",
      "상신",
      "반려",
      "재상신",
      "공종",
      "가능성",
      "중대성",
      "잔여위험(개선후)",
      "관리감독자",
      "결재선",
      "검증센터",
      "지오펜스(위험구역)",
      "완충대",
      "PPE(보호구)",
      "산업안전보건관리비",
      "작업중지권",
    ]) {
      expect(terms).toContain(need);
    }
  });

  it("searches across roles when asked, and filters when not", () => {
    const local = filterManualSections("", "worker", false);
    expect(local.every((s) => s.audience.includes("worker"))).toBe(true);
    const global = filterManualSections("전자결재", "worker", true);
    expect(global.some((s) => s.id === "approvals")).toBe(true);
    expect(filterManualFaqs("상신", "worker", false).some((f) => f.id === "ra-preflight")).toBe(false);
    expect(filterManualFaqs("상신", "worker", true).some((f) => f.id === "ra-preflight")).toBe(true);
  });
});
