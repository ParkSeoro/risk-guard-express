import { describe, expect, it } from 'vitest';
import {
  assessRoleAccess,
  mapLegacyApprovalPosition,
  mapLegacyPositionToEnum,
  normalizeProjectRole,
} from '@/lib/legacyRoleMapping';
import { filterApproversForStep, type EligibleApprover } from '@/lib/approvalRules';

describe('legacyRoleMapping', () => {
  it('maps contractor/user → worker', () => {
    expect(normalizeProjectRole('contractor')).toEqual({ ok: true, role: 'worker', legacy: true });
    expect(normalizeProjectRole('user')).toEqual({ ok: true, role: 'worker', legacy: true });
    expect(normalizeProjectRole('worker')).toEqual({ ok: true, role: 'worker', legacy: false });
  });

  it('rejects unknown roles (no silent viewer)', () => {
    expect(normalizeProjectRole('role_id_99').ok).toBe(false);
    expect(normalizeProjectRole(null).ok).toBe(false);
  });

  it('blocks access when only unknown roles exist', () => {
    const a = assessRoleAccess(['legacy_foo', 'role_id_1']);
    expect(a.blocked).toBe(true);
    expect(a.normalizedRoles).toEqual([]);
  });

  it('allows access when legacy aliases map cleanly', () => {
    const a = assessRoleAccess(['contractor', 'safety_manager']);
    expect(a.blocked).toBe(false);
    expect(a.normalizedRoles).toContain('worker');
    expect(a.normalizedRoles).toContain('safety_manager');
  });

  it('maps client safety_manager position to OWNER_HSE', () => {
    expect(mapLegacyPositionToEnum('safety_manager', 'client')).toBe('OWNER_HSE');
    expect(mapLegacyPositionToEnum('HSE_MANAGER', 'client')).toBe('OWNER_HSE');
    expect(mapLegacyPositionToEnum('safety_manager', 'contractor')).toBe('HSE_MANAGER');
  });

  it('maps approval positions with company context', () => {
    expect(mapLegacyApprovalPosition('safety_manager', 'client')).toBe('owner_sm');
    expect(mapLegacyApprovalPosition('safety_manager', 'contractor')).toBe('contractor_safety_manager');
    expect(mapLegacyApprovalPosition('safety_manager')).toBeNull();
  });
});

describe('filterApproversForStep legacy guard', () => {
  const pool: EligibleApprover[] = [
    {
      out_user_id: '1',
      out_display_name: 'GC 안전',
      out_company_id: 'c1',
      out_company_name: '원청',
      out_company_type: 'gc',
      out_position: 'HSE_MANAGER',
      out_role: 'safety_manager',
    },
    {
      out_user_id: '2',
      out_display_name: '발주 SM',
      out_company_id: 'c2',
      out_company_name: '발주처',
      out_company_type: 'client',
      out_position: 'OWNER_HSE',
      out_role: 'safety_manager',
    },
    {
      out_user_id: '3',
      out_display_name: '협력 안전',
      out_company_id: 'c3',
      out_company_name: '협력',
      out_company_type: 'contractor',
      out_position: 'HSE_MANAGER',
      out_role: 'safety_manager',
    },
  ];

  it('does not dump all approvers for legacy safety_manager key', () => {
    expect(filterApproversForStep(pool, 'safety_manager')).toEqual([]);
  });

  it('owner_sm only returns owner-side HSE', () => {
    const r = filterApproversForStep(pool, 'owner_sm');
    expect(r.map((x) => x.out_user_id).sort()).toEqual(['1', '2']);
  });

  it('contractor_safety_manager only returns contractor HSE', () => {
    const r = filterApproversForStep(pool, 'contractor_safety_manager');
    expect(r.map((x) => x.out_user_id)).toEqual(['3']);
  });
});
