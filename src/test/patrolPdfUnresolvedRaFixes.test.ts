import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  filterVisibleInspectionActions,
  isClosedInspectionAction,
  isOpenInspectionAction,
} from '@/lib/inspectionActions';
import {
  canWithdrawPatrolLog,
  isPatrolLogLocked,
  patrolLockEditHint,
} from '@/lib/legalForms/patrolLog';
import {
  forceSubmitterStepToAuthor,
  submitterStepMismatchAuthor,
} from '@/lib/approvalRules';

describe('inspection action open/closed', () => {
  it('treats done and completed as closed', () => {
    expect(isOpenInspectionAction('pending')).toBe(true);
    expect(isOpenInspectionAction('in_progress')).toBe(true);
    expect(isOpenInspectionAction('completed')).toBe(false);
    expect(isOpenInspectionAction('done')).toBe(false);
    expect(isClosedInspectionAction('done')).toBe(true);
  });

  it('drops orphan and soft-deleted parent actions', () => {
    const rows = [
      { id: '1', inspection: { id: 'a', is_deleted: false } },
      { id: '2', inspection: { id: 'b', is_deleted: true } },
      { id: '3', inspection: null },
      { id: '4', inspection: undefined },
    ];
    expect(filterVisibleInspectionActions(rows as any).map((r) => r.id)).toEqual(['1']);
  });
});

describe('patrol withdraw-then-edit', () => {
  it('locks 결재진행/completed and allows withdraw only while 결재진행', () => {
    expect(isPatrolLogLocked('결재진행')).toBe(true);
    expect(isPatrolLogLocked('completed')).toBe(true);
    expect(isPatrolLogLocked('in_progress')).toBe(false);
    expect(canWithdrawPatrolLog('결재진행')).toBe(true);
    expect(canWithdrawPatrolLog('completed')).toBe(false);
    expect(patrolLockEditHint('결재진행')).toMatch(/회수/);
    expect(patrolLockEditHint('completed')).toMatch(/복제/);
  });
});

describe('RA submitter step author lock', () => {
  it('forces contractor_supervisor onto the author', () => {
    const steps = [
      { position: 'contractor_supervisor', user_id: 'other', user_name: '타인', company_id: 'c1', company_name: 'A' },
      { position: 'owner_sm', user_id: 'sm', user_name: 'SM', company_id: 'c2', company_name: 'B' },
    ];
    const forced = forceSubmitterStepToAuthor(steps, {
      userId: 'author-1',
      userName: '작성자',
      companyId: 'c9',
      companyName: '작성사',
    });
    expect(forced[0].user_id).toBe('author-1');
    expect(forced[0].user_name).toBe('작성자');
    expect(forced[1].user_id).toBe('sm');
    expect(submitterStepMismatchAuthor(steps, 'author-1')).toBe(true);
    expect(submitterStepMismatchAuthor(forced, 'author-1')).toBe(false);
  });
});

describe('pdf attachment render quality', () => {
  it('uses print-intent raster with ink boost and size budget (avoids 546)', () => {
    const src = readFileSync('src/lib/pdfRender.ts', 'utf8');
    const helpers = readFileSync('src/lib/pdfRenderHelpers.ts', 'utf8');
    expect(src).toMatch(/PDF_RENDER_SCALE\s*=\s*2\.5/);
    expect(helpers).toContain('darkenLightInk');
    expect(helpers).toContain('compactRenderedAttachments');
    expect(helpers).toContain('MAX_RENDERED_ATTACHMENTS_CHARS');
    expect(src).toContain("intent: 'print'");
    expect(src).toContain("alpha: false");
    expect(src).toContain('image/webp');
  });

  it('retries work-plan PDF without attachments on invoke failure', () => {
    const preview = readFileSync('src/lib/approvalDocPreview.ts', 'utf8');
    expect(preview).toContain('compactRenderedAttachments');
    expect(preview).toContain('retrying body-only');
    expect(preview).toContain('546');
  });

  it('resets preview body width and attachment max-height for print', () => {
    const preview = readFileSync('src/lib/approvalDocPreview.ts', 'utf8');
    expect(preview).toContain('@media print');
    expect(preview).toContain('width: auto !important');
    expect(preview).toContain('max-height: none !important');
    const edge = readFileSync('supabase/functions/generate-workplan-pdf/index.ts', 'utf8');
    expect(edge).toContain('attachment-print-img');
    expect(edge).not.toMatch(/max-height:720pt/);
  });
});
