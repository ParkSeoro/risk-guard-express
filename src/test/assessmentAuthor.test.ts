import { describe, expect, it } from 'vitest';
import {
  assessmentAuthorSubmitMessage,
  buildAuthorCandidates,
  canAssistAssessmentWrite,
  canCreateAssessmentRun,
  canSubmitAssessmentRun,
  defaultAuthorUserId,
  formatAssessmentAuthorLabel,
  hasAssessmentLegalAuthor,
  isAssessmentLegalAuthorMember,
  isAssessmentLegalAuthorRole,
  isSiteSupervisorRole,
} from '@/lib/assessmentAuthor';

describe('assessmentAuthor', () => {
  it('treats site_supervisor and site_manager as legal authors', () => {
    expect(isAssessmentLegalAuthorRole('site_supervisor')).toBe(true);
    expect(isAssessmentLegalAuthorRole('site_manager')).toBe(true);
    expect(isSiteSupervisorRole('site_supervisor')).toBe(true);
    expect(isAssessmentLegalAuthorRole('safety_manager')).toBe(false);
    expect(isAssessmentLegalAuthorRole('project_admin')).toBe(false);
  });

  it('lets SM create as assistant but never as legal author', () => {
    expect(canCreateAssessmentRun('safety_manager')).toBe(true);
    expect(canAssistAssessmentWrite('safety_manager')).toBe(true);
    expect(defaultAuthorUserId({ userId: 'sm-1', role: 'safety_manager' })).toBe('');
    expect(defaultAuthorUserId({ userId: 'sup-1', role: 'site_supervisor' })).toBe('sup-1');
    expect(defaultAuthorUserId({ userId: 'smgr-1', role: 'site_manager' })).toBe('smgr-1');
  });

  it('lets a 현장소장 create and submit as themselves', () => {
    expect(canCreateAssessmentRun('site_manager')).toBe(true);
    expect(canSubmitAssessmentRun({ userId: 'smgr-1', authorUserId: 'smgr-1' })).toBe(true);
    expect(canSubmitAssessmentRun({ userId: 'sm-1', authorUserId: 'smgr-1' })).toBe(false);
  });

  it('allows only the named author to submit', () => {
    expect(canSubmitAssessmentRun({ userId: 'sm-1', authorUserId: 'sup-1' })).toBe(false);
    expect(canSubmitAssessmentRun({ userId: 'sup-1', authorUserId: 'sup-1' })).toBe(true);
    expect(canSubmitAssessmentRun({ userId: 'master', authorUserId: 'sup-1' })).toBe(false);
    expect(canSubmitAssessmentRun({ userId: 'sup-1', authorUserId: null })).toBe(false);
  });

  it('blocks submit and print copy when author is missing', () => {
    expect(hasAssessmentLegalAuthor(null)).toBe(false);
    expect(assessmentAuthorSubmitMessage({
      authorUserId: null,
      userId: 'sm-1',
    })).toMatch(/현장소장/);
    expect(assessmentAuthorSubmitMessage({
      authorUserId: 'sup-1',
      authorName: '김감독',
      userId: 'sm-1',
    })).toMatch(/김감독/);
    expect(assessmentAuthorSubmitMessage({
      authorUserId: 'sup-1',
      authorName: '김감독',
      userId: 'sup-1',
    })).toBeNull();
  });

  it('labels author with role and company', () => {
    expect(formatAssessmentAuthorLabel({
      user_id: 'u1',
      display_name: '김재현',
      company_id: 'c1',
      company_name: '정원이엔씨',
      role: 'site_manager',
    })).toBe('김재현 · 현장소장 · 정원이엔씨');
  });

  it('treats SITE_MANAGER position as legal author even if role drifted', () => {
    expect(isAssessmentLegalAuthorMember({ role_new: 'project_admin', position_new: 'SITE_MANAGER' })).toBe(true);
    expect(isAssessmentLegalAuthorMember({ role_new: 'worker', position_new: 'WORKER' })).toBe(false);
  });

  it('lists 현장소장 before 관리감독자', () => {
    const list = buildAuthorCandidates([
      { user_id: 's1', display_name: '강감독', role_new: 'site_supervisor', company_name: 'A' },
      { user_id: 'm1', display_name: '최경호', role_new: 'site_manager', company_name: '정원' },
      { user_id: 'm2', display_name: '이진남', position_new: 'SITE_MANAGER', company_name: '정원' },
    ]);
    expect(list.map((c) => c.display_name)).toEqual(['이진남', '최경호', '강감독']);
    expect(list[0].role).toBe('site_manager');
    expect(list[2].role).toBe('site_supervisor');
  });
});
