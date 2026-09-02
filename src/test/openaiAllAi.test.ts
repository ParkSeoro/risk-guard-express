import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_COST_LANES } from "@/lib/aiCostRoute";

function src(path: string) {
  return readFileSync(path, "utf8");
}

describe("AI 비용 레인", () => {
  it("작업계획서·위험성평가·브리핑·사고사례는 OpenAI", () => {
    const openai = AI_COST_LANES.filter((l) => l.provider === "OpenAI").map((l) => l.feature);
    expect(openai).toEqual(["작업계획서", "위험성평가", "허가서 브리핑", "사고사례"]);
  });

  it("교육·도우미·보건·안관비·비전은 Gemini", () => {
    const gemini = AI_COST_LANES.filter((l) => l.provider === "Gemini").map((l) => l.feature);
    expect(gemini).toEqual(["교육자료", "안전 도우미", "보건·근로자 의견", "안관비 분류", "OCR·양식 분석"]);
  });

  it("Edge 기본 라우트가 UI 표와 같다", () => {
    const text = src("supabase/functions/_shared/aiRoute.ts");
    expect(text).toContain('work_plan: "openai"');
    expect(text).toContain('risk: "openai"');
    expect(text).toContain('permit_briefing: "openai"');
    expect(text).toContain('accident: "openai"');
    expect(text).toContain('education: "gemini"');
    expect(text).toContain('assistant: "gemini"');
    expect(text).toContain('health: "gemini"');
    expect(text).toContain('safety_cost: "gemini"');
    expect(text).toContain('permit_template: "gemini"');
  });

  it("작업계획서 work_plan_section은 OpenAI를 먼저 호출한다", () => {
    const text = src("supabase/functions/generate-risk-ai/index.ts");
    const section = text.slice(
      text.indexOf('if (mode === "work_plan_section")'),
      text.indexOf("const normalizedEquipment"),
    );
    expect(section).toContain("callOpenAiChat");
    expect(section.indexOf("callOpenAiChat")).toBeLessThan(section.indexOf("geminiChatFetch"));
    expect(section).toContain('purpose: "work_plan"');
  });

  it("공유 채팅은 purpose 레인으로 Gemini native를 탄다", () => {
    const text = src("supabase/functions/_shared/gemini.ts");
    expect(text).toContain("resolveAiProvider");
    expect(text).toContain("callGeminiNativeChat");
    expect(src("supabase/functions/generate-education-material/index.ts")).toContain('purpose: "education"');
    expect(src("supabase/functions/safety-assistant/index.ts")).toContain("purpose: 'assistant'");
    expect(src("supabase/functions/analyze-worker-opinion/index.ts")).toContain("purpose: 'health'");
    expect(src("supabase/functions/analyze-safety-cost-document/index.ts")).toContain('purpose: "safety_cost"');
    expect(src("supabase/functions/analyze-permit-template/index.ts")).toContain("purpose: 'permit_template'");
    expect(src("supabase/functions/generate-permit-briefing/index.ts")).toContain("purpose: 'permit_briefing'");
    expect(src("supabase/functions/generate-accident-ai/index.ts")).toContain('purpose: "accident"');
  });

  it("설정 화면이 비용 분리표를 보여 준다", () => {
    expect(src("src/pages/SettingsAI.tsx")).toContain("비용 기준 모델 분리");
    expect(src("src/pages/SettingsAI.tsx")).toContain("AI_COST_LANES");
    expect(src("src/pages/Settings.tsx")).toContain("OpenAI·Gemini 비용 분리");
  });

  it("안관비 OCR은 Gemini 다음 OpenAI 비전으로 폴백한다", () => {
    const ocr = src("supabase/functions/_shared/koreanOcr.ts");
    expect(ocr).toContain("callOpenAiChat");
    expect(ocr).toContain("isOpenAiFallbackEnabled");
    expect(ocr).toContain("callOpenAiVision");
    expect(ocr).not.toMatch(/if \(!opts\.geminiKey\) \{\s*return \{/);
    expect(src("src/pages/SafetyCost.tsx")).toContain("documentAnalysisToastCopy");
  });
});
