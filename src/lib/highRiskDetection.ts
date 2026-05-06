// 산업안전보건법 기준 고위험 작업 자동 식별
// 위험성평가의 risk_items 내용을 분석하여 고위험 작업 카테고리를 추출합니다.

export type HighRiskCategory =
  | '고소작업'
  | '중량물취급'
  | '밀폐공간'
  | '전기작업'
  | '용접화재'
  | '굴착작업';

interface CategoryRule {
  category: HighRiskCategory;
  keywords: string[];
  searchTerms: string[]; // accident_cases 테이블 검색용
}

export const HIGH_RISK_RULES: CategoryRule[] = [
  {
    category: '고소작업',
    keywords: ['고소', '추락', '비계', '사다리', '높이', '개구부', '난간', '작업발판', '2m', '고층'],
    searchTerms: ['추락', '고소작업', '비계'],
  },
  {
    category: '중량물취급',
    keywords: ['중량물', '인양', '양중', '크레인', '호이스트', '리프트', '하역', '낙하'],
    searchTerms: ['낙하', '중량물', '양중', '크레인'],
  },
  {
    category: '밀폐공간',
    keywords: ['밀폐', '맨홀', '탱크내부', '저장조', '산소결핍', '질식', '환기불량'],
    searchTerms: ['질식', '밀폐공간', '산소결핍'],
  },
  {
    category: '전기작업',
    keywords: ['전기', '감전', '활선', '배전', '분전반', '누전', '정전작업', '고압'],
    searchTerms: ['감전', '전기', '누전'],
  },
  {
    category: '용접화재',
    keywords: ['용접', '용단', '화재', '인화성', '가연성', '불티', '산소절단', '그라인더'],
    searchTerms: ['화재', '용접', '폭발'],
  },
  {
    category: '굴착작업',
    keywords: ['굴착', '터파기', '굴삭', '토사붕괴', '지반', '흙막이', '매설', '토류판'],
    searchTerms: ['붕괴', '굴착', '매몰'],
  },
];

export interface RiskItemLike {
  process?: string | null;
  sub_task?: string | null;
  hazard?: string | null;
  hazard_situation?: string | null;
}

export function detectHighRiskCategories(items: RiskItemLike[]): HighRiskCategory[] {
  if (!items || items.length === 0) return [];
  const text = items
    .map(i => `${i.process || ''} ${i.sub_task || ''} ${i.hazard || ''} ${i.hazard_situation || ''}`)
    .join(' ')
    .toLowerCase();

  const found = new Set<HighRiskCategory>();
  for (const rule of HIGH_RISK_RULES) {
    if (rule.keywords.some(k => text.includes(k.toLowerCase()))) {
      found.add(rule.category);
    }
  }
  return Array.from(found);
}

export function getSearchTermsForCategories(categories: HighRiskCategory[]): string[] {
  const terms = new Set<string>();
  for (const c of categories) {
    const rule = HIGH_RISK_RULES.find(r => r.category === c);
    rule?.searchTerms.forEach(t => terms.add(t));
  }
  return Array.from(terms);
}
