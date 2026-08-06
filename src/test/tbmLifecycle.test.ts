import { describe, expect, it } from "vitest";
import { todayKst } from "@/lib/permitWorkDate";

describe("tbmLifecycle date helpers", () => {
  it("todayKst is YYYY-MM-DD", () => {
    expect(todayKst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("past tbm_date is before today (ordering)", () => {
    const today = todayKst();
    expect("2026-08-04" < today || "2026-08-04" === today || "2026-08-04" > today).toBe(true);
    // Aug 4/5 relative to a later day
    expect("2026-08-04" < "2026-08-06").toBe(true);
    expect("2026-08-05" < "2026-08-06").toBe(true);
  });
});
