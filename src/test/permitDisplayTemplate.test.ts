import { describe, expect, it } from 'vitest';
import {
  isSectionHidden,
  normalizeDisplayTemplate,
  pickCompanyDisplayTemplate,
  resolveFormOwnerCompanyId,
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
});
