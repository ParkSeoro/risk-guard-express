import { describe, expect, it } from 'vitest';
import {
  isSectionHidden,
  normalizeDisplayTemplate,
  pickCompanyDisplayTemplate,
  pickGlobalStandardTemplate,
  pickPermitDisplayTemplateCascade,
  resolveFormOwnerCompanyId,
  resolveProjectGcCompanyId,
  emptyDisplayTemplate,
  LOCKED_DISPLAY_SECTIONS,
} from '@/lib/permitDisplayTemplate';

describe('permitDisplayTemplate', () => {
  it('null display hides nothing (standard DigPermitForm path)', () => {
    expect(isSectionHidden(null, 'attachments')).toBe(false);
    expect(isSectionHidden(undefined, 'gas_measurement')).toBe(false);
  });

  it('never hides locked sections even if listed', () => {
    const t = normalizeDisplayTemplate({
      labels: {},
      hiddenSections: Array.from(LOCKED_DISPLAY_SECTIONS),
    });
    for (const id of LOCKED_DISPLAY_SECTIONS) {
      expect(isSectionHidden(t, id)).toBe(false);
    }
  });

  it('hides optional sections when configured', () => {
    const t = normalizeDisplayTemplate({
      hiddenSections: ['attachments', 'footer_notes', 'approval_matrix'],
    });
    expect(t.hiddenSections).toEqual(['attachments', 'footer_notes']);
    expect(isSectionHidden(t, 'attachments')).toBe(true);
    expect(isSectionHidden(t, 'approval_matrix')).toBe(false);
  });

  it('pickCompanyDisplayTemplate ignores other companies and globals', () => {
    const list = [
      {
        id: 'global',
        project_id: null,
        company_id: null,
        code: 'G',
        name: 'global',
        version: '1',
        layout_json: {},
        is_default: true,
        is_active: true,
        permit_type: 'general',
      },
      {
        id: 'co-a',
        project_id: null,
        company_id: 'company-a',
        code: 'A',
        name: 'Air Liquide form',
        version: '1',
        layout_json: {},
        is_default: true,
        is_active: true,
        permit_type: 'general',
      },
    ];
    expect(pickCompanyDisplayTemplate(list as any, 'company-a', 'general')?.id).toBe('co-a');
    expect(pickCompanyDisplayTemplate(list as any, 'other', 'general')).toBeNull();
    expect(pickCompanyDisplayTemplate(list as any, null, 'general')).toBeNull();
    expect(pickGlobalStandardTemplate(list as any, 'general')?.id).toBe('global');
  });

  it('resolveFormOwnerCompanyId prefers permit company over project GC', () => {
    expect(
      resolveFormOwnerCompanyId(
        { gc_company_id: 'gc1', gc_company_ids: ['gc2'] },
        'permit-co',
      ),
    ).toBe('permit-co');
    expect(resolveFormOwnerCompanyId({ gc_company_id: 'gc1' }, null)).toBe('gc1');
    expect(resolveFormOwnerCompanyId({ gc_company_ids: ['gc2'] }, null)).toBe('gc2');
    expect(resolveFormOwnerCompanyId(null, 'permit-co')).toBe('permit-co');
    expect(resolveFormOwnerCompanyId(null, null)).toBeNull();
  });

  it('emptyDisplayTemplate starts with no hidden sections', () => {
    expect(emptyDisplayTemplate().hiddenSections).toEqual([]);
  });

  it('resolveProjectGcCompanyId reads gc_company_id then gc_company_ids', () => {
    expect(resolveProjectGcCompanyId({ gc_company_id: 'gc1' })).toBe('gc1');
    expect(resolveProjectGcCompanyId({ gc_company_ids: ['gc2'] })).toBe('gc2');
    expect(resolveProjectGcCompanyId({ gc_company_id: null, gc_company_ids: [] })).toBeNull();
  });

  it('pickPermitDisplayTemplateCascade: own → GC inherit → global', () => {
    const list = [
      {
        id: 'global',
        project_id: null,
        company_id: null,
        code: 'G',
        name: 'global',
        version: '1',
        layout_json: {},
        is_default: true,
        is_active: true,
        permit_type: 'general',
      },
      {
        id: 'gc-tpl',
        project_id: null,
        company_id: 'gc1',
        code: 'GC',
        name: 'GC form',
        version: '1',
        layout_json: {},
        is_default: true,
        is_active: true,
        permit_type: 'general',
      },
      {
        id: 'partner-tpl',
        project_id: null,
        company_id: 'sub1',
        code: 'P',
        name: 'Partner form',
        version: '1',
        layout_json: {},
        is_default: true,
        is_active: true,
        permit_type: 'general',
      },
    ] as any[];

    expect(
      pickPermitDisplayTemplateCascade({
        templates: list,
        permitCompanyId: 'sub1',
        gcCompanyId: 'gc1',
        permitType: 'general',
      })?.id,
    ).toBe('partner-tpl');

    expect(
      pickPermitDisplayTemplateCascade({
        templates: list.filter((t) => t.id !== 'partner-tpl'),
        permitCompanyId: 'sub1',
        gcCompanyId: 'gc1',
        permitType: 'general',
      })?.id,
    ).toBe('gc-tpl');

    expect(
      pickPermitDisplayTemplateCascade({
        templates: list.filter((t) => t.id === 'global'),
        permitCompanyId: 'sub1',
        gcCompanyId: 'gc1',
        permitType: 'general',
      })?.id,
    ).toBe('global');

    // GC 작성: 자사 템플릿만 (GC inherit 스킵 — 동일 company)
    expect(
      pickPermitDisplayTemplateCascade({
        templates: list,
        permitCompanyId: 'gc1',
        gcCompanyId: 'gc1',
        permitType: 'general',
      })?.id,
    ).toBe('gc-tpl');
  });
});
