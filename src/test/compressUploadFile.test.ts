import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  isCompressibleImage,
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
  });

  it('keeps 20MB hard cap constant', () => {
    expect(DEFAULT_UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});
