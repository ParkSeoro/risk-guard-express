import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  parseRiskAssessmentWorkbook,
  scoreHeaderRow,
} from "@/lib/riskExcelImport";

describe("scoreHeaderRow", () => {
  it("scores Korean RA column titles", () => {
    expect(scoreHeaderRow(["공정", "세부작업", "위험요인", "가능성"])).toBeGreaterThanOrEqual(3);
    expect(scoreHeaderRow(["청원산기 상시 위험성평가"])).toBe(0);
  });
});

describe("parseRiskAssessmentExcel", () => {
  it("skips a cover sheet and reads the table sheet", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["청원산기 상시 위험성평가"], ["기간 26.08.24~26.08.30"]]),
      "표지",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["공정", "세부작업", "위험요인", "가능성", "중대성"],
        ["철골", "용접", "화재", "중", "상"],
        ["배관", "절단", "협착", "하", "중"],
      ]),
      "위험성평가",
    );
    const parsed = parseRiskAssessmentWorkbook(wb);
    expect(parsed.sheetName).toBe("위험성평가");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]["위험요인"]).toBe("화재");
  });

  it("finds headers below title rows on the first sheet", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["청원산기"],
        ["상시 위험성평가 (26.08.24~26.08.30)"],
        [],
        ["공정", "세부작업", "위험요인"],
        ["토목", "터파기", "붕괴"],
      ]),
      "Sheet1",
    );
    const parsed = parseRiskAssessmentWorkbook(wb);
    expect(parsed.headerRow).toBe(4);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]["공정"]).toBe("토목");
  });

  it("throws a useful error when only a cover sheet exists", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["작성안내"], ["이 양식은 표지입니다"]]),
      "안내",
    );
    expect(() => parseRiskAssessmentWorkbook(wb)).toThrow(/표 헤더/);
  });
});
