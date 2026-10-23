import { describe, expect, it } from 'vitest';
import { permitFormDataForClone } from '@/lib/permitExtend';
import { permitPostStepKind } from '@/lib/permitPostApproval';
import { permitIssueApprovalCreatesTbm } from '@/lib/tbmLifecycle';
import {
  canRequestWorkPermitVoid,
  voidRequestDecisionEffect,
  voidRequestErrorMessage,
} from '@/lib/permitVoidRequest';
import { workDocVoidInfo } from '@/lib/workDocVoid';

const issued = {
  status: '승인완료',
  voidedAt: null as string | null,
  pending: false,
};

describe('canRequestWorkPermitVoid', () => {
  it('lets the author request an issued permit', () => {
    expect(canRequestWorkPermitVoid({
      ...issued,
      userId: 'author',
      userRole: 'site_supervisor',
      createdBy: 'author',
    })).toBe(true);
  });

  it('does not treat a missing author as everyone', () => {
    expect(canRequestWorkPermitVoid({
      ...issued,
      userId: 'someone',
      userRole: 'site_supervisor',
      createdBy: null,
    })).toBe(false);
  });

  it('hides the request from master and project admin even when they wrote it', () => {
    expect(canRequestWorkPermitVoid({
      ...issued,
      userId: 'admin',
      userRole: 'project_admin',
      createdBy: 'admin',
    })).toBe(false);
    expect(canRequestWorkPermitVoid({
      ...issued,
      userId: 'master',
      isMaster: true,
      userRole: 'viewer',
      createdBy: 'master',
    })).toBe(false);
  });

  it('allows the permit company or parent contractor safety manager, not a client SM', () => {
    expect(canRequestWorkPermitVoid({
      ...issued,
      userId: 'sm',
      userRole: 'safety_manager',
      userCompanyId: 'co-1',
      userCompanyType: 'contractor',
      permitCompanyId: 'co-1',
      createdBy: 'author',
    })).toBe(true);
    expect(canRequestWorkPermitVoid({
      ...issued,
      userId: 'director',
      userRole: 'site_manager',
      userCompanyId: 'gc-1',
      userCompanyType: 'gc',
      permitCompanyId: 'co-1',
      parentCompanyId: 'gc-1',
      createdBy: 'author',
    })).toBe(true);
    expect(canRequestWorkPermitVoid({
      ...issued,
      userId: 'client-sm',
      userRole: 'safety_manager',
      userCompanyId: 'client-1',
      userCompanyType: 'client',
      permitCompanyId: 'client-1',
      createdBy: 'author',
    })).toBe(false);
  });

  it('refuses drafts and a request that is already pending', () => {
    expect(canRequestWorkPermitVoid({
      ...issued,
      status: '작성중',
      userId: 'author',
      createdBy: 'author',
    })).toBe(false);
    expect(canRequestWorkPermitVoid({
      ...issued,
      pending: true,
      userId: 'author',
      createdBy: 'author',
    })).toBe(false);
  });
});

describe('void request approval result', () => {
  it('keeps the issued permit when the request is rejected', () => {
    expect(voidRequestDecisionEffect('void_rejected')).toBe('keep_issued');
    expect(voidRequestDecisionEffect('voided')).toBe('void');
    expect(voidRequestDecisionEffect('rejected')).toBe('other');
  });

  it('does not classify the void step as a normal issuance approval', () => {
    expect(permitPostStepKind('void_request_client')).toBe('void_request_client');
    expect(permitPostStepKind('void_request_client')).not.toBe('normal');
  });

  it('does not create a TBM when the approval result is voided', () => {
    expect(permitIssueApprovalCreatesTbm({ finalized: true, action: 'approved' })).toBe(true);
    expect(permitIssueApprovalCreatesTbm({ finalized: true, action: 'voided' })).toBe(false);
    expect(permitIssueApprovalCreatesTbm({ finalized: true, action: 'void_rejected' })).toBe(false);
    expect(permitIssueApprovalCreatesTbm({ finalized: false, action: 'approved' })).toBe(false);
  });
});

describe('permit void request clone and stamp', () => {
  it('drops a pending void request when copying the previous permit', () => {
    const cloned = permitFormDataForClone({
      work_name: '배관 용접',
      work_void_requested_reason: '우천',
      work_void_requested_at: '2026-10-24T00:00:00Z',
      work_void_requested_by: 'author',
      work_void_requested_by_name: '홍길동',
    });
    expect(cloned.work_name).toBe('배관 용접');
    expect(cloned).not.toHaveProperty('work_void_requested_reason');
    expect(cloned).not.toHaveProperty('work_void_requested_at');
    expect(cloned).not.toHaveProperty('work_void_requested_by');
    expect(cloned).not.toHaveProperty('work_void_requested_by_name');
  });

  it('adds the requester line only when a request was approved', () => {
    expect(workDocVoidInfo({
      status: '작업취소',
      voided_reason: '우천',
      voided_by_name: '김발주',
      voided_at: '2026-10-24T01:00:00Z',
    })).toEqual({
      reason: '우천',
      byName: '김발주',
      at: '2026-10-24T01:00:00Z',
    });
    expect(workDocVoidInfo({
      status: '작업취소',
      voided_reason: '우천',
      voided_by_name: '김발주',
      voided_at: '2026-10-24T01:00:00Z',
      form_data: { work_void_requested_by_name: '홍길동' },
    })?.requestedByName).toBe('홍길동');
  });

  it('maps request errors', () => {
    expect(voidRequestErrorMessage('USE_DIRECT_VOID')).toMatch(/작업 취소/);
    expect(voidRequestErrorMessage('NO_CLIENT_APPROVER')).toMatch(/발주처/);
    expect(voidRequestErrorMessage('NOT_APPROVED')).toMatch(/발행/);
  });
});
