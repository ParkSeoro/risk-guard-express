import { describe, expect, it } from 'vitest';
import {
  isSectionHidden,
  normalizeDisplayTemplate,
  pickCompanyDisplayTemplate,
  pickGlobalStandardTemplate,
  pickPermitDisplayTemplateCascade,
  pickPermitDisplayTemplateWithSource,
  resolveFormOwnerCompanyId,
  resolvePermitFormGcCompanyId,
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

  it('resolvePermitFormGcCompanyId prefers project_companies parent for partners', () => {
    const links = [
      { company_id: 'client1', parent_company_id: null, role_in_project: 'client' },
      { company_id: 'hitech', parent_company_id: 'client1', role_in_project: 'gc' },
      { company_id: 'jinnam_gc', parent_company_id: 'client1', role_in_project: 'gc' },
      { company_id: 'jinnam_sub', parent_company_id: 'hitech', role_in_project: 'contractor' },
      { company_id: 'taeyeong', parent_company_id: 'hitech', role_in_project: 'contractor' },
    ];
    // projects.gc_* empty — real GSC 여수 shape
    const emptyProj = { gc_company_id: null, gc_company_ids: [] as string[] };

    expect(
      resolvePermitFormGcCompanyId({
        permitCompanyId: 'jinnam_sub',
        projectCompanyLinks: links,
        project: emptyProj,
      }),
    ).toBe('hitech');
    expect(
      resolvePermitFormGcCompanyId({
        permitCompanyId: 'taeyeong',
        projectCompanyLinks: links,
        project: emptyProj,
      }),
    ).toBe('hitech');
    // GC 작성: parent가 발주처면 상속 대상 아님 (자기 양식/글로벌)
    expect(
      resolvePermitFormGcCompanyId({
        permitCompanyId: 'hitech',
        projectCompanyLinks: links,
        project: emptyProj,
      }),
    ).toBeNull();
    // projects.gc_company_id fallback
    expect(
      resolvePermitFormGcCompanyId({
        permitCompanyId: 'hitech',
        projectCompanyLinks: links,
        project: { gc_company_id: 'hitech', gc_company_ids: [] },
      }),
    ).toBe('hitech');
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

  it('isolates the same company across projects (Project A gets GSC form, Project B gets LGC form)', () => {
    const list = [
      { id: 'global-std', project_id: null, company_id: null, code: 'STD', name: '표준', version: '1', layout_json: {}, is_default: true, is_active: true, permit_type: 'general' },
      { id: 'projA-all', project_id: 'projA', company_id: null, code: 'GSC', name: 'GSC 양식', version: '1', layout_json: {}, is_default: true, is_active: true, permit_type: 'general' },
      { id: 'projB-gc1', project_id: 'projB', company_id: 'gc1', code: 'LGC', name: 'LGC 양식', version: '1', layout_json: {}, is_default: true, is_active: true, permit_type: 'general' },
    ] as any[];

    // Same company gc1 in Project A -> gets Project A's GSC form
    expect(
      pickPermitDisplayTemplateCascade({
        templates: list,
        projectId: 'projA',
        permitCompanyId: 'gc1',
        gcCompanyId: 'gc1',
        permitType: 'general',
      })?.id,
    ).toBe('projA-all');

    // Same company gc1 in Project B -> gets Project B's LGC form (zero cross-project leak!)
    expect(
      pickPermitDisplayTemplateCascade({
        templates: list,
        projectId: 'projB',
        permitCompanyId: 'gc1',
        gcCompanyId: 'gc1',
        permitType: 'general',
      })?.id,
    ).toBe('projB-gc1');

    // Same company gc1 in Project C (no project override) -> falls back to global standard
    expect(
      pickPermitDisplayTemplateCascade({
        templates: list,
        projectId: 'projC',
        permitCompanyId: 'gc1',
        gcCompanyId: 'gc1',
        permitType: 'general',
      })?.id,
    ).toBe('global-std');
  });

  it('pickPermitDisplayTemplateWithSource reports exact cascade source for all 6 levels', () => {
    const base = {
      code: 'C',
      name: 'N',
      version: '1',
      layout_json: {},
      is_default: true,
      is_active: true,
      permit_type: 'general',
    };
    const globalStd = { ...base, id: 'g-std', project_id: null, company_id: null };
    const globalGc = { ...base, id: 'g-gc', project_id: null, company_id: 'gc1' };
    const globalSub = { ...base, id: 'g-sub', project_id: null, company_id: 'sub1' };
    const projAll = { ...base, id: 'p-all', project_id: 'projA', company_id: null };
    const projGc = { ...base, id: 'p-gc', project_id: 'projA', company_id: 'gc1' };
    const projSub = { ...base, id: 'p-sub', project_id: 'projA', company_id: 'sub1' };

    const check = (templates: any[]) =>
      pickPermitDisplayTemplateWithSource({
        templates,
        projectId: 'projA',
        permitCompanyId: 'sub1',
        gcCompanyId: 'gc1',
        permitType: 'general',
      });

    expect(check([globalStd, globalGc, globalSub, projAll, projGc, projSub])?.sourceScope).toBe('project_company');
    expect(check([globalStd, globalGc, globalSub, projAll, projGc])?.sourceScope).toBe('project_gc');
    expect(check([globalStd, globalGc, globalSub, projAll])?.sourceScope).toBe('project_all');
    expect(check([globalStd, globalGc, globalSub])?.sourceScope).toBe('global_company');
    expect(check([globalStd, globalGc])?.sourceScope).toBe('global_gc');
    expect(check([globalStd])?.sourceScope).toBe('global_standard');
  });
});
