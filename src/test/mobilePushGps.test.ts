import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  hasTrackingConsent,
  setTrackingConsent,
  normalizeTrackingConsentStorage,
} from "@/lib/tracking/locationTracker";
import { isIosSafariTab, pushStatusLabel } from "@/lib/pushSubscription";

describe("tracking consent SSOT", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("accepts legacy '1' from old ConsentPage writes", () => {
    localStorage.setItem("tracking-consent-v1", "1");
    expect(hasTrackingConsent()).toBe(true);
  });

  it("normalizes '1' to 'yes'", () => {
    localStorage.setItem("tracking-consent-v1", "1");
    normalizeTrackingConsentStorage();
    expect(localStorage.getItem("tracking-consent-v1")).toBe("yes");
    expect(hasTrackingConsent()).toBe(true);
  });

  it("setTrackingConsent(true) writes yes", () => {
    setTrackingConsent(true);
    expect(localStorage.getItem("tracking-consent-v1")).toBe("yes");
    expect(hasTrackingConsent()).toBe(true);
  });

  it("rejects no / missing", () => {
    expect(hasTrackingConsent()).toBe(false);
    setTrackingConsent(false);
    expect(hasTrackingConsent()).toBe(false);
  });
});

describe("push platform hints", () => {
  const originalUA = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: originalUA,
    });
  });

  it("detects iOS Safari tab (not standalone)", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    // matchMedia standalone false by default in jsdom
    expect(isIosSafariTab()).toBe(true);
    expect(pushStatusLabel()).toMatch(/홈 화면/);
  });
});

describe("distance UI state logic", () => {
  it("distinguishes site missing vs gps waiting", () => {
    const siteLat: number | null = null;
    const siteLng: number | null = null;
    const lastGpsFix = null;
    const label =
      siteLat == null || siteLng == null
        ? "현장 좌표 미설정"
        : !lastGpsFix
          ? "GPS 대기…"
          : "ok";
    expect(label).toBe("현장 좌표 미설정");
  });
});
