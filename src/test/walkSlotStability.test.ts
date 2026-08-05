import { describe, expect, it } from "vitest";

/**
 * Regression: capturing B must not overwrite A when labels are stable slots.
 * Mirrors MobileMapCalibration slot state machine.
 */
type WalkSlot = {
  label: string;
  u: number;
  v: number;
  status: "pending" | "done";
  lat?: number;
  lng?: number;
};

function capture(slots: WalkSlot[], label: string, gps: { lat: number; lng: number }): WalkSlot[] {
  return slots.map((s) =>
    s.label === label && s.status === "pending"
      ? { ...s, status: "done" as const, lat: gps.lat, lng: gps.lng }
      : s,
  );
}

function skipReplace(slots: WalkSlot[], label: string, uv: { u: number; v: number }): WalkSlot[] {
  return slots.map((s) =>
    s.label === label && s.status === "pending" ? { ...s, u: uv.u, v: uv.v } : s,
  );
}

describe("walk slot stability", () => {
  it("keeps A after capturing B", () => {
    let slots: WalkSlot[] = [
      { label: "A", u: 0.2, v: 0.2, status: "pending" },
      { label: "B", u: 0.8, v: 0.2, status: "pending" },
      { label: "C", u: 0.2, v: 0.8, status: "pending" },
    ];
    slots = capture(slots, "A", { lat: 35.1, lng: 129.0 });
    slots = capture(slots, "B", { lat: 35.11, lng: 129.01 });
    const a = slots.find((s) => s.label === "A")!;
    const b = slots.find((s) => s.label === "B")!;
    expect(a.status).toBe("done");
    expect(a.lat).toBe(35.1);
    expect(b.status).toBe("done");
    expect(b.lat).toBe(35.11);
    expect(a.u).toBe(0.2);
    expect(b.u).toBe(0.8);
  });

  it("skip only moves pending slot UV, never renames or touches done", () => {
    let slots: WalkSlot[] = [
      { label: "A", u: 0.2, v: 0.2, status: "done", lat: 35.1, lng: 129.0 },
      { label: "B", u: 0.8, v: 0.2, status: "pending" },
      { label: "C", u: 0.2, v: 0.8, status: "pending" },
    ];
    slots = skipReplace(slots, "B", { u: 0.55, v: 0.45 });
    expect(slots.find((s) => s.label === "A")!.lat).toBe(35.1);
    expect(slots.find((s) => s.label === "B")!.u).toBe(0.55);
    expect(slots.find((s) => s.label === "B")!.label).toBe("B");
  });
});
