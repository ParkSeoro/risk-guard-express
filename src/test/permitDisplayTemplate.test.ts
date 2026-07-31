import { describe, expect, it } from 'vitest';
import {
  isSectionHidden,
  normalizeDisplayTemplate,
  pickProjectDisplayTemplate,
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

  it('pickProjectDisplayTemplate ignores global/null project templates', () => {
    const list = [
      {
        id: 'global',
        project_id: null,
        code: 'G',
        name: 'global',
        version: '1',
        layout_json: {},
        is_default: true,
        is_active: true,
        permit_type: 'general',
      },
      {
        id: 'p1',
        project_id: 'proj-a',
        code: 'A',
        name: 'proj',
        version: '1',
        layout_json: {},
        is_default: true,
        is_active: true,
        permit_type: 'general',
      },
    ];
    expect(pickProjectDisplayTemplate(list as any, 'proj-a', 'general')?.id).toBe('p1');
    expect(pickProjectDisplayTemplate(list as any, 'other', 'general')).toBeNull();
    expect(pickProjectDisplayTemplate(list as any, null, 'general')).toBeNull();
  });

  it('emptyDisplayTemplate starts with no hidden sections', () => {
    expect(emptyDisplayTemplate().hiddenSections).toEqual([]);
  });
});
