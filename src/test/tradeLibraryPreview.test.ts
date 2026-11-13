import { describe, expect, it } from "vitest";
import {
  buildTradePreview,
  chosenProcessKey,
  libraryInsertCap,
  likeToken,
  tradeFillBlockReason,
  tradePreviewLine,
} from "@/lib/tradeLibraryPreview";

describe("trade library preview", () => {
  it("caps how many library rows one fill inserts", () => {
    expect(libraryInsertCap("core")).toBe(12);
    expect(libraryInsertCap("comprehensive")).toBe(20);
  });

  it("strips spaces so 철근 배근 searches as 철근배근", () => {
    expect(likeToken("철근 배근")).toBe("철근배근");
    expect(likeToken("100%_test")).toBe("100test");
  });

  it("shows an exact count and does not offer other names", () => {
    const preview = buildTradePreview(
      "철골",
      [
        { process_key: "철골", process_label: "철골" },
        { process_key: "철골", process_label: "철골" },
      ],
      [{ process_key: "철골설치", process_label: "철골 설치" }],
    );
    expect(preview.exactCount).toBe(2);
    expect(preview.candidates).toEqual([]);
    expect(tradePreviewLine(preview)).toBe("철골 2건을 가져옵니다.");
    expect(chosenProcessKey(preview)).toBe("철골");
  });

  it("lists nearby trades and waits for a tap", () => {
    const preview = buildTradePreview("철근배근", [], [
      { process_key: "철근 배근", process_label: "철근 배근" },
      { process_key: "철근 배근", process_label: "철근 배근" },
      { process_key: "철근공사", process_label: "철근공사" },
    ]);
    expect(preview.exactCount).toBe(0);
    expect(preview.candidates.map((c) => c.processKey)).toEqual(["철근 배근", "철근공사"]);
    expect(chosenProcessKey(preview)).toBeNull();
    expect(chosenProcessKey(preview, "철근 배근")).toBe("철근 배근");
    expect(tradeFillBlockReason([preview], {}, true)).toBe("철근배근의 표준 공종을 고르세요.");
    expect(tradeFillBlockReason([preview], { 철근배근: "철근 배근" }, false)).toBeNull();
  });

  it("blocks a miss when AI draft is off", () => {
    const preview = buildTradePreview("없는공종", [], []);
    expect(tradePreviewLine(preview)).toContain("라이브러리 항목이 없습니다");
    expect(tradeFillBlockReason([preview], {}, false)).toContain("라이브러리 항목이 없습니다");
    expect(tradeFillBlockReason([preview], {}, true)).toBeNull();
  });
});
