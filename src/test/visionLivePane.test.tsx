import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("hls.js", () => ({
  default: class Hls {
    static isSupported() {
      return false;
    }
  },
}));

import VisionLivePane from "@/components/vision/VisionLivePane";
import { toast } from "sonner";

const PLAYBACK = "https://example.com/live/ab/index.m3u8";

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
    vi.clearAllMocks();
  });

  function mount(idleMs?: number, connectMs?: number) {
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
          playbackUrl={PLAYBACK}
          idleMs={idleMs}
          connectMs={connectMs}
        />,
      );
    });
  }

  function click(id: string) {
    act(() => {
      (el!.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click();
    });
  }

  it("uses its own controls and does not call a saved address online", () => {
    mount();
    const overlay = el!.querySelector('[data-testid="vision-pane-overlay-0"]') as HTMLElement;
    expect(overlay.className).toContain("pointer-events-none");
    expect((el!.querySelector("video") as HTMLVideoElement).controls).toBe(false);
    expect(el!.textContent).toContain("연결 중");
    expect(el!.textContent).not.toContain("online");
    expect(el!.textContent).not.toContain("재생 중");
    for (const id of [
      "play",
      "mute",
      "snapshot",
      "record",
      "zoom-in",
      "zoom-out",
      "pan-up",
      "pan-down",
      "pan-left",
      "pan-right",
      "pip",
      "fullscreen",
    ]) {
      expect(el!.querySelector(`[data-testid="vision-pane-${id}-0"]`), id).toBeTruthy();
    }
    expect(el!.querySelector('[data-testid="vision-pane-volume-0"]')).toBeTruthy();
  });

  it("says it is playing only after a picture actually starts", () => {
    mount();
    act(() => {
      (el!.querySelector("video") as HTMLVideoElement).dispatchEvent(new Event("playing"));
    });
    expect(el!.textContent).toContain("재생 중");
    expect(el!.querySelector("video")?.getAttribute("data-vision-frame")).toBe("ready");
  });

  it("pauses, unmutes, and changes volume", () => {
    mount();
    const video = el!.querySelector("video") as HTMLVideoElement;
    expect(video.muted).toBe(true);
    click("vision-pane-play-0");
    expect(el!.querySelector('[data-testid="vision-pane-play-0"]')?.getAttribute("aria-label")).toBe("재생");
    expect(el!.textContent).toContain("일시정지");
    click("vision-pane-play-0");
    expect(el!.querySelector('[data-testid="vision-pane-play-0"]')?.getAttribute("aria-label")).toBe("일시정지");

    click("vision-pane-mute-0");
    expect(video.muted).toBe(false);
    expect(el!.querySelector('[data-testid="vision-pane-mute-0"]')?.getAttribute("aria-label")).toBe("음소거");

    const slider = el!.querySelector('[data-testid="vision-pane-volume-0"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(slider, "0");
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(video.muted).toBe(true);
  });

  it("zooms, pans the enlarged picture, and leaves fullscreen", () => {
    mount();
    click("vision-pane-zoom-in-0");
    expect(el!.querySelector('[data-testid="vision-pane-0"]')?.getAttribute("data-zoom")).toBe("1.5");
    click("vision-pane-zoom-out-0");
    expect(el!.querySelector('[data-testid="vision-pane-0"]')?.getAttribute("data-zoom")).toBe("1");

    click("vision-pane-pan-up-0");
    const pane = el!.querySelector('[data-testid="vision-pane-0"]') as HTMLElement;
    expect(pane.getAttribute("data-zoom")).toBe("1.5");
    expect(Number(pane.getAttribute("data-pan-y"))).toBeLessThan(0);
    click("vision-pane-pan-right-0");
    expect(Number(pane.getAttribute("data-pan-x"))).toBeGreaterThan(0);

    pane.requestFullscreen = () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => pane });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    document.exitFullscreen = () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    click("vision-pane-fullscreen-0");
    expect(el!.querySelector('[data-testid="vision-pane-fullscreen-0"]')?.getAttribute("aria-label")).toBe("축소");
    click("vision-pane-fullscreen-0");
    expect(el!.querySelector('[data-testid="vision-pane-fullscreen-0"]')?.getAttribute("aria-label")).toBe("전체화면");
  });

  it("says the camera is not publishing when playback fails", () => {
    mount();
    const video = el!.querySelector("video") as HTMLVideoElement;
    act(() => {
      video.dispatchEvent(new Event("error"));
    });
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeTruthy();
    expect(el!.textContent).toContain("송출이 없습니다");
    click("vision-pane-retry-0");
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    expect(el!.textContent).toContain("연결 중");
  });

  it("says the camera is not publishing when no picture arrives", () => {
    vi.useFakeTimers();
    mount(undefined, 8_000);
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(4_000);
      (el!.querySelector("video") as HTMLVideoElement).dispatchEvent(new Event("waiting"));
      vi.advanceTimersByTime(4_000);
    });
    expect(el!.textContent).toContain("송출이 없습니다");
  });

  it("keeps a live picture when the element errors after playback started", () => {
    mount();
    const video = el!.querySelector("video") as HTMLVideoElement;
    act(() => {
      video.dispatchEvent(new Event("playing"));
    });
    act(() => {
      video.dispatchEvent(new Event("error"));
    });
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    expect(el!.textContent).toContain("재생 중");
  });

  it("keeps a live picture through a short buffer gap", () => {
    vi.useFakeTimers();
    mount(undefined, 8_000);
    const video = el!.querySelector("video") as HTMLVideoElement;
    act(() => {
      video.dispatchEvent(new Event("playing"));
    });
    act(() => {
      video.dispatchEvent(new Event("waiting"));
      vi.advanceTimersByTime(8_000);
    });
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    expect(el!.textContent).toContain("재생 중");
  });

  it("stops HLS pull after the idle window and lets the viewer resume", () => {
    vi.useFakeTimers();
    mount();
    act(() => {
      (el!.querySelector("video") as HTMLVideoElement).dispatchEvent(new Event("playing"));
    });
    expect(el!.querySelector('[data-testid="vision-pane-idle-0"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(el!.querySelector('[data-testid="vision-pane-idle-0"]')).toBeTruthy();
    expect(el!.textContent).toContain("트래픽 절약을 위해 재생을 멈췄습니다");
    click("vision-pane-resume-0");
    expect(el!.querySelector('[data-testid="vision-pane-idle-0"]')).toBeNull();
    expect(el!.querySelector('[data-testid="vision-pane-controls-0"]')).toBeTruthy();
  });

  it("tells the viewer when a snapshot or recording has no picture yet", async () => {
    mount();
    await act(async () => {
      (el!.querySelector('[data-testid="vision-pane-snapshot-0"]') as HTMLButtonElement).click();
    });
    expect(toast.error).toHaveBeenCalledWith("아직 저장할 화면이 없습니다");
    click("vision-pane-record-0");
    expect(toast.error).toHaveBeenCalledWith("이 브라우저에서는 녹화를 지원하지 않습니다");
    click("vision-pane-pip-0");
    expect(toast.error).toHaveBeenCalledWith("이 브라우저에서는 작은 창을 지원하지 않습니다");
  });
});
