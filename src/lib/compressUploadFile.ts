/**
 * 업로드 전 클라이언트 압축 + attachments 버킷 업로드 헬퍼.
 * - 이미지: 긴 변 maxEdge 이하로 리사이즈 + JPEG 품질 압축
 * - PDF/기타: 원본 유지 (용량 한도만 검사)
 */
import { supabase } from '@/integrations/supabase/client';

export const DEFAULT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024; // 20MB hard cap
export const DEFAULT_IMAGE_MAX_EDGE = 1920;
export const DEFAULT_IMAGE_QUALITY = 0.72;
/** 이 크기 이하면 이미지여도 압축 생략 */
export const DEFAULT_SKIP_BELOW_BYTES = 400 * 1024; // 400KB

export type CompressUploadResult = {
  file: File;
  compressed: boolean;
  originalBytes: number;
  finalBytes: number;
  skippedReason?: string;
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function isCompressibleImage(file: File) {
  const t = (file.type || '').toLowerCase();
  return t === 'image/jpeg' || t === 'image/jpg' || t === 'image/png' || t === 'image/webp';
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없습니다.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

async function renderToJpeg(
  img: HTMLImageElement,
  maxEdge: number,
  quality: number,
): Promise<Blob | null> {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const longEdge = Math.max(srcW, srcH) || 1;
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  return canvasToBlob(canvas, 'image/jpeg', quality);
}

export async function compressUploadFile(
  input: File,
  opts?: {
    maxBytes?: number;
    maxEdge?: number;
    quality?: number;
    skipBelowBytes?: number;
  },
): Promise<CompressUploadResult> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES;
  const maxEdge = opts?.maxEdge ?? DEFAULT_IMAGE_MAX_EDGE;
  const quality = opts?.quality ?? DEFAULT_IMAGE_QUALITY;
  const skipBelow = opts?.skipBelowBytes ?? DEFAULT_SKIP_BELOW_BYTES;
  const originalBytes = input.size;

  if (!isCompressibleImage(input)) {
    if (originalBytes > maxBytes) {
      throw new Error(`파일이 너무 큽니다. 최대 ${formatBytes(maxBytes)}까지 업로드할 수 있습니다.`);
    }
    return {
      file: input,
      compressed: false,
      originalBytes,
      finalBytes: originalBytes,
      skippedReason: (input.type || '').includes('pdf') ? 'pdf' : 'non_image',
    };
  }

  if (originalBytes <= skipBelow) {
    return {
      file: input,
      compressed: false,
      originalBytes,
      finalBytes: originalBytes,
      skippedReason: 'already_small',
    };
  }

  const img = await loadImageElement(input);
  let blob = await renderToJpeg(img, maxEdge, quality);
  if (!blob) {
    return { file: input, compressed: false, originalBytes, finalBytes: originalBytes, skippedReason: 'encode_failed' };
  }

  if (blob.size > maxBytes) {
    blob = (await renderToJpeg(img, Math.round(maxEdge * 0.75), 0.6)) || blob;
  }
  if (blob.size > maxBytes) {
    blob = (await renderToJpeg(img, Math.round(maxEdge * 0.5), 0.5)) || blob;
  }

  if (blob.size > maxBytes) {
    throw new Error(`압축 후에도 ${formatBytes(maxBytes)}를 초과합니다. 해상도를 줄여 다시 올려주세요.`);
  }

  if (blob.size >= originalBytes) {
    return {
      file: input,
      compressed: false,
      originalBytes,
      finalBytes: originalBytes,
      skippedReason: 'no_gain',
    };
  }

  const baseName = input.name.replace(/\.[^.]+$/, '') || 'image';
  const outFile = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  return {
    file: outFile,
    compressed: true,
    originalBytes,
    finalBytes: outFile.size,
  };
}

export type UploadAttachmentResult = CompressUploadResult & {
  path: string;
  publicUrl: string;
};

/** 압축 후 attachments 버킷 업로드 (전 기능 공통) */
export async function uploadAttachmentFile(
  path: string,
  input: File,
  opts?: {
    upsert?: boolean;
    maxBytes?: number;
    maxEdge?: number;
    quality?: number;
  },
): Promise<UploadAttachmentResult> {
  const prepared = await compressUploadFile(input, {
    maxBytes: opts?.maxBytes,
    maxEdge: opts?.maxEdge,
    quality: opts?.quality,
  });
  const { error } = await supabase.storage.from('attachments').upload(path, prepared.file, {
    upsert: opts?.upsert ?? true,
    contentType: prepared.file.type || undefined,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('attachments').getPublicUrl(path);
  return {
    ...prepared,
    path,
    publicUrl: data.publicUrl,
  };
}
