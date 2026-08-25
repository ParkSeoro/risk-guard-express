/** Pure helpers for work-plan attachment print rasters (no pdfjs — safe in Vitest). */

/**
 * Form PDFs often rasterize Hangul as light-grey anti-aliased ink.
 * Only safe on mostly-grayscale pages — never run on color certificates.
 */
export function isMostlyGrayscale(
  canvas: HTMLCanvasElement,
  sampleStep = 8,
): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;
  const { width, height } = canvas;
  if (width < 2 || height < 2) return true;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  let colored = 0;
  let sampled = 0;
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      // Ignore near-white paper
      if (r >= 248 && g >= 248 && b >= 248) continue;
      sampled += 1;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min > 28) colored += 1;
    }
  }
  if (sampled < 20) return true;
  return colored / sampled < 0.08;
}

export function darkenLightInk(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  if (width < 2 || height < 2) return;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    if (r >= 248 && g >= 248 && b >= 248) continue;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum >= 210) {
      const t = Math.min(1, (lum - 210) / 45);
      const factor = 0.22 + 0.2 * (1 - t);
      d[i] = Math.round(r * factor);
      d[i + 1] = Math.round(g * factor);
      d[i + 2] = Math.round(b * factor);
      continue;
    }
    if (lum >= 150) {
      d[i] = Math.round(r * 0.45);
      d[i + 1] = Math.round(g * 0.45);
      d[i + 2] = Math.round(b * 0.45);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Prefer process/hazard columns when printing uploaded RA excel. */
export const RISK_PRINT_COLUMN_HINTS = [
  "공정",
  "공종",
  "세부작업",
  "세부공종",
  "위험요인",
  "유해위험",
  "발생상황",
  "위험발생",
  "기존대책",
  "현재대책",
  "개선대책",
  "추가대책",
  "가능성",
  "중대성",
  "위험도",
  "법적근거",
];

export function pickRiskPrintHeaders(headers: string[], maxCols = 8): string[] {
  const scored = headers.map((h, idx) => {
    const hit = RISK_PRINT_COLUMN_HINTS.some((hint) => h.includes(hint));
    return { h, idx, hit };
  });
  const preferred = scored.filter((s) => s.hit).map((s) => s.h);
  if (preferred.length >= 3) return preferred.slice(0, maxCols);
  return headers.slice(0, maxCols);
}

export type WorkPlanRiskPrintTable = {
  source: "excel" | "section";
  headers: string[];
  rows: string[][];
};
