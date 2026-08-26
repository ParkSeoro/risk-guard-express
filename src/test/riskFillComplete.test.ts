import { describe, expect, it } from 'vitest';
import {
  defaultLegalForHazard,
  defaultPpeForHazard,
  needsLlmNarrativeFill,
  seedFillDetailFromRow,
} from '@/lib/riskFillComplete';

describe('needsLlmNarrativeFill', () => {
  it('does not call LLM when 상황·대책 are already written (PPE/legal are local)', () => {
    expect(
      needsLlmNarrativeFill({
        hazard: '사다리 추락',
        hazard_situation: '낙하',
        existing_measure: '2인1조',
        improvement_measure: '작업전 안전교육',
      }),
    ).toBe(false);
  });

  it('needs LLM for empty 대책 or scope-draft rows', () => {
    expect(
      needsLlmNarrativeFill({
        hazard: '추락',
        hazard_situation: '',
        existing_measure: '',
        improvement_measure: '',
      }),
    ).toBe(true);
    expect(
      needsLlmNarrativeFill({
        note: '[AI_SCOPE_DRAFT]',
        hazard: '추락',
        hazard_situation: '고소',
        existing_measure: '난간',
        improvement_measure: '안전대',
      }),
    ).toBe(true);
  });
});

describe('seedFillDetailFromRow', () => {
  it('fills default legal for 추락 without overwriting written measures', () => {
    const d = seedFillDetailFromRow({
      process: '소방공사',
      sub_task: '소방전기',
      hazard: '사다리 작업간 작업자가 중심을 잃고 추락',
      hazard_situation: '낙하',
      existing_measure: '사다리 작업시 2인1조',
      improvement_measure: '작업전 안전교육',
      ppe: [],
      legal_basis: [],
      risk_grade: '상',
    });
    expect(d.existing_measure).toBe('사다리 작업시 2인1조');
    expect(d.improvement_measure).toBe('작업전 안전교육');
    expect(d.ppe).toEqual(['안전모', '안전화', '안전대']);
    expect(d.legal_basis).toContain('산안기준규칙 제42조');
    expect(d.legal_basis).toContain('산안기준규칙 제24조');
    expect(d.hazard).toContain('추락');
  });

  it('keeps library PPE when present', () => {
    const d = seedFillDetailFromRow(
      { hazard: '추락', ppe: [], hazard_situation: '고소' },
      { ppe: ['안전모', '안전대'], hazard_situation: '라이브러리 상황' },
    );
    expect(d.ppe).toEqual(['안전모', '안전대']);
    expect(d.hazard_situation).toBe('고소');
  });
});

describe('defaultPpeForHazard', () => {
  it('maps 감전 / 추락', () => {
    expect(defaultPpeForHazard('활선 감전')).toContain('절연장갑');
    expect(defaultPpeForHazard('고소 추락')).toContain('안전대');
  });
});

describe('defaultLegalForHazard', () => {
  it('maps 추락·사다리 / 전도·조도 / 협착 without a legal_references table', () => {
    const fall = defaultLegalForHazard('사다리 작업간 작업자가 중심을 잃고 추락', '낙하');
    expect(fall).toContain('산안기준규칙 제42조');
    expect(fall).toContain('산안기준규칙 제24조');
    expect(fall).toContain('산안기준규칙 제32조');

    const trip = defaultLegalForHazard('조도 미확보 장소에서 이동 중 전도위험', '전도');
    expect(trip).toContain('산안기준규칙 제3조');
    expect(trip).toContain('산안기준규칙 제8조');

    const pinch = defaultLegalForHazard('파이핑 머신 회전부에 손가락 협착', '협착');
    expect(pinch).toContain('산안기준규칙 제86조');
  });
});
