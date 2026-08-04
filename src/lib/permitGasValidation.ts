/**
 * Optional gas measurement helpers for work permits.
 * Closure / work-completion approval is NOT gated on these fields.
 * Keys match DigPermitForm / form_data.
 */
import type { PermitKindId } from '@/lib/permitKinds';
import { normalizePermitKinds } from '@/lib/permitKinds';

export type GasFieldKey =
  | 'gas_o2'
  | 'gas_co2'
  | 'gas_h2s'
  | 'gas_co'
  | 'gas_hc'
  | 'gas_time'
  | 'gas_measurer';

export const GAS_FIELD_LABEL: Record<GasFieldKey, string> = {
  gas_o2: 'O₂ 농도',
  gas_co2: 'CO₂ 농도',
  gas_h2s: 'H₂S 농도',
  gas_co: 'CO 농도',
  gas_hc: 'H·C 농도',
  gas_time: '측정시간',
  gas_measurer: '측정자',
};

/** Only these keys may be written via save_permit_gas_readings. */
export const GAS_READING_KEYS: GasFieldKey[] = [
  'gas_o2',
  'gas_co2',
  'gas_h2s',
  'gas_co',
  'gas_hc',
  'gas_time',
  'gas_measurer',
];

const GENERAL_REQUIRED: GasFieldKey[] = [
  'gas_o2',
  'gas_co2',
  'gas_h2s',
  'gas_co',
  'gas_time',
  'gas_measurer',
];

const SPECIAL_REQUIRED: GasFieldKey[] = [
  'gas_o2',
  'gas_h2s',
  'gas_co',
  'gas_hc',
  'gas_co2',
];

export function requiredGasFieldsForKinds(kinds: unknown): GasFieldKey[] {
  const normalized = normalizePermitKinds(kinds, 'general');
  const set = new Set<GasFieldKey>();
  for (const k of normalized) {
    if (k === 'general') GENERAL_REQUIRED.forEach((f) => set.add(f));
    if (k === 'hot_work' || k === 'confined_space') SPECIAL_REQUIRED.forEach((f) => set.add(f));
  }
  // Stable order for UI
  return GAS_READING_KEYS.filter((k) => set.has(k));
}

export function kindsNeedGasMeasurement(kinds: unknown): boolean {
  return requiredGasFieldsForKinds(kinds).length > 0;
}

function isFilled(v: unknown): boolean {
  return String(v ?? '').trim().length > 0;
}

export type GasClosureCheck = {
  ok: boolean;
  missing: GasFieldKey[];
  missingLabels: string[];
};

export function validatePermitGasForClosure(
  formData: Record<string, unknown> | null | undefined,
  kinds: unknown,
): GasClosureCheck {
  const required = requiredGasFieldsForKinds(kinds);
  const fd = formData || {};
  const missing = required.filter((k) => !isFilled(fd[k]));
  return {
    ok: missing.length === 0,
    missing,
    missingLabels: missing.map((k) => GAS_FIELD_LABEL[k]),
  };
}

export function pickGasReadings(
  formData: Record<string, unknown> | null | undefined,
): Partial<Record<GasFieldKey, string>> {
  const fd = formData || {};
  const out: Partial<Record<GasFieldKey, string>> = {};
  for (const k of GAS_READING_KEYS) {
    const v = fd[k];
    if (v != null && String(v).trim() !== '') out[k] = String(v);
  }
  return out;
}

/**
 * Merge gas keys from a DigPermitForm onChange payload into previous form state.
 * Only keys present on `incoming` are applied — avoids wiping earlier fields when
 * DigPermitForm's update() closes over a stale `data` snapshot.
 */
export function mergeGasReadingsIntoForm<T extends Record<string, unknown>>(
  prev: T,
  incoming: Record<string, unknown> | null | undefined,
): T {
  const next = { ...prev };
  const src = incoming || {};
  for (const k of GAS_READING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    const v = src[k];
    if (v == null || String(v).trim() === '') {
      delete (next as Record<string, unknown>)[k];
    } else {
      (next as Record<string, unknown>)[k] = String(v);
    }
  }
  return next;
}

/** Map save_permit_gas_readings RPC error codes to Korean UX copy. */
export function gasSaveErrorMessage(code: unknown): string {
  const c = String(code ?? '');
  switch (c) {
    case 'EMPTY_READINGS':
      return '가스농도 측정값을 한 칸 이상 입력한 뒤 저장하세요. (양식 아래 「가스농도측정」란)';
    case 'INVALID_STATUS':
      return '발행 완료·종료대기 상태에서만 가스측정을 저장할 수 있습니다.';
    case 'FORBIDDEN':
      return '이 허가서에 가스측정을 저장할 권한이 없습니다.';
    case 'NOT_FOUND':
      return '허가서를 찾을 수 없습니다.';
    case 'UNAUTHENTICATED':
      return '로그인이 필요합니다.';
    default:
      return c || '알 수 없는 오류';
  }
}

export function gasClosureErrorMessage(check: GasClosureCheck): string {
  if (check.ok) return '';
  const labels = check.missingLabels.length
    ? check.missingLabels.join(', ')
    : '가스농도 측정값';
  return `가스농도 측정 미입력: ${labels}`;
}

export function permitKindsFromRow(row: {
  permit_kinds?: unknown;
  permit_type?: string | null;
}): PermitKindId[] {
  if (Array.isArray(row.permit_kinds) && row.permit_kinds.length > 0) {
    return normalizePermitKinds(row.permit_kinds);
  }
  return normalizePermitKinds(row.permit_type ? [row.permit_type] : []);
}
