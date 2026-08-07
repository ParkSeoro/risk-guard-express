import { describe, expect, it, vi } from 'vitest';
import {
  createStagedAttachments,
  extFromMime,
  filesFromDataTransfer,
  isAcceptableAttachmentFile,
  namePasteFile,
} from '@/lib/attachmentPasteInbox';

describe('attachmentPasteInbox', () => {
  it('accepts images and pdf only', () => {
    expect(isAcceptableAttachmentFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isAcceptableAttachmentFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(true);
    expect(isAcceptableAttachmentFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(false);
  });

  it('names generic clipboard images', () => {
    const named = namePasteFile(new File(['x'], 'image.png', { type: 'image/png' }));
    expect(named.name).toMatch(/^paste_.+\.png$/);
  });

  it('keeps real filenames', () => {
    const named = namePasteFile(new File(['x'], '사업자등록증.jpg', { type: 'image/jpeg' }));
    expect(named.name).toBe('사업자등록증.jpg');
  });

  it('reads files from DataTransfer-like object', () => {
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const dt = {
      files: {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        0: file,
        [Symbol.iterator]: function* () { yield file; },
      },
      items: { length: 0 },
    } as unknown as DataTransfer;
    const files = filesFromDataTransfer(dt);
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe('image/png');
  });

  it('creates staged previews for images', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const staged = createStagedAttachments([
      new File(['x'], 'a.png', { type: 'image/png' }),
      new File(['x'], 'b.pdf', { type: 'application/pdf' }),
    ]);
    expect(staged).toHaveLength(2);
    expect(staged[0].previewUrl).toBe('blob:mock');
    expect(staged[1].previewUrl).toBeNull();
    vi.unstubAllGlobals();
  });

  it('maps mime to extension', () => {
    expect(extFromMime('image/webp')).toBe('webp');
    expect(extFromMime('application/pdf')).toBe('pdf');
  });
});
