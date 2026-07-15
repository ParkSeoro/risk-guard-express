/**
 * 용어 표준화 사전
 * 건설현장 위험성평가 시스템 전체에서 사용되는 용어 오류를 자동 교정
 */

const TERM_CORRECTIONS: [RegExp, string][] = [
  [/굴삭기/g, '굴착기'],
  [/굴삭/g, '굴착'],
  [/중장비/g, '건설기계'],
  [/안전그물/g, '안전방망'],
  [/작업공정/g, '공정'],
  [/리스크/g, '위험요인'],
  [/Risk/gi, '위험요인'],
  [/해자드/g, '위험요인'],
  [/하자드/g, '위험요인'],
  [/안전모자/g, '안전모'],
  [/안전화(?!물)/g, '안전화'],
  [/포크레인/g, '굴착기'],
  [/백호/g, '굴착기'],
  [/유압쇼벨/g, '굴착기'],
  [/써포트/g, '서포트'],
  [/비계(?:발판)?작업/g, '비계작업'],
  [/가설(?:구조)?발판/g, '가설발판'],
  [/화재폭발/g, '화재·폭발'],
  [/추락재해/g, '추락'],
  [/낙하(?:물)?재해/g, '낙하물'],
  [/감전재해/g, '감전'],
  [/협착재해/g, '협착'],
  [/전도재해/g, '전도'],
  [/붕괴재해/g, '붕괴'],
];

/**
 * 문자열에서 잘못된 용어를 표준 용어로 교정
 */
export function correctTerms(text: string): string {
  if (!text) return text;
  let result = text;
  for (const [pattern, replacement] of TERM_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * 객체의 문자열 필드들을 일괄 교정
 */
export function correctItemTerms<T extends Record<string, any>>(item: T, fields: string[]): T {
  const corrected = { ...item };
  for (const field of fields) {
    if (typeof corrected[field] === 'string') {
      (corrected as any)[field] = correctTerms(corrected[field]);
    }
  }
  return corrected;
}

/** 위험성평가 항목에서 교정할 필드 목록 */
export const RISK_ITEM_TEXT_FIELDS = [
  'process', 'sub_task', 'hazard', 'hazard_situation',
  'existing_measure', 'improvement_measure', 'department', 'assignee', 'note',
];
