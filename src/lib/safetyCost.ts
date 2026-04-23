export const SAFETY_COST_CATEGORIES = [
  { code: '1', name: '안전·보건관리자 임금 등', keywords: ['안전관리자', '보건관리자', '안전보건관리담당자', '임금', '급여', '수당', '인건비', '업무수행비'] },
  { code: '2', name: '안전시설비 등', keywords: ['안전난간', '추락방호망', '낙하물방지망', '방호선반', '개구부', '표지판', '안전시설', '휀스', '울타리', '덮개', '안전통로', '가설전기', '접지', '누전차단기', '안전가설'] },
  { code: '3', name: '보호구 등', keywords: ['안전모', '안전화', '안전대', '보안경', '방진마스크', '방독마스크', '장갑', '보호구', '귀마개', '보호복', '송기마스크', '안면보호구'] },
  { code: '4', name: '안전보건진단비 등', keywords: ['진단', '점검', '측정', '컨설팅', '위험성평가 컨설팅', '유해위험방지계획서', '안전점검', '정밀안전'] },
  { code: '5', name: '안전보건교육비 등', keywords: ['교육', '교재', '강사', 'VR', '체험교육', '특별교육', '정기교육', '신규채용자교육', '관리감독자교육', '교육장'] },
  { code: '6', name: '근로자 건강장해 예방비 등', keywords: ['건강진단', '작업환경측정', '휴게시설', '그늘막', '냉방', '온열질환', '응급', '구급', '제세동기', 'AED', '음수대', '분진', '소음'] },
  { code: '7', name: '건설재해예방 전문지도기관 기술지도비', keywords: ['기술지도', '재해예방', '전문지도기관'] },
  { code: '8', name: '본사 전담조직 근로자 임금 등', keywords: ['본사', '전담조직'] },
  { code: '9', name: '위험성평가 등에 따른 소요비용', keywords: ['위험성평가', '개선대책', '유해위험요인', '평가회의'] },
] as const;

const WARNING_KEYWORDS = ['일반공구', '공구', '소모품', '사무용품', '복리후생', '간식', '식대', '회식', '유류', '장비임대', '자재', '철근', '레미콘', '노무비', '청소', '폐기물', '통신비', '교통비'];
const REVIEW_KEYWORDS = ['수리', '보수', '임대', '운반', '설치비', '철거', '혼합', '세트', '기타', '잡자재'];

export type SafetyCostClassificationStatus = 'usable' | 'warning' | 'review';

export function classifySafetyCostItem(name: string) {
  const normalized = name.replace(/\s+/g, '').toLowerCase();
  const warningKeyword = WARNING_KEYWORDS.find((keyword) => normalized.includes(keyword.replace(/\s+/g, '').toLowerCase()));
  if (warningKeyword) {
    return {
      category_code: '',
      category_name: '사용 불가 검토',
      classification_status: 'warning' as SafetyCostClassificationStatus,
      ai_reason: `“${warningKeyword}”은 산업재해 예방 목적 직접 비용으로 보기 어려워 사용 불가 가능성이 높습니다.`,
      legal_basis: '건설업 산업안전보건관리비 계상 및 사용기준 제7조 사용기준 및 목적 외 사용 제한',
    };
  }

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

  const reviewKeyword = REVIEW_KEYWORDS.find((keyword) => normalized.includes(keyword.replace(/\s+/g, '').toLowerCase()));
  if (reviewKeyword) {
    return {
      category_code: match.code,
      category_name: match.name,
      classification_status: 'review' as SafetyCostClassificationStatus,
      ai_reason: `품목명은 “${match.name}”에 해당할 수 있으나 “${reviewKeyword}” 비용 성격이 포함되어 증빙 검토가 필요합니다.`,
      legal_basis: '건설업 산업안전보건관리비 계상 및 사용기준 제7조 및 별표 사용가능 항목',
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

export function analyzeSafetyCostCompliance(items: Array<{ amount?: number | string | null; classification_status?: string | null; legal_basis?: string | null }>, totalBudget?: number | string | null) {
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const warningCount = items.filter((item) => item.classification_status === 'warning').length;
  const reviewCount = items.filter((item) => item.classification_status === 'review').length;
  const missingBasisCount = items.filter((item) => !item.legal_basis).length;
  const budget = Number(totalBudget || 0);
  const rate = budget > 0 ? Math.round((total / budget) * 100) : 0;
  const issues = [
    warningCount > 0 && `사용 불가 가능 항목 ${warningCount}건`,
    reviewCount > 0 && `검토 필요 항목 ${reviewCount}건`,
    missingBasisCount > 0 && `법적 근거 누락 ${missingBasisCount}건`,
    budget > 0 && rate < 50 && '누계 사용률 50% 미만',
    budget > 0 && rate > 100 && '계상된 산업안전보건관리비 초과',
  ].filter(Boolean) as string[];

  return { total, rate, warningCount, reviewCount, missingBasisCount, issues, verdict: issues.length ? '검토 필요' : '적정' };
}

export function formatKRW(value: number | string | null | undefined) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);
}

export function getSafetyCostStatusLabel(status: string) {
  const map: Record<string, string> = { draft: '작성중', submitted: '결재중', approved: '승인완료', rejected: '반려' };
  return map[status] || status;
}
