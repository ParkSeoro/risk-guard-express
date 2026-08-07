import { describe, expect, it } from 'vitest';
import { computeAttachmentProgress } from '@/lib/workPlanAttachments';

describe('computeAttachmentProgress', () => {
  it('counts mandatory missing as blockers', () => {
    const p = computeAttachmentProgress([
      { attachment_key: 'biz_license', name: '사업자등록증', is_mandatory: true, file_url: null, category: 'legal' },
      { attachment_key: 'crane_spec', name: '크레인 제원표', is_mandatory: true, file_url: 'https://x/a.pdf', category: 'calc_evidence' },
      { attachment_key: 'optional', name: '선택', is_mandatory: false, file_url: null, category: 'site_proof' },
    ]);
    expect(p.total).toBe(3);
    expect(p.uploaded).toBe(1);
    expect(p.mandatoryTotal).toBe(2);
    expect(p.mandatoryMissing).toBe(1);
    expect(p.blockers.map((b) => b.key)).toEqual(['biz_license']);
  });

  it('empty rows → no blockers', () => {
    const p = computeAttachmentProgress([]);
    expect(p.mandatoryMissing).toBe(0);
    expect(p.blockers).toEqual([]);
  });
});
