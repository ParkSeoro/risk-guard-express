/**
 * 표준 SF003 허가서 양식(내장 DigPermitForm) 스타일 계층.
 * 마스터가 프로젝트별 · 허가서 종류별로 다음을 조정 가능:
 * - 열 너비 (columns)
 * - 폰트 크기 (body/title/small)
 * - 로고 이미지 (logoUrl)
 * - 각 종류별 라벨 배경색 / 값 셀 배경색 / 테두리 / 강조 색상 / 행 높이
 *
 * 저장 위치: permit_form_templates.layout_json.standard_style / standard_labels
 * DigPermitForm 은 이 객체를 CSS 변수 + <colgroup> 로 주입한다.
 */
import type { PermitType } from '@/components/permits/DigPermitForm';

export type PermitTypeKey = 'general' | 'confined_space' | 'hot_work' | 'excavation';

export interface PermitTypeStyle {
  /** 헤더/라벨 셀 배경 (기본 #DCE6F1 — Rev.C 파란 라벨) */
  labelBg?: string;
  /** 값 셀 배경 */
  valueBg?: string;
  /** 테두리 색 */
  borderColor?: string;
  /** 강조 텍스트 색 (빨간 경고 문구 등) */
  emphasisColor?: string;
  /** 각 <tr> 최소 높이(px) */
  rowHeightPx?: number;
}

export interface StandardStyle {
  /** 테이블 열 폭(px). 'auto' 는 잔여 폭 자동 배분. */
  columns: Partial<Record<PermitTypeKey, (number | 'auto')[]>>;
  /** 본문 기본 폰트(pt) */
  bodyFontPt?: number;
  /** 제목 폰트(pt) */
  titleFontPt?: number;
  /** 작은 라벨 폰트(pt) */
  smallFontPt?: number;
  /** 좌상단 로고 URL (선택) */
  logoUrl?: string;
  /** 제목 정렬 */
  titleAlign?: 'left' | 'center' | 'right';
  /** 제목 색 */
  titleColor?: string;
  /** 허가서 종류별 색/행높이 오버라이드 */
  perType?: Partial<Record<PermitTypeKey, PermitTypeStyle>>;
}

export interface StandardLabels {
  /** 승인업체명 (기본: Rev.C 예시) */
  approverCompany?: string;
  /** 문서번호 접두사 */
  docNoPrefix?: string;
}

/** Rev.C 기본 색상 팔레트 (첨부 원본 SF003 참조) */
export const DEFAULT_TYPE_STYLE: PermitTypeStyle = {
  labelBg: '#DCE6F1',
  valueBg: '#FFFFFF',
  borderColor: '#000000',
  emphasisColor: '#C00000',
  rowHeightPx: 24,
};

export const DEFAULT_STANDARD_STYLE: StandardStyle = {
  columns: {
    general: [110, 160, 110, 'auto', 100, 100],
    confined_space: [100, 'auto', 'auto', 120],
    hot_work: [100, 'auto', 'auto', 120],
    excavation: [100, 'auto', 'auto', 120],
  },
  bodyFontPt: 10,
  titleFontPt: 18,
  smallFontPt: 9,
  logoUrl: '',
  titleAlign: 'center',
  titleColor: '#000000',
  perType: {
    general: { ...DEFAULT_TYPE_STYLE },
    confined_space: { ...DEFAULT_TYPE_STYLE },
    hot_work: { ...DEFAULT_TYPE_STYLE },
    excavation: { ...DEFAULT_TYPE_STYLE },
  },
};

export const DEFAULT_STANDARD_LABELS: StandardLabels = {
  approverCompany: 'Air Liquide Korea',
  docNoPrefix: 'GEN-000000-SF003',
};

export function mergeTypeStyle(saved?: Partial<PermitTypeStyle> | null): PermitTypeStyle {
  const s = saved || {};
  return {
    labelBg: s.labelBg ?? DEFAULT_TYPE_STYLE.labelBg,
    valueBg: s.valueBg ?? DEFAULT_TYPE_STYLE.valueBg,
    borderColor: s.borderColor ?? DEFAULT_TYPE_STYLE.borderColor,
    emphasisColor: s.emphasisColor ?? DEFAULT_TYPE_STYLE.emphasisColor,
    rowHeightPx: s.rowHeightPx ?? DEFAULT_TYPE_STYLE.rowHeightPx,
  };
}

export function mergeStandardStyle(saved?: Partial<StandardStyle> | null): StandardStyle {
  const s = saved || {};
  const perTypeSaved = s.perType || {};
  const perType: Record<PermitTypeKey, PermitTypeStyle> = {
    general: mergeTypeStyle(perTypeSaved.general),
    confined_space: mergeTypeStyle(perTypeSaved.confined_space),
    hot_work: mergeTypeStyle(perTypeSaved.hot_work),
    excavation: mergeTypeStyle(perTypeSaved.excavation),
  };
  return {
    columns: { ...DEFAULT_STANDARD_STYLE.columns, ...(s.columns || {}) },
    bodyFontPt: s.bodyFontPt ?? DEFAULT_STANDARD_STYLE.bodyFontPt,
    titleFontPt: s.titleFontPt ?? DEFAULT_STANDARD_STYLE.titleFontPt,
    smallFontPt: s.smallFontPt ?? DEFAULT_STANDARD_STYLE.smallFontPt,
    logoUrl: s.logoUrl ?? DEFAULT_STANDARD_STYLE.logoUrl,
    titleAlign: s.titleAlign ?? DEFAULT_STANDARD_STYLE.titleAlign,
    titleColor: s.titleColor ?? DEFAULT_STANDARD_STYLE.titleColor,
    perType,
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
