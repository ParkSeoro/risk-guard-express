import { describe, expect, it } from "vitest";
import { seoulDayRange } from "@/lib/dailyWorkAck";

describe("seoulDayRange (F-01)", () => {
  it("includes a 07:00 KST check-in on that Seoul calendar day", () => {
    const { start, end } = seoulDayRange("2026-08-18");
    const entry = new Date("2026-08-18T07:00:00+09:00").getTime();
    expect(entry).toBeGreaterThanOrEqual(new Date(start).getTime());
    expect(entry).toBeLessThanOrEqual(new Date(end).getTime());
  });

  it("does not treat naive UTC midnight as Seoul midnight", () => {
    const { start } = seoulDayRange("2026-08-18");
    const naiveUtc = new Date("2026-08-18T00:00:00Z").getTime();
    const kst0700 = new Date("2026-08-18T07:00:00+09:00").getTime();
    // The old query window started at 09:00 KST, so 07:00 was missed.
    expect(kst0700).toBeLessThan(naiveUtc);
    expect(new Date(start).getTime()).toBeLessThan(kst0700);
  });

  it("excludes the previous Seoul evening and next Seoul morning", () => {
    const { start, end } = seoulDayRange("2026-08-18");
    expect(new Date("2026-08-17T23:59:59+09:00").getTime()).toBeLessThan(
      new Date(start).getTime(),
    );
    expect(new Date("2026-08-19T00:00:00+09:00").getTime()).toBeGreaterThan(
      new Date(end).getTime(),
    );
  });
});
