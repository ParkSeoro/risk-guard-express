import { describe, expect, it } from 'vitest';
import {
  canClientVoidWorkDoc,
  isWorkDocVoidableStatus,
  isWorkDocVoided,
  isWorkerTodayPermitActive,
  voidWorkDocumentErrorMessage,
  workDocVoidInfo,
} from '@/lib/workDocVoid';

describe('work document void', () => {
  it('allows master and project_admin only — not SM / site manager / supervisor', () => {
    const issued = { status: '승인완료', voidedAt: null as string | null };
    expect(canClientVoidWorkDoc({ userRole: 'master', ...issued })).toBe(true);
    expect(canClientVoidWorkDoc({ userRole: 'project_admin', isMaster: false, ...issued })).toBe(true);
    expect(canClientVoidWorkDoc({ userRole: 'safety_manager', ...issued })).toBe(false);
    expect(canClientVoidWorkDoc({ userRole: 'site_manager', ...issued })).toBe(false);
    expect(canClientVoidWorkDoc({ userRole: 'supervisor', ...issued })).toBe(false);
    expect(canClientVoidWorkDoc({ userRole: 'site_supervisor', ...issued })).toBe(false);
    expect(canClientVoidWorkDoc({ isMaster: true, userRole: 'viewer', ...issued })).toBe(true);
  });

  it('is only for submitted pipeline statuses, not draft / reject / closed', () => {
    expect(isWorkDocVoidableStatus('결재중')).toBe(true);
    expect(isWorkDocVoidableStatus('승인')).toBe(true);
    expect(isWorkDocVoidableStatus('종료대기')).toBe(true);
    expect(isWorkDocVoidableStatus('완료')).toBe(true);
    expect(isWorkDocVoidableStatus('작성중')).toBe(false);
    expect(isWorkDocVoidableStatus('반려')).toBe(false);
    expect(isWorkDocVoidableStatus('임시저장')).toBe(false);
    expect(isWorkDocVoidableStatus('종료완료')).toBe(false);
    expect(isWorkDocVoidableStatus('작업취소')).toBe(false);
  });

  it('treats status or voided_at as cancelled', () => {
    expect(isWorkDocVoided({ status: '작업취소' })).toBe(true);
    expect(isWorkDocVoided({ status: '승인', voided_at: '2026-09-16T01:00:00Z' })).toBe(true);
    expect(isWorkDocVoided({ status: '승인' })).toBe(false);
    expect(canClientVoidWorkDoc({ userRole: 'project_admin', status: '작업취소' })).toBe(false);
  });

  it('hides cancelled permits from worker today lists', () => {
    expect(isWorkerTodayPermitActive({ status: '승인완료' })).toBe(true);
    expect(isWorkerTodayPermitActive({ status: '작업취소' })).toBe(false);
    expect(isWorkerTodayPermitActive({ status: '승인완료', voided_at: '2026-09-16T01:00:00Z' })).toBe(false);
    expect(isWorkerTodayPermitActive({ status: '승인완료', is_deleted: true })).toBe(false);
  });

  it('builds stamp overlay fields from live row', () => {
    expect(workDocVoidInfo({ status: '승인' })).toBeNull();
    expect(workDocVoidInfo({
      status: '작업취소',
      voided_reason: '기상 악화',
      voided_by_name: '김발주',
      voided_at: '2026-09-16T01:00:00Z',
    })).toEqual({
      reason: '기상 악화',
      byName: '김발주',
      at: '2026-09-16T01:00:00Z',
    });
  });

  it('maps RPC errors without exposing SQL', () => {
    expect(voidWorkDocumentErrorMessage('FORBIDDEN')).toMatch(/프로젝트 관리자/);
    expect(voidWorkDocumentErrorMessage('NOT_VOIDABLE')).toMatch(/작성중/);
  });
});
