import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    checkPermissions: async () => ({ location: "denied" }),
    requestPermissions: async () => ({ location: "denied" }),
  },
}));

vi.mock("@/lib/native/isNativeApp", () => ({
  isNativeApp: () => true,
}));

vi.mock("sonner", () => ({ toast: { message: vi.fn(), error: vi.fn() } }));

import GpsConsentCoach from "@/components/worker/GpsConsentCoach";

describe("GpsConsentCoach", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
  });

  it("shows which Android taps to press when location is denied", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<GpsConsentCoach isCheckedIn={false} hasFix={false} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const card = host.querySelector("[data-testid=gps-consent-coach]");
    expect(card).toBeTruthy();
    expect(card?.textContent).toMatch(/정확한 위치/);
    expect(card?.textContent).toMatch(/항상 허용/);
    expect(card?.textContent).toMatch(/출근할 수 없습니다/);
  });
});
