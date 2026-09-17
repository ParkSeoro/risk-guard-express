import { describe, expect, it } from "vitest";
import {
  DISPATCH_CONCURRENCY,
  chunkArray,
  uniqueNotificationIds,
} from "../../supabase/functions/_shared/dispatchNotificationBatch";

describe("uniqueNotificationIds", () => {
  it("dedupes and drops blanks", () => {
    expect(uniqueNotificationIds(["a", "a", "", "b", null, "b"])).toEqual(["a", "b"]);
  });
});

describe("chunkArray", () => {
  it("keeps site-wide fanout at a small concurrency", () => {
    expect(DISPATCH_CONCURRENCY).toBe(8);
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
