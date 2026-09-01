import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function src(path: string) {
  return readFileSync(path, "utf8");
}

describe("AI 기능 OpenAI 통일", () => {
  it("preferOpenAiForDraft 기본값은 openai (nvidia만 예외)", () => {
    const text = src("supabase/functions/_shared/openaiChat.ts");
    expect(text).toContain('Deno.env.get("RISK_AI_DRAFT_PROVIDER") || "openai"');
    expect(text).toContain('raw !== "nvidia"');
  });

  it("작업계획서 work_plan_section은 OpenAI를 먼저 호출한다", () => {
    const text = src("supabase/functions/generate-risk-ai/index.ts");
    const section = text.slice(
      text.indexOf('if (mode === "work_plan_section")'),
      text.indexOf("const normalizedEquipment"),
    );
    expect(section).toContain("callOpenAiChat");
    expect(section.indexOf("callOpenAiChat")).toBeLessThan(section.indexOf("geminiChatFetch"));
    expect(section).toContain("json: false");
  });

  it("공유 gemini 채팅은 OpenAI 1순위", () => {
    const text = src("supabase/functions/_shared/gemini.ts");
    expect(text).toContain("OpenAI (gpt-4o-mini) first");
    expect(text).toContain("viaOpenAi({ messages: openaiMessages");
    expect(text).toContain("imagePresent");
  });

  it("안관비 구조화는 NVIDIA 키 없이도 OpenAI 경로를 탄다", () => {
    const text = src("supabase/functions/analyze-safety-cost-document/index.ts");
    expect(text).toContain("hasChatAiKey");
    expect(text).toContain("chatReady");
    expect(text).not.toContain("nvidiaKey");
    expect(text).toContain("OPENAI_API_KEY·GEMINI_API_KEY");
  });

  it("설정/배너/에러 문구는 OPENAI_API_KEY를 안내한다", () => {
    expect(src("src/pages/SettingsAI.tsx")).toContain("OPENAI_API_KEY");
    expect(src("src/pages/SettingsAI.tsx")).toContain("OpenAI API 키");
    expect(src("src/pages/Settings.tsx")).toContain("OpenAI 생성");
    expect(src("src/components/AICreditBanner.tsx")).toContain("OpenAI API 상태 확인");
    expect(src("src/lib/riskAutoGenAI.ts")).toContain("OPENAI_API_KEY를 Supabase Edge Secrets에 등록");
    expect(src("supabase/functions/generate-risk-ai/index.ts")).toContain(
      "설정 → AI 설정에서 OPENAI_API_KEY를 확인하세요",
    );
  });

  it("텍스트 AI 함수는 hasChatAiKey 또는 OpenAI-first gemini를 쓴다", () => {
    const files = [
      "supabase/functions/generate-permit-briefing/index.ts",
      "supabase/functions/generate-education-material/index.ts",
      "supabase/functions/analyze-worker-opinion/index.ts",
      "supabase/functions/check-ai-credits/index.ts",
      "supabase/functions/safety-assistant/index.ts",
      "supabase/functions/generate-accident-ai/index.ts",
      "supabase/functions/analyze-permit-template/index.ts",
    ];
    for (const file of files) {
      const text = src(file);
      const usesGate = text.includes("hasChatAiKey") || text.includes("isOpenAiFallbackEnabled");
      const usesShared = text.includes("_shared/gemini.ts") || text.includes("_shared/openaiChat.ts");
      expect(usesShared || usesGate, file).toBe(true);
    }
    expect(src("supabase/functions/analyze-permit-template/index.ts")).toContain("gpt-4o-mini");
  });
});
