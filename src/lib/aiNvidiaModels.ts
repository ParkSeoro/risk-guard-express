/**
 * NVIDIA NIM model catalog + chain helpers for Settings > AI.
 * Keep in sync with supabase/functions/_shared/nvidiaChat.ts defaults.
 */

export const DEFAULT_PRIMARY_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';

export type AiModelChainItem = {
  id: string;
  enabled: boolean;
};

export type AiModelCatalogEntry = {
  id: string;
  label: string;
  note?: string;
};

/** Curated candidates for the AI settings UI (same OpenAI-compatible NIM endpoint). */
export const NVIDIA_MODEL_CATALOG: AiModelCatalogEntry[] = [
  {
    id: DEFAULT_PRIMARY_MODEL,
    label: 'Nemotron Super 49B (1순위 권장)',
    note: '현재 위험성평가 기본 · 품질 검증됨',
  },
  {
    id: 'meta/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B Instruct',
    note: '한도 분산용 폴백',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    label: 'Nemotron 70B Instruct',
    note: 'NVIDIA 계열 폴백',
  },
  {
    id: 'mistralai/mistral-small-3.1-24b-instruct-2503',
    label: 'Mistral Small 3.1 24B',
    note: '가벼운 여유분',
  },
];

export const DEFAULT_MODEL_CHAIN: AiModelChainItem[] = NVIDIA_MODEL_CATALOG.map((m) => ({
  id: m.id,
  enabled: true,
}));

export function normalizeModelChain(raw: unknown): AiModelChainItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_MODEL_CHAIN.map((x) => ({ ...x }));
  }
  const out: AiModelChainItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && typeof (item as any).id === 'string'
          ? String((item as any).id).trim()
          : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const enabled =
      typeof item === 'object' && item != null
        ? (item as any).enabled !== false
        : true;
    out.push({ id, enabled });
  }
  return out.length ? out : DEFAULT_MODEL_CHAIN.map((x) => ({ ...x }));
}

/** Enabled models in order (for Edge / display). */
export function enabledModelIds(chain: AiModelChainItem[]): string[] {
  return chain.filter((m) => m.enabled).map((m) => m.id);
}

export function moveChainItem(
  chain: AiModelChainItem[],
  index: number,
  dir: -1 | 1,
): AiModelChainItem[] {
  const next = [...chain];
  const j = index + dir;
  if (j < 0 || j >= next.length) return next;
  const tmp = next[index];
  next[index] = next[j];
  next[j] = tmp;
  return next;
}

export function catalogLabel(modelId: string): string {
  return NVIDIA_MODEL_CATALOG.find((m) => m.id === modelId)?.label || modelId;
}
