import { describe, expect, it } from 'vitest';
import { buildAssessmentSubmitPreflight, countIncompleteAssessmentItems } from '@/lib/assessmentSubmitPreflight';

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
      participantCount: 1,
    });
    expect(items.some((i) => i.id === 'opinions')).toBe(false);
    expect(items.find((i) => i.id === 'item_fields')?.ok).toBe(true);
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
      participantCount: 1,
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

  it('blocks when improvement/PPE/legal are missing', () => {
    const { ready, items } = buildAssessmentSubmitPreflight({
      itemCount: 15,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 5,
      approvalDraftReady: true,
      authorUserId: 'sup-1',
      currentUserId: 'sup-1',
      incompleteItemCount: 8,
      incompleteItemDetail: '8행 미기재 (개선대책 8) · [나머지 채우기] 또는 직접 입력',
    });
    expect(ready).toBe(false);
    expect(items.find((i) => i.id === 'item_fields')?.ok).toBe(false);
    expect(items.find((i) => i.id === 'item_fields')?.detail).toContain('나머지 채우기');
  });

  it('asks for an occasional reason only on 수시', () => {
    const blocked = buildAssessmentSubmitPreflight({
      itemCount: 1,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 2,
      approvalDraftReady: true,
      authorUserId: 'sup-1',
      currentUserId: 'sup-1',
      participantCount: 1,
      runType: '수시',
      occasionalReason: '  ',
    });
    expect(blocked.items.find((i) => i.id === 'occasional_reason')?.detail).toBe('수시 사유가 비어 있습니다');
    const regular = buildAssessmentSubmitPreflight({
      itemCount: 1,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 2,
      approvalDraftReady: true,
      authorUserId: 'sup-1',
      currentUserId: 'sup-1',
      participantCount: 1,
      runType: '정기',
    });
    expect(regular.items.some((i) => i.id === 'occasional_reason')).toBe(false);
  });

  it('blocks participation only when opinion, photo, and participant are all missing', () => {
    const blocked = buildAssessmentSubmitPreflight({
      itemCount: 1,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 2,
      approvalDraftReady: true,
      authorUserId: 'sup-1',
      currentUserId: 'sup-1',
    });
    expect(blocked.items.find((i) => i.id === 'worker_participation')?.detail).toBe('작업 근로자 참여 기록이 없습니다');
    const photo = buildAssessmentSubmitPreflight({
      itemCount: 1,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 2,
      approvalDraftReady: true,
      authorUserId: 'sup-1',
      currentUserId: 'sup-1',
      participationPhotos: 1,
    });
    expect(photo.items.find((i) => i.id === 'worker_participation')?.ok).toBe(true);
  });
});

describe('countIncompleteAssessmentItems', () => {
  it('counts unique rows missing improvement even when existing is filled', () => {
    const { count, detail } = countIncompleteAssessmentItems([
      {
        hazard_situation: '과속 전도',
        existing_measure: '제한속도 10km/h',
        improvement_measure: '',
        ppe: [],
        legal_basis: [],
        risk_grade: '상',
      },
      {
        hazard_situation: '용접 불티',
        existing_measure: '소화기 비치',
        improvement_measure: '화재감시자 배치',
        ppe: ['용접면'],
        legal_basis: ['산업안전보건기준에 관한 규칙 제241조'],
        risk_grade: '상',
      },
    ]);
    expect(count).toBe(1);
    expect(detail).toContain('개선대책');
    expect(detail).toContain('PPE');
    expect(detail).toContain('법적근거');
  });

  it('does not require legal for 하 grade', () => {
    const { count } = countIncompleteAssessmentItems([
      {
        hazard_situation: '상황',
        existing_measure: '기존',
        improvement_measure: '개선',
        ppe: ['안전모'],
        legal_basis: [],
        risk_grade: '하',
      },
    ]);
    expect(count).toBe(0);
  });
});
