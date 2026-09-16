/** 작업허가서·작업계획서 작업취소(void). 삭제·회수·종료완료와 구분한다. */

export const VOIDED_WORK_DOC_STATUS = '작업취소';

/** 상신 이후만. 작성중/반려/임시저장/종료완료는 제외. */
export const VOIDABLE_WORK_DOC_STATUSES = new Set([
  '결재중',
  '결재진행',
  '검토대기',
  '검토완료',
  '대기',
  '승인',
  '승인완료',
  '발행완료',
  'approved',
  'ISSUED',
  'APPROVED',
  '종료대기',
  'CLOSURE_PENDING',
  '완료',
]);

export type WorkDocVoidInfo = {
  reason: string;
  byName: string;
  at: string | null;
};

export function isWorkDocVoided(row?: {
  status?: string | null;
  voided_at?: string | null;
} | null): boolean {
  if (!row) return false;
  return row.status === VOIDED_WORK_DOC_STATUS || Boolean(row.voided_at);
}

export function isWorkDocVoidableStatus(status?: string | null): boolean {
  return VOIDABLE_WORK_DOC_STATUSES.has(status || '');
}

/**
 * Client ACL only. Server RPC is the authority.
 * Do NOT use isProjectAdmin — that flag includes SM.
 */
export function canClientVoidWorkDoc(opts: {
  userRole?: string | null;
  isMaster?: boolean;
  status?: string | null;
  voidedAt?: string | null;
}): boolean {
  if (isWorkDocVoided({ status: opts.status, voided_at: opts.voidedAt })) return false;
  if (!isWorkDocVoidableStatus(opts.status)) return false;
  const role = opts.userRole || '';
  return opts.isMaster === true || role === 'master' || role === 'project_admin';
}

export function workDocVoidInfo(row?: {
  status?: string | null;
  voided_at?: string | null;
  voided_reason?: string | null;
  voided_by_name?: string | null;
} | null): WorkDocVoidInfo | null {
  if (!isWorkDocVoided(row)) return null;
  return {
    reason: String(row?.voided_reason || '').trim() || '-',
    byName: String(row?.voided_by_name || '').trim() || '-',
    at: row?.voided_at || null,
  };
}

export function formatVoidedAtKst(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function voidWorkDocumentErrorMessage(code: string): string {
  const c = String(code || '');
  if (c.includes('UNAUTHENTICATED')) return '로그인이 필요합니다.';
  if (c.includes('FORBIDDEN')) return '프로젝트 관리자만 취소할 수 있습니다.';
  if (c.includes('REASON_REQUIRED')) return '취소 사유를 입력하세요.';
  if (c.includes('NOT_FOUND')) return '문서를 찾을 수 없습니다.';
  if (c.includes('ALREADY_VOIDED')) return '이미 취소된 문서입니다.';
  if (c.includes('NOT_VOIDABLE')) return '작성중·반려·종료완료 문서는 여기서 취소할 수 없습니다.';
  if (c.includes('INVALID_TYPE')) return '지원하지 않는 문서 유형입니다.';
  return c || '취소에 실패했습니다.';
}

/** 근로자 당일/TBM 오늘 목록: 취소·삭제 문서는 숨긴다. 서명·공수 이력은 건드리지 않는다. */
export function isWorkerTodayPermitActive(p: {
  status?: string | null;
  is_deleted?: boolean | null;
  voided_at?: string | null;
}): boolean {
  if (p.is_deleted) return false;
  if (isWorkDocVoided(p)) return false;
  return true;
}
