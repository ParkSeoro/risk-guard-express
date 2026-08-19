import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  isCompressibleImage,
  sanitizeStorageFileName,
  sanitizeStorageObjectPath,
  buildProjectAttachmentPath,
  DEFAULT_UPLOAD_MAX_BYTES,
} from '@/lib/compressUploadFile';

describe('compressUploadFile helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500B');
    expect(formatBytes(2048)).toBe('2KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5MB');
  });

  it('detects compressible images', () => {
    expect(isCompressibleImage(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isCompressibleImage(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isCompressibleImage(new File(['x'], 'a.webp', { type: 'image/webp' }))).toBe(true);
    expect(isCompressibleImage(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(false);
    expect(isCompressibleImage(new File(['x'], 'a.heic', { type: 'image/heic' }))).toBe(false);
    expect(isCompressibleImage(new File(['x'], '서명.heif', { type: '' }))).toBe(false);
    expect(isCompressibleImage(new File(['x'], '서명.jpg', { type: '' }))).toBe(true);
  });

  it('keeps 20MB hard cap constant', () => {
    expect(DEFAULT_UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it('strips Hangul, spaces, and hash from storage filenames', () => {
    expect(sanitizeStorageFileName('근로자 서명 #1.jpg')).toBe('1.jpg');
    expect(sanitizeStorageFileName('KakaoTalk_2026-08-19 21.14.30 #123.png')).toBe(
      'KakaoTalk_2026-08-19_21.14.30_123.png',
    );
    expect(sanitizeStorageFileName('C:\\Users\\서명\\photo.jpeg')).toBe('photo.jpeg');
  });

  it('sanitizes only the object filename, keeping project UUID folders', () => {
    const projectId = '7d403837-0216-427c-954c-c9ddba898a44';
    expect(
      sanitizeStorageObjectPath(`${projectId}/worker-sign/1710000000_근로자 서명.jpg`),
    ).toBe(`${projectId}/worker-sign/1710000000.jpg`);
  });

  it('builds ASCII-only project attachment paths', () => {
    const projectId = '7d403837-0216-427c-954c-c9ddba898a44';
    const path = buildProjectAttachmentPath(projectId, 'worker-sign', '근로자 서명.jpg');
    expect(path.startsWith(`${projectId}/worker-sign/`)).toBe(true);
    expect(path.endsWith('.jpg')).toBe(true);
    expect(path).toMatch(/^[a-zA-Z0-9/._-]+$/);
    expect(() => buildProjectAttachmentPath('', 'worker-sign', 'a.jpg')).toThrow('프로젝트 정보가 없습니다.');
  });
});
