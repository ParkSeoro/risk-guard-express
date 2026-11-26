import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyOcrFileSupport,
  evaluateExpiryStatus,
  normalizeOcrResponse,
  pickBestKeywordPage,
  resolveNdtEffectiveExpiry,
} from "@/lib/workPlanOcrHelpers";

describe("WorkPlan Phase 1 — OCR MVP helpers & contracts", () => {
  it("classifies image, standard PDF, Haansoft PDF, and unsupported formats", () => {
    expect(classifyOcrFileSupport({ name: "cert.jpg", type: "image/jpeg" })).toBe("image");
    expect(classifyOcrFileSupport({ name: "spec.pdf", type: "application/pdf" })).toBe("pdf");
    expect(classifyOcrFileSupport({ name: "doc.pdf", type: "application/haansoftpdf" })).toBe(
      "haansoft_pdf",
    );
    expect(
      classifyOcrFileSupport({
        name: "sheet.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe("unsupported");
  });

  it("picks the keyword-rich page (e.g. Load Chart on page 7) on digital PDFs and returns null for scanned PDFs", () => {
    const digitalPages = [
      "Kobelco CKE2500-2 사용설명서 표지",
      "목차 1. 개요 2. 안전수칙",
      "일반 사양 설명",
      "유지보수 안내",
      "와이어로프 점검",
      "아웃트리거 설치",
      "작업반경별 정격하중표 (Load Chart) 3m 50t 10m 18t",
    ];
    expect(pickBestKeywordPage(digitalPages)).toBe(7);

    const scannedPages = ["", "   ", ""];
    expect(pickBestKeywordPage(scannedPages)).toBeNull();
  });

  it("evaluates expiry status accurately against KST today", () => {
    expect(evaluateExpiryStatus("2026-11-23", "2026-11-24")).toBe("expired");
    expect(evaluateExpiryStatus("2026-11-24", "2026-11-24")).toBe("expiring_soon");
    expect(evaluateExpiryStatus("2026-12-20", "2026-11-24")).toBe("expiring_soon");
    expect(evaluateExpiryStatus("2027-03-15", "2026-11-24")).toBe("valid");
    expect(evaluateExpiryStatus(null, "2026-11-24")).toBe("unknown");
  });

  it("rejects hallucinated suggested_key outside allowed slots and provides safe fallback on failure", () => {
    const allowed = new Set(["biz_license", "inspection_cert"]);
    const ok = normalizeOcrResponse(
      {
        ok: true,
        suggested_key: "non_existent_key",
        doc_category_label: "안전검사증",
        confidence: 0.91,
        company_or_holder: "청원산기(주)",
        expiry_date: "2026-10-01",
      },
      { allowedKeys: allowed, pageNumber: 1, totalPages: 1, todayKst: "2026-11-24" },
    );
    expect(ok.ok).toBe(true);
    expect(ok.suggestedKey).toBeNull();
    expect(ok.expiryStatus).toBe("expired");

    const fail = normalizeOcrResponse(
      { ok: false, error: "일시적 오류" },
      { allowedKeys: allowed, pageNumber: 1, totalPages: 5 },
    );
    expect(fail.ok).toBe(false);
    expect(fail.needsPageSelect).toBe(true);
    expect(fail.error).toContain("일시적 오류");
  });

  it("keeps work-plan Vision EF decoupled from safety-cost koreanOcr.ts and requires user confirmation", () => {
    const efSrc = readFileSync(
      "supabase/functions/analyze-workplan-attachment/index.ts",
      "utf8",
    );
    expect(efSrc).not.toMatch(/from\s+["'][^"']*koreanOcr/);
    expect(efSrc).toContain("needs_page_select");
    expect(efSrc).toContain("rated_capacity_ton");

    const uiSrc = readFileSync(
      "src/components/work-plan/AttachmentChecklist.tsx",
      "utf8",
    );
    expect(uiSrc).toContain("AI 자동 분류");
    expect(uiSrc).toContain("판독 페이지 선택");
    expect(uiSrc).toContain("수동으로 항목에 넣기");
  });

  it("applies NDT (비파괴검사) validity rules: 1yr for <10yr equipment, 1mo for >=10yr equipment, never treating issue date as expiry", () => {
    // AI mistakenly puts inspection date into expiry_date -> cleared & calculated as +1 year
    const under10 = resolveNdtEffectiveExpiry({
      issueDate: "2026-04-15",
      expiryDate: "2026-04-15",
      equipmentYear: 2020,
      todayKst: "2026-11-26",
    });
    expect(under10.ruleApplied).toBe("ndt_1yr");
    expect(under10.expiryDate).toBe("2027-04-15");
    expect(evaluateExpiryStatus(under10.expiryDate, "2026-11-26")).toBe("valid");

    // 10+ year old equipment -> valid only 1 month from inspection date
    const over10 = resolveNdtEffectiveExpiry({
      issueDate: "2026-09-01",
      expiryDate: null,
      equipmentYear: 2015,
      todayKst: "2026-11-26",
    });
    expect(over10.ruleApplied).toBe("ndt_10yr_1m");
    expect(over10.expiryDate).toBe("2026-10-01");
    expect(evaluateExpiryStatus(over10.expiryDate, "2026-11-26")).toBe("expired");
    expect(over10.note).toContain("10년 이상 장비");

    // Unknown equipment year -> default 1 year + reminder note about 10yr+ rule
    const unknownYear = resolveNdtEffectiveExpiry({
      issueDate: "2026-06-01",
      expiryDate: null,
      equipmentYear: null,
      todayKst: "2026-11-26",
    });
    expect(unknownYear.ruleApplied).toBe("ndt_1yr");
    expect(unknownYear.expiryDate).toBe("2027-06-01");
    expect(unknownYear.note).toContain("10년 이상 장비는 반입 1개월 이내");
  });
});
