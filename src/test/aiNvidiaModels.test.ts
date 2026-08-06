import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_MODEL_CHAIN,
  enabledModelIds,
  moveChainItem,
  normalizeModelChain,
} from '@/lib/aiNvidiaModels';

describe('aiNvidiaModels', () => {
  it('keeps Nemotron Super as default primary', () => {
    expect(DEFAULT_MODEL_CHAIN[0]?.id).toBe(DEFAULT_PRIMARY_MODEL);
    expect(enabledModelIds(DEFAULT_MODEL_CHAIN)[0]).toBe(DEFAULT_PRIMARY_MODEL);
  });

  it('normalizeModelChain dedupes and respects enabled', () => {
    const chain = normalizeModelChain([
      { id: 'a', enabled: true },
      { id: 'a', enabled: true },
      { id: 'b', enabled: false },
      'c',
    ]);
    expect(chain.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(enabledModelIds(chain)).toEqual(['a', 'c']);
  });

  it('normalizeModelChain falls back to defaults on empty', () => {
    expect(normalizeModelChain([])[0]?.id).toBe(DEFAULT_PRIMARY_MODEL);
    expect(normalizeModelChain(null)[0]?.id).toBe(DEFAULT_PRIMARY_MODEL);
  });

  it('moveChainItem reorders without dropping primary identity', () => {
    const base = normalizeModelChain([
      { id: 'm1', enabled: true },
      { id: 'm2', enabled: true },
      { id: 'm3', enabled: true },
    ]);
    const down = moveChainItem(base, 0, 1);
    expect(down.map((x) => x.id)).toEqual(['m2', 'm1', 'm3']);
    const up = moveChainItem(down, 1, -1);
    expect(up.map((x) => x.id)).toEqual(['m1', 'm2', 'm3']);
  });
});
