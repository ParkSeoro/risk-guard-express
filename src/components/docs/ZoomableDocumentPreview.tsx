/**
 * Print-HTML preview: native scroll + pinch / Ctrl+wheel / +/- zoom.
 * PC never enlarges past A4 CSS width; phone shrinks to the viewport.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  A4_PORTRAIT_PX,
  MAX_USER_SCALE,
  MIN_USER_SCALE,
  clamp,
  previewFitScale,
} from "@/lib/approvalDocPreview";
import { waitForDocumentImages } from "@/lib/printHtmlDocument";

type Props = {
  html: string | null;
  loading?: boolean;
  error?: string | null;
  pageWidth?: number;
  className?: string;
  emptyHint?: string;
  loadingHint?: string;
  /** Remeasure when the hosting tab becomes visible again. */
  active?: boolean;
};

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export default function ZoomableDocumentPreview({
  html,
  loading,
  error,
  pageWidth = A4_PORTRAIT_PX,
  className,
  emptyHint = "표시할 문서가 없습니다",
  loadingHint,
  active = true,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [contentH, setContentH] = useState(pageWidth * 1.414);
  const [userScale, setUserScale] = useState(1);
  const [imagesReady, setImagesReady] = useState(!html);
  const htmlKeyRef = useRef(html);
  const imageWaitGen = useRef(0);
  if (htmlKeyRef.current !== html) {
    htmlKeyRef.current = html;
    imageWaitGen.current += 1;
    setImagesReady(!html);
  }

  const live = useRef({
    userScale: 1,
    vpW: 0,
    contentH: pageWidth * 1.414,
    pageWidth,
  });
  live.current.userScale = userScale;
  live.current.vpW = vp.w;
  live.current.contentH = contentH;
  live.current.pageWidth = pageWidth;

  const gesture = useRef<{
    mode: "none" | "pinch";
    originScale: number;
    pinchDist: number;
  }>({
    mode: "none",
    originScale: 1,
    pinchDist: 0,
  });

  const applyScaleAt = useCallback((nextUserScale: number, clientX: number, clientY: number) => {
    const el = viewportRef.current;
    const s = clamp(nextUserScale, MIN_USER_SCALE, MAX_USER_SCALE);
    const prev = live.current.userScale;
    if (!el || prev <= 0) {
      live.current.userScale = s;
      setUserScale(s);
      return;
    }
    const box = el.getBoundingClientRect();
    const sx = el.scrollLeft + (clientX - box.left);
    const sy = el.scrollTop + (clientY - box.top);
    const ratio = s / prev;
    live.current.userScale = s;
    setUserScale(s);
    requestAnimationFrame(() => {
      el.scrollLeft = sx * ratio - (clientX - box.left);
      el.scrollTop = sy * ratio - (clientY - box.top);
    });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setVp({ w: cr.width, h: cr.height });
      live.current.vpW = cr.width;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measureIframe = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const h = Math.max(
      doc.documentElement?.scrollHeight || 0,
      doc.body?.scrollHeight || 0,
      doc.documentElement?.offsetHeight || 0,
      pageWidth,
    );
    if (h > 0) {
      setContentH(h);
      live.current.contentH = h;
    }
  }, [pageWidth]);

  useEffect(() => {
    if (!active) return;
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setVp({ w: rect.width, h: rect.height });
      live.current.vpW = rect.width;
    }
    requestAnimationFrame(measureIframe);
  }, [active, measureIframe]);

  useEffect(() => {
    setUserScale(1);
    live.current.userScale = 1;
    const el = viewportRef.current;
    if (el) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }, [html, pageWidth]);

  const onIframeLoad = () => {
    const gen = imageWaitGen.current;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      if (imageWaitGen.current === gen) setImagesReady(true);
      return;
    }
    void waitForDocumentImages(doc, { timeoutMs: 25_000 }).then(() => {
      if (imageWaitGen.current !== gen) return;
      measureIframe();
      setImagesReady(true);
      requestAnimationFrame(measureIframe);
    });
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyScaleAt(live.current.userScale * factor, e.clientX, e.clientY);
    };

    const onTouchStart = (e: TouchEvent) => {
      const g = gesture.current;
      if (e.touches.length === 2) {
        g.mode = "pinch";
        g.pinchDist = dist(
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY },
        );
        g.originScale = live.current.userScale;
        return;
      }
      g.mode = "none";
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (g.mode === "pinch" && e.touches.length === 2) {
        e.preventDefault();
        const d = dist(
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY },
        );
        const next = g.originScale * (d / Math.max(g.pinchDist, 1));
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        applyScaleAt(next, cx, cy);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gesture.current;
      if (g.mode === "pinch" && e.touches.length < 2) {
        g.mode = "none";
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [applyScaleAt]);

  const fit = previewFitScale(vp.w, pageWidth);
  const scale = fit * userScale;
  const layoutW = pageWidth * scale;
  const layoutH = contentH * scale;

  const reset = () => {
    setUserScale(1);
    live.current.userScale = 1;
    const el = viewportRef.current;
    if (el) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  };

  const zoomFromCenter = (next: number) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    applyScaleAt(next, box.left + box.width / 2, box.top + box.height / 2);
  };

  return (
    <div className={`relative min-h-0 h-full ${className || ""}`} data-testid="zoomable-doc-preview">
      <div
        ref={viewportRef}
        className="absolute inset-0 overflow-x-auto overflow-y-scroll bg-slate-800 select-none overscroll-contain"
        style={{ WebkitOverflowScrolling: "touch", scrollbarGutter: "stable" }}
      >
        {html && (
          <div className="flex justify-center min-w-full" style={{ minHeight: "100%" }}>
            <div style={{ width: layoutW, height: layoutH, position: "relative", flex: "0 0 auto" }}>
              <iframe
                ref={iframeRef}
                title="문서 미리보기"
                srcDoc={html}
                sandbox="allow-same-origin"
                onLoad={onIframeLoad}
                className="block border-0 bg-white pointer-events-none"
                style={{
                  width: pageWidth,
                  height: contentH,
                  transform: `scale(${scale})`,
                  transformOrigin: "0 0",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {(loading || (html && !imagesReady) || (!html && !error)) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300 bg-slate-900/70 z-10">
          {loading || (html && !imagesReady) ? (
            <>
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">{loadingHint || (html && !imagesReady ? "문서를 불러오는 중…" : "문서를 준비하는 중…")}</p>
            </>
          ) : (
            <p className="text-sm text-slate-400">{emptyHint}</p>
          )}
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-x-3 top-3 z-10 rounded-lg bg-amber-950/90 border border-amber-700 px-3 py-2 text-sm text-amber-100">
          {error}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/65 px-2 py-1 text-[10px] text-white">
        스크롤 · 핀치/Ctrl+휠 줌 · {userScale.toFixed(1)}×
      </div>
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-9 w-9"
          aria-label="확대"
          onClick={() => zoomFromCenter(userScale * 1.35)}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-9 w-9"
          aria-label="축소"
          onClick={() => zoomFromCenter(userScale / 1.35)}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-9 w-9"
          aria-label="맞춤"
          onClick={reset}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
