import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("council provider link", () => {
  it("calls Anthropic and OpenAI from the server and keeps both keys out of the browser", () => {
    const fn = readFileSync("supabase/functions/council-provider/index.ts", "utf8");
    const client = readFileSync("src/lib/councilProvider.ts", "utf8");
    const pane = readFileSync("src/components/messenger/AiCouncilChatPane.tsx", "utf8");

    expect(fn).toContain("ANTHROPIC_API_KEY");
    expect(fn).toContain("OPENAI_API_KEY");
    expect(fn).toContain("https://api.anthropic.com/v1/messages");
    expect(fn).toContain("https://api.openai.com/v1/chat/completions");
    expect(fn).toContain('rpc("is_master"');
    expect(fn).not.toContain("sk-");

    expect(client).toContain('invoke("council-provider"');
    expect(client).not.toContain("ANTHROPIC_API_KEY");
    expect(client).not.toContain("OPENAI_API_KEY");

    expect(pane).toContain('askCouncilProvider');
    expect(pane).toContain('seat: "anthropic"');
    expect(pane).not.toContain("api.anthropic.com");
    expect(pane).not.toContain("api.openai.com");
    expect(pane).not.toContain("9 pass, 0 fail");
  });
});
