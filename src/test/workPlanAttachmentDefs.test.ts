import { describe, expect, it } from 'vitest';
import { APPROVAL_BLOCKING_COMMON_KEYS, generateAttachments, withKind } from '@/lib/attachmentTemplates';
import {
  defaultMandatoryWithoutOverride,
  mergeAttachmentDefs,
  slugifyAttachmentKey,
} from '@/lib/workPlanAttachmentDefs';

describe('workPlanAttachmentDefs', () => {
  it('defaults only approval-blocking commons as mandatory without override', () => {
    const base = generateAttachments('heavy_lifting').map(withKind);
    const merged = mergeAttachmentDefs(base, [], 'heavy_lifting');
    for (const k of APPROVAL_BLOCKING_COMMON_KEYS) {
      expect(merged.find((m) => m.key === k)?.required).toBe(true);
    }
    expect(merged.find((m) => m.key === 'crane_spec')?.required).toBe(false);
    expect(merged.find((m) => m.key === 'vehicle_insurance')?.required).toBe(false);
    expect(defaultMandatoryWithoutOverride(withKind({
      key: 'vehicle_insurance',
      name: '보험증권',
      required: true,
      description: '',
      category: '장비서류',
    }))).toBe(false);
  });

  it('overrides required flag from project defs', () => {
    const base = generateAttachments('heavy_lifting').map(withKind);
    const merged = mergeAttachmentDefs(base, [{
      work_type: 'heavy_lifting',
      attachment_key: 'crane_spec',
      name: '크레인 제원표',
      description: '',
      category: 'calc_evidence',
      is_mandatory: true,
      is_enabled: true,
      is_custom: false,
      sort_order: 0,
    }], 'heavy_lifting');
    expect(merged.find((m) => m.key === 'crane_spec')?.required).toBe(true);
    expect(merged.find((m) => m.key === 'biz_license')?.required).toBe(true);
  });

  it('hides disabled template items', () => {
    const base = generateAttachments('scaffold').map(withKind);
    const merged = mergeAttachmentDefs(base, [{
      work_type: 'scaffold',
      attachment_key: 'checklist',
      name: '비계 점검체크리스트',
      description: '',
      category: 'legal',
      is_mandatory: true,
      is_enabled: false,
      is_custom: false,
      sort_order: 0,
    }], 'scaffold');
    expect(merged.some((m) => m.key === 'checklist')).toBe(false);
  });

  it('appends custom enabled items', () => {
    const base = generateAttachments('excavation').map(withKind);
    const merged = mergeAttachmentDefs(base, [{
      work_type: 'excavation',
      attachment_key: 'custom_site_photo_pack',
      name: '현장 사진 묶음',
      description: '굴착면 사진',
      category: 'site_proof',
      is_mandatory: true,
      is_enabled: true,
      is_custom: true,
      sort_order: 10,
    }], 'excavation');
    const custom = merged.find((m) => m.key === 'custom_site_photo_pack');
    expect(custom?.required).toBe(true);
    expect(custom?.isCustom).toBe(true);
  });

  it('prefers specific work_type over star', () => {
    const base = generateAttachments('high_work').map(withKind);
    const merged = mergeAttachmentDefs(base, [
      {
        work_type: '*',
        attachment_key: 'harness_check',
        name: '안전대',
        description: '',
        category: 'legal',
        is_mandatory: false,
        is_enabled: true,
        is_custom: false,
        sort_order: 0,
      },
      {
        work_type: 'high_work',
        attachment_key: 'harness_check',
        name: '안전대',
        description: '',
        category: 'legal',
        is_mandatory: true,
        is_enabled: true,
        is_custom: false,
        sort_order: 0,
      },
    ], 'high_work');
    expect(merged.find((m) => m.key === 'harness_check')?.required).toBe(true);
  });

  it('slugifies custom keys', () => {
    expect(slugifyAttachmentKey('현장 사진')).toMatch(/^custom_/);
  });
});
