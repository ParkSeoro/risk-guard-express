/**
 * 표준 SF003 허가서 양식(내장 DigPermitForm)의 열 너비 · 폰트 · 라벨을
 * 마스터가 프로젝트별로 조정할 수 있게 해주는 스타일 계층.
 *
 * 값은 permit_form_templates.layout_json.standard_style / standard_labels 에 저장된다.
 * DigPermitForm 은 이 객체를 받아 <colgroup> 및 CSS 변수에 반영한다.
 */
import type { PermitType } from '@/components/permits/DigPermitForm';

export type PermitTypeKey = 'general' | 'confined_space' | 'hot_work' | 'excavation';

export interface StandardStyle {
  /** 테이블 열 폭(px). 'auto' 는 잔여 폭 자동 배분. */
  columns: Partial<Record<PermitTypeKey, (number | 'auto')[]>>;
  /** 본문 기본 폰트(pt) — 화면/인쇄 공통 */
  bodyFontPt?: number;
  /** 제목(안전작업허가서 등) 폰트(pt) */
  titleFontPt?: number;
  /** 안전조치 요구사항 내부 라벨 폰트(pt) */
  smallFontPt?: number;
}

export interface StandardLabels {
  /** 승인업체명 (기본: "에어리퀴드") */
  approverCompany?: string;
  /** 문서번호 접두사 (기본: "MD-000000-SF003") */
  docNoPrefix?: string;
}

export const DEFAULT_STANDARD_STYLE: StandardStyle = {
  columns: {
    // general 헤더: [공사업체 라벨, 값, 승인업체 라벨, 승인업체 값, 검토일, 승인일]
    general: [110, 160, 110, 'auto', 100, 100],
    // confined/hot: [라벨, 소속, 성명, 서명]
    confined_space: [100, 'auto', 'auto', 120],
    hot_work: [100, 'auto', 'auto', 120],
    excavation: [100, 'auto', 'auto', 120],
  },
  bodyFontPt: 10,
  titleFontPt: 18,
  smallFontPt: 9,
};

export const DEFAULT_STANDARD_LABELS: StandardLabels = {
  approverCompany: '에어리퀴드',
  docNoPrefix: 'MD-000000-SF003',
};

export function mergeStandardStyle(saved?: Partial<StandardStyle> | null): StandardStyle {
  const s = saved || {};
  return {
    columns: { ...DEFAULT_STANDARD_STYLE.columns, ...(s.columns || {}) },
    bodyFontPt: s.bodyFontPt ?? DEFAULT_STANDARD_STYLE.bodyFontPt,
    titleFontPt: s.titleFontPt ?? DEFAULT_STANDARD_STYLE.titleFontPt,
    smallFontPt: s.smallFontPt ?? DEFAULT_STANDARD_STYLE.smallFontPt,
  };
}

export function mergeStandardLabels(saved?: Partial<StandardLabels> | null): StandardLabels {
  const s = saved || {};
  return {
    approverCompany: s.approverCompany ?? DEFAULT_STANDARD_LABELS.approverCompany,
    docNoPrefix: s.docNoPrefix ?? DEFAULT_STANDARD_LABELS.docNoPrefix,
  };
}

/** 각 permit_type 별 열 슬롯 라벨 (디자이너 UI 용) */
export const COLUMN_LABELS: Record<PermitTypeKey, string[]> = {
  general: ['① 공사업체 라벨', '② 공사업체 값/서명', '③ 승인업체 라벨', '④ 승인업체 값', '⑤ 검토일', '⑥ 승인일'],
  confined_space: ['① 라벨(신청인 등)', '② 소속', '③ 성명', '④ 서명'],
  hot_work: ['① 라벨(신청인 등)', '② 소속', '③ 성명', '④ 서명'],
  excavation: ['① 라벨(신청인 등)', '② 소속', '③ 성명', '④ 서명'],
};

export const PERMIT_TYPE_LABEL: Record<PermitTypeKey, string> = {
  general: '일반',
  confined_space: '밀폐공간',
  hot_work: '화기',
  excavation: '굴착·중장비',
};

/** DigPermitForm 렌더링 시 사용할 colgroup width 문자열 */
export function colWidthCss(width: number | 'auto'): string | undefined {
  return width === 'auto' ? undefined : `${width}px`;
}

// re-export for convenience
export type { PermitType };
