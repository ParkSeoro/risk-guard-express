import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canPrintAssessmentRun } from '@/lib/assessmentAuthor';
import { workPlanPrintAuthorBlockMessage } from '@/lib/workPlanAuthor';
import { extractTbmParticipantCount, tbmPageRange } from '@/lib/tbmListQuery';
import { permitFormDataForClone } from '@/lib/permitExtend';
import { chunkArray } from '@/lib/chunkArray';

describe('QA Batch 1 (P0) regressions — PR #688 consensus & PR #689 review fixes', () => {
  describe('#1 TBM participant count & offset pagination past 1,000 rows', () => {
    it('extracts counts safely from PostgREST embedded shapes', () => {
      expect(extractTbmParticipantCount({ tbm_participations: [{ count: 30 }] })).toBe(30);
      expect(extractTbmParticipantCount({ tbm_participations: { count: 6 } })).toBe(6);
      expect(extractTbmParticipantCount({ tbm_participations: [] })).toBe(0);
      expect(extractTbmParticipantCount({ tbm_participations: null })).toBe(0);
      expect(extractTbmParticipantCount({})).toBe(0);
    });

    it('computes offset-append ranges cleanly past PostgREST 1,000-row ceiling', () => {
      expect(tbmPageRange(0, 50)).toEqual([0, 50]);
      expect(tbmPageRange(50, 50)).toEqual([50, 100]);
      expect(tbmPageRange(1000, 50)).toEqual([1000, 1050]);
    });

    it('TbmManager queries embedded tbm_participations(count), uses offset pagination, and checks errors', () => {
      const src = readFileSync('src/components/tbm/TbmManager.tsx', 'utf8');
      expect(src).toContain("select('*, tbm_participations(count)')");
      expect(src).toContain('tbmPageRange(offset, TBM_PAGE_SIZE)');
      expect(src).not.toMatch(/\.from\(['"]tbm_participations['"][^;]*\.in\(['"]tbm_session_id['"]/);
    });
  });

  describe('#2 Legacy / non-draft print & PDF unblocked while draft stays gated', () => {
    it('assessment runs: blocks 작성중 without legal author, blocks when both author and createdBy are absent, allows legacy finalized docs with createdBy', () => {
      expect(canPrintAssessmentRun({ status: '작성중', authorUserId: null, createdBy: 'u-1' })).toBe(false);
      expect(canPrintAssessmentRun({ status: '', authorUserId: null, createdBy: 'u-1' })).toBe(false);
      expect(canPrintAssessmentRun({ status: '승인완료', authorUserId: null, createdBy: null })).toBe(false);
      expect(canPrintAssessmentRun({ status: '작성중', authorUserId: 'sup-1', createdBy: null })).toBe(true);
      expect(canPrintAssessmentRun({ status: '승인완료', authorUserId: null, createdBy: 'u-1' })).toBe(true);
      expect(canPrintAssessmentRun({ status: '결재진행', authorUserId: null, createdBy: 'u-1' })).toBe(true);
      expect(canPrintAssessmentRun({ status: '반려', authorUserId: null, createdBy: 'u-1' })).toBe(true);
      expect(canPrintAssessmentRun({ status: '만료', authorUserId: null, createdBy: 'u-1' })).toBe(true);
    });

    it('generate-pdf resolves legalAuthorName via legalAuthorId (author_user_id || created_by)', () => {
      const src = readFileSync('supabase/functions/generate-pdf/index.ts', 'utf8');
      expect(src).toContain('const legalAuthorId = run.author_user_id || run.created_by;');
      expect(src).toContain('.eq("user_id", legalAuthorId)');
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

  describe('#3 SafetyInspections avoids invalid embed and chunks profile lookups', () => {
    it('chunks large ID lists cleanly', () => {
      const ids = Array.from({ length: 125 }, (_, i) => `u-${i}`);
      const chunks = chunkArray(ids, 50);
      expect(chunks.map((c) => c.length)).toEqual([50, 50, 25]);
      expect(chunkArray([], 50)).toEqual([]);
    });

    it('does not embed profiles(display_name) and chunks profile queries in SafetyInspections', () => {
      const src = readFileSync('src/pages/SafetyInspections.tsx', 'utf8');
      expect(src).not.toContain('profiles(display_name)');
      expect(src).toContain('chunkArray(memberUserIds, 50)');
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

  describe('#5 Work permit clone strips prior completion/closure/signatures metadata', () => {
    it('strips work_complete_time, closed_*, closure_*, and all prior signatures while preserving work content', () => {
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
          applicant: { name: '차강찬' },
          sm: { name: '박서로' },
          closed_at: '2026-11-18T23:50:40Z',
          closure_approver: { name: '박서로' },
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
      expect(cloned.signatures).toBeUndefined();
    });
  });
});
