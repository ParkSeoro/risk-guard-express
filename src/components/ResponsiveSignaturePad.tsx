/**
 * ResponsiveSignaturePad
 * - 컨테이너 폭에 맞춰 캔버스 내부 해상도를 동기화하고 devicePixelRatio를 반영해
 *   모바일에서 펜 좌표가 왼쪽으로 치우치는 문제를 방지한다.
 * - react-signature-canvas 의 ref 를 그대로 노출하여 isEmpty/clear/getCanvas 사용 가능.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";

export interface ResponsiveSignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: (type?: string) => string;
  getCanvas: () => HTMLCanvasElement | null;
}

interface Props {
  height?: number;          // CSS px height (default 160)
  penColor?: string;        // default "#0a1f44"
  className?: string;       // wrapper className
}

const ResponsiveSignaturePad = forwardRef<ResponsiveSignaturePadHandle, Props>(function ResponsiveSignaturePad(
  { height = 160, penColor = "#0a1f44", className = "" },
  ref
) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: height });

  useImperativeHandle(ref, () => ({
    clear: () => sigRef.current?.clear(),
    isEmpty: () => sigRef.current?.isEmpty() ?? true,
    toDataURL: (type = "image/png") => sigRef.current?.getCanvas().toDataURL(type) ?? "",
    getCanvas: () => sigRef.current?.getCanvas() ?? null,
  }));

  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      if (w !== size.w) setSize({ w, h: height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("orientationchange", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // Apply devicePixelRatio scaling after canvas mounts/resizes so pointer coords match CSS pixels.
  useEffect(() => {
    const c = sigRef.current?.getCanvas();
    if (!c || !size.w) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.floor(size.w * dpr);
    c.height = Math.floor(size.h * dpr);
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    // Re-bind react-signature-canvas internal _ctx so it draws using the scaled context.
    // The library reads ctx on mount; calling clear() forces it to refresh from canvas.
    sigRef.current?.clear();
  }, [size.w, size.h]);

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full overflow-hidden bg-white rounded ${className}`}
      style={{ height, touchAction: "none" }}
    >
      {size.w > 0 && (
        <SignatureCanvas
          ref={(r) => { sigRef.current = r; }}
          penColor={penColor}
          canvasProps={{
            width: size.w,
            height: size.h,
            className: "block",
            style: { width: size.w, height: size.h, touchAction: "none", display: "block" },
          }}
        />
      )}
    </div>
  );
});

export default ResponsiveSignaturePad;
