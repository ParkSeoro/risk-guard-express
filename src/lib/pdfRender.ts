// Client-side PDF -> image renderer using pdfjs-dist.
// Used only for work-plan print/PDF-save: attachments are embedded as page images.
// Opening the original file bypasses this path (and looks fine).

import * as pdfjsLib from 'pdfjs-dist';
// Use the CDN worker (avoids bundler-specific worker path issues)
// Pin to the installed pdfjs-dist version
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

const MAX_PAGES = 20;
/** ~216 DPI for A4 — dense Korean form text (보험증권 등) stays readable in print. */
export const PDF_RENDER_SCALE = 3;
/**
 * Prefer PNG (lossless). JPEG — even at 0.95 — washes thin black text into grey
 * and leaves salt-and-pepper noise on dark rules when Chrome "PDF로 저장"s.
 */
export const PDF_RENDER_MIME = 'image/png' as const;
/** Soft limit per page data-URL — above this, fall back to near-lossless JPEG so invoke body fits. */
const MAX_PNG_CHARS = 3_500_000;

function canvasToPrintDataUrl(canvas: HTMLCanvasElement): string {
  const png = canvas.toDataURL(PDF_RENDER_MIME);
  if (png.length <= MAX_PNG_CHARS) return png;
  // Oversized scan/photo pages: keep DPI, avoid crushing text with low JPEG quality.
  return canvas.toDataURL('image/jpeg', 0.98);
}

export async function renderPdfUrlToImages(url: string): Promise<string[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const buf = await res.arrayBuffer();
    const loadingTask = (pdfjsLib as any).getDocument({ data: buf });
    const pdf = await loadingTask.promise;
    const total = Math.min(pdf.numPages, MAX_PAGES);
    const images: string[] = [];
    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) continue;
      // Opaque white — transparent PDF pages otherwise print as washed grey.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
        // Use print intent so fine strokes are not screen-optimized away.
        intent: 'print',
      } as any).promise;
      images.push(canvasToPrintDataUrl(canvas));
    }
    return images;
  } catch (e) {
    console.error('renderPdfUrlToImages failed', url, e);
    return [];
  }
}

export async function renderAttachmentsToImages(
  attachments: { file_url?: string | null; mime_type?: string | null }[]
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const a of attachments) {
    if (!a.file_url) continue;
    const mime = (a.mime_type || '').toLowerCase();
    const isPdf = mime === 'application/pdf' || /\.pdf($|\?)/i.test(a.file_url);
    if (!isPdf) continue;
    const imgs = await renderPdfUrlToImages(a.file_url);
    if (imgs.length > 0) out[a.file_url] = imgs;
  }
  return out;
}
