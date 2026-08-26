import { describe, it, expect } from 'vitest';
import {
  isPlaceholderProcessName,
  riskFillWorkKey,
  toRiskFillDraft,
  isNonRetryableFillError,
  pickLibraryFillMatch,
} from '@/lib/riskAutoGenAI';

describe('riskFillWorkKey', () => {
  it('prefers 세부작업, then 위험요인, then a real 공종', () => {
    expect(riskFillWorkKey({ sub_task: '용접', hazard: '화기', process: '배관' })).toBe('용접');
    expect(riskFillWorkKey({ sub_task: '', hazard: '추락', process: '비계' })).toBe('추락');
    expect(riskFillWorkKey({ sub_task: '', hazard: '', process: '굴착' })).toBe('굴착');
  });

  it('does not use blank 행 추가 placeholders as the fill key', () => {
    expect(isPlaceholderProcessName('신규공정')).toBe(true);
    expect(isPlaceholderProcessName('공종')).toBe(true);
    expect(isPlaceholderProcessName('미분류')).toBe(true);
    expect(isPlaceholderProcessName('굴착')).toBe(false);
    expect(riskFillWorkKey({ sub_task: '', hazard: '', process: '신규공정' })).toBe('');
    expect(riskFillWorkKey({ sub_task: '  ', hazard: null, process: '공종' })).toBe('');
  });

  it('synthesizes a draft sub_task so Edge does not drop the row', () => {
    const draft = toRiskFillDraft({
      sub_task: '',
      hazard: '개구부 추락',
      process: '철골',
    });
    expect(draft.sub_task).toBe('개구부 추락');
    expect(draft.hazard).toBe('개구부 추락');
  });
});

describe('isNonRetryableFillError', () => {
  it('treats CALL_CAP / credits / missing draft as not worth per-row retries', () => {
    expect(isNonRetryableFillError(new Error('AI 호출 상한(6회/요청)에 도달했습니다. CALL_CAP'))).toBe(true);
    expect(isNonRetryableFillError(new Error('AI 무료 할당량이 소진되었습니다'))).toBe(true);
    expect(isNonRetryableFillError(new Error('채울 초안(draft_items)이 필요합니다.'))).toBe(true);
    expect(isNonRetryableFillError(new Error('세부작업(sub_task)이 필요합니다.'))).toBe(true);
    expect(isNonRetryableFillError(new Error('generate-risk-ai redeploy in progress — retry in a minute'))).toBe(true);
    expect(isNonRetryableFillError(new Error('AI 서버가 재시작 중입니다. 1분 후 다시 시도해주세요.'))).toBe(true);
    expect(isNonRetryableFillError(new Error('AI 서버가 일시적으로 바쁩니다'))).toBe(true);
  });
});

describe('pickLibraryFillMatch', () => {
  const pool = [
    { sub_task: '슬래브 타설', hazard: '낙하', improvement_measure: '낙하물 방지망' },
    { sub_task: '개구부 작업', hazard: '추락', improvement_measure: '덮개·난간 설치' },
  ];

  it('matches by overlapping 세부작업 or 위험요인', () => {
    expect(pickLibraryFillMatch(pool, { sub_task: '개구부 작업', hazard: '' })?.improvement_measure).toBe(
      '덮개·난간 설치',
    );
    expect(pickLibraryFillMatch(pool, { sub_task: '', hazard: '낙하' })?.improvement_measure).toBe('낙하물 방지망');
  });

  it('does not invent a match when the row has no 세부작업/위험요인', () => {
    expect(pickLibraryFillMatch(pool, { sub_task: '', hazard: '', process: '신규공정' } as any)).toBeNull();
  });
});
