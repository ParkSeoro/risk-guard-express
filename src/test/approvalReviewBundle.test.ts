import { describe, expect, it } from "vitest";
import { bundleRiskItems, reviewBundleForStatus } from "@/lib/approvalReviewBundle";

const bundle = {
  bundle_version: 2,
  risk_items: [
    { id: "a", is_deleted: false, hazard: "추락" },
    { id: "b", is_deleted: true, hazard: "지움" },
  ],
  participants: [{ user_name: "김" }],
};

describe("approval review bundle", () => {
  it("lets a reviewer read the submit bundle", () => {
    const found = reviewBundleForStatus("결재중", bundle);
    expect(found?.participants).toEqual([{ user_name: "김" }]);
    expect(bundleRiskItems(found)).toEqual([{ id: "a", is_deleted: false, hazard: "추락" }]);
  });

  it("keeps drafts and returns on the live rows", () => {
    expect(reviewBundleForStatus("작성중", bundle)).toBeNull();
    expect(reviewBundleForStatus("반려", bundle)).toBeNull();
    expect(reviewBundleForStatus("보완중", bundle)).toBeNull();
  });

  it("ignores a snapshot that is not the review bundle", () => {
    expect(reviewBundleForStatus("승인완료", { title: "old" })).toBeNull();
    expect(reviewBundleForStatus("승인완료", null)).toBeNull();
  });
});
