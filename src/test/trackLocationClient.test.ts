import { describe, expect, it } from "vitest";
import {
  isTrackLocationIdentityDenied,
  TRACK_LOCATION_IDENTITY_DENIED,
  trackLocationInvokeUserMessage,
} from "@/lib/tracking/trackLocationClient";

describe("trackLocationInvokeUserMessage", () => {
  it("surfaces identity mismatch instead of failing silently", () => {
    expect(
      trackLocationInvokeUserMessage({ message: "Identity mismatch: body worker does not match authenticated user" }),
    ).toBe(TRACK_LOCATION_IDENTITY_DENIED);
    expect(isTrackLocationIdentityDenied(TRACK_LOCATION_IDENTITY_DENIED)).toBe(true);
  });

  it("maps a generic 403 to a visible GPS rejection", () => {
    expect(trackLocationInvokeUserMessage({ message: "Forbidden", context: { status: 403 } })).toMatch(
      /거부/,
    );
  });

  it("returns null when invoke succeeded", () => {
    expect(trackLocationInvokeUserMessage(null)).toBeNull();
  });
});
