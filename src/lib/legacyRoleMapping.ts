/**
 * 레거시 권한 ↔ 최신 권한 체계 매핑 SSOT
 * ------------------------------------------------------------------
 * ## 현황 요약
 *
 * ### 과거 (app_role 시대)
 * - `user_roles.role` / 초대 기본값에 `master | project_admin | safety_manager | contractor | viewer | user`
 * - `contractor` ≈ 현장 시공측 사용자(근로자·소장 등 혼재)
 * - `project_members.position` 소문자 텍스트: site_manager, safety_manager, supervisor …
 * - 결재선 `approval_lines.position` 도 프로젝트 역할키(safety_manager 등)를 그대로 사용
 *   → 발주처(CM/SM) 단계에 원청·협력 안전관리자가 섞여 노출되는 원인
 *
 * ### 현재 (project_role + project_position + companies.type)
 * - 글로벌: `user_roles.role` = `global_role` → 사실상 `master` 만
 * - 프로젝트: `project_members.role_new`
 *   = project_admin | safety_manager | site_manager | supervisor | worker | viewer
 * - 직책: `project_members.position_new` = SITE_MANAGER | HSE_MANAGER | OWNER_PM | OWNER_HSE | …
 * - 회사: `companies.type` = client | gc | contractor | vendor
 * - 결재선 포지션: contractor_supervisor / contractor_safety_manager /
 *   contractor_site_director / owner_cm / owner_sm / cooperator
 *
 * ## 매핑 전략 (SQL·FE 공통)
 *
 * | 레거시 role / 입력           | 최신 role_new                          |
 * |-----------------------------|----------------------------------------|
 * | master                      | (user_roles 유지) — 프로젝트 멤버는 master 취급 |
 * | project_admin               | project_admin                          |
 * | safety_manager              | safety_manager                         |
 * | site_manager                | site_manager                           |
 * | supervisor / inspector      | supervisor                             |
 * | contractor / user / worker  | worker                                 |
 * | viewer                      | viewer                                 |
 * | null / 알 수 없음            | 차단(권한 없음) — 자동 viewer 부여 금지   |
 *
 * | 레거시 position (소문자 등)   | 최신 position_new (+ 회사타입 보정)      |
 * |-----------------------------|----------------------------------------|
 * | safety_manager / sm / hse   | client → OWNER_HSE, else HSE_MANAGER   |
 * | site_manager                | client → OWNER_PM, else SITE_MANAGER   |
 * | cm / owner_pm               | OWNER_PM                               |
 * | construction_mgr            | CONSTRUCTION_MGR                       |
 * | field_engineer              | FIELD_ENGINEER                         |
 * | foreman                     | FOREMAN                                |
 * | supervisor / inspector      | SUPERVISOR                             |
 * | worker                      | WORKER                                 |
 * | ceo / executive             | CEO / EXECUTIVE                        |
 *
 * | 레거시 결재 position          | 최신 ApprovalPositionKey               |
 * |-----------------------------|----------------------------------------|
 * | supervisor / contractor_pic | contractor_supervisor                  |
 * | safety_manager (협력 추정)   | contractor_safety_manager *주의*       |
 * | site_manager / site_director| contractor_site_director               |
 * | project_admin / cm          | owner_cm                               |
 * | sm (발주 추정)               | owner_sm                              |
 * | 알 수 없음                   | 필터 결과 빈 배열 (전체 노출 금지)         |
 *
 * *주의*: 옛 `safety_manager` 한 단어로는 협력사 HSE vs 발주처 SM 구분이 불가.
 *         SQL은 회사 type 이 client/gc 이면 OWNER_HSE / owner_sm 쪽으로,
 *         contractor/vendor 이면 HSE_MANAGER / contractor_safety_manager 쪽으로 나눈다.
 */

export type CanonicalProjectRole =
  | 'master'
  | 'project_admin'
  | 'safety_manager'
  | 'site_manager'
  | 'supervisor'
  | 'worker'
  | 'viewer';

/** 인식 가능한(매핑 가능한) 레거시·최신 role 문자열 */
export const KNOWN_ROLE_ALIASES = new Set([
  'master',
  'project_admin',
  'safety_manager',
  'site_manager',
  'supervisor',
  'worker',
  'viewer',
  'contractor', // legacy → worker
  'user', // legacy → worker
  'inspector', // → supervisor
]);

export type RoleNormalizeResult =
  | { ok: true; role: CanonicalProjectRole; legacy: boolean }
  | { ok: false; reason: 'null' | 'unknown'; raw: string | null };

/**
 * 프로젝트 role 문자열을 최신 project_role 로 정규화.
 * 알 수 없는 값은 ok:false — 호출측에서 접근 차단에 사용.
 */
export function normalizeProjectRole(input: string | null | undefined): RoleNormalizeResult {
  if (input == null || String(input).trim() === '') {
    return { ok: false, reason: 'null', raw: input ?? null };
  }
  const raw = String(input).trim();
  const key = raw.toLowerCase();

  switch (key) {
    case 'master':
      return { ok: true, role: 'master', legacy: false };
    case 'project_admin':
      return { ok: true, role: 'project_admin', legacy: false };
    case 'safety_manager':
      return { ok: true, role: 'safety_manager', legacy: false };
    case 'site_manager':
      return { ok: true, role: 'site_manager', legacy: false };
    case 'supervisor':
    case 'inspector':
      return { ok: true, role: 'supervisor', legacy: key === 'inspector' };
    case 'worker':
      return { ok: true, role: 'worker', legacy: false };
    case 'viewer':
      return { ok: true, role: 'viewer', legacy: false };
    case 'contractor':
    case 'user':
      return { ok: true, role: 'worker', legacy: true };
    default:
      return { ok: false, reason: 'unknown', raw };
  }
}

/** AuthContext 호환: hasRole 에 쓸 수 있는 문자열 (worker 유지, contractor 별칭 제거) */
export function normalizeAuthRole(input: string | null | undefined): CanonicalProjectRole | null {
  const r = normalizeProjectRole(input);
  return r.ok ? r.role : null;
}

export type CompanyTypeKey = 'client' | 'gc' | 'contractor' | 'vendor' | null;

/**
 * profiles.position / 구 position 텍스트 → project_position 대문자 키
 */
export function mapLegacyPositionToEnum(
  position: string | null | undefined,
  companyType?: CompanyTypeKey,
): string | null {
  if (!position || !String(position).trim()) return null;
  const raw = String(position).trim();
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();
  const co = (companyType || '').toLowerCase();
  const isOwner = co === 'client' || co === 'gc';
  const isClient = co === 'client';

  // Already canonical
  const CANON = new Set([
    'CEO', 'EXECUTIVE', 'SITE_MANAGER', 'HSE_MANAGER', 'CONSTRUCTION_MGR',
    'FIELD_ENGINEER', 'FOREMAN', 'WORKER', 'OWNER_PM', 'OWNER_HSE', 'SUPERVISOR',
  ]);
  if (CANON.has(upper)) {
    if (isClient && upper === 'HSE_MANAGER') return 'OWNER_HSE';
    if (isClient && upper === 'SITE_MANAGER') return 'OWNER_PM';
    return upper;
  }

  switch (lower) {
    case 'safety_manager':
    case 'hse_manager':
    case 'sm':
      return isOwner && (isClient || lower === 'sm') ? 'OWNER_HSE' : 'HSE_MANAGER';
    case 'owner_hse':
      return 'OWNER_HSE';
    case 'site_manager':
      return isClient ? 'OWNER_PM' : 'SITE_MANAGER';
    case 'owner_pm':
    case 'cm':
      return 'OWNER_PM';
    case 'construction_mgr':
    case 'construction_manager':
      return 'CONSTRUCTION_MGR';
    case 'field_engineer':
      return 'FIELD_ENGINEER';
    case 'foreman':
      return 'FOREMAN';
    case 'supervisor':
    case 'inspector':
      return 'SUPERVISOR';
    case 'worker':
      return 'WORKER';
    case 'ceo':
      return 'CEO';
    case 'executive':
    case 'manager':
      return 'EXECUTIVE';
    default:
      return null;
  }
}

/**
 * 레거시 결재선 position → 고정 5단계 키.
 * 회사 타입을 알면 safety_manager 모호성을 해소한다.
 */
export function mapLegacyApprovalPosition(
  position: string | null | undefined,
  companyType?: CompanyTypeKey,
): string | null {
  if (!position) return null;
  const key = String(position).trim().toLowerCase();
  const co = (companyType || '').toLowerCase();
  const isOwner = co === 'client' || co === 'gc';
  const isContractor = co === 'contractor' || co === 'vendor';

  const FIXED = new Set([
    'contractor_supervisor',
    'contractor_safety_manager',
    'contractor_site_director',
    'owner_cm',
    'owner_sm',
    'cooperator',
  ]);
  if (FIXED.has(key)) return key;

  switch (key) {
    case 'supervisor':
    case 'contractor_pic':
    case 'foreman':
      return 'contractor_supervisor';
    case 'contractor_safety_manager':
      return 'contractor_safety_manager';
    case 'safety_manager':
    case 'safety_pic':
    case 'hse_manager':
      if (isOwner) return 'owner_sm';
      if (isContractor) return 'contractor_safety_manager';
      // 회사 모름 → 추론 불가 (전체 노출 금지)
      return null;
    case 'site_manager':
    case 'site_director':
      return isOwner ? 'owner_cm' : 'contractor_site_director';
    case 'project_admin':
    case 'cm':
    case 'owner_pm':
    case 'construction_mgr':
      return 'owner_cm';
    case 'sm':
    case 'owner_hse':
      return 'owner_sm';
    case 'cooperator':
    case '협조':
      return 'cooperator';
    case 'master':
    case 'contractor':
    case 'worker':
    case 'viewer':
    case 'user':
      return null;
    default:
      return null;
  }
}

export interface RoleAccessAssessment {
  normalizedRoles: CanonicalProjectRole[];
  unknownRaw: string[];
  /** 매핑 불가 레거시만 있고 유효 role 이 없음 → 접근 차단 */
  blocked: boolean;
  blockReason: string | null;
}

export function assessRoleAccess(rawRoles: Array<string | null | undefined>): RoleAccessAssessment {
  const normalizedRoles: CanonicalProjectRole[] = [];
  const unknownRaw: string[] = [];

  for (const raw of rawRoles) {
    if (raw == null || String(raw).trim() === '') continue;
    const r = normalizeProjectRole(raw);
    if (r.ok) {
      if (!normalizedRoles.includes(r.role)) normalizedRoles.push(r.role);
    } else if (r.reason === 'unknown') {
      unknownRaw.push(String(r.raw));
    }
  }

  // 알 수 없는 구형 ID 만 있고 정상 권한이 없으면 차단
  if (unknownRaw.length > 0 && normalizedRoles.length === 0) {
    return {
      normalizedRoles: [],
      unknownRaw,
      blocked: true,
      blockReason: `매핑되지 않은 레거시 권한(${unknownRaw.join(', ')}) — 관리자에게 권한 재설정을 요청하세요.`,
    };
  }

  return {
    normalizedRoles,
    unknownRaw,
    blocked: false,
    blockReason: null,
  };
}
