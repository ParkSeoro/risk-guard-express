// Client-side PDF -> PNG image renderer using pdfjs-dist
// Renders each page of a PDF to a base64 PNG data URL so server PDF outputs
// can embed the pages as images instead of file links.

import * as pdfjsLib from 'pdfjs-dist';
// Use the CDN worker (avoids bundler-specific worker path issues)
// Pin to the installed pdfjs-dist version
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

const MAX_PAGES = 20;
const SCALE = 1.4;

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
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85));
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
