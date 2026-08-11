import { describe, it, expect } from "vitest";
import { harvestLegalCitations, normalizeLegalBasisList } from "@/lib/enrichLegalBasis";

describe("normalizeLegalBasisList", () => {
  it("keeps array values", () => {
    expect(normalizeLegalBasisList(["산안기준규칙 제42조", "KOSHA GUIDE C-1-2020"])).toEqual([
      "산안기준규칙 제42조",
      "KOSHA GUIDE C-1-2020",
    ]);
  });

  it("splits string legal_basis instead of dropping it", () => {
    expect(normalizeLegalBasisList("산안기준규칙 제42조, 산안기준규칙 제43조")).toEqual([
      "산안기준규칙 제42조",
      "산안기준규칙 제43조",
    ]);
  });

  it("harvests citations from narrative when array empty", () => {
    const out = normalizeLegalBasisList([], [
      "[산업안전보건기준에 관한 규칙 제225조] 용접 흄 흡입",
      "(산안기준규칙 제38조) 안전난간 설치",
    ]);
    expect(out.some((s) => /225/.test(s))).toBe(true);
    expect(out.some((s) => /38/.test(s))).toBe(true);
  });

  it("reads Korean 법적근거 key via caller pass-through", () => {
    // mapAIItemToGenerated passes item['법적근거'] as raw
    expect(normalizeLegalBasisList("산안기준규칙 제42조")).toEqual(["산안기준규칙 제42조"]);
  });
});

describe("harvestLegalCitations", () => {
  it("finds KOSHA GUIDE citations", () => {
    const out = harvestLegalCitations(["작업 전 [KOSHA GUIDE C-42-2021] 확인"]);
    expect(out.join(" ")).toMatch(/KOSHA GUIDE C-42-2021/i);
  });
});
