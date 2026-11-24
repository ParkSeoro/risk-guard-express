import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeHealthCheckupOcrResponse,
  pickHealthCheckupPdfPage,
  shouldRecommendDailyHealthLog,
  suggestNextCheckupDueDate,
} from "@/lib/healthCheckupOcr";

describe("Health Checkup Report AI OCR", () => {
  it("suggests OSH Act Annex 23 next due date (+6m for high-hazard special/pre-placement, +12m standard)", () => {
    expect(suggestNextCheckupDueDate("2026-11-24", "일반", [])).toBe("2027-11-24");
    expect(suggestNextCheckupDueDate("2026-11-24", "배치전", ["소음", "분진"])).toBe("2027-11-24");
    expect(suggestNextCheckupDueDate("2026-11-24", "배치전", ["야간작업"])).toBe("2027-05-24");
    expect(suggestNextCheckupDueDate("2026-11-24", "특수", ["벤젠"])).toBe("2027-05-24");
    expect(suggestNextCheckupDueDate("2026-11-24", "수시", [])).toBeNull();
  });

  it("recommends daily health log for 유소견/요관찰 or restriction text, not for 정상A", () => {
    expect(shouldRecommendDailyHealthLog("유소견D1", null)).toBe(true);
    expect(shouldRecommendDailyHealthLog("유소견D2", null)).toBe(true);
    expect(shouldRecommendDailyHealthLog("요관찰C", null)).toBe(true);
    expect(shouldRecommendDailyHealthLog("정상B", "고소작업 주의")).toBe(true);
    expect(shouldRecommendDailyHealthLog("정상A", "정상업무 가능")).toBe(false);
    expect(shouldRecommendDailyHealthLog("정상A", null)).toBe(false);
  });

  it("picks the judgment/opinion page in multi-page checkup PDFs", () => {
    const pages = [
      "건강진단 안내 표지 및 병원 약도 안내문입니다.",
      "배치전 건강진단 결과표 판정: 유소견D1 업무수행 적합여부: 고소작업 제한 유해인자: 야간작업",
      "혈액검사 수치 참고표",
    ];
    expect(pickHealthCheckupPdfPage(pages)).toBe(2);
  });

  it("normalizes Edge Function response and computes fallback due date & daily-log flag", () => {
    const res = normalizeHealthCheckupOcrResponse({
      ok: true,
      worker_name: "홍길동",
      type: "배치전",
      result: "유소견D1",
      conducted_date: "2026-11-20",
      next_due_date: null,
      institution: "서울산업보건센터",
      restrictions: "고소작업 제한",
      hazard_factors: ["야간작업", "소음"],
      confidence: "high",
      summary: "배치전 유소견D1 판정",
    });
    expect(res.ok).toBe(true);
    expect(res.workerName).toBe("홍길동");
    expect(res.suggestedNextDueDate).toBe("2027-05-20");
    expect(res.recommendDailyHealthLog).toBe(true);
  });

  it("enforces privacy-first rules in analyze-health-checkup Edge Function", () => {
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/analyze-health-checkup/index.ts"),
      "utf-8",
    );
    expect(src).toContain("주민등록번호");
    expect(src).toContain("auth.getUser()");
  });
});
