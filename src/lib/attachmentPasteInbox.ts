/**
 * 작업계획서 첨부 — 클립보드 붙여넣기 / 드래그앤드롭 / 임시함 헬퍼
 */

export type StagedAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

const ACCEPT_PREFIXES = ['image/', 'application/pdf'];

export function isAcceptableAttachmentFile(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  if (!t) {
    // 일부 OS/브라우저에서 type 비움 — 확장자로 허용
    return /\.(jpe?g|png|webp|gif|pdf)$/i.test(file.name || '');
  }
  return ACCEPT_PREFIXES.some((p) => t.startsWith(p)) || t === 'image/gif';
}

export function extFromMime(mime: string): string {
  const t = (mime || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('pdf')) return 'pdf';
  return 'jpg';
}

/** 클립보드/드롭에서 온 이름 없는 파일에 쓸 기본 파일명 */
export function namePasteFile(file: File, index = 0): File {
  const hasName = !!(file.name && file.name !== 'image.png' && file.name !== 'blob' && !/^image$/i.test(file.name));
  // Chrome paste often names clipboard images "image.png"
  const looksGeneric = !file.name || /^(image|blob|untitled)(\.\w+)?$/i.test(file.name);
  if (hasName && !looksGeneric) return file;
  const ext = extFromMime(file.type) || 'png';
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const named = new File([file], `paste_${stamp}${index ? `_${index}` : ''}.${ext}`, {
    type: file.type || `image/${ext}`,
    lastModified: file.lastModified || Date.now(),
  });
  return named;
}

export function filesFromDataTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files.item(i);
      if (f) out.push(f);
    }
  }
  if (out.length === 0 && dt.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out.filter(isAcceptableAttachmentFile).map((f, i) => namePasteFile(f, i));
}

export function filesFromClipboardEvent(e: ClipboardEvent | { clipboardData?: DataTransfer | null }): File[] {
  return filesFromDataTransfer(e.clipboardData ?? null);
}

export function createStagedAttachment(file: File): StagedAttachment {
  const named = namePasteFile(file);
  const isImg = (named.type || '').startsWith('image/');
  let previewUrl: string | null = null;
  if (isImg && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try { previewUrl = URL.createObjectURL(named); } catch { previewUrl = null; }
  }
  return {
    id: `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    file: named,
    previewUrl,
  };
}

export function createStagedAttachments(files: File[]): StagedAttachment[] {
  return files.filter(isAcceptableAttachmentFile).map((f) => createStagedAttachment(f));
}

export function revokeStagedPreview(item: StagedAttachment) {
  if (item.previewUrl) {
    try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
  }
}

export function revokeAllStaged(items: StagedAttachment[]) {
  for (const it of items) revokeStagedPreview(it);
}
