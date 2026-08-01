/**
 * Gas measurement required before work-completion (closure) approval.
 * Applies to all companies. Keys match DigPermitForm / form_data.
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

export function gasClosureErrorMessage(check: GasClosureCheck): string {
  if (check.ok) return '';
  const labels = check.missingLabels.length
    ? check.missingLabels.join(', ')
    : '가스농도 측정값';
  return `작업 완료 확인 전 가스농도 측정을 입력하세요. (미입력: ${labels})`;
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
