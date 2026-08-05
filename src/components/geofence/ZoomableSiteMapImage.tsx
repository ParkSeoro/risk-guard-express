/**
 * Pinch / wheel / double-tap zoom + pan for precise UV picks on site map photos.
 */
import { useCallback, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

type Uv = { u: number; v: number };

export type MapMarker = Uv & {
  label?: string;
  /** Tailwind-ish tone: blue | amber | emerald | rose */
  tone?: "blue" | "amber" | "emerald" | "rose";
};

type Props = {
  src: string;
  alt?: string;
  /** Single pick marker (1-point mode). */
  marker?: Uv | null;
  /** Extra labeled markers (walk recommendations / captured). */
  markers?: MapMarker[];
  onPick: (uv: Uv) => void;
  className?: string;
};

const TONE_CLASS: Record<NonNullable<MapMarker["tone"]>, string> = {
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
};

const MIN_SCALE = 1;
const MAX_SCALE = 8;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export default function ZoomableSiteMapImage({
  src,
  alt = "",
  marker,
  markers,
  onPick,
  className,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const gesture = useRef<{
    mode: "none" | "pan" | "pinch";
    startX: number;
    startY: number;
    originTx: number;
    originTy: number;
    originScale: number;
    pinchDist: number;
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
    moved: false,
    lastTapAt: 0,
  });

  const clientToUv = useCallback((clientX: number, clientY: number): Uv | null => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      u: clamp((clientX - rect.left) / rect.width, 0, 1),
      v: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      const vp = viewportRef.current;
      if (!vp) {
        setScale(nextScale);
        return;
      }
      const rect = vp.getBoundingClientRect();
      const lx = clientX - rect.left;
      const ly = clientY - rect.top;
      const s = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const ratio = s / scale;
      setTx(lx - (lx - tx) * ratio);
      setTy(ly - (ly - ty) * ratio);
      setScale(s);
    },
    [scale, tx, ty],
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, scale * factor);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length === 2) {
      g.mode = "pinch";
      g.pinchDist = dist(
        { x: e.touches[0].clientX, y: e.touches[0].clientY },
        { x: e.touches[1].clientX, y: e.touches[1].clientY },
      );
      g.originScale = scale;
      g.originTx = tx;
      g.originTy = ty;
      g.moved = true;
      return;
    }
    if (e.touches.length === 1) {
      g.mode = "pan";
      g.startX = e.touches[0].clientX;
      g.startY = e.touches[0].clientY;
      g.originTx = tx;
      g.originTy = ty;
      g.moved = false;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    const vp = viewportRef.current;
    if (g.mode === "pinch" && e.touches.length === 2 && vp) {
      e.preventDefault();
      const d = dist(
        { x: e.touches[0].clientX, y: e.touches[0].clientY },
        { x: e.touches[1].clientX, y: e.touches[1].clientY },
      );
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = vp.getBoundingClientRect();
      const lx = midX - rect.left;
      const ly = midY - rect.top;
      const next = clamp(g.originScale * (d / Math.max(g.pinchDist, 1)), MIN_SCALE, MAX_SCALE);
      const ratio = next / Math.max(g.originScale, 0.001);
      // Zoom about pinch midpoint relative to gesture start transform
      setScale(next);
      setTx(lx - (lx - g.originTx) * ratio);
      setTy(ly - (ly - g.originTy) * ratio);
      g.moved = true;
      return;
    }
    if (g.mode === "pan" && e.touches.length === 1 && scale > 1.02) {
      e.preventDefault();
      const dx = e.touches[0].clientX - g.startX;
      const dy = e.touches[0].clientY - g.startY;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      setTx(g.originTx + dx);
      setTy(g.originTy + dy);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (g.mode === "pan" && !g.moved && e.changedTouches[0]) {
      const t = e.changedTouches[0];
      const now = Date.now();
      if (now - g.lastTapAt < 320) {
        // double-tap zoom toggle
        const next = scale < 2.2 ? 3.5 : 1;
        if (next === 1) {
          setScale(1);
          setTx(0);
          setTy(0);
        } else {
          zoomAt(t.clientX, t.clientY, next);
        }
        g.lastTapAt = 0;
      } else {
        g.lastTapAt = now;
        const uv = clientToUv(t.clientX, t.clientY);
        if (uv) onPick(uv);
      }
    }
    if (e.touches.length === 0) g.mode = "none";
  };

  const onClick = (e: React.MouseEvent) => {
    // touch devices already handled via touchend
    if ((e as any).detail === 0) return;
    const uv = clientToUv(e.clientX, e.clientY);
    if (uv) onPick(uv);
  };

  const reset = () => {
    setScale(1);
    setTx(0);
    setTy(0);
  };

  const markerStyle =
    marker && imgRef.current
      ? (() => {
          // Place marker in viewport space via image rect after transform
          return null;
        })()
      : null;
  void markerStyle;

  return (
    <div className={className}>
      <div
        ref={viewportRef}
        className="relative h-[min(58vh,420px)] overflow-hidden rounded-lg border bg-black touch-none select-none"
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          gesture.current.mode = "none";
        }}
      >
        <div
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
          className="relative"
        >
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={false}
            className="block w-full h-auto max-w-none pointer-events-auto"
            onClick={onClick}
          />
          {marker && (
            <div
              className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-blue-500 shadow pointer-events-none"
              style={{ left: `${marker.u * 100}%`, top: `${marker.v * 100}%` }}
            />
          )}
          {(markers || []).map((m, i) => (
            <div
              key={`${m.label || i}-${m.u}-${m.v}`}
              className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{ left: `${m.u * 100}%`, top: `${m.v * 100}%` }}
            >
              <div
                className={`w-4 h-4 rounded-full border-2 border-white shadow ${TONE_CLASS[m.tone || "amber"]}`}
              />
              {m.label && (
                <span className="mt-0.5 rounded bg-black/70 px-1 text-[10px] font-semibold text-white leading-tight">
                  {m.label}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
          핀치·더블탭·휠로 확대 · {scale.toFixed(1)}×
        </div>
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-9 w-9"
            onClick={() => {
              const vp = viewportRef.current?.getBoundingClientRect();
              if (!vp) return;
              zoomAt(vp.left + vp.width / 2, vp.top + vp.height / 2, scale * 1.4);
            }}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-9 w-9"
            onClick={() => {
              if (scale <= 1.05) {
                reset();
                return;
              }
              const vp = viewportRef.current?.getBoundingClientRect();
              if (!vp) return;
              zoomAt(vp.left + vp.width / 2, vp.top + vp.height / 2, scale / 1.4);
            }}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
