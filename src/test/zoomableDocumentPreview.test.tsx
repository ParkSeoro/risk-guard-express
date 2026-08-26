import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import ZoomableDocumentPreview from "@/components/docs/ZoomableDocumentPreview";
import { A4_PORTRAIT_PX, previewFitScale } from "@/lib/approvalDocPreview";

/** Same phone frames as Settings → 모바일 프리뷰 (`MobilePreviewHost` VIEWPORTS). */
const MOBILE_PREVIEW_WIDTHS = [412, 390, 360];

const SAMPLE_HTML = `<!DOCTYPE html><html><head></head><body>
  <div style="height:2400px;background:#fff">
    <header style="background:#1e293b;color:#fff;padding:12px">작 업 계 획 서</header>
    <p>본문</p>
  </div>
</body></html>`;

describe("ZoomableDocumentPreview mobile-preview frames", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  beforeEach(() => {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
  });

  it("keeps A4 within every mobile-preview phone width", () => {
    for (const w of MOBILE_PREVIEW_WIDTHS) {
      const scale = previewFitScale(w, A4_PORTRAIT_PX);
      expect(scale).toBeLessThanOrEqual(1);
      expect(scale).toBeCloseTo(w / A4_PORTRAIT_PX, 8);
    }
    expect(previewFitScale(1200, A4_PORTRAIT_PX) * A4_PORTRAIT_PX).toBe(A4_PORTRAIT_PX);
  });

  it("renders a native vertical scrollbar, not a pan-only surface", () => {
    el = document.createElement("div");
    el.style.width = "390px";
    el.style.height = "844px";
    document.body.appendChild(el);
    root = createRoot(el);

    act(() => {
      root!.render(
        <div style={{ width: 390, height: 844 }}>
          <ZoomableDocumentPreview html={SAMPLE_HTML} loading={false} active pageWidth={A4_PORTRAIT_PX} />
        </div>,
      );
    });

    const preview = el.querySelector("[data-testid='zoomable-doc-preview']");
    expect(preview).toBeTruthy();
    const scroller = preview?.querySelector(".overflow-y-scroll");
    expect(scroller).toBeTruthy();
    expect(scroller?.className).not.toMatch(/overflow-hidden/);
    expect(scroller?.className).not.toMatch(/touch-none/);
    expect(el.textContent).toContain("스크롤");
  });
});
