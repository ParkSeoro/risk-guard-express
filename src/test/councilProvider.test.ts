import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("council provider link", () => {
  it("calls Gemini, Anthropic, and OpenAI from the server and keeps the keys out of the browser", () => {
    const fn = readFileSync("supabase/functions/council-provider/index.ts", "utf8");
    const client = readFileSync("src/lib/councilProvider.ts", "utf8");
    const pane = readFileSync("src/components/messenger/AiCouncilChatPane.tsx", "utf8");

    expect(fn).toContain("GEMINI_API_KEY");
    expect(fn).toContain("gemini-4-argon");
    expect(fn).toContain("gemini-3.8-flash");
    expect(fn).toContain("https://generativelanguage.googleapis.com/v1beta/models/");
    expect(fn).toContain("resolveGeminiApiKey");
    expect(fn).toContain("저장소는 열 수 없다");
    expect(fn).toContain("채점 줄은 쓰지 않는다");
    expect(fn).toContain("seat_retired");
    expect(fn).not.toContain("있는 그대로");
    expect(fn).not.toContain("하나로 줄이지 않는다");
    expect(fn).not.toContain("판정: 합의가능");
    expect(fn).toContain("ANTHROPIC_API_KEY");
    expect(fn).toContain("OPENAI_API_KEY");
    expect(fn).toContain("https://api.anthropic.com/v1/messages");
    expect(fn).toContain("https://api.openai.com/v1/chat/completions");
    expect(fn).toContain('rpc("is_council_director"');
    expect(fn).not.toContain("sk-");

    expect(client).toContain('invoke("council-provider"');
    expect(client).toContain('"gemini"');
    expect(client).not.toContain("GEMINI_API_KEY");
    expect(client).not.toContain("ANTHROPIC_API_KEY");
    expect(client).not.toContain("OPENAI_API_KEY");

    expect(pane).toContain('askCouncilProvider');
    expect(pane).toContain("너는 Gemini다");
    expect(pane).toContain("너는 Cursor다");
    expect(pane).not.toContain("너는 Claude다");
    expect(pane).not.toContain("너는 GPT다");
    expect(pane).not.toContain("councilCanClose");
    expect(pane).toContain("loadCouncilMeetings");
    expect(pane).toContain("councilMemoryBrief");
    expect(pane).not.toContain("메인 UI 루프 및 결재 트랜잭션 블로킹");
    expect(pane).not.toContain("자동 점수로 계산하지 않습니다");
    expect(pane).not.toContain("일치율");
    expect(pane).not.toContain("api.anthropic.com");
    expect(pane).not.toContain("api.openai.com");
    expect(pane).not.toContain("generativelanguage.googleapis.com");
    expect(pane).not.toContain("9 pass, 0 fail");
  });
});
