import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  applyOwnCompanyFilter,
  resolveAccessibleCompanyIds,
  seesProjectWideCompanies,
} from '@/lib/companyDocScope';

/**
 * Project-scoped role (new model).
 * Legacy `contractor` / `user` values still appear in old data and are
 * coerced to `worker` at runtime.
 */
export type ProjectRole =
  | 'master'
  | 'project_admin'
  | 'safety_manager'
  | 'site_manager'
  | 'supervisor'
  | 'site_supervisor'
  | 'worker'
  | 'viewer';

export type ProjectPosition =
  | 'CEO'
  | 'EXECUTIVE'
  | 'SITE_MANAGER'
  | 'HSE_MANAGER'
  | 'CONSTRUCTION_MGR'
  | 'FIELD_ENGINEER'
  | 'FOREMAN'
  | 'WORKER'
  | 'OWNER_PM'
  | 'OWNER_CM'
  | 'OWNER_SM'
  | 'OWNER_HSE'
  | 'SUPERVISOR'
  | 'SITE_SUPERVISOR'
  | null;

export type CompanyType = 'client' | 'gc' | 'contractor' | 'vendor' | null;

export type FeatureKey =
  | 'risk_assessment'
  | 'work_plan'
  | 'work_permit'
  | 'safety_inspection'
  | 'tbm'
  | 'incident'
  | 'safety_cost'
  | 'legal_duty'
  | 'todo'
  | 'approval'
  | 'company'
  | 'member'
  | 'master_data'
  | 'audit_log';

type Perm = { create: boolean; edit: boolean; delete: boolean; approve: boolean };

const ALL: Perm = { create: true, edit: true, delete: true, approve: true };
const RO: Perm = { create: false, edit: false, delete: false, approve: false };
const CRUD_NO_APPROVE: Perm = { create: true, edit: true, delete: true, approve: false };
const CRU_APPROVE: Perm = { create: true, edit: true, delete: false, approve: true };
const CRU_NO_APPROVE: Perm = { create: true, edit: true, delete: false, approve: false };
const APPROVE_ONLY: Perm = { create: false, edit: false, delete: false, approve: true };

/**
 * Authoritative permission matrix.
 * Mirrors `.lovable/plan.md` §3.
 */
const PERMISSION_MATRIX: Record<ProjectRole, Record<FeatureKey, Perm>> = {
  master: {
    risk_assessment: ALL, work_plan: ALL, work_permit: ALL, safety_inspection: ALL,
    tbm: ALL, incident: ALL, safety_cost: ALL, legal_duty: ALL, todo: ALL,
    approval: CRU_APPROVE, company: ALL, member: ALL, master_data: ALL, audit_log: ALL,
  },
  project_admin: {
    risk_assessment: ALL, work_plan: ALL, work_permit: ALL, safety_inspection: ALL,
    tbm: ALL, incident: ALL, safety_cost: ALL, legal_duty: ALL, todo: ALL,
    approval: CRU_APPROVE, company: ALL, member: ALL, master_data: ALL, audit_log: ALL,
  },
  // 안전관리자: 프로젝트 내에서 마스터 전용(글로벌 관리)을 제외한 모든 권한을 보유
  safety_manager: {
    risk_assessment: ALL, work_plan: ALL, work_permit: ALL, safety_inspection: ALL,
    tbm: ALL, incident: ALL, safety_cost: ALL, legal_duty: ALL, todo: ALL,
    approval: CRU_APPROVE, company: ALL, member: ALL, master_data: ALL, audit_log: ALL,
  },
  site_manager: {
    risk_assessment: CRU_APPROVE, work_plan: CRU_APPROVE, work_permit: CRU_APPROVE,
    safety_inspection: CRUD_NO_APPROVE, tbm: CRUD_NO_APPROVE, incident: CRUD_NO_APPROVE,
    safety_cost: RO, legal_duty: RO, todo: CRUD_NO_APPROVE,
    approval: APPROVE_ONLY, company: RO, member: RO, master_data: RO, audit_log: RO,
  },
  // 감리 — 위험성평가 작성 주체 아님 (열람·결재 위주)
  supervisor: {
    risk_assessment: RO, work_plan: RO, work_permit: APPROVE_ONLY,
    safety_inspection: CRU_NO_APPROVE, tbm: RO, incident: CRU_NO_APPROVE,
    safety_cost: RO, legal_duty: RO, todo: CRU_NO_APPROVE,
    approval: APPROVE_ONLY, company: RO, member: RO, master_data: RO, audit_log: RO,
  },
  // 관리감독자 — 위험성평가 고시 §7: 유해·위험요인 파악·개선조치 시행(실질 작성)
  // 안전관리자(SM)는 보좌·지도·조언·검토 (ALL 유지). 감리(supervisor)와 권한 분리.
  site_supervisor: {
    risk_assessment: CRUD_NO_APPROVE, work_plan: RO, work_permit: APPROVE_ONLY,
    safety_inspection: CRU_NO_APPROVE, tbm: RO, incident: CRU_NO_APPROVE,
    safety_cost: RO, legal_duty: RO, todo: CRU_NO_APPROVE,
    approval: APPROVE_ONLY, company: RO, member: RO, master_data: RO, audit_log: RO,
  },
  worker: {
    risk_assessment: CRU_NO_APPROVE, work_plan: CRU_NO_APPROVE, work_permit: RO,
    safety_inspection: RO, tbm: RO, incident: CRU_NO_APPROVE,
    safety_cost: RO, legal_duty: RO, todo: CRU_NO_APPROVE,
    approval: { create: true, edit: false, delete: false, approve: false },
    company: RO, member: RO, master_data: RO, audit_log: RO,
  },
  viewer: {
    risk_assessment: RO, work_plan: RO, work_permit: RO, safety_inspection: RO,
    tbm: RO, incident: RO, safety_cost: RO, legal_duty: RO, todo: RO,
    approval: RO, company: RO, member: RO, master_data: RO, audit_log: RO,
  },
};

/** Map any legacy role string to a canonical ProjectRole. Unknown → null (차단). */
function normalizeRole(input: string | null | undefined): ProjectRole | null {
  switch ((input || '').toLowerCase()) {
    case 'master': return 'master';
    case 'project_admin': return 'project_admin';
    case 'safety_manager': return 'safety_manager';
    case 'site_manager': return 'site_manager';
    case 'supervisor': return 'supervisor';
    case 'site_supervisor': return 'site_supervisor';
    case 'worker':
    case 'contractor': // legacy 통칭 → worker
    case 'user':       // legacy
      return 'worker';
    case 'viewer':
      return 'viewer';
    case '':
    case null as any:
    case undefined as any:
      return null;
    default:
      // 알 수 없는 구형 값 → silent viewer 승격 금지
      return null;
  }
}


export interface ProjectAccess {
  projects: { id: string; name: string; site_name: string }[];
  selectedProject: string;
  setSelectedProject: (id: string) => void;
  userCompanyId: string | null;
  userCompanyType: CompanyType;
  userRole: ProjectRole;
  userPosition: ProjectPosition;
  isMaster: boolean;
  isProjectAdmin: boolean;
  isSafetyManager: boolean;
  isSiteManager: boolean;
  isSupervisor: boolean;
  isWorker: boolean;
  isContractor: boolean; // legacy alias = isWorker
  loading: boolean;
  /**
   * null = project-wide (master / 발주처 PA·SM).
   * string[] = allowed company_ids (own or own+descendants for GC).
   * [] = restrictive (loading / no membership).
   */
  accessibleCompanyIds: string[] | null;
  /**
   * True only when company data is project-wide (accessibleCompanyIds === null).
   * Do NOT use isProjectAdmin / isSafetyManager for company visibility —
   * 시공사·협력사 SM/PA 는 여기 false 여야 한다.
   */
  seesAllCompanies: boolean;
  /** Apply to supabase query builder for company-scoped filtering. */
  applyCompanyFilter: (query: any, opts?: { includeOrphans?: boolean }) => any;
  canCreate: (feature: FeatureKey) => boolean;
  canEdit: (feature: FeatureKey) => boolean;
  canDelete: (feature: FeatureKey) => boolean;
  canApprove: (feature: FeatureKey) => boolean;
}

interface MemberInfo {
  role: ProjectRole | null;
  position: ProjectPosition;
  company_id: string | null;
  company_type: CompanyType;
}


export function useProjectAccess(): ProjectAccess {
  const { user, hasRole } = useAuth();
  const isMaster = hasRole('master');
  const [projects, setProjects] = useState<{ id: string; name: string; site_name: string }[]>([]);
  const [selectedProject, setSelectedProjectState] = useState(() => {
    try { return localStorage.getItem('selectedProjectId') || ''; } catch { return ''; }
  });
  const [memberInfo, setMemberInfo] = useState<MemberInfo | null>(null);
  const [loading, setLoading] = useState(true);
  // [] until resolved — never flash "all" for non-master
  const [accessibleCompanyIds, setAccessibleCompanyIds] = useState<string[] | null>([]);

  const setSelectedProject = (id: string) => {
    setSelectedProjectState(id);
    try { localStorage.setItem('selectedProjectId', id); } catch {}
  };

  useEffect(() => {
    loadProjects();
  }, [user, isMaster]);

  useEffect(() => {
    if (selectedProject && user && !isMaster) {
      loadMemberInfo();
    } else if (isMaster) {
      setMemberInfo({ role: 'master', position: null, company_id: null, company_type: null });
    }
  }, [selectedProject, user, isMaster]);

  const loadProjects = async () => {
    if (!user) { setLoading(false); return; }
    if (isMaster) {
      const { data } = await supabase
        .from('projects')
        .select('id, name, site_name')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setProjects(data);
        const saved = localStorage.getItem('selectedProjectId');
        const validSaved = saved && data.some(p => p.id === saved);
        if (!selectedProject || !data.some(p => p.id === selectedProject)) {
          setSelectedProject(validSaved ? saved! : data[0].id);
        }
      } else {
        setProjects([]);
        if (selectedProject) setSelectedProject('');
      }
    } else {
      const { data: members } = await supabase
        .from('project_members')
        .select('project_id, projects(id, name, site_name, is_deleted)')
        .eq('user_id', user.id);
      if (members && members.length > 0) {
        const projs = members
          .map(m => (m as any).projects)
          .filter((p: any) => p && p.is_deleted !== true)
          .map((p: any) => ({ id: p.id, name: p.name, site_name: p.site_name }));
        setProjects(projs);
        const saved = localStorage.getItem('selectedProjectId');
        const validSaved = saved && projs.some((p: any) => p.id === saved);
        if (!selectedProject || !projs.some((p: any) => p.id === selectedProject)) {
          setSelectedProject(validSaved ? saved! : (projs[0]?.id || ''));
        }
      } else {
        setProjects([]);
        if (selectedProject) setSelectedProject('');
      }
    }
    setLoading(false);
  };

  const loadMemberInfo = async () => {
    if (!user || !selectedProject) return;
    // Read project-scoped role/position columns.
    const { data } = await supabase
      .from('project_members')
      .select('company_id, role_new, position_new, companies(type)' as any)
      .eq('user_id', user.id)
      .eq('project_id', selectedProject)
      .maybeSingle();

    if (data) {
      const d = data as any;
      setMemberInfo({
        role: normalizeRole(d.role_new),
        position: (d.position_new || null) as ProjectPosition,
        company_id: d.company_id || null,
        company_type: (d.companies?.type as CompanyType) || null,
      });
    }
  };

  const userRole = useMemo<ProjectRole>(
    () => (isMaster ? 'master' : memberInfo?.role || 'viewer'),
    [isMaster, memberInfo],
  );

  /**
   * Feature ACL flag (parity with DB is_project_admin): includes safety_manager.
   * WARNING: NOT a company-scope flag. For data visibility use seesAllCompanies /
   * accessibleCompanyIds / applyCompanyFilter. 발주·시공·협력 각각 SM이 있다.
   */
  const isProjectAdmin = userRole === 'project_admin' || userRole === 'master' || userRole === 'safety_manager';
  const isSafetyManager = userRole === 'safety_manager';
  const seesAllCompanies = seesProjectWideCompanies({
    isMaster,
    role: userRole,
    companyType: isMaster ? null : memberInfo?.company_type,
    accessibleCompanyIds: isMaster ? null : accessibleCompanyIds,
  });
  const isSiteManager = userRole === 'site_manager';
  const isSupervisor = userRole === 'supervisor' || userRole === 'site_supervisor';
  const isWorker = userRole === 'worker';

  const userCompanyId = isMaster ? null : (memberInfo?.company_id || null);
  const userCompanyType: CompanyType = isMaster ? null : (memberInfo?.company_type ?? null);
  const userPosition: ProjectPosition = isMaster ? null : (memberInfo?.position ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isMaster) {
        if (!cancelled) setAccessibleCompanyIds(null); // null = project-wide
        return;
      }
      // Restrictive until member/scope resolves — never treat unknown as "all"
      if (!selectedProject || !memberInfo) {
        if (!cancelled) setAccessibleCompanyIds([]);
        return;
      }
      const ids = await resolveAccessibleCompanyIds({
        projectId: selectedProject,
        companyId: memberInfo.company_id,
        companyType: memberInfo.company_type,
        role: memberInfo.role || userRole,
        isMaster: false,
      });
      // null only when mode=all (발주처 admin); otherwise string[]
      if (!cancelled) setAccessibleCompanyIds(ids === null ? null : ids);
    })();
    return () => { cancelled = true; };
  }, [isMaster, selectedProject, memberInfo, userRole]);

  const applyCompanyFilter = useCallback(
    (query: any, opts?: { includeOrphans?: boolean }): any =>
      applyOwnCompanyFilter(query, {
        role: userRole,
        companyType: userCompanyType,
        companyId: userCompanyId,
        isMaster,
        accessibleCompanyIds,
        includeOrphans: opts?.includeOrphans,
      }),
    [userRole, userCompanyType, userCompanyId, isMaster, accessibleCompanyIds],
  );

  const getPermissions = (feature: FeatureKey): Perm =>
    PERMISSION_MATRIX[userRole]?.[feature] ?? RO;

  return {
    projects,
    selectedProject,
    setSelectedProject,
    userCompanyId,
    userCompanyType,
    userRole,
    userPosition,
    isMaster,
    isProjectAdmin,
    isSafetyManager,
    isSiteManager,
    isSupervisor,
    isWorker,
    isContractor: (userCompanyType === 'contractor' || userCompanyType === 'vendor') && (
      userRole === 'project_admin' || userRole === 'safety_manager' ||
      userRole === 'site_manager' || userRole === 'supervisor' ||
      userRole === 'site_supervisor' || userRole === 'worker'
    ),
    loading,
    accessibleCompanyIds,
    seesAllCompanies,
    applyCompanyFilter,
    canCreate: (f) => getPermissions(f).create,
    canEdit: (f) => getPermissions(f).edit,
    canDelete: (f) => getPermissions(f).delete,
    canApprove: (f) => getPermissions(f).approve,
  };
}
