import { describe, expect, it } from 'vitest';
import {
  APPROVAL_BLOCKING_COMMON_KEYS,
  getMandatoryLegalAttachments,
  withKind,
} from '@/lib/attachmentTemplates';

describe('work plan approval-blocking attachments', () => {
  it('treats biz_license and insurance_cert as legal blockers', () => {
    const legal = getMandatoryLegalAttachments('excavation');
    const keys = legal.map((a) => a.key);
    expect(keys).toContain('biz_license');
    expect(keys).toContain('insurance_cert');
    for (const k of APPROVAL_BLOCKING_COMMON_KEYS) {
      expect(keys).toContain(k);
    }
  });

  it('withKind keeps explicit legal on common docs', () => {
    expect(withKind({
      key: 'biz_license',
      name: '사업자등록증',
      required: true,
      description: '',
      category: '공통서류',
      kind: 'legal',
    }).kind).toBe('legal');
    expect(withKind({
      key: 'insurance_cert',
      name: '보험가입증명서',
      required: true,
      description: '',
      category: '공통서류',
    }).kind).toBe('legal');
  });

  it('does not promote equipment insurance/certs to legal', () => {
    expect(withKind({
      key: 'vehicle_insurance',
      name: '보험증권',
      required: true,
      description: '',
      category: '장비서류',
    }).kind).not.toBe('legal');
    expect(withKind({
      key: 'inspection_cert',
      name: '검사증',
      required: true,
      description: '',
      category: '장비서류',
    }).kind).not.toBe('legal');
    expect(getMandatoryLegalAttachments('heavy_lifting').map((a) => a.key)).not.toContain('vehicle_insurance');
  });
});
