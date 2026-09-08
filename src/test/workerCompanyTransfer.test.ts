import { describe, expect, it } from "vitest";
import {
  foreignRosterBadgeLabel,
  foreignRosterTransferPrompt,
} from "@/lib/workerCompanyTransfer";

describe("foreign roster copy", () => {
  it("names the other company on the badge", () => {
    expect(foreignRosterBadgeLabel("청원산기(주)")).toBe("타사 소속 · 청원산기(주)");
    expect(foreignRosterBadgeLabel("")).toBe("타사 소속");
  });

  it("asks before moving the roster row", () => {
    expect(
      foreignRosterTransferPrompt({
        name: "이진수",
        source_company_name: "청원산기(주)",
        dest_company_name: "진남토건(주)",
      }),
    ).toContain("청원산기(주)");
    expect(
      foreignRosterTransferPrompt({
        name: "이진수",
        source_company_name: "청원산기(주)",
        dest_company_name: "진남토건(주)",
      }),
    ).toContain("「진남토건(주)」으로 이관할까요?");
  });

  it("mentions reactivation when the other company row is inactive", () => {
    const text = foreignRosterTransferPrompt({
      name: "이진수",
      source_company_name: "청원산기(주)",
      dest_company_name: "진남토건(주)",
      is_active: false,
    });
    expect(text).toContain("명단(비활성)");
    expect(text).toContain("우리 명단에 활성으로 올라갑니다");
  });
});
