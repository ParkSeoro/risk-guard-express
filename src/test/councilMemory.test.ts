import { describe, expect, it } from "vitest";
import { canOpenCouncil } from "@/lib/councilAccess";
import { councilMemoryBrief } from "@/lib/councilMemory";

describe("council director gate", () => {
  it("opens only for the director account", () => {
    expect(canOpenCouncil({
      id: "51c291bd-b434-4872-8995-e78f495b2e01",
      email: "seoro.park@airliquide.com",
    })).toBe(true);
    expect(canOpenCouncil({
      id: "5e780ffb-81c8-42ef-8eed-b27815785fd1",
      email: "PSR1579@gmail.com",
    })).toBe(true);
    expect(canOpenCouncil({
      id: "5e780ffb-81c8-42ef-8eed-b27815785fd1",
      email: "other@example.com",
    })).toBe(true);
    expect(canOpenCouncil({
      id: "00000000-0000-0000-0000-000000000000",
      email: "other@example.com",
    })).toBe(false);
    expect(canOpenCouncil({
      id: "00000000-0000-0000-0000-000000000000",
      email: "seoro.park@airliquide.com",
    })).toBe(true);
    expect(canOpenCouncil(null)).toBe(false);
  });
});

describe("council memory", () => {
  it("keeps the latest finished conclusion and leaves the current topic out", () => {
    const brief = councilMemoryBrief([
      {
        agenda: "화면은 디렉터만",
        status: "합의",
        turns: [
          { seat: "cursor", body: "판정: 된다" },
          { seat: "chair", body: "합의했다." },
        ],
      },
    ]);
    expect(brief).toContain("지난 이야기");
    expect(brief).toContain("[합의] 화면은 디렉터만");
    expect(brief).toContain("Cursor: 판정: 된다");
    expect(brief).toContain("의장: 합의했다.");
    expect(councilMemoryBrief([])).toBe("");
  });
});
