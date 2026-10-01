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
    vi.unstubAllGlobals();
  });

  function mount(idleMs?: number, connectMs?: number, playbackUrl = PLAYBACK) {
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
          playbackUrl={playbackUrl}
          idleMs={idleMs}
          connectMs={connectMs}
        />,
      );
    });
  }

  function showPicture() {
    const video = el!.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "videoWidth", { configurable: true, get: () => 320 });
    Object.defineProperty(video, "readyState", { configurable: true, get: () => 2 });
    act(() => {
      video.dispatchEvent(new Event("playing"));
    });
  }

  function mockPlaylist(status: number, body = "") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("viewer-status")) {
        return new Response(JSON.stringify({ idle_kick: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(body, { status });
    }),
  );
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
    expect(el!.textContent).toContain("카메라를 연결하고 있습니다");
    expect(el!.textContent).toContain("사용 방법이 잘못된 것이 아닙니다");
    expect(el!.textContent).toContain("연결될 때까지");
    expect(el!.textContent).not.toContain("붙");
    expect(el!.querySelector('[data-testid="vision-pane-connecting-0"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="vision-pane-controls-0"]')).toBeNull();
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    expect(el!.textContent).not.toContain("online");
    expect(el!.textContent).not.toContain("재생 중");
    showPicture();
    expect(el!.querySelector('[data-testid="vision-pane-connecting-0"]')).toBeNull();
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
    expect(el!.textContent).toContain("카메라를 연결하고 있습니다");
    expect(el!.textContent).not.toContain("재생 중");
    showPicture();
    expect(el!.textContent).toContain("재생 중");
    expect(el!.textContent).not.toContain("카메라를 연결하고 있습니다");
    expect(el!.querySelector("video")?.getAttribute("data-vision-frame")).toBe("ready");
  });

  it("pauses, unmutes, and changes volume", () => {
    mount();
    showPicture();
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
    showPicture();
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

  it("keeps the address after a playback error and shows the picture when it arrives", async () => {
    mount(undefined, 8_000);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const video = el!.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src") || video.src).toContain("index.m3u8");
    act(() => {
      video.dispatchEvent(new Event("error"));
    });
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    expect(video.getAttribute("src") || video.src).toContain("index.m3u8");
    showPicture();
    expect(el!.textContent).toContain("재생 중");
  });

  it("clears the offline notice when a picture arrives without a retry click", async () => {
    vi.useFakeTimers();
    mockPlaylist(404);
    mount(undefined, 8_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(el!.textContent).toContain("카메라가 서버에 연결되어 있지 않습니다");
    showPicture();
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    expect(el!.textContent).toContain("재생 중");
  });

  it("keeps a relay picture on a short drop instead of saying it is offline", async () => {
    mount(undefined, 8_000, "https://49-247-192-161.sslip.io/live/0edfed08baf964c1/index.m3u8");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const video = el!.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src") || video.src).toContain("/live/0edfed08baf964c1/index.m3u8");
    showPicture();
    act(() => {
      video.dispatchEvent(new Event("error"));
      video.dispatchEvent(new Event("waiting"));
    });
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    expect(el!.textContent).toContain("재생 중");
  });

  it("says the camera is not connected when the playlist is missing", async () => {
    vi.useFakeTimers();
    mockPlaylist(404);
    mount(undefined, 8_000);
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
      (el!.querySelector("video") as HTMLVideoElement).dispatchEvent(new Event("waiting"));
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(el!.textContent).toContain("카메라가 서버에 연결되어 있지 않습니다");
    expect(el!.textContent).toContain("전원, 배터리, 4G 중 하나일 수 있습니다");
    expect(el!.textContent).not.toContain("붙");
  });

  it("names the relay when the playlist cannot be reached", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    mount(undefined, 8_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(el!.textContent).toContain("중계 서버에 연결하지 못했습니다");
  });

  it("keeps connecting while a fresh playlist has no picture yet", async () => {
    vi.useFakeTimers();
    mockPlaylist(200, "#EXTM3U\n#EXTINF:1.0,\nseg.ts\n");
    mount(undefined, 8_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(el!.querySelector('[data-testid="vision-pane-offline-0"]')).toBeNull();
    expect(el!.textContent).toContain("카메라를 연결하고 있습니다");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(el!.textContent).toContain("서버에는 연결되어 있는데 화면이 열리지 않습니다");
  });

  it("keeps a live picture when the element errors after playback started", () => {
    mount();
    const video = el!.querySelector("video") as HTMLVideoElement;
    showPicture();
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
    showPicture();
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
    showPicture();
    expect(el!.querySelector('[data-testid="vision-pane-idle-0"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(el!.querySelector('[data-testid="vision-pane-idle-0"]')).toBeTruthy();
    expect(el!.textContent).toContain("트래픽 절약을 위해 재생을 멈췄습니다");
    click("vision-pane-resume-0");
    expect(el!.querySelector('[data-testid="vision-pane-idle-0"]')).toBeNull();
    expect(el!.textContent).toContain("카메라를 연결하고 있습니다");
    showPicture();
    expect(el!.querySelector('[data-testid="vision-pane-controls-0"]')).toBeTruthy();
  });

  it("tells the viewer when a snapshot or recording has no picture yet", async () => {
    mount();
    showPicture();
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
