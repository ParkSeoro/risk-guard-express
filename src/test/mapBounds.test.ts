import { describe, it, expect } from "vitest";
import {
  anchorsToSwNe,
  swNeToAnchorPayload,
  normalizeSwNe,
} from "@/lib/mapBounds";

describe("mapBounds", () => {
  it("converts NW/SE anchors to SW/NE", () => {
    const b = anchorsToSwNe({
      geo_anchor_nw_lat: 37.6,
      geo_anchor_nw_lng: 126.9,
      geo_anchor_se_lat: 37.5,
      geo_anchor_se_lng: 127.0,
    });
    expect(b).toEqual({
      sw: { lat: 37.5, lng: 126.9 },
      ne: { lat: 37.6, lng: 127.0 },
    });
  });

  it("round-trips SW/NE to NW/SE payload", () => {
    const payload = swNeToAnchorPayload({
      sw: { lat: 37.5, lng: 126.9 },
      ne: { lat: 37.6, lng: 127.0 },
    });
    expect(payload).toEqual({
      geo_anchor_nw_lat: 37.6,
      geo_anchor_nw_lng: 126.9,
      geo_anchor_se_lat: 37.5,
      geo_anchor_se_lng: 127.0,
    });
  });

  it("normalizes inverted corners", () => {
    const b = normalizeSwNe(
      { lat: 37.6, lng: 127.0 },
      { lat: 37.5, lng: 126.9 },
    );
    expect(b.sw.lat).toBeLessThan(b.ne.lat);
    expect(b.sw.lng).toBeLessThan(b.ne.lng);
  });
});
