// Client-side PDF -> image renderer using pdfjs-dist.
// Renders work-plan PDF attachments to JPEG, uploads to Storage, returns public URLs.
// Cache key is the source filename (already unique per upload).

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeStorageObjectPath } from '@/lib/compressUploadFile';
import {
  darkenLightInk,
  isMostlyGrayscale,
  PRINT_CACHE_META_NAME,
  PRINT_CACHE_VERSION,
  printCacheFileKey,
  printCachePageName,
  type PrintRasterProgressFn,
} from '@/lib/pdfRenderHelpers';

export {
  darkenLightInk,
  isMostlyGrayscale,
  pickRiskPrintHeaders,
  PRINT_CACHE_VERSION,
  printCacheFileKey,
  type PrintRasterProgress,
  type PrintRasterProgressFn,
  type WorkPlanRiskPrintTable,
} from '@/lib/pdfRenderHelpers';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_PAGES = 30;
/** ~144 DPI for A4 — sharp enough for Hangul forms without 200MB caches. */
export const PDF_RENDER_SCALE = 2;
const JPEG_QUALITY_COLOR = 0.88;
const JPEG_QUALITY_FORM = 0.92;
const RENDER_CONCURRENCY = 3;

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
}

async function renderPageToJpegBlob(page: any, scale: number): Promise<Blob | null> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
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

  const grayscale = isMostlyGrayscale(canvas);
  // Always boost gray ink (지정서 빨간 도장이 있어도 한글만 살림).
  darkenLightInk(canvas);
  return canvasToJpegBlob(canvas, grayscale ? JPEG_QUALITY_FORM : JPEG_QUALITY_COLOR);
}

export async function renderPdfUrlToJpegBlobs(
  url: string,
  opts?: { scale?: number; maxPages?: number },
): Promise<Blob[]> {
  const scale = opts?.scale ?? PDF_RENDER_SCALE;
  const maxPages = opts?.maxPages ?? MAX_PAGES;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const buf = await res.arrayBuffer();
    const loadingTask = (pdfjsLib as any).getDocument({ data: buf, useWorkerFetch: false });
    const pdf = await loadingTask.promise;
    const total = Math.min(pdf.numPages, maxPages);
    const out: Blob[] = [];
    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      const blob = await renderPageToJpegBlob(page, scale);
      if (blob) out.push(blob);
    }
    return out;
  } catch (e) {
    console.error('renderPdfUrlToJpegBlobs failed', url, e);
    return [];
  }
}

function cacheFolder(projectId: string, planId: string, fileUrl: string): string {
  const key = printCacheFileKey(fileUrl);
  return sanitizeStorageObjectPath(
    `${projectId}/work-plans/${planId}/print-cache/${PRINT_CACHE_VERSION}/${key}`,
  );
}

function publicObjectUrl(path: string): string {
  const { data } = supabase.storage.from('attachments').getPublicUrl(path);
  return data?.publicUrl || '';
}

async function urlsFromMeta(folder: string): Promise<string[]> {
  const metaUrl = publicObjectUrl(`${folder}/${PRINT_CACHE_META_NAME}`);
  if (!metaUrl) return [];
  try {
    const res = await fetch(metaUrl, { cache: 'no-store' });
    if (!res.ok) return [];
    const meta = await res.json();
    const pages = Number(meta?.pages);
    if (!Number.isFinite(pages) || pages < 1) return [];
    return Array.from({ length: Math.min(pages, MAX_PAGES) }, (_, i) =>
      publicObjectUrl(`${folder}/${printCachePageName(i + 1)}`),
    ).filter(Boolean);
  } catch {
    return [];
  }
}

async function listCachedUrls(folder: string): Promise<string[]> {
  const fromMeta = await urlsFromMeta(folder);
  if (fromMeta.length > 0) return fromMeta;

  const { data, error } = await supabase.storage.from('attachments').list(folder, {
    limit: MAX_PAGES + 2,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error || !data?.length) return [];
  const names = data
    .map((f) => f.name)
    .filter((n) => /^p\d{2}\.jpe?g$/i.test(n))
    .sort();
  if (names.length === 0) return [];
  return names.map((name) => publicObjectUrl(`${folder}/${name}`)).filter(Boolean);
}

async function uploadPageBlobs(
  folder: string,
  blobs: Blob[],
): Promise<string[]> {
  const urls: string[] = [];
  let failCount = 0;
  for (let i = 0; i < blobs.length; i++) {
    const path = `${folder}/${printCachePageName(i + 1)}`;
    const { error } = await supabase.storage.from('attachments').upload(path, blobs[i], {
      upsert: true,
      contentType: 'image/jpeg',
    });
    if (error) {
      failCount += 1;
      console.warn('print raster upload failed', path, error.message);
      continue;
    }
    const url = publicObjectUrl(path);
    if (url) urls.push(url);
  }
  if (failCount > 0 || urls.length !== blobs.length) {
    throw new Error(
      `첨부 PDF 인쇄 이미지 업로드에 실패했습니다 (${failCount || blobs.length - urls.length}건). 권한/네트워크를 확인 후 다시 시도해 주세요.`,
    );
  }
  const meta = new Blob(
    [JSON.stringify({ v: PRINT_CACHE_VERSION, pages: urls.length })],
    { type: 'application/json' },
  );
  const { error: metaErr } = await supabase.storage.from('attachments').upload(
    `${folder}/${PRINT_CACHE_META_NAME}`,
    meta,
    { upsert: true, contentType: 'application/json' },
  );
  if (metaErr) {
    console.warn('print raster meta upload failed', folder, metaErr.message);
  }
  return urls;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function isPdfAttachment(a: { file_url?: string | null; mime_type?: string | null }): a is {
  file_url: string;
  mime_type?: string | null;
} {
  if (!a.file_url) return false;
  const mime = (a.mime_type || '').toLowerCase();
  return mime === 'application/pdf' || /\.pdf($|\?)/i.test(a.file_url);
}

export async function renderAttachmentsToStorageUrls(
  attachments: { file_url?: string | null; mime_type?: string | null }[],
  projectId: string,
  planId: string,
  opts?: { scale?: number; maxPages?: number; onProgress?: PrintRasterProgressFn },
): Promise<Record<string, string[]>> {
  const pdfs = attachments.filter(isPdfAttachment);
  if (pdfs.length === 0) return {};

  const out: Record<string, string[]> = {};
  let done = 0;
  let cached = 0;
  const total = pdfs.length;
  opts?.onProgress?.({ total, done: 0, cached: 0 });

  await mapPool(pdfs, RENDER_CONCURRENCY, async (a) => {
    const fileUrl = a.file_url;
    const folder = cacheFolder(projectId, planId, fileUrl);
    const hit = await listCachedUrls(folder);
    if (hit.length > 0) {
      out[fileUrl] = hit;
      cached += 1;
      done += 1;
      opts?.onProgress?.({ total, done, cached });
      return;
    }
    const blobs = await renderPdfUrlToJpegBlobs(fileUrl, opts);
    if (!blobs.length) {
      done += 1;
      opts?.onProgress?.({ total, done, cached });
      return;
    }
    const urls = await uploadPageBlobs(folder, blobs);
    if (urls.length) out[fileUrl] = urls;
    done += 1;
    opts?.onProgress?.({ total, done, cached });
  });
  return out;
}

/** Render one newly uploaded PDF into print-cache so 인쇄/미리보기가 바로 캐시를 씁니다. */
export async function warmWorkPlanAttachmentPrintCache(
  attachment: { file_url?: string | null; mime_type?: string | null },
  projectId: string,
  planId: string,
): Promise<void> {
  if (!isPdfAttachment(attachment) || !projectId || !planId) return;
  await renderAttachmentsToStorageUrls([attachment], projectId, planId);
}

/** @deprecated kept for older tests — prefer renderAttachmentsToStorageUrls */
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
    const blobs = await renderPdfUrlToJpegBlobs(a.file_url, opts);
    const urls: string[] = [];
    for (const blob of blobs) {
      urls.push(URL.createObjectURL(blob));
    }
    if (urls.length) out[a.file_url] = urls;
  }
  return out;
}
