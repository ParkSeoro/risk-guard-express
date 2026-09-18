import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import VisionQuadGrid from "@/components/vision/VisionQuadGrid";

describe("VisionQuadGrid", () => {
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

  it("always renders four panes and pages extra cameras", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    const cameras = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      camera_id: `cam-${i}`,
      name: `현장캠 ${i + 1}`,
      health_state: "online",
      playback_url: null,
    }));
    act(() => {
      root!.render(<VisionQuadGrid cameras={cameras} page={0} onPageChange={() => undefined} />);
    });
    expect(el.querySelector('[data-testid="vision-quad-grid"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid^="vision-pane-"]')).toHaveLength(4);
    expect(el.textContent).toContain("고화질 4화면");
    expect(el.querySelector('[data-testid="vision-quad-range"]')?.textContent).toContain("1–4 / 5대");
  });
});
