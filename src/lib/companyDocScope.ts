/**
 * Company document isolation SSOT.
 *
 * Rules:
 * - master / 발주처(client) PA·SM: project-wide
 * - 시공사(gc): own company + descendant companies only (never peer GCs)
 * - 협력사/공급사: own company only
 * - worker/viewer: own company only
 */
import {
  companyTypeLabel,
  isContractorType,
  isClientType,
  isGcType,
  normalizeCompanyType,
} from '@/lib/companyTypes';
import { resolveParentGcCompanyId } from '@/lib/approvalRules';
import { supabase } from '@/integrations/supabase/client';

const NIL_COMPANY = '00000000-0000-0000-0000-000000000000';

/** Company allowlist has finished resolving (null = project-wide, string[] = scoped). */
export type CompanyScopeStatus = 'pending' | 'ready';

const MEMBER_ROLE_RANK: Record<string, number> = {
  master: 100,
  project_admin: 90,
  safety_manager: 80,
  site_manager: 70,
  site_supervisor: 60,
  supervisor: 50,
  worker: 20,
  contractor: 20,
  viewer: 10,
};

export type ProjectMemberPickRow = {
  company_id?: string | null;
  role_new?: string | null;
  role?: string | null;
  [key: string]: unknown;
};

/** Dual-persona: pick preferred company, else higher role, else first row with a company. */
export function pickProjectMemberRow<T extends ProjectMemberPickRow>(
  rows: T[] | null | undefined,
  preferredCompanyId?: string | null,
): T | null {
  const list = (rows || []).filter(Boolean);
  if (list.length === 0) return null;
  const preferred = String(preferredCompanyId || '').trim();
  if (preferred) {
    const hit = list.find((r) => String(r.company_id || '') === preferred);
    if (hit) return hit;
  }
  const ranked = [...list].sort((a, b) => {
    const ra = MEMBER_ROLE_RANK[String(a.role_new || a.role || '').toLowerCase()] ?? 0;
    const rb = MEMBER_ROLE_RANK[String(b.role_new || b.role || '').toLowerCase()] ?? 0;
    if (rb !== ra) return rb - ra;
    const ac = a.company_id ? 1 : 0;
    const bc = b.company_id ? 1 : 0;
    return bc - ac;
  });
  return ranked[0] ?? null;
}

export function readPreferredCompanyId(): string | null {
  try {
    return localStorage.getItem('selectedCompanyId') || null;
  } catch {
    return null;
  }
}

export type AssessmentDocumentCompanyInfo = {
  authorCompanyId: string | null;
  authorCompanyName: string;
  gcCompanyId: string | null;
  gcCompanyName: string;
  clientCompanyName: string;
};

/**
 * 위험성평가표 헤더용 회사.
 * 작성 회사 = 작성자 소속. 시공사 = 그 회사의 상위 GC만 (프로젝트 전체 업체 나열 금지).
 */
export function resolveAssessmentDocumentCompanies(opts: {
  authorCompanyId?: string | null;
  authorCompanyName?: string | null;
  authorCompanyType?: string | null;
  companies: Array<{
    id: string;
    name?: string | null;
    type?: string | null;
    parent_company_id?: string | null;
  }>;
}): AssessmentDocumentCompanyInfo {
  const companies = opts.companies || [];
  const byId = new Map(companies.map((c) => [c.id, c]));
  const client = companies.find((c) => normalizeCompanyType(c.type) === 'client');
  const clientCompanyName = String(client?.name || '').trim() || '(미지정)';

  const authorCompanyId = opts.authorCompanyId || null;
  const authorNode = authorCompanyId ? byId.get(authorCompanyId) : undefined;
  const authorCompanyName =
    String(authorNode?.name || opts.authorCompanyName || '').trim() || '(미지정)';

  const gcCompanyId = resolveParentGcCompanyId(
    authorCompanyId,
    companies.map((c) => ({
      id: c.id,
      type: c.type,
      parent_company_id: c.parent_company_id,
    })),
  );
  const gcNode = gcCompanyId ? byId.get(gcCompanyId) : undefined;
  const gcCompanyName = String(gcNode?.name || '').trim() || '(미지정)';

  return {
    authorCompanyId,
    authorCompanyName,
    gcCompanyId,
    gcCompanyName,
    clientCompanyName,
  };
}

export type CompanyScopeRole =
  | 'master'
  | 'project_admin'
  | 'safety_manager'
  | 'site_manager'
  | 'supervisor'
  | 'site_supervisor'
  | 'worker'
  | 'viewer'
  | 'contractor'
  | string;

export type CompanyDocScopeMode = 'all' | 'own' | 'tree';

/**
 * Project-wide company visibility (master / 발주처 PA·SM).
 *
 * NEVER derive this from `isProjectAdmin` or `isSafetyManager` alone —
 * 시공사·협력사에도 safety_manager / project_admin 이 따로 있다.
 * Prefer `accessibleCompanyIds === null` from useProjectAccess (already SSOT-resolved).
 */
export function seesProjectWideCompanies(opts: {
  role?: CompanyScopeRole | null;
  companyType?: string | null;
  isMaster?: boolean;
  /** Precomputed allowlist: null = all, [] = none yet / denied, string[] = scoped */
  accessibleCompanyIds?: string[] | null;
}): boolean {
  if (opts.accessibleCompanyIds !== undefined) {
    return opts.accessibleCompanyIds === null;
  }
  return companyDocScopeMode(opts) === 'all';
}

export function companyDocScopeMode(opts: {
  role?: CompanyScopeRole | null;
  companyType?: string | null;
  isMaster?: boolean;
}): CompanyDocScopeMode {
  if (opts.isMaster || opts.role === 'master') return 'all';

  const role = (opts.role || '').toLowerCase();
  const t = normalizeCompanyType(opts.companyType);

  // 협력사 / 공급사 — 자사만 (역할 무관)
  if (isContractorType(opts.companyType) || t === 'contractor' || t === 'vendor') {
    return 'own';
  }

  // 시공사 — 자사 + 하위 협력사만 (PA/SM 포함, 타 시공사 불가)
  if (isGcType(opts.companyType) || t === 'gc') {
    if (role === 'worker' || role === 'viewer') return 'own';
    return 'tree';
  }

  // 발주처 — PA/SM은 전체, 그 외는 자사
  if (isClientType(opts.companyType) || t === 'client') {
    if (role === 'project_admin' || role === 'safety_manager') return 'all';
    if (role === 'worker' || role === 'viewer') return 'own';
    // client site_manager: treat as tree of whole? Usually client sees all via PA.
    // Fail safe: site_manager on client → all for practical owner oversight
    if (role === 'site_manager' || role === 'supervisor' || role === 'site_supervisor') return 'all';
    return 'own';
  }

  if (role === 'worker' || role === 'viewer' || role === 'contractor') return 'own';

  // Unknown type: restrict
  return 'own';
}

/** @deprecated use companyDocScopeMode === 'own' || needs filter */
export function mustScopeToOwnCompany(opts: {
  role?: CompanyScopeRole | null;
  companyType?: string | null;
  isMaster?: boolean;
}): boolean {
  return companyDocScopeMode(opts) !== 'all';
}

/**
 * Resolve company ids the user may see for a project.
 * - all → null (no filter)
 * - own → [companyId]
 * - tree → [companyId, ...descendants via project_companies.parent_company_id]
 */
export async function resolveAccessibleCompanyIds(opts: {
  projectId: string;
  companyId?: string | null;
  companyType?: string | null;
  role?: CompanyScopeRole | null;
  isMaster?: boolean;
}): Promise<string[] | null> {
  const mode = companyDocScopeMode(opts);
  if (mode === 'all') return null;
  if (!opts.companyId) return [NIL_COMPANY];
  if (mode === 'own') return [opts.companyId];

  // tree
  const { data, error } = await (supabase as any)
    .from('project_companies')
    .select('company_id, parent_company_id')
    .eq('project_id', opts.projectId)
    .eq('is_deleted', false);

  if (error || !data?.length) {
    // Fallback: companies.parent_company_id
    const { data: cos } = await supabase
      .from('companies')
      .select('id, parent_company_id')
      .eq('is_deleted', false);
    return collectDescendants(
      (cos || []).map((c: any) => ({ id: c.id, parent_id: c.parent_company_id })),
      opts.companyId,
    );
  }

  return collectDescendants(
    (data as any[]).map((r) => ({
      id: r.company_id as string,
      parent_id: (r.parent_company_id as string | null) || null,
    })),
    opts.companyId,
  );
}

export function collectDescendants(
  rows: { id: string; parent_id: string | null }[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const list = children.get(r.parent_id) || [];
    list.push(r.id);
    children.set(r.parent_id, list);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of children.get(cur) || []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return [...out];
}

/** Apply company_id scope to a supabase query builder. */
export function applyOwnCompanyFilter(
  query: any,
  opts: {
    role?: CompanyScopeRole | null;
    companyType?: string | null;
    companyId?: string | null;
    isMaster?: boolean;
    /** Precomputed ids for tree mode; if missing, falls back to own-only for GC */
    accessibleCompanyIds?: string[] | null;
    /**
     * Also select company_id IS NULL rows (legacy orphans).
     * Caller must filter by normalizeCompanyLabel — do not use for unrelated modules.
     */
    includeOrphans?: boolean;
  },
): any {
  const mode = companyDocScopeMode(opts);
  if (mode === 'all') return query;

  if (mode === 'tree' && opts.accessibleCompanyIds && opts.accessibleCompanyIds.length > 0) {
    if (opts.includeOrphans) {
      const ids = opts.accessibleCompanyIds.join(',');
      return query.or(`company_id.in.(${ids}),company_id.is.null`);
    }
    return query.in('company_id', opts.accessibleCompanyIds);
  }

  // own, or tree without ids loaded yet → own only (safe).
  if (opts.companyId) {
    if (opts.includeOrphans) {
      return query.or(`company_id.eq.${opts.companyId},company_id.is.null`);
    }
    return query.eq('company_id', opts.companyId);
  }
  return query.eq('company_id', NIL_COMPANY);
}

/** Filter assessment_runs-like rows that use target_company_ids instead of company_id. */
export function filterRunsByCompanyScope<T extends {
  created_by?: string | null;
  target_company_ids?: string[] | null;
}>(
  rows: T[],
  opts: {
    userId?: string | null;
    accessibleCompanyIds: string[] | null; // null = all
  },
): T[] {
  if (opts.accessibleCompanyIds === null) return rows;
  const allow = new Set(opts.accessibleCompanyIds);
  return rows.filter((r) => {
    if (opts.userId && r.created_by === opts.userId) return true;
    const targets = r.target_company_ids;
    if (!Array.isArray(targets) || targets.length === 0) return false;
    return targets.some((id) => allow.has(id));
  });
}

/**
 * 위험성평가 회차 카드용 대상 업체 표시명.
 * SSOT: target_company_ids → nameMap, 없으면 legacy target_contractors.
 */
export function resolveAssessmentRunCompanyLabels(
  run: {
    target_company_ids?: string[] | null;
    target_contractors?: string[] | null;
  },
  nameMap?: Record<string, string> | null,
): string[] {
  const ids = Array.isArray(run.target_company_ids)
    ? run.target_company_ids.map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  if (ids.length > 0) {
    return ids.map((id) => (nameMap && nameMap[id]) || id);
  }
  const legacy = Array.isArray(run.target_contractors)
    ? run.target_contractors.map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  return legacy;
}

/** 카드에 짧게 보여 줄 업체 라벨 (많을 때 +N) */
export function formatCompanyLabelsShort(names: string[], maxVisible = 2): string {
  if (names.length === 0) return '';
  if (names.length <= maxVisible) return names.join(', ');
  const head = names.slice(0, maxVisible).join(', ');
  return `${head} 외 ${names.length - maxVisible}`;
}

/** 작성자 소속 표시: "진남토건(주)(협력사)" — 이름에 이미 구분이 있으면 중복 붙이지 않음. */
export function formatCreatorCompanyLabel(
  name?: string | null,
  type?: string | null,
): string {
  const n = String(name || '').trim();
  if (!n) return '';
  const t = companyTypeLabel(type);
  if (!t || t === '-') return n;
  const suffix = `(${t})`;
  if (n.endsWith(suffix)) return n;
  return `${n}${suffix}`;
}

export function buildProjectCompanyLabelMap(
  companies: Array<{ id?: string | null; name?: string | null; type?: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of companies || []) {
    const id = String(c.id || '').trim();
    const label = formatCreatorCompanyLabel(c.name, c.type);
    if (id && label) out[id] = label;
  }
  return out;
}

export function preferredCompanyIdsByRunAuthors<T extends {
  created_by?: string | null;
  author_user_id?: string | null;
  target_company_ids?: string[] | null;
}>(runs: T[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const run of runs || []) {
    const targets = (run.target_company_ids || []).map(String).map((s) => s.trim()).filter(Boolean);
    if (!targets.length) continue;
    for (const uid of [run.author_user_id, run.created_by]) {
      if (!uid) continue;
      const cur = out[uid] || [];
      for (const id of targets) {
        if (!cur.includes(id)) cur.push(id);
      }
      out[uid] = cur;
    }
  }
  return out;
}

/**
 * 위평 리스트 카드 회사명.
 * 1) 회차 대상 업체(target_company_ids) — 하이테크 협력사 페르소나
 * 2) 작성 주체(author_user_id) 소속
 * 3) 입력자(created_by) 소속
 */
export function resolveAssessmentRunListCompanyLabel(
  run: {
    created_by?: string | null;
    author_user_id?: string | null;
    target_company_ids?: string[] | null;
    target_contractors?: string[] | null;
  },
  opts?: {
    companyLabelById?: Record<string, string> | null;
    userCompanyLabelById?: Record<string, string> | null;
  },
): string {
  const fromTargets = resolveAssessmentRunCompanyLabels(run, opts?.companyLabelById);
  if (fromTargets.length > 0) return formatCompanyLabelsShort(fromTargets, 2);
  const users = opts?.userCompanyLabelById;
  const author = run.author_user_id ? users?.[run.author_user_id] : '';
  if (author) return author;
  const creator = run.created_by ? users?.[run.created_by] : '';
  return creator || '';
}

/**
 * assessment_runs.created_by / author_user_id → 프로젝트 멤버십 소속 업체 라벨.
 * 듀얼 페르소나면 회차 target_company_ids 와 맞는 멤버십을 우선.
 * 구분은 companies.type 이 아니라 이 프로젝트 role_in_project.
 */
export async function fetchCreatorCompanyLabelMap(
  projectId: string,
  userIds: string[],
  preferredCompanyIdsByUser?: Record<string, string[] | undefined>,
): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.map(String).filter(Boolean))];
  if (!projectId || ids.length === 0) return {};

  const [{ data, error }, { data: links }] = await Promise.all([
    supabase
      .from('project_members')
      .select('user_id, company_id, role_new, companies:company_id(name, type)')
      .eq('project_id', projectId)
      .in('user_id', ids),
    (supabase as any)
      .from('project_companies')
      .select('company_id, role_in_project')
      .eq('project_id', projectId)
      .eq('is_deleted', false),
  ]);
  if (error) throw error;

  const roleByCo = new Map<string, string>();
  for (const row of (links || []) as { company_id?: string; role_in_project?: string }[]) {
    const cid = String(row.company_id || '').trim();
    if (cid) roleByCo.set(cid, row.role_in_project || '');
  }

  const byUser = new Map<string, any[]>();
  for (const row of (data || []) as any[]) {
    const uid = row.user_id as string;
    if (!uid) continue;
    const list = byUser.get(uid) || [];
    list.push(row);
    byUser.set(uid, list);
  }

  const out: Record<string, string> = {};
  for (const [uid, rows] of byUser) {
    const preferredList = (preferredCompanyIdsByUser?.[uid] || []).map(String).filter(Boolean);
    const preferredHit = preferredList.find((id) =>
      rows.some((r) => String(r.company_id || '') === id),
    );
    const picked = pickProjectMemberRow(rows, preferredHit);
    const co = picked?.companies;
    const companyId = String(picked?.company_id || '');
    const type = roleByCo.get(companyId) || co?.type || null;
    const label = formatCreatorCompanyLabel(co?.name || null, type);
    if (label) out[uid] = label;
  }
  return out;
}
