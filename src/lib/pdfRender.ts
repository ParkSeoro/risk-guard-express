// Client-side PDF -> image renderer using pdfjs-dist.
// Used only for work-plan print/PDF-save: attachments are embedded as page images.
// Opening the original file bypasses this path (and looks fine).

import * as pdfjsLib from 'pdfjs-dist';
import {
  compactRenderedAttachments,
  darkenLightInk,
  MAX_RENDERED_ATTACHMENTS_CHARS,
  renderedAttachmentsCharSize,
} from '@/lib/pdfRenderHelpers';

export {
  compactRenderedAttachments,
  darkenLightInk,
  MAX_RENDERED_ATTACHMENTS_CHARS,
  renderedAttachmentsCharSize,
};

// Use the CDN worker (avoids bundler-specific worker path issues)
// Pin to the installed pdfjs-dist version
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

const MAX_PAGES = 12;
/** ~180 DPI for A4 — readable Hangul forms without blowing the Edge invoke body. */
export const PDF_RENDER_SCALE = 2.5;
export const PDF_RENDER_MIME_PNG = 'image/png' as const;
export const PDF_RENDER_MIME_WEBP = 'image/webp' as const;

/** Soft limit per page data-URL (chars). */
const MAX_PAGE_CHARS = 1_800_000;

function supportsCanvasMime(mime: string): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const url = c.toDataURL(mime, 0.92);
    return typeof url === 'string' && url.startsWith(`data:${mime}`);
  } catch {
    return false;
  }
}

let webpOk: boolean | null = null;
function canEncodeWebp(): boolean {
  if (webpOk == null) webpOk = supportsCanvasMime(PDF_RENDER_MIME_WEBP);
  return webpOk;
}

function encodeCanvas(canvas: HTMLCanvasElement): string {
  darkenLightInk(canvas);

  if (canEncodeWebp()) {
    const webp = canvas.toDataURL(PDF_RENDER_MIME_WEBP, 0.92);
    if (webp.length <= MAX_PAGE_CHARS) return webp;
    const webpHi = canvas.toDataURL(PDF_RENDER_MIME_WEBP, 0.8);
    if (webpHi.length <= MAX_PAGE_CHARS) return webpHi;
  }

  const png = canvas.toDataURL(PDF_RENDER_MIME_PNG);
  if (png.length <= MAX_PAGE_CHARS) return png;

  return canvas.toDataURL('image/jpeg', 0.95);
}

async function renderPageToDataUrl(page: any, scale: number): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
    intent: 'print',
    background: 'rgb(255,255,255)',
  } as any).promise;
  return encodeCanvas(canvas);
}

export async function renderPdfUrlToImages(
  url: string,
  opts?: { scale?: number; maxPages?: number },
): Promise<string[]> {
  const scale = opts?.scale ?? PDF_RENDER_SCALE;
  const maxPages = opts?.maxPages ?? MAX_PAGES;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const buf = await res.arrayBuffer();
    const loadingTask = (pdfjsLib as any).getDocument({ data: buf });
    const pdf = await loadingTask.promise;
    const total = Math.min(pdf.numPages, maxPages);
    const images: string[] = [];
    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      let dataUrl = await renderPageToDataUrl(page, scale);
      if (dataUrl.length > MAX_PAGE_CHARS && scale > 1.6) {
        dataUrl = await renderPageToDataUrl(page, Math.max(1.5, scale * 0.7));
      }
      if (dataUrl) images.push(dataUrl);
    }
    return images;
  } catch (e) {
    console.error('renderPdfUrlToImages failed', url, e);
    return [];
  }
}

export async function renderAttachmentsToImages(
  attachments: { file_url?: string | null; mime_type?: string | null }[],
  opts?: { scale?: number; maxPages?: number },
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const a of attachments) {
    if (!a.file_url) continue;
    const mime = (a.mime_type || '').toLowerCase();
    const isPdf = mime === 'application/pdf' || /\.pdf($|\?)/i.test(a.file_url);
    if (!isPdf) continue;
    const imgs = await renderPdfUrlToImages(a.file_url, opts);
    if (imgs.length > 0) out[a.file_url] = imgs;
  }
  return out;
}
