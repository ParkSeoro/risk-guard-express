import { describe, expect, it } from "vitest";
import {
  feedbackPhotoRequirement,
  mergeKeptAndUploaded,
  removeAtIndex,
} from "@/lib/feedbackPhotos";

describe("mergeKeptAndUploaded", () => {
  it("keeps remaining saved urls and appends new uploads", () => {
    expect(mergeKeptAndUploaded(["https://a/1.png", ""], ["https://a/2.png"])).toEqual([
      "https://a/1.png",
      "https://a/2.png",
    ]);
  });
});

describe("removeAtIndex", () => {
  it("drops only the chosen attachment", () => {
    expect(removeAtIndex(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });
});

describe("feedbackPhotoRequirement", () => {
  it("blocks saving when every before photo was removed", () => {
    expect(
      feedbackPhotoRequirement({
        status: "진행중",
        keptBefore: [],
        newBeforeCount: 0,
        keptAfter: [],
        newAfterCount: 0,
      }).error,
    ).toMatch(/조치 전/);
  });

  it("allows edit after deleting one of several before photos", () => {
    expect(
      feedbackPhotoRequirement({
        status: "진행중",
        keptBefore: ["https://a/1.png"],
        newBeforeCount: 0,
        keptAfter: [],
        newAfterCount: 0,
      }).ok,
    ).toBe(true);
  });

  it("still requires an after photo when marking complete", () => {
    expect(
      feedbackPhotoRequirement({
        status: "완료",
        keptBefore: ["https://a/1.png"],
        newBeforeCount: 0,
        keptAfter: [],
        newAfterCount: 0,
      }).error,
    ).toMatch(/조치 후/);
  });
});
