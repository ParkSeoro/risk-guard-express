/**
 * Phone-width print-HTML preview with pinch / wheel / double-tap / +/- zoom.
 * iframe is pointer-events-none so gestures stay on the viewport (not swallowed).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  A4_PORTRAIT_PX,
  MAX_USER_SCALE,
  MIN_USER_SCALE,
  clamp,
  clampDocumentPan,
  fitWidthScale,
} from "@/lib/approvalDocPreview";

type Props = {
  html: string | null;
  loading?: boolean;
  error?: string | null;
  pageWidth?: number;
  className?: string;
  emptyHint?: string;
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
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [contentH, setContentH] = useState(pageWidth * 1.414);
  const [userScale, setUserScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const live = useRef({ userScale: 1, tx: 0, ty: 0, vpW: 0, vpH: 0, contentH: pageWidth * 1.414, pageWidth });
  live.current.userScale = userScale;
  live.current.tx = tx;
  live.current.ty = ty;
  live.current.vpW = vp.w;
  live.current.vpH = vp.h;
  live.current.contentH = contentH;
  live.current.pageWidth = pageWidth;

  const gesture = useRef<{
    mode: "none" | "pan" | "pinch";
    startX: number;
    startY: number;
    originTx: number;
    originTy: number;
    originScale: number;
    pinchDist: number;
    pinchLx: number;
    pinchLy: number;
    moved: boolean;
    lastTapAt: number;
  }>({
    mode: "none",
    startX: 0,
    startY: 0,
    originTx: 0,
    originTy: 0,
    originScale: 1,
    pinchDist: 0,
    pinchLx: 0,
    pinchLy: 0,
    moved: false,
    lastTapAt: 0,
  });

  const applyClamped = useCallback((nextScale: number, nextTx: number, nextTy: number) => {
    const s = clamp(nextScale, MIN_USER_SCALE, MAX_USER_SCALE);
    const { vpW, vpH, contentH: h, pageWidth: pw } = live.current;
    const fit = fitWidthScale(vpW, pw);
    const pan = clampDocumentPan(nextTx, nextTy, fit * s, pw, h, vpW, vpH);
    live.current.userScale = s;
    live.current.tx = pan.tx;
    live.current.ty = pan.ty;
    setUserScale(s);
    setTx(pan.tx);
    setTy(pan.ty);
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextUserScale: number) => {
      const box = viewportRef.current?.getBoundingClientRect();
      const { userScale: cur, tx: curTx, ty: curTy, vpW, pageWidth: pw } = live.current;
      const fit = fitWidthScale(vpW, pw);
      const s = clamp(nextUserScale, MIN_USER_SCALE, MAX_USER_SCALE);
      if (!box || fit <= 0 || cur <= 0) {
        applyClamped(s, curTx, curTy);
        return;
      }
      const lx = clientX - box.left;
      const ly = clientY - box.top;
      const ratio = s / cur;
      applyClamped(s, lx - (lx - curTx) * ratio, ly - (ly - curTy) * ratio);
    },
    [applyClamped],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = cr.width;
      const h = cr.height;
      setVp({ w, h });
      live.current.vpW = w;
      live.current.vpH = h;
      const fit = fitWidthScale(w, live.current.pageWidth);
      const pan = clampDocumentPan(
        live.current.tx,
        live.current.ty,
        fit * live.current.userScale,
        live.current.pageWidth,
        live.current.contentH,
        w,
        h,
      );
      setTx(pan.tx);
      setTy(pan.ty);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setUserScale(1);
    setTx(0);
    setTy(0);
    live.current.userScale = 1;
    live.current.tx = 0;
    live.current.ty = 0;
  }, [html, pageWidth]);

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

  const onIframeLoad = () => {
    measureIframe();
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const imgs = Array.from(doc.images || []);
    imgs.forEach((img) => {
      if (img.complete) return;
      img.addEventListener("load", measureIframe);
      img.addEventListener("error", measureIframe);
    });
    requestAnimationFrame(measureIframe);
    setTimeout(measureIframe, 400);
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(e.clientX, e.clientY, live.current.userScale * factor);
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
        g.originTx = live.current.tx;
        g.originTy = live.current.ty;
        const box = el.getBoundingClientRect();
        g.pinchLx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - box.left;
        g.pinchLy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - box.top;
        g.moved = true;
        return;
      }
      if (e.touches.length === 1) {
        g.mode = "pan";
        g.startX = e.touches[0].clientX;
        g.startY = e.touches[0].clientY;
        g.originTx = live.current.tx;
        g.originTy = live.current.ty;
        g.moved = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (g.mode === "pinch" && e.touches.length === 2) {
        e.preventDefault();
        const d = dist(
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY },
        );
        const next = clamp(g.originScale * (d / Math.max(g.pinchDist, 1)), MIN_USER_SCALE, MAX_USER_SCALE);
        const ratio = next / Math.max(g.originScale, 0.001);
        applyClamped(
          next,
          g.pinchLx - (g.pinchLx - g.originTx) * ratio,
          g.pinchLy - (g.pinchLy - g.originTy) * ratio,
        );
        g.moved = true;
        return;
      }
      if (g.mode === "pan" && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - g.startX;
        const dy = e.touches[0].clientY - g.startY;
        if (Math.hypot(dx, dy) > 6) g.moved = true;
        applyClamped(live.current.userScale, g.originTx + dx, g.originTy + dy);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gesture.current;
      if (g.mode === "pan" && !g.moved && e.changedTouches[0]) {
        const t = e.changedTouches[0];
        const now = Date.now();
        if (now - g.lastTapAt < 320) {
          const next = live.current.userScale < 1.8 ? 2.4 : 1;
          if (next === 1) applyClamped(1, 0, 0);
          else zoomAt(t.clientX, t.clientY, next);
          g.lastTapAt = 0;
        } else {
          g.lastTapAt = now;
        }
      }
      if (e.touches.length === 0) g.mode = "none";
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
  }, [applyClamped, zoomAt]);

  const fit = fitWidthScale(vp.w, pageWidth);
  const scale = fit * userScale;

  const reset = () => applyClamped(1, 0, 0);

  return (
    <div className={`relative min-h-0 h-full ${className || ""}`} data-testid="zoomable-doc-preview">
      <div
        ref={viewportRef}
        className="absolute inset-0 overflow-hidden bg-slate-800 touch-none select-none"
        style={{ touchAction: "none" }}
      >
        {html && (
          <div
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
              transformOrigin: "0 0",
              willChange: "transform",
              width: pageWidth,
            }}
          >
            <iframe
              ref={iframeRef}
              title="문서 미리보기"
              srcDoc={html}
              sandbox="allow-same-origin"
              onLoad={onIframeLoad}
              className="block border-0 bg-white pointer-events-none"
              style={{ width: pageWidth, height: contentH }}
            />
          </div>
        )}
      </div>

      {(loading || (!html && !error)) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300 bg-slate-900/70 z-10">
          {loading ? (
            <>
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">문서를 준비하는 중…</p>
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
        핀치·더블탭·+/− · {userScale.toFixed(1)}×
      </div>
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-9 w-9"
          aria-label="확대"
          onClick={() => {
            const box = viewportRef.current?.getBoundingClientRect();
            if (!box) return;
            zoomAt(box.left + box.width / 2, box.top + box.height / 2, userScale * 1.35);
          }}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-9 w-9"
          aria-label="축소"
          onClick={() => {
            const box = viewportRef.current?.getBoundingClientRect();
            if (!box) return;
            zoomAt(box.left + box.width / 2, box.top + box.height / 2, userScale / 1.35);
          }}
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
