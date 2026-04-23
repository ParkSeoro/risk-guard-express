export const SAFETY_COST_CATEGORIES = [
  { code: '1', name: '안전·보건관리자 임금 등', keywords: ['안전관리자', '보건관리자', '임금', '급여', '수당', '인건비'] },
  { code: '2', name: '안전시설비 등', keywords: ['안전난간', '추락방호망', '낙하물방지망', '방호선반', '개구부', '표지판', '안전시설', '휀스', '울타리'] },
  { code: '3', name: '보호구 등', keywords: ['안전모', '안전화', '안전대', '보안경', '방진마스크', '방독마스크', '장갑', '보호구', '귀마개'] },
  { code: '4', name: '안전보건진단비 등', keywords: ['진단', '점검', '측정', '컨설팅', '위험성평가 컨설팅'] },
  { code: '5', name: '안전보건교육비 등', keywords: ['교육', '교재', '강사', 'VR', '체험교육', '특별교육', '정기교육'] },
  { code: '6', name: '근로자 건강장해 예방비 등', keywords: ['건강진단', '작업환경측정', '휴게시설', '그늘막', '냉방', '온열질환', '응급'] },
  { code: '7', name: '건설재해예방 전문지도기관 기술지도비', keywords: ['기술지도', '재해예방', '전문지도기관'] },
  { code: '8', name: '본사 전담조직 근로자 임금 등', keywords: ['본사', '전담조직'] },
  { code: '9', name: '위험성평가 등에 따른 소요비용', keywords: ['위험성평가', '개선대책', '유해위험요인', '평가회의'] },
] as const;

export type SafetyCostClassificationStatus = 'usable' | 'warning' | 'review';

export function classifySafetyCostItem(name: string) {
  const normalized = name.replace(/\s+/g, '').toLowerCase();
  const match = SAFETY_COST_CATEGORIES.find((cat) =>
    cat.keywords.some((keyword) => normalized.includes(keyword.replace(/\s+/g, '').toLowerCase()))
  );

  if (!match) {
    return {
      category_code: '',
      category_name: '검토 필요',
      classification_status: 'review' as SafetyCostClassificationStatus,
      ai_reason: '자동 키워드 분류 기준에 명확히 일치하지 않아 산업안전보건관리비 사용 가능 여부 검토가 필요합니다.',
      legal_basis: '건설업 산업안전보건관리비 계상 및 사용기준',
    };
  }

  return {
    category_code: match.code,
    category_name: match.name,
    classification_status: 'usable' as SafetyCostClassificationStatus,
    ai_reason: `품목명이 “${match.name}” 관련 키워드와 일치합니다.`,
    legal_basis: '건설업 산업안전보건관리비 계상 및 사용기준 제7조 및 별표 사용가능 항목',
  };
}

export function formatKRW(value: number | string | null | undefined) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);
}

export function getSafetyCostStatusLabel(status: string) {
  const map: Record<string, string> = { draft: '작성중', submitted: '결재중', approved: '승인완료', rejected: '반려' };
  return map[status] || status;
}
