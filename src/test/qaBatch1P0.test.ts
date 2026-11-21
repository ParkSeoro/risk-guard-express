import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canPrintAssessmentRun } from '@/lib/assessmentAuthor';
import { workPlanPrintAuthorBlockMessage } from '@/lib/workPlanAuthor';
import { extractTbmParticipantCount } from '@/lib/tbmListQuery';
import { permitFormDataForClone } from '@/lib/permitExtend';

describe('QA Batch 1 (P0) regressions — PR #688 consensus', () => {
  describe('#1 TBM participant count via embedded count', () => {
    it('extracts counts safely from PostgREST embedded shapes', () => {
      expect(extractTbmParticipantCount({ tbm_participations: [{ count: 30 }] })).toBe(30);
      expect(extractTbmParticipantCount({ tbm_participations: { count: 6 } })).toBe(6);
      expect(extractTbmParticipantCount({ tbm_participations: [] })).toBe(0);
      expect(extractTbmParticipantCount({ tbm_participations: null })).toBe(0);
      expect(extractTbmParticipantCount({})).toBe(0);
    });

    it('TbmManager queries embedded tbm_participations(count) instead of unbounded .in(ids)', () => {
      const src = readFileSync('src/components/tbm/TbmManager.tsx', 'utf8');
      expect(src).toContain("select('*, tbm_participations(count)')");
      expect(src).not.toMatch(/\.from\(['"]tbm_participations['"][^;]*\.in\(['"]tbm_session_id['"]/);
    });
  });

  describe('#2 Legacy / non-draft print & PDF unblocked while draft stays gated', () => {
    it('assessment runs: blocks only 작성중 without legal author, allows legacy/finalized statuses', () => {
      expect(canPrintAssessmentRun({ status: '작성중', authorUserId: null })).toBe(false);
      expect(canPrintAssessmentRun({ status: '', authorUserId: null })).toBe(false);
      expect(canPrintAssessmentRun({ status: '작성중', authorUserId: 'sup-1' })).toBe(true);
      expect(canPrintAssessmentRun({ status: '승인완료', authorUserId: null })).toBe(true);
      expect(canPrintAssessmentRun({ status: '결재진행', authorUserId: null })).toBe(true);
      expect(canPrintAssessmentRun({ status: '반려', authorUserId: null })).toBe(true);
      expect(canPrintAssessmentRun({ status: '만료', authorUserId: null })).toBe(true);
    });

    it('work plans: blocks only 작성중 without legal author, allows 만료/승인완료/결재중/반려/작업취소', () => {
      expect(workPlanPrintAuthorBlockMessage({ status: '작성중', authorUserId: null })).toBeTruthy();
      expect(workPlanPrintAuthorBlockMessage({ status: '작성중', authorUserId: 'sup-1' })).toBeNull();
      expect(workPlanPrintAuthorBlockMessage({ status: '만료', authorUserId: null })).toBeNull();
      expect(workPlanPrintAuthorBlockMessage({ status: '승인완료', authorUserId: null })).toBeNull();
      expect(workPlanPrintAuthorBlockMessage({ status: '결재중', authorUserId: null })).toBeNull();
      expect(workPlanPrintAuthorBlockMessage({ status: '반려', authorUserId: null })).toBeNull();
      expect(workPlanPrintAuthorBlockMessage({ status: '작업취소', authorUserId: null })).toBeNull();
    });
  });

  describe('#3 SafetyInspections avoids invalid project_members -> profiles embed', () => {
    it('does not embed profiles(display_name) inside project_members query', () => {
      const src = readFileSync('src/pages/SafetyInspections.tsx', 'utf8');
      expect(src).not.toContain('profiles(display_name)');
    });
  });

  describe('#4 Approvals rejected tab matches KPI (current timeline only)', () => {
    it('Approvals.tsx and MobileApprovals.tsx exclude priorIssuanceSteps from rejected tab', () => {
      const desktop = readFileSync('src/pages/Approvals.tsx', 'utf8');
      const mobile = readFileSync('src/pages/MobileApprovals.tsx', 'utf8');
      expect(desktop).not.toMatch(/\[\.\.\.issuanceSteps,\s*\.\.\.postSteps,\s*\.\.\.priorIssuanceSteps\]/);
      expect(mobile).not.toMatch(/\[\.\.\.current,\s*\.\.\.priorIssuanceSteps\]/);
    });
  });

  describe('#5 Work permit clone strips prior completion/closure metadata', () => {
    it('strips work_complete_time, closed_at, closed_by*, closure_* and nested closure signatures', () => {
      const cloned = permitFormDataForClone({
        work_location: 'A동 배관',
        personnel_count: 49,
        work_complete_time: '2026-11-19 08:15',
        closed_at: '2026-11-18T23:50:40+00:00',
        closed_by: 'u-1',
        closed_by_name: '박서로',
        closure_approver: { name: '박서로', signed_at: '2026-11-18T23:50:40Z' },
        closure_comment: '완료',
        signatures: {
          closed_at: '2026-11-18T23:50:40Z',
          closure_approver: { name: '박서로' },
          approved_at: '2026-11-18T00:00:00Z',
          reviewed_at: '2026-11-17T00:00:00Z',
        },
      });
      expect(cloned.work_location).toBe('A동 배관');
      expect(cloned.personnel_count).toBe(49);
      expect(cloned.work_complete_time).toBeUndefined();
      expect(cloned.closed_at).toBeUndefined();
      expect(cloned.closed_by).toBeUndefined();
      expect(cloned.closed_by_name).toBeUndefined();
      expect(cloned.closure_approver).toBeUndefined();
      expect(cloned.closure_comment).toBeUndefined();
      expect((cloned.signatures as Record<string, unknown>).closed_at).toBeUndefined();
      expect((cloned.signatures as Record<string, unknown>).closure_approver).toBeUndefined();
    });
  });
});
