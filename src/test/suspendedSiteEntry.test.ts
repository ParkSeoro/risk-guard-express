import { describe, expect, it } from "vitest";
import { isWithinSiteAttendance, type SiteBoundary } from "@/lib/tracking/siteBoundary";
import { workerGpsStartMode } from "@/lib/tracking/suspendedWorkerGps";
import {
  isWithinAttendanceShape,
  isWithinPinAttendance,
  matchingAttendanceSpotName,
} from "../../supabase/functions/_shared/siteSpotAttendance";

const square: SiteBoundary = {
  id: "spot-1",
  project_id: "p1",
  name: "본관",
  geometry_type: "polygon",
  geo_polygon: [
    { lat: 37.5, lng: 127.0 },
    { lat: 37.501, lng: 127.0 },
    { lat: 37.501, lng: 127.001 },
    { lat: 37.5, lng: 127.001 },
  ],
  center_lat: 37.5005,
  center_lng: 127.0005,
  radius_m: 400,
  buffer_m: 150,
};

describe("suspended worker GPS start", () => {
  it("tracks a checked-in worker the usual way", () => {
    expect(workerGpsStartMode({ checkedIn: true, siteEntrySuspended: false })).toBe("checked_in");
  });

  it("tracks a suspended worker from the site fence without a check-in", () => {
    expect(workerGpsStartMode({ checkedIn: false, siteEntrySuspended: true })).toBe("site_fence");
  });

  it("keeps an already checked-in suspended worker on the open entry", () => {
    expect(workerGpsStartMode({ checkedIn: true, siteEntrySuspended: true })).toBe("checked_in");
  });

  it("does not track a normal worker who has not checked in", () => {
    expect(workerGpsStartMode({ checkedIn: false, siteEntrySuspended: false })).toBe("stopped");
  });
});

describe("site attendance match used by the alarm", () => {
  it("agrees with the client attendance rule inside the shape and outside the buffer", () => {
    const inside = { lat: 37.5005, lng: 127.0005 };
    const far = { lat: 37.51, lng: 127.01 };
    expect(isWithinAttendanceShape(inside.lat, inside.lng, square, 10)).toBe(
      isWithinSiteAttendance(inside.lat, inside.lng, square, 10),
    );
    expect(isWithinAttendanceShape(inside.lat, inside.lng, square, 10)).toBe(true);
    expect(isWithinAttendanceShape(far.lat, far.lng, square, 10)).toBe(false);
    expect(isWithinAttendanceShape(far.lat, far.lng, square, 10)).toBe(
      isWithinSiteAttendance(far.lat, far.lng, square, 10),
    );
  });

  it("names the first matching spot and ignores a fix outside every spot", () => {
    expect(
      matchingAttendanceSpotName(37.5005, 127.0005, [square], 5),
    ).toBe("본관");
    expect(matchingAttendanceSpotName(37.51, 127.01, [square], 5)).toBeNull();
  });

  it("treats a pin-only site as inside the 350m attendance circle", () => {
    expect(isWithinPinAttendance(37.5, 127.0, 37.5, 127.0, 10)).toBe(true);
    expect(isWithinPinAttendance(37.51, 127.0, 37.5, 127.0, 10)).toBe(false);
  });
});
