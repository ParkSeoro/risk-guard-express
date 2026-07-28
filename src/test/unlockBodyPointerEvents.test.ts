import { describe, it, expect, beforeEach } from 'vitest';
import { unlockBodyPointerEvents } from '@/lib/unlockBodyPointerEvents';

describe('unlockBodyPointerEvents', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = 'none';
    document.body.setAttribute('data-scroll-locked', '1');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.pointerEvents = 'none';
  });

  it('clears leftover Radix body pointer-events lock', () => {
    unlockBodyPointerEvents();
    expect(document.body.style.pointerEvents).toBe('');
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.pointerEvents).toBe('');
  });
});
