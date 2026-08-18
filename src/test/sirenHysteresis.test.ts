import { describe, expect, it } from "vitest";
import {
  nextSirenHysteresis,
  serverConfirmsRestricted,
  SIREN_ENTRY_STREAK_NEEDED,
  SIREN_EXIT_STREAK_NEEDED,
} from "@/lib/tracking/sirenHysteresis";

describe("siren hysteresis (F-02, F-04)", () => {
  it("does not open on a single inside hit", () => {
    const a = nextSirenHysteresis({
      inside: true,
      accurate: true,
      entryStreak: 0,
      exitStreak: 0,
    });
    expect(a.open).toBe(false);
    expect(a.entryStreak).toBe(1);
  });

  it("opens on two consecutive accurate inside hits", () => {
    const a = nextSirenHysteresis({
      inside: true,
      accurate: true,
      entryStreak: SIREN_ENTRY_STREAK_NEEDED - 1,
      exitStreak: 2,
    });
    expect(a.open).toBe(true);
    expect(a.exitStreak).toBe(0);
  });

  it("ignores a 300m blip for both open and close", () => {
    const a = nextSirenHysteresis({
      inside: true,
      accurate: false,
      entryStreak: 1,
      exitStreak: 0,
    });
    expect(a.open).toBe(false);
    expect(a.entryStreak).toBe(1);
    const b = nextSirenHysteresis({
      inside: false,
      accurate: false,
      entryStreak: 0,
      exitStreak: 2,
    });
    expect(b.close).toBe(false);
    expect(b.exitStreak).toBe(2);
  });

  it("closes only after the configured outside streak", () => {
    const almost = nextSirenHysteresis({
      inside: false,
      accurate: true,
      entryStreak: 2,
      exitStreak: SIREN_EXIT_STREAK_NEEDED - 2,
    });
    expect(almost.close).toBe(false);
    const done = nextSirenHysteresis({
      inside: false,
      accurate: true,
      entryStreak: 0,
      exitStreak: SIREN_EXIT_STREAK_NEEDED - 1,
    });
    expect(done.close).toBe(true);
    expect(done.entryStreak).toBe(0);
  });
});

describe("serverConfirmsRestricted (S-01)", () => {
  it("treats low-accuracy ignore as unknown so a preview is not cleared", () => {
    expect(serverConfirmsRestricted({ ignored: "low_accuracy" })).toBe("unknown");
  });

  it("treats restricted_zone_id / unauthorized_entry as inside", () => {
    expect(serverConfirmsRestricted({ restricted_zone_id: "z1" })).toBe("inside");
    expect(serverConfirmsRestricted({ event_type: "unauthorized_entry" })).toBe("inside");
    expect(serverConfirmsRestricted({ zone_type: "danger" })).toBe("inside");
  });

  it("treats exit and empty restricted match as outside", () => {
    expect(serverConfirmsRestricted({ event_type: "exit" })).toBe("outside");
    expect(serverConfirmsRestricted({ event_type: "entry" })).toBe("outside");
  });
});
