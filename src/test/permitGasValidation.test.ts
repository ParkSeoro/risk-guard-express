import { describe, expect, it } from 'vitest';
import {
  GAS_EXTRA_READING_KEYS,
  GAS_READING_KEYS,
  extraGasKey,
  gasClosureErrorMessage,
  gasSaveErrorMessage,
  kindsNeedGasMeasurement,
  mergeGasReadingsIntoForm,
  pickGasReadings,
  requiredGasFieldsForKinds,
  validatePermitGasForClosure,
} from '@/lib/permitGasValidation';

describe('permitGasValidation', () => {
  it('requires general gas fields including time/measurer', () => {
    expect(requiredGasFieldsForKinds(['general'])).toEqual([
      'gas_o2',
      'gas_co2',
      'gas_h2s',
      'gas_co',
      'gas_time',
      'gas_measurer',
    ]);
  });

  it('requires special sheet measurement results for hot/confined', () => {
    expect(requiredGasFieldsForKinds(['hot_work'])).toEqual([
      'gas_o2',
      'gas_co2',
      'gas_h2s',
      'gas_co',
      'gas_hc',
    ]);
    expect(requiredGasFieldsForKinds(['confined_space'])).toContain('gas_hc');
  });

  it('does not require gas for excavation-only', () => {
    expect(kindsNeedGasMeasurement(['excavation'])).toBe(false);
    expect(validatePermitGasForClosure({}, ['excavation']).ok).toBe(true);
  });

  it('reports missing optional gas fields for general kinds', () => {
    const check = validatePermitGasForClosure(
      { gas_o2: '20.9', gas_co2: '0.1' },
      ['general'],
    );
    expect(check.ok).toBe(false);
    expect(check.missing).toContain('gas_h2s');
    expect(check.missing).toContain('gas_time');
    expect(gasClosureErrorMessage(check)).toContain('가스농도');
  });

  it('passes when all required values are filled', () => {
    const check = validatePermitGasForClosure(
      {
        gas_o2: '20.9',
        gas_co2: '0.1',
        gas_h2s: '0',
        gas_co: '0',
        gas_hc: '0',
        gas_time: '14:30',
        gas_measurer: '홍길동',
      },
      ['general', 'hot_work'],
    );
    expect(check.ok).toBe(true);
  });

  it('merges only present gas keys without wiping siblings', () => {
    const prev = { work_name: '기초', gas_o2: '20.9', gas_co2: '0.1' };
    const next = mergeGasReadingsIntoForm(prev, { gas_h2s: '0' });
    expect(next).toEqual({
      work_name: '기초',
      gas_o2: '20.9',
      gas_co2: '0.1',
      gas_h2s: '0',
    });
  });

  it('clears a gas key when incoming value is blank', () => {
    const next = mergeGasReadingsIntoForm(
      { gas_o2: '20.9', gas_co: '1' },
      { gas_o2: '  ' },
    );
    expect(next).toEqual({ gas_co: '1' });
  });

  it('pickGasReadings skips empty values', () => {
    expect(pickGasReadings({ gas_o2: '20.9', gas_co: '' })).toEqual({ gas_o2: '20.9' });
    expect(pickGasReadings({})).toEqual({});
  });

  it('maps EMPTY_READINGS to Korean guidance', () => {
    expect(gasSaveErrorMessage('EMPTY_READINGS')).toContain('한 칸 이상');
  });

  it('treats 2~4회 keys as optional extras, never required for closure', () => {
    expect(GAS_READING_KEYS).toEqual(expect.arrayContaining(GAS_EXTRA_READING_KEYS));
    expect(GAS_EXTRA_READING_KEYS).toHaveLength(15);
    expect(extraGasKey('gas_o2', 2)).toBe('gas_o2_2');
    for (const kinds of [['hot_work'], ['confined_space'], ['general']] as const) {
      const required = requiredGasFieldsForKinds([...kinds]);
      for (const extra of GAS_EXTRA_READING_KEYS) {
        expect(required).not.toContain(extra);
      }
    }
    const check = validatePermitGasForClosure(
      {
        gas_o2: '20.9',
        gas_co2: '0.1',
        gas_h2s: '0',
        gas_co: '0',
        gas_hc: '0',
      },
      ['hot_work'],
    );
    expect(check.ok).toBe(true);
  });

  it('picks and merges extra 2~4회 keys without wiping row 1', () => {
    const prev = { work_name: '배관', gas_o2: '20.9', gas_o2_2: '20.8' };
    expect(pickGasReadings({ ...prev, gas_o2_3: '  ' })).toEqual({
      gas_o2: '20.9',
      gas_o2_2: '20.8',
    });
    const next = mergeGasReadingsIntoForm(prev, { gas_o2_2: '20.7', gas_h2s_4: '1' });
    expect(next).toEqual({
      work_name: '배관',
      gas_o2: '20.9',
      gas_o2_2: '20.7',
      gas_h2s_4: '1',
    });
  });
});
