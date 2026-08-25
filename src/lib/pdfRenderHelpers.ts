/** Pure helpers for work-plan attachment print rasters (no pdfjs — safe in Vitest). */

/** Total renderedAttachments JSON budget before Edge/gateway returns HTTP 546. */
export const MAX_RENDERED_ATTACHMENTS_CHARS = 2_200_000;

/**
 * Form PDFs often rasterize Hangul as light-grey anti-aliased ink that looks
 * "white ghost" after downscale/print. Push non-background pixels darker.
 */
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

/** Shrink rendered map until JSON fits Edge invoke limits (avoids HTTP 546). */
export function compactRenderedAttachments(
  rendered: Record<string, string[]>,
  budget = MAX_RENDERED_ATTACHMENTS_CHARS,
): Record<string, string[]> {
  const clone: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rendered || {})) {
    clone[k] = Array.isArray(v) ? [...v] : [];
  }

  const sizeOf = () => JSON.stringify(clone).length;
  if (sizeOf() <= budget) return clone;

  let guard = 0;
  while (sizeOf() > budget && guard++ < 200) {
    let trimmed = false;
    for (const k of Object.keys(clone)) {
      if (clone[k].length > 1) {
        clone[k].pop();
        trimmed = true;
        if (sizeOf() <= budget) return clone;
      }
    }
    if (!trimmed) break;
  }

  const keys = Object.keys(clone);
  while (sizeOf() > budget && keys.length > 0) {
    const k = keys.pop()!;
    delete clone[k];
  }
  return clone;
}

export function renderedAttachmentsCharSize(rendered: Record<string, string[]>): number {
  try {
    return JSON.stringify(rendered || {}).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
