import { describe, expect, it } from "vitest";
import {
  createMotionIdleState,
  DEFAULT_IDLE_AFTER_MS,
  DEFAULT_MOVE_THRESHOLD_M,
  nextMotionIdle,
} from "@/lib/tracking/motionIdle";

const ORIGIN = { lat: 37.5, lng: 127.0 };

function offsetMeters(origin: { lat: number; lng: number }, northM: number, eastM: number) {
  const lat0 = (origin.lat * Math.PI) / 180;
  return {
    lat: origin.lat + northM / 111_195,
    lng: origin.lng + eastM / (111_195 * Math.cos(lat0)),
  };
}

describe("nextMotionIdle (F-11)", () => {
  const t0 = 1_000_000;

  it("is not idle on the first sample", () => {
    const r = nextMotionIdle(createMotionIdleState(t0), ORIGIN, t0);
    expect(r.idle).toBe(false);
    expect(r.state.origin).toEqual(ORIGIN);
  });

  it("treats slow walking as movement by accumulating displacement from origin", () => {
    let s = createMotionIdleState(t0);
    let t = t0;
    // Native-style 5s samples of ~5 m — previously each step was < 12 m so idle won.
    for (const north of [5, 10, 15]) {
      t += 5_000;
      const r = nextMotionIdle(s, offsetMeters(ORIGIN, north, 0), t);
      s = r.state;
      expect(r.idle).toBe(false);
    }
    expect(s.lastMovedAt).toBeGreaterThan(t0);
  });

  it("goes idle when staying within the 12 m bubble for idleAfterMs", () => {
    let s = createMotionIdleState(t0);
    s = nextMotionIdle(s, ORIGIN, t0).state;
    const jitter = nextMotionIdle(s, offsetMeters(ORIGIN, 5, 0), t0 + 30_000);
    expect(jitter.idle).toBe(false);
    s = jitter.state;
    const later = nextMotionIdle(
      s,
      offsetMeters(ORIGIN, 4, 3),
      t0 + DEFAULT_IDLE_AFTER_MS + 1,
    );
    expect(later.idle).toBe(true);
    expect(DEFAULT_MOVE_THRESHOLD_M).toBe(12);
  });

  it("does not couple idle to server-send interval", () => {
    // Web previously only moved the origin after a successful track-location.
    // A 5 m walk between two local previews must not yet be idle, and a 15 m
    // walk must reset lastMovedAt even if nothing was sent.
    let s = createMotionIdleState(t0);
    s = nextMotionIdle(s, ORIGIN, t0).state;
    const mid = nextMotionIdle(s, offsetMeters(ORIGIN, 5, 0), t0 + 45_000);
    expect(mid.idle).toBe(false);
    expect(mid.state.lastMovedAt).toBe(t0);
    const far = nextMotionIdle(mid.state, offsetMeters(ORIGIN, 15, 0), t0 + 46_000);
    expect(far.idle).toBe(false);
    expect(far.state.lastMovedAt).toBe(t0 + 46_000);
  });
});
