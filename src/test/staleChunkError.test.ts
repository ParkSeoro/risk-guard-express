import { describe, expect, it } from 'vitest';
import {
  STALE_CHUNK_USER_MESSAGE,
  formatAutoGenError,
  isStaleChunkError,
  shouldReloadForStaleChunk,
  STALE_CHUNK_RELOAD_COOLDOWN_MS,
} from '@/lib/staleChunkError';

describe('staleChunkError', () => {
  it('detects Vite missing hashed chunks', () => {
    expect(
      isStaleChunkError(
        new Error(
          'Failed to fetch dynamically imported module: https://www.safenex.org/assets/riskReuseFromPast-BpRWODFF.js',
        ),
      ),
    ).toBe(true);
    expect(isStaleChunkError(new Error('Loading chunk riskReuseFromPast failed'))).toBe(true);
    expect(isStaleChunkError(new Error('library insert failed: permission denied'))).toBe(false);
  });

  it('maps stale-chunk auto-gen errors to a refresh hint', () => {
    expect(
      formatAutoGenError(
        new Error(
          'Failed to fetch dynamically imported module: https://www.safenex.org/assets/riskReuseFromPast-BpRWODFF.js',
        ),
      ),
    ).toBe(STALE_CHUNK_USER_MESSAGE);
    expect(formatAutoGenError(new Error('edge timeout'))).toBe('edge timeout');
    expect(formatAutoGenError(new Error(''))).toBe('자동 생성 실패');
  });

  it('allows one reload then cools down', () => {
    expect(shouldReloadForStaleChunk(0, 1_000)).toBe(true);
    expect(shouldReloadForStaleChunk(1_000, 1_000 + STALE_CHUNK_RELOAD_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldReloadForStaleChunk(1_000, 1_000 + STALE_CHUNK_RELOAD_COOLDOWN_MS)).toBe(true);
  });
});
