import { hangulCount, LETTER_TEXT_ENOUGH } from '@/lib/officialLetterOcr';

const MAX_EDGE = 1400;
const JPEG_QUALITY = 0.62;

async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false }).promise;
  const total = Math.min(pdf.numPages, 2);
  const parts: string[] = [];
  for (let pageNo = 1; pageNo <= total; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ('str' in item ? String(item.str || '') : ''))
      .join(' ');
    parts.push(line);
  }
  return parts.join('\n');
}

function blobToJpegBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      const comma = value.indexOf(',');
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function canvasToJpeg(source: CanvasImageSource, width: number, height: number): Promise<string> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('화면에서 공문 이미지를 줄이지 못했습니다.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('공문 이미지를 준비하지 못했습니다.');
  return blobToJpegBase64(blob);
}

async function imageFileToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return await canvasToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function pdfFirstPageToJpeg(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, MAX_EDGE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('스캔 공문을 열지 못했습니다.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('스캔 공문을 준비하지 못했습니다.');
  return blobToJpegBase64(blob);
}

export type PreparedOfficialLetterFile = {
  text: string;
  imageBase64?: string;
  mimeType?: string;
};

/** 글자 레이어가 있는 PDF는 그대로 읽고, 스캔·사진만 한 장으로 줄여 판독에 넘긴다. */
export async function prepareOfficialLetterFile(file: File): Promise<PreparedOfficialLetterFile> {
  const mime = (file.type || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const data = await file.arrayBuffer();
    const text = await pdfText(data.slice(0));
    if (hangulCount(text) >= LETTER_TEXT_ENOUGH) return { text };
    return { text, imageBase64: await pdfFirstPageToJpeg(data.slice(0)), mimeType: 'image/jpeg' };
  }
  if (!mime.startsWith('image/')) {
    throw new Error('PDF 또는 이미지 파일만 올릴 수 있습니다.');
  }
  return { text: '', imageBase64: await imageFileToJpeg(file), mimeType: 'image/jpeg' };
}
