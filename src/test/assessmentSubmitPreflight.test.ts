import { describe, expect, it } from 'vitest';
import { buildAssessmentSubmitPreflight } from '@/lib/assessmentSubmitPreflight';

describe('buildAssessmentSubmitPreflight', () => {
  it('blocks when items missing', () => {
    const { ready, items } = buildAssessmentSubmitPreflight({
      itemCount: 0,
      opinionRequired: true,
      healthRequired: true,
      opinions: 1,
      healths: 1,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 5,
    });
    expect(ready).toBe(false);
    expect(items.find((i) => i.id === 'items')?.ok).toBe(false);
  });

  it('skips opinion when not required', () => {
    const { items } = buildAssessmentSubmitPreflight({
      itemCount: 2,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 5,
      authorUserId: 'sup-1',
      currentUserId: 'sup-1',
    });
    expect(items.some((i) => i.id === 'opinions')).toBe(false);
    expect(items.every((i) => i.ok)).toBe(true);
  });

  it('uses saved draft ready instead of the dead >=2 fallback', () => {
    const { ready, items } = buildAssessmentSubmitPreflight({
      itemCount: 2,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 1,
      approvalDraftReady: true,
      authorUserId: 'sup-1',
      currentUserId: 'sup-1',
    });
    expect(ready).toBe(true);
    expect(items.find((i) => i.id === 'approval')?.detail).toContain('임시 저장');
  });

  it('flags unreviewed AI', () => {
    const { ready, items } = buildAssessmentSubmitPreflight({
      itemCount: 2,
      opinionRequired: true,
      healthRequired: true,
      opinions: 1,
      healths: 1,
      unreviewedAi: 3,
      unreviewedHealth: 0,
      approvalLineCount: 5,
      authorUserId: 'sup-1',
      currentUserId: 'sup-1',
    });
    expect(ready).toBe(false);
    expect(items.find((i) => i.id === 'ai_review')?.detail).toContain('3');
  });

  it('blocks when the submitter is not the legal author', () => {
    const { ready, items } = buildAssessmentSubmitPreflight({
      itemCount: 2,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 5,
      approvalDraftReady: true,
      authorUserId: 'sup-1',
      authorName: '김감독',
      currentUserId: 'sm-1',
    });
    expect(ready).toBe(false);
    expect(items.find((i) => i.id === 'author')?.ok).toBe(true);
    expect(items.find((i) => i.id === 'author_submitter')?.ok).toBe(false);
  });
});
