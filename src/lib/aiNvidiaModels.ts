/**
 * NVIDIA NIM model catalog + chain helpers for Settings > AI.
 * Keep in sync with supabase/functions/_shared/nvidiaChat.ts defaults.
 */

export const DEFAULT_PRIMARY_MODEL = 'meta/llama-3.3-70b-instruct';

/** Hosted NIM EOL 2026-08-26 — must stay disabled. */
export const RETIRED_NEMOTRON_SUPER_49B = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';

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
    label: 'Llama 3.3 70B Instruct (1순위)',
    note: 'Nemotron Super 49B 호스팅 종료(2026-08-26) 후 기본',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    label: 'Nemotron 70B Instruct',
    note: 'NVIDIA 계열 폴백',
  },
  {
    id: 'mistralai/mistral-small-3.1-24b-instruct-2503',
    label: 'Mistral Small 3.1 24B',
    note: '위험성평가 초안(scope_draft) 기본 · 속도 우선',
  },
  {
    id: RETIRED_NEMOTRON_SUPER_49B,
    label: 'Nemotron Super 49B (종료됨)',
    note: 'NIM 호스팅 종료 — 사용 금지 (HTTP 410)',
  },
];

export const DEFAULT_MODEL_CHAIN: AiModelChainItem[] = NVIDIA_MODEL_CATALOG.map((m) => ({
  id: m.id,
  enabled: m.id !== RETIRED_NEMOTRON_SUPER_49B,
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
