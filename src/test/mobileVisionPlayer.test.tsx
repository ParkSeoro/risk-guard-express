import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import MobileVisionPlayer from "@/components/vision/MobileVisionPlayer";
import { selectedMobileVisionCamera } from "@/lib/mobileVisionPlayer";

describe("selectedMobileVisionCamera", () => {
  it("falls back to the first camera when the id is missing", () => {
    const cameras = [
      { id: "a", name: "정문" },
      { id: "b", name: "후문" },
    ];
    expect(selectedMobileVisionCamera(cameras, null)?.id).toBe("a");
    expect(selectedMobileVisionCamera(cameras, "b")?.id).toBe("b");
    expect(selectedMobileVisionCamera(cameras, "gone")?.id).toBe("a");
    expect(selectedMobileVisionCamera([], "a")).toBeNull();
  });
});

describe("MobileVisionPlayer", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
  });

  it("plays one camera at a time instead of a 2x2 wall", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    const cameras = [
      {
        id: "c1",
        camera_id: "cam-1",
        name: "정문",
        health_state: "online",
        playback_url: null,
      },
      {
        id: "c2",
        camera_id: "cam-2",
        name: "후문",
        health_state: "online",
        playback_url: null,
      },
    ];
    act(() => {
      root!.render(<MobileVisionPlayer cameras={cameras} />);
    });
    expect(el.querySelector('[data-testid="mobile-vision-player"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="vision-quad-grid"]')).toBeNull();
    expect(el.querySelectorAll('[data-testid^="vision-pane-"]')).toHaveLength(1);
    expect(el.textContent).toContain("정문");
    expect(el.textContent).toContain("후문");

    act(() => {
      (el!.querySelector('[data-testid="mobile-vision-cam-c2"]') as HTMLButtonElement).click();
    });
    expect(el.querySelectorAll('[data-testid^="vision-pane-"]')).toHaveLength(1);
    expect(
      (el.querySelector('[data-testid="mobile-vision-cam-c2"]') as HTMLButtonElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("shows an empty pane when there are no cameras", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(<MobileVisionPlayer cameras={[]} />);
    });
    expect(el.querySelector('[data-testid="mobile-vision-empty"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid^="vision-pane-"]')).toHaveLength(0);
  });
});
