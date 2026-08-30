import { describe, expect, it } from 'vitest';
import {
  PERMIT_BRIEFING_SYSTEM_PROMPT,
  applyPermitBriefingLead,
  buildLocalPermitBriefing,
  buildPermitBriefingLead,
  buildPermitBriefingLlmPayload,
  extractPermitBriefingFacts,
  formatPermitBriefingDateKo,
  normalizePermitBriefing,
} from '@/lib/permitBriefing';

describe('permit briefing facts', () => {
  it('prefers applicant company and work_start date', () => {
    const facts = extractPermitBriefingFacts({
      formData: {
        applicant_company: '청원산기',
        work_start: '2026-08-14T08:00',
        work_name: '배관 용접',
        work_description: 'C라인 배관 교체',
        work_location: '여수 H2 장치',
        hz_hot: true,
        hz_hot_note: '플랜지 용접',
        hz_hot_detail: { '소화기 비치': true, '화재감시자 배치': true },
        chk_ppe: true,
        att_tbm_log: true,
        hz_heavy_equipment_name: '용접기',
      },
      permitKinds: ['hot_work'],
      permitDate: '2026-01-01',
    });
    expect(facts.company).toBe('청원산기');
    expect(facts.workDate).toBe('2026-08-14');
    expect(facts.kindLabels).toEqual(['화기']);
    expect(facts.hazards).toEqual([
      { label: '화기', note: '플랜지 용접', measures: ['소화기 비치', '화재감시자 배치'] },
    ]);
    expect(facts.checklist).toContain('보호구 착용 및 건강 상태 확인');
    expect(facts.attachments).toContain('TBM 일지');
    expect(facts.equipment).toBe('용접기');
  });

  it('uses work_start_at when form work_start is empty', () => {
    const facts = extractPermitBriefingFacts({
      formData: { contractor_company: 'B사', work_name: '굴착' },
      permitKinds: ['excavation'],
      workStartAt: '2026-08-20T07:30:00+09:00',
    });
    expect(facts.workDate).toBe('2026-08-20');
    expect(buildPermitBriefingLead(facts)).toContain('2026년 8월 20일');
  });

  it('does not add hazards that were not checked or selected as kinds', () => {
    const facts = extractPermitBriefingFacts({
      formData: { work_name: '자재 반입', chk_ppe: true },
      permitKinds: ['general'],
    });
    expect(facts.hazards).toEqual([]);
    const payload = buildPermitBriefingLlmPayload(facts);
    expect(payload.hazards).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('추락');
  });

  it('does not treat 굴착·중장비 kind as both hazards', () => {
    const empty = extractPermitBriefingFacts({
      formData: { work_name: '크레인 양중' },
      permitKinds: ['excavation'],
      kindLabels: ['굴착·중장비'],
    });
    expect(empty.hazards).toEqual([]);
    expect(empty.kindLabels).toEqual([]);

    const heavyOnly = extractPermitBriefingFacts({
      formData: { hz_heavy_equipment_name: '굴착기 0.7㎥' },
      permitKinds: ['excavation'],
      kindLabels: ['일반', '굴착·중장비'],
    });
    expect(heavyOnly.kindLabels).toEqual(['일반', '중장비']);
    expect(heavyOnly.hazards.map((h) => h.label)).toEqual(['중장비']);
    expect(heavyOnly.hazards[0].note).toContain('투입장비 굴착기 0.7㎥');
    expect(heavyOnly.hazards.some((h) => h.label === '굴착')).toBe(false);
    expect(buildPermitBriefingLlmPayload(heavyOnly).has_excavation_work).toBe(false);
    expect(buildPermitBriefingLlmPayload(heavyOnly).투입장비).toBe('굴착기 0.7㎥');
    expect(buildPermitBriefingLlmPayload(heavyOnly).excavation).toBeUndefined();

    const digOnly = extractPermitBriefingFacts({
      formData: {
        ex_depth: '1.8',
        ex_width: '0.8',
        ex_method: '인력',
        ex_underground: '가스관 확인',
        ex_safety: { '굴착 기울기 준수(흙 1:1.0 등)': true, '중장비 안전점검표 확인': true },
      },
      permitKinds: ['excavation'],
    });
    expect(digOnly.kindLabels).toEqual(['굴착', '중장비']);
    expect(digOnly.hazards.find((h) => h.label === '굴착')?.note).toContain('1.8');
    expect(digOnly.hazards.find((h) => h.label === '굴착')?.measures).toContain('굴착 기울기 준수(흙 1:1.0 등)');
    expect(digOnly.hazards.find((h) => h.label === '중장비')?.measures).toContain('중장비 안전점검표 확인');
    expect(digOnly.excavation).toEqual({
      depth: '1.8',
      width: '0.8',
      method: '인력',
      underground: '가스관 확인',
    });

    const specOnly = extractPermitBriefingFacts({
      formData: { ex_depth: '2.0' },
      permitKinds: ['excavation'],
    });
    expect(specOnly.kindLabels).toEqual(['굴착']);
    expect(specOnly.hazards.map((h) => h.label)).toEqual(['굴착']);
    expect(buildPermitBriefingLlmPayload(specOnly).excavation).toEqual({ depth: '2.0' });
  });

  it('keeps 화기 equipment name from becoming a 중장비 hazard', () => {
    const facts = extractPermitBriefingFacts({
      formData: { hz_hot: true, hz_heavy_equipment_name: '용접기' },
      permitKinds: ['hot_work'],
    });
    expect(facts.hazards.map((h) => h.label)).toEqual(['화기']);
    expect(facts.equipment).toBe('용접기');
    expect(facts.kindLabels).toEqual(['화기']);
  });

  it('summarizes 일반 허가서 투입장비 as 중장비, not 굴착', () => {
    const facts = extractPermitBriefingFacts({
      formData: {
        hz_heavy: true,
        hz_heavy_equipment_name: '지게차 3t',
        hz_heavy_detail: { '유도자·신호수 배치': true },
      },
      permitKinds: ['general', 'excavation'],
      kindLabels: ['일반', '굴착·중장비'],
    });
    expect(facts.kindLabels).toEqual(['일반', '중장비']);
    expect(facts.hazards.map((h) => h.label)).toEqual(['중장비']);
    expect(facts.hazards[0].note).toBe('투입장비 지게차 3t');
    expect(JSON.stringify(buildPermitBriefingLlmPayload(facts))).not.toMatch(/굴착(?!기)/);
  });
});

describe('lead sentence', () => {
  it('starts with company and Korean date', () => {
    expect(formatPermitBriefingDateKo('2026-08-14')).toBe('2026년 8월 14일');
    const facts = extractPermitBriefingFacts({
      formData: {
        contractor_company: '정엔지니어링',
        work_start: '2026-08-14T09:00',
        work_name: '탱크 내부 청소',
      },
      permitKinds: ['confined_space'],
    });
    expect(buildPermitBriefingLead(facts)).toBe(
      '정엔지니어링 2026년 8월 14일 작업 사항으로 탱크 내부 청소를 시행함.',
    );
  });

  it('prepends lead and strips a model-written lead clause', () => {
    const lead = '청원산기 2026년 8월 14일 작업 사항으로 배관 용접을 시행함.';
    expect(applyPermitBriefingLead('용접 전 가스측정을 실시함.', lead)).toBe(
      `${lead} 용접 전 가스측정을 실시함.`,
    );
    expect(applyPermitBriefingLead(lead, lead)).toBe(lead);
    expect(applyPermitBriefingLead(
      '다른업체 2026년 1월 1일 작업 사항으로 잘못된 작업을 시행함. 실제로는 배관 용접임.',
      lead,
    )).toBe(`${lead} 실제로는 배관 용접임.`);
  });
});

describe('local fallback', () => {
  it('uses the lead sentence and only listed hazards', () => {
    const briefing = buildLocalPermitBriefing({
      formData: {
        applicant_company: '청원산기',
        work_start: '2026-08-14T08:00',
        work_name: '배관 용접',
        hz_hot: true,
        hz_hot_note: '플랜지',
        chk_ppe: true,
      },
      permitKinds: ['hot_work'],
    });
    expect(briefing.work_overview.startsWith('청원산기 2026년 8월 14일 작업 사항으로 배관 용접을 시행함.')).toBe(true);
    expect(briefing.top_risks.join(' ')).toContain('화기');
    expect(briefing.top_risks.join(' ')).toContain('플랜지');
    expect(briefing.top_risks.some((r) => r.includes('추락') || r.includes('질식'))).toBe(false);
    expect(briefing.required_controls).toContain('보호구 착용 및 건강 상태 확인');
  });

  it('does not pad generic construction risks when none are recorded', () => {
    const briefing = buildLocalPermitBriefing({
      formData: { work_name: '자재 반입', applicant_company: 'A사', work_start: '2026-08-14' },
      permitKinds: ['general'],
    });
    expect(briefing.top_risks).toEqual([]);
    expect(briefing.work_overview).toContain('A사');
    expect(briefing.work_overview).toContain('자재 반입');
  });
});

describe('briefing prompt', () => {
  it('grounds the model in permit facts and skips the risk-assessment appendix', () => {
    expect(PERMIT_BRIEFING_SYSTEM_PROMPT).toContain('입력에 없는 위험·조치를 만들지 않는다');
    expect(PERMIT_BRIEFING_SYSTEM_PROMPT).not.toContain('누락 없이');
    expect(PERMIT_BRIEFING_SYSTEM_PROMPT).not.toContain('발생 가능한 위험');
    expect(PERMIT_BRIEFING_SYSTEM_PROMPT).toContain('업체명·날짜');
    expect(PERMIT_BRIEFING_SYSTEM_PROMPT).toContain('굴착과 중장비는 서로 다른 위험이다');
    expect(PERMIT_BRIEFING_SYSTEM_PROMPT).toContain('투입장비는 일반 허가서 중장비 칸');
  });

  it('uses recorded kinds, not the model bundled 굴착·중장비 label', () => {
    const facts = extractPermitBriefingFacts({
      formData: { hz_heavy_equipment_name: '덤프 15t' },
      permitKinds: ['excavation'],
    });
    const briefing = normalizePermitBriefing({
      work_overview: '굴착 사면 붕괴에 주의한다. 덤프 작업반경을 통제한다.',
      included_kinds: ['굴착·중장비'],
      top_risks: ['굴착 붕괴', '중장비 협착'],
      required_controls: ['흙막이 설치', '작업반경 출입통제'],
    }, facts);
    expect(briefing.included_kinds).toEqual(['중장비']);
    expect(briefing.top_risks.join(' ')).not.toMatch(/굴착(?!기)/);
    expect(briefing.top_risks.join(' ')).toContain('중장비');
    expect(briefing.work_overview).not.toMatch(/사면/);
    expect(briefing.work_overview).toContain('덤프');
    expect(briefing.required_controls).toEqual(['작업반경 출입통제']);
  });
});
