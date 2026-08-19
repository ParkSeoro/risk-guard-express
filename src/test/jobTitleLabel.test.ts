import { describe, expect, it } from 'vitest';
import { jobTitleLabel, localizePersonName } from '@/lib/jobTitleLabel';

describe('jobTitleLabel', () => {
  it('maps approval slot keys to job titles, not step headers', () => {
    expect(jobTitleLabel('contractor_supervisor')).toBe('관리감독자');
    expect(jobTitleLabel('contractor_safety_manager')).toBe('안전관리자');
    expect(jobTitleLabel('contractor_site_director')).toBe('현장소장');
    expect(jobTitleLabel('owner_sm')).toBe('발주처 SM');
  });

  it('maps HR position enums', () => {
    expect(jobTitleLabel('SITE_SUPERVISOR')).toBe('관리감독자');
    expect(jobTitleLabel('HSE_MANAGER')).toBe('안전관리자');
    expect(jobTitleLabel('SITE_MANAGER')).toBe('현장소장');
  });
});

describe('localizePersonName', () => {
  it('translates trailing English position codes', () => {
    expect(localizePersonName('차강찬 / SITE_SUPERVISOR')).toBe('차강찬 / 관리감독자');
    expect(localizePersonName('박상우 / 안전관리자')).toBe('박상우 / 안전관리자');
  });
});
