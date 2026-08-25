// Client-side PDF -> image renderer using pdfjs-dist.
// Renders work-plan PDF attachments to PNG, uploads to Storage, returns public URLs
// so Edge invoke body stays small (no base64) while print quality stays high.

import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeStorageObjectPath } from '@/lib/compressUploadFile';
import { darkenLightInk, isMostlyGrayscale } from '@/lib/pdfRenderHelpers';

export {
  darkenLightInk,
  isMostlyGrayscale,
  pickRiskPrintHeaders,
  type WorkPlanRiskPrintTable,
} from '@/lib/pdfRenderHelpers';

// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

const MAX_PAGES = 20;
/** ~216 DPI for A4 — keep Hangul forms and color certificates sharp. */
export const PDF_RENDER_SCALE = 3;

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
}

async function renderPageToPngBlob(page: any, scale: number): Promise<Blob | null> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
    intent: 'print',
    background: 'rgb(255,255,255)',
  } as any).promise;

  // Color certificates (교육확인서 등): never ink-boost — causes muddy seals/noise.
  // Grayscale forms (지정서 등): darken washed Hangul strokes only.
  if (isMostlyGrayscale(canvas)) {
    darkenLightInk(canvas);
  }
  return canvasToPngBlob(canvas);
}

export async function renderPdfUrlToPngBlobs(
  url: string,
  opts?: { scale?: number; maxPages?: number },
): Promise<Blob[]> {
  const scale = opts?.scale ?? PDF_RENDER_SCALE;
  const maxPages = opts?.maxPages ?? MAX_PAGES;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const buf = await res.arrayBuffer();
    const loadingTask = (pdfjsLib as any).getDocument({ data: buf });
    const pdf = await loadingTask.promise;
    const total = Math.min(pdf.numPages, maxPages);
    const out: Blob[] = [];
    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      const blob = await renderPageToPngBlob(page, scale);
      if (blob) out.push(blob);
    }
    return out;
  } catch (e) {
    console.error('renderPdfUrlToPngBlobs failed', url, e);
    return [];
  }
}

/** Upload print rasters; returns original file_url → public PNG URLs. */
export async function uploadPrintRasters(
  projectId: string,
  planId: string,
  blobsByUrl: Record<string, Blob[]>,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const stamp = Date.now();
  let seq = 0;
  for (const [fileUrl, blobs] of Object.entries(blobsByUrl)) {
    const urls: string[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const path = sanitizeStorageObjectPath(
        `${projectId}/work-plans/${planId}/print-cache/${stamp}_${seq++}_p${i + 1}.png`,
      );
      const { error } = await supabase.storage.from('attachments').upload(path, blob, {
        upsert: true,
        contentType: 'image/png',
      });
      if (error) {
        console.warn('print raster upload failed', path, error.message);
        continue;
      }
      const { data } = supabase.storage.from('attachments').getPublicUrl(path);
      if (data?.publicUrl) urls.push(data.publicUrl);
    }
    if (urls.length) out[fileUrl] = urls;
  }
  return out;
}

export async function renderAttachmentsToStorageUrls(
  attachments: { file_url?: string | null; mime_type?: string | null }[],
  projectId: string,
  planId: string,
  opts?: { scale?: number; maxPages?: number },
): Promise<Record<string, string[]>> {
  const blobsByUrl: Record<string, Blob[]> = {};
  for (const a of attachments) {
    if (!a.file_url) continue;
    const mime = (a.mime_type || '').toLowerCase();
    const isPdf = mime === 'application/pdf' || /\.pdf($|\?)/i.test(a.file_url);
    if (!isPdf) continue;
    const blobs = await renderPdfUrlToPngBlobs(a.file_url, opts);
    if (blobs.length) blobsByUrl[a.file_url] = blobs;
  }
  if (Object.keys(blobsByUrl).length === 0) return {};
  return uploadPrintRasters(projectId, planId, blobsByUrl);
}

/** @deprecated kept for older tests — prefer renderAttachmentsToStorageUrls */
export async function renderAttachmentsToImages(
  attachments: { file_url?: string | null; mime_type?: string | null }[],
  opts?: { scale?: number; maxPages?: number },
): Promise<Record<string, string[]>> {
  // Legacy path returned data-URLs; callers should migrate to storage URLs.
  const out: Record<string, string[]> = {};
  for (const a of attachments) {
    if (!a.file_url) continue;
    const mime = (a.mime_type || '').toLowerCase();
    const isPdf = mime === 'application/pdf' || /\.pdf($|\?)/i.test(a.file_url);
    if (!isPdf) continue;
    const blobs = await renderPdfUrlToPngBlobs(a.file_url, opts);
    const urls: string[] = [];
    for (const blob of blobs) {
      urls.push(URL.createObjectURL(blob));
    }
    if (urls.length) out[a.file_url] = urls;
  }
  return out;
}
