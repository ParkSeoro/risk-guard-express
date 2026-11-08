import { describe, expect, it } from "vitest";
import { councilCanClose, readVerdict } from "@/lib/councilDebate";

const manyPoints = [
  "1. 결재 버튼은 바로 끝나는 편이 맞다.",
  "2. 알림은 그 다음으로 미뤄도 된다.",
  "3. 다만 실패하면 사용자에게 보여야 한다.",
].join("\n");

describe("council debate verdicts", () => {
  it("reads the closing line and keeps several opinions above it", () => {
    expect(readVerdict(`${manyPoints}\n판정: 합의가능`)).toBe("합의가능");
    expect(readVerdict(`${manyPoints}\n판정: 계속`)).toBe("계속");
    expect(readVerdict(`${manyPoints}\n판정: 된다`)).toBe("된다");
    expect(readVerdict(`${manyPoints}\n판정: 안 된다`)).toBe("안된다");
  });

  it("does not treat a missing line as agreement", () => {
    expect(readVerdict(manyPoints)).toBeNull();
    expect(councilCanClose([manyPoints, manyPoints, manyPoints], `${manyPoints}\n판정: 된다`)).toBe(false);
  });

  it("closes only when Cursor says the proposal works and the other seats have no remaining objection", () => {
    const agreed = `${manyPoints}\n판정: 합의가능`;
    const cursor = "규칙에 어긋나는 항목은 없다.\n판정: 된다";
    expect(councilCanClose([agreed, agreed, agreed], cursor)).toBe(true);
    expect(councilCanClose([agreed, `${manyPoints}\n판정: 계속`, agreed], cursor)).toBe(false);
    expect(councilCanClose([agreed, agreed, agreed], `${manyPoints}\n판정: 안된다`)).toBe(false);
  });
});
