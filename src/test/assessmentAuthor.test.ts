import { describe, expect, it } from 'vitest';
import {
  assessmentAuthorSubmitMessage,
  canAssistAssessmentWrite,
  canCreateAssessmentRun,
  canSubmitAssessmentRun,
  defaultAuthorUserId,
  formatAssessmentAuthorLabel,
  hasAssessmentLegalAuthor,
  isSiteSupervisorRole,
} from '@/lib/assessmentAuthor';

describe('assessmentAuthor', () => {
  it('treats only site_supervisor as the legal author role', () => {
    expect(isSiteSupervisorRole('site_supervisor')).toBe(true);
    expect(isSiteSupervisorRole('safety_manager')).toBe(false);
    expect(isSiteSupervisorRole('site_manager')).toBe(false);
    expect(isSiteSupervisorRole('project_admin')).toBe(false);
  });

  it('lets SM create as assistant but never as legal author', () => {
    expect(canCreateAssessmentRun('safety_manager')).toBe(true);
    expect(canAssistAssessmentWrite('safety_manager')).toBe(true);
    expect(defaultAuthorUserId({ userId: 'sm-1', role: 'safety_manager' })).toBe('');
    expect(defaultAuthorUserId({ userId: 'sup-1', role: 'site_supervisor' })).toBe('sup-1');
  });

  it('allows only the named supervisor to submit', () => {
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
    })).toMatch(/관리감독자/);
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

  it('labels author with company', () => {
    expect(formatAssessmentAuthorLabel({
      user_id: 'u1',
      display_name: '김재현',
      company_id: 'c1',
      company_name: '정원이엔씨',
    })).toBe('김재현 · 정원이엔씨');
  });
});
