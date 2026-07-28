/**
 * ============================================================
 * dataAccess.ts — 프로젝트/회사 격리 SSOT (Single Source of Truth)
 * ============================================================
 *
 * 모든 페이지가 supabase.from(...) 를 직접 호출하는 대신
 * scopedQuery() 를 통해 호출하면:
 *   1. project_id 필터 자동 적용
 *   2. company_id 격리 자동 적용 (역할에 따라)
 *   3. is_deleted = false 자동 적용 (휴지통 제외)
 *
 * RLS가 최종 게이트이지만, 클라이언트에서도 한 번 더 강제해
 * 실수로 다른 프로젝트/회사 데이터가 섞이지 않도록 한다.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectRole } from '@/hooks/useProjectAccess';

export interface ScopeOptions {
  projectId: string | null | undefined;
  companyId?: string | null;
  role: ProjectRole;
  /** 휴지통 보기일 때만 true — 기본은 삭제된 행 제외 */
  includeDeleted?: boolean;
  /** 이 테이블에 is_deleted 컬럼이 없으면 false */
  hasSoftDelete?: boolean;
}

/** 회사 격리가 필요한 역할인지 */
function shouldEnforceCompanyFilter(role: ProjectRole): boolean {
  return role === 'worker' || role === 'viewer';
}

/** 프로젝트 전체 접근이 가능한 역할인지 (격리 면제) */
function isOwnerSideRole(role: ProjectRole): boolean {
  return role === 'master' || role === 'project_admin' || role === 'safety_manager';
}

/**
 * 조회 쿼리에 스코프 필터 적용.
 *
 * @example
 *   const { data } = await scopedSelect(
 *     supabase.from('work_plans').select('*'),
 *     { projectId, companyId, role, hasSoftDelete: true }
 *   );
 */
export function scopedSelect<T>(query: T, opts: ScopeOptions): T {
  let q: any = query;

  // 1) project_id 필터
  if (opts.projectId) {
    q = q.eq('project_id', opts.projectId);
  } else {
    // 프로젝트가 없으면 절대 데이터를 보이지 않음
    q = q.eq('project_id', '00000000-0000-0000-0000-000000000000');
  }

  // 2) 회사 격리 (worker / viewer 만)
  if (shouldEnforceCompanyFilter(opts.role)) {
    if (opts.companyId) {
      q = q.eq('company_id', opts.companyId);
    } else {
      // company_id 없는 worker/viewer 는 아무것도 못 봄
      q = q.eq('company_id', '00000000-0000-0000-0000-000000000000');
    }
  }
  // site_manager / supervisor 는 RLS의 하위 회사 트리 검사에 위임

  // 3) 소프트 삭제 제외 (휴지통 모드 아닐 때)
  if (opts.hasSoftDelete && !opts.includeDeleted) {
    q = q.eq('is_deleted', false);
  }

  return q as T;
}

/**
 * 소프트 삭제 페이로드. update() 에 넘기면 됨.
 *
 * @example
 *   await supabase.from('work_plans')
 *     .update(softDeletePayload(userId, '중복 작성'))
 *     .eq('id', rowId);
 */
export function softDeletePayload(userId: string, reason?: string) {
  return {
    is_deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_by: userId,
    deleted_reason: (reason || '').trim() || null,
  };
}

/**
 * 소프트 삭제 복구 페이로드.
 */
export function softRestorePayload() {
  return {
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
  };
}

/** 휴지통/감사 대상이 되는 표준 소프트 삭제 테이블 화이트리스트 */
export const SOFT_DELETE_TABLES = [
  'assessment_runs',
  'work_plans',
  'work_permits',
  'safety_inspections',
  'tbm_sessions',
  'incident_reports',
  'safety_cost_items',
  'safety_cost_monthly_reports',
  'safety_education_materials',
  'legal_duties',
  'todo_items',
  'equipment_master',
  'environment_tags',
  'master_processes',
  'master_assignees',
  'master_departments',
  'master_ppe',
  'projects',
  'companies',
  'risk_items',
  'generated_batches',
  'approval_route_templates',
  'health_checkups',
  'health_education_logs',
  'chemicals',
  'work_env_measurements',
  'work_env_factors',
  'hazard_surveys',
  'worker_education_records',
  'emergency_drills',
  'site_maps',
  'site_zones',
  'restricted_zones',
] as const;


export type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number];

/** 사용자에게 보여줄 한글 테이블 라벨 */
export const TABLE_LABELS: Record<SoftDeleteTable, string> = {
  assessment_runs: '위험성평가',
  work_plans: '작업계획서',
  work_permits: '작업허가서',
  safety_inspections: '안전점검',
  tbm_sessions: 'TBM(작업 전 안전회의)',
  incident_reports: '사고/아차사고',
  safety_cost_items: '산업안전보건관리비',
  safety_cost_monthly_reports: '산업안전보건관리비 월보고서',
  safety_education_materials: '안전교육 자료',
  legal_duties: '법적업무',
  todo_items: 'To-Do',
  equipment_master: '장비 마스터',
  environment_tags: '환경 태그',
  master_processes: '공정 마스터',
  master_assignees: '담당자 마스터',
  master_departments: '부서 마스터',
  master_ppe: '보호구 마스터',
  projects: '프로젝트',
  companies: '협력사',
  risk_items: '위험성평가 항목',
  generated_batches: 'AI 생성 배치',
  approval_route_templates: '결재선 템플릿',
  health_checkups: '건강진단',
  health_education_logs: '보건교육 이력',
  chemicals: '화학물질(MSDS)',
  work_env_measurements: '작업환경측정',
  work_env_factors: '환경 유해요인',
  hazard_surveys: '유해요인 조사',
  worker_education_records: '근로자 안전보건교육',
  emergency_drills: '비상대피훈련',
  site_maps: '현장 사이트맵',
  site_zones: '사이트 구역',
  restricted_zones: '위험/진입금지 구역',
};

