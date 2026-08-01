import { describe, expect, it } from 'vitest';
import {
  gasClosureErrorMessage,
  kindsNeedGasMeasurement,
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

  it('blocks closure when general fields are blank', () => {
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
});
