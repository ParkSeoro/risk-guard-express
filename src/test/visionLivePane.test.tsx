import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

vi.mock("hls.js", () => ({
  default: class Hls {
    static isSupported() {
      return false;
    }
  },
}));

import VisionLivePane from "@/components/vision/VisionLivePane";

describe("VisionLivePane", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
  });

  it("keeps the name overlay from blocking video controls", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <VisionLivePane
          index={0}
          name="정문"
          cameraId="vps_ab"
          healthState="online"
          playbackUrl="https://example.com/live/ab/index.m3u8"
        />,
      );
    });
    const overlay = el.querySelector('[data-testid="vision-pane-overlay-0"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.className).toContain("pointer-events-none");
    expect(overlay.className).toContain("top-0");
    expect(el.querySelector('[data-testid="vision-pane-fullscreen-0"]')).toBeTruthy();
    expect((el.querySelector("video") as HTMLVideoElement).controls).toBe(true);
  });

  it("stops HLS pull after the idle window and lets the viewer resume", () => {
    vi.useFakeTimers();
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <VisionLivePane
          index={0}
          name="정문"
          cameraId="vps_ab"
          healthState="online"
          playbackUrl="https://example.com/live/ab/index.m3u8"
        />,
      );
    });
    expect(el.querySelector('[data-testid="vision-pane-idle-0"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(el.querySelector('[data-testid="vision-pane-idle-0"]')).toBeTruthy();
    expect(el.textContent).toContain("트래픽 절약을 위해 재생을 멈췄습니다");
    expect((el.querySelector("video") as HTMLVideoElement).controls).toBe(false);
    act(() => {
      (el!.querySelector('[data-testid="vision-pane-resume-0"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="vision-pane-idle-0"]')).toBeNull();
    expect((el.querySelector("video") as HTMLVideoElement).controls).toBe(true);
    vi.useRealTimers();
  });
});
