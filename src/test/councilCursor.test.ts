import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("council cursor link", () => {
  it("calls this cloud agent from the server and keeps the key out of the browser", () => {
    const fn = readFileSync("supabase/functions/council-cursor/index.ts", "utf8");
    const client = readFileSync("src/lib/councilCursor.ts", "utf8");
    const pane = readFileSync("src/components/messenger/AiCouncilChatPane.tsx", "utf8");

    expect(fn).toContain("bc-5c9ec1a0-6625-4210-a11b-d7595a9996eb");
    expect(fn).toContain("CURSOR_API_KEY");
    expect(fn).toContain('rpc("is_council_director"');
    expect(fn).toContain("풀 리퀘스트와 머지는 디렉터만 한다.");
    expect(fn).toContain("판정 줄로 끝내지 않는다");
    expect(fn).not.toContain("판정: 된다");
    expect(fn).not.toContain("판정: 안된다");
    expect(fn).not.toContain("sk-");

    expect(client).toContain('invoke("council-cursor"');
    expect(client).not.toContain("CURSOR_API_KEY");
    expect(client).not.toContain("api.cursor.com");

    expect(pane).toContain("askCouncilCursor");
    expect(pane).not.toContain("git checkout -b council/governance-sync");
    expect(pane).not.toContain("executeSafeTask");
  });
});
