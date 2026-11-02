import { isCivilConstruction } from '@/lib/constructionTypes';

/**
 * 참고 문구만 만든다. 선임 행이나 기술지도 계약을 만들지 않는다.
 *
 * 안전관리자 수: 산업안전보건법 시행령 별표 3 건설업 (2024. 6. 25. 개정본에서 확인한 구간).
 * - 원도급 50억 / 관계수급인 100억 이상 ~ 800억 미만: 1명 이상
 * - 800억 ~ 1,500억 미만: 2명 이상 (전·후 15% 기간은 1명)
 * - 1,500억 ~ 2,200억 미만: 3명 이상 (전·후 15% 기간은 2명)
 * - 그 이상은 별표의 추가 구간이라 인원을 단정하지 않는다.
 * 전담: 시행령 제16조제2항. 120억(토목 150억) 이상.
 *
 * 기술지도: 시행령 제59조. 1억 이상 120억(토목 150억) 미만.
 * 공사기간 1개월 미만은 제외. 섬 지역·전담 선임·유해위험방지계획서·건축허가는 이 화면에서 판단하지 않는다.
 */

const EOK = 100_000_000;

export interface SafetyScaleInput {
  amount?: number | null;
  constructionType?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  /** 협력사·공급사 도급은 관계수급인 하한(100억)을 쓴다. */
  relationSubcontractor?: boolean;
}

export interface SafetyScaleHint {
  hasAmount: boolean;
  /** 이 업체 도급금액 기준 선임 참고 */
  appointment: string;
  /** 이 업체 도급금액 기준 기술지도 참고 */
  technicalGuidance: string;
}

export function isRelationSubcontractorType(companyType?: string | null): boolean {
  return companyType === 'contractor' || companyType === 'vendor';
}

/** 착공~준공이 달력 기준 1개월 미만이면 true. 날짜가 없으면 null. */
export function constructionPeriodUnderOneMonth(start?: string | null, end?: string | null): boolean | null {
  if (!start || !end) return null;
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const limit = new Date(s);
  limit.setMonth(limit.getMonth() + 1);
  return e < limit;
}

export function safetyScaleHint(input: SafetyScaleInput): SafetyScaleHint {
  const amount = Number(input.amount || 0);
  const civil = isCivilConstruction(input.constructionType);
  const dedicatedLine = civil ? 150 * EOK : 120 * EOK;
  const guidanceCap = dedicatedLine;
  const appointmentFloor = input.relationSubcontractor ? 100 * EOK : 50 * EOK;
  const shortPeriod = constructionPeriodUnderOneMonth(input.periodStart, input.periodEnd);

  if (!amount || amount <= 0) {
    const empty = '도급금액을 입력하면 선임 규모와 기술지도 대상을 볼 수 있습니다.';
    return { hasAmount: false, appointment: empty, technicalGuidance: empty };
  }

  let appointment: string;
  if (amount < appointmentFloor) {
    appointment = '이 금액대는 안전관리자 선임 참고 대상이 아닙니다.';
  } else if (amount < 800 * EOK) {
    appointment = amount >= dedicatedLine
      ? '안전관리자 1명 이상 · 전담 참고'
      : '안전관리자 1명 이상 참고';
  } else if (amount < 1500 * EOK) {
    appointment = '안전관리자 2명 이상 참고 (공사 전·후 15% 기간은 1명 참고)';
  } else if (amount < 2200 * EOK) {
    appointment = '안전관리자 3명 이상 참고 (공사 전·후 15% 기간은 2명 참고)';
  } else {
    appointment = '2,200억원 이상은 별표 3 추가 구간입니다. 인원은 관할 기준으로 확인하세요.';
  }

  let technicalGuidance: string;
  if (shortPeriod === true) {
    technicalGuidance = '공사기간 1개월 미만은 기술지도 대상에서 빠지는 참고입니다.';
  } else if (amount >= EOK && amount < guidanceCap) {
    technicalGuidance = '기술지도 계약 대상 참고 (시행령 제59조). 전담 안전관리자 선임, 섬 지역, 유해위험방지계획서 대상은 제외될 수 있습니다.';
    if (shortPeriod === null) {
      technicalGuidance += ' 기간을 입력하면 1개월 미만 제외를 같이 봅니다.';
    }
  } else if (amount >= guidanceCap) {
    technicalGuidance = '이 금액대는 기술지도 금액 구간 밖입니다.';
  } else {
    technicalGuidance = '1억원 미만은 금액 기준 기술지도 대상이 아닙니다. 건축허가 대상이면 별도 확인이 필요합니다.';
  }

  return { hasAmount: true, appointment, technicalGuidance };
}
