/** Work permit kind SSOT — used by create/detail/print/AI briefing. */
export type PermitKindId = 'general' | 'confined_space' | 'hot_work' | 'excavation';

export const PERMIT_KIND_OPTIONS: { id: PermitKindId; label: string; short: string }[] = [
  { id: 'general', label: '일반 작업허가서', short: '일반' },
  { id: 'confined_space', label: '밀폐공간 작업허가서', short: '밀폐공간' },
  { id: 'hot_work', label: '화기 작업허가서', short: '화기' },
  { id: 'excavation', label: '굴착·중장비 작업허가서', short: '굴착·중장비' },
];

export const PERMIT_KIND_LABEL: Record<PermitKindId, string> = Object.fromEntries(
  PERMIT_KIND_OPTIONS.map((o) => [o.id, o.short]),
) as Record<PermitKindId, string>;

export function normalizePermitKinds(
  kinds: unknown,
  fallback: PermitKindId = 'general',
): PermitKindId[] {
  const allowed = new Set(PERMIT_KIND_OPTIONS.map((o) => o.id));
  const raw = Array.isArray(kinds) ? kinds : [];
  const cleaned = raw
    .map((k) => String(k || '').trim())
    .filter((k): k is PermitKindId => allowed.has(k as PermitKindId));
  const unique = Array.from(new Set(cleaned));
  return unique.length > 0 ? unique : [fallback];
}

export function primaryPermitKind(kinds: PermitKindId[]): PermitKindId {
  return kinds[0] || 'general';
}

export function togglePermitKind(kinds: PermitKindId[], id: PermitKindId, on: boolean): PermitKindId[] {
  if (on) {
    if (kinds.includes(id)) return kinds;
    // Keep stable display order from PERMIT_KIND_OPTIONS
    const next = [...kinds, id];
    return PERMIT_KIND_OPTIONS.map((o) => o.id).filter((k) => next.includes(k));
  }
  const next = kinds.filter((k) => k !== id);
  // Always keep at least one kind selected
  return next.length > 0 ? next : kinds;
}
