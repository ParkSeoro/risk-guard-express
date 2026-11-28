import { describe, expect, it } from 'vitest';
import {
  SAMPLE_ISO_LOX,
  SAMPLE_VENDOR_BOQ_LOX,
  crossCheckIsoVsVendorBoq,
  derivePlantPermitChecklist,
  evaluateAirLiquideGasSafety,
  normalizePipeSize,
} from '@/lib/plantIsoEngine';

describe('Air Liquide Plant ISO Engine', () => {
  it('normalizes DN/A/inch pipe sizes consistently', () => {
    expect(normalizePipeSize('DN50')).toBe('2"');
    expect(normalizePipeSize('50A')).toBe('2"');
    expect(normalizePipeSize('2"')).toBe('2"');
    expect(normalizePipeSize('100A')).toBe('4"');
  });

  it('flags missing cryogenic Thermal Relief PSV and O2 cleaning on LOX ISO', () => {
    const findings = evaluateAirLiquideGasSafety(SAMPLE_ISO_LOX);
    const titles = findings.map((f) => f.title).join(' | ');
    expect(titles).toContain('Thermal Relief PSV');
    expect(titles).toContain('O2 Cleaning');
    expect(findings.filter((f) => f.severity === 'critical').length).toBeGreaterThanOrEqual(2);
  });

  it('cross-checks vendor BOQ against ISO BOM and detects overclaim, missing, and extra items', () => {
    const diff = crossCheckIsoVsVendorBoq(SAMPLE_ISO_LOX.bom, SAMPLE_VENDOR_BOQ_LOX);
    const pipe = diff.find((d) => d.category === 'pipe');
    expect(pipe?.status).toBe('overclaimed');
    expect(pipe?.delta_qty).toBe(7.5);
    expect(diff.some((d) => d.status === 'missing_in_boq' && d.category === 'bolt_gasket')).toBe(true);
    expect(diff.some((d) => d.status === 'not_in_drawing' && d.category === 'tee')).toBe(true);
    expect(diff.some((d) => d.status === 'match' && d.category === 'valve')).toBe(true);
  });

  it('derives Korean KGS/PSM permit checklist for high-pressure gas lines', () => {
    const permits = derivePlantPermitChecklist(SAMPLE_ISO_LOX);
    expect(permits.some((p) => p.law === '고압가스안전관리법')).toBe(true);
  });
});
