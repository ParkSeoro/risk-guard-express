import { describe, it, expect } from "vitest";
import { parseDateTimeValue, toDateTimeValue } from "@/components/ui/datetime-picker";

describe("DateTimePicker value helpers", () => {
  it("round-trips local datetime including non-default hours", () => {
    const d = new Date(2026, 7, 4); // Aug 4 local
    const v = toDateTimeValue(d, "14", "30");
    expect(v).toBe("2026-08-04T14:30");
    const parsed = parseDateTimeValue(v);
    expect(parsed).not.toBeNull();
    expect(parsed!.getHours()).toBe(14);
    expect(parsed!.getMinutes()).toBe(30);
  });

  it("parses empty as null", () => {
    expect(parseDateTimeValue("")).toBeNull();
    expect(parseDateTimeValue(undefined)).toBeNull();
  });
});
