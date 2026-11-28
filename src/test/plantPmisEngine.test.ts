import { describe, expect, it } from 'vitest';
import {
  SAMPLE_CLAIMS_YEOSU,
  SAMPLE_MANPOWER_YEOSU,
  auditPmisData,
} from '@/lib/plantPmisEngine';

describe('Construction PMIS Manpower & Progress Claim Audit Engine', () => {
  it('flags contract overrun, unverified NDT progress claim, manpower mismatch, and missing TBM', () => {
    const summary = auditPmisData(SAMPLE_MANPOWER_YEOSU, SAMPLE_CLAIMS_YEOSU);
    expect(summary.totalActualHeadcount).toBe(25);
    expect(summary.recommendedCutKrw).toBeGreaterThan(0);
    expect(summary.anomalies.some((a) => a.category === '계약액 초과')).toBe(true);
    expect(summary.anomalies.some((a) => a.category === '안전·품질 미충족')).toBe(true);
    expect(summary.anomalies.some((a) => a.category === '투입인원 괴리')).toBe(true);
  });
});
