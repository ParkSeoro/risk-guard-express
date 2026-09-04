import { describe, expect, it } from "vitest";
import { TBM_MAX_PHOTOS, parseTbmPhotoUrls, tbmPhotoCountLabel } from "@/lib/tbmPhotos";

describe("parseTbmPhotoUrls", () => {
  it("reads jsonb arrays and caps at max", () => {
    expect(parseTbmPhotoUrls(["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg", "https://a/4.jpg"])).toEqual([
      "https://a/1.jpg",
      "https://a/2.jpg",
      "https://a/3.jpg",
    ]);
    expect(TBM_MAX_PHOTOS).toBe(3);
  });

  it("parses JSON string and single URL", () => {
    expect(parseTbmPhotoUrls('["https://a/1.jpg"]')).toEqual(["https://a/1.jpg"]);
    expect(parseTbmPhotoUrls("https://a/1.jpg")).toEqual(["https://a/1.jpg"]);
    expect(parseTbmPhotoUrls("")).toEqual([]);
    expect(parseTbmPhotoUrls(null)).toEqual([]);
  });

  it("labels counts", () => {
    expect(tbmPhotoCountLabel([])).toBe("");
    expect(tbmPhotoCountLabel(["https://a/1.jpg"])).toBe("실시 사진 1/3");
  });
});
