/**
 * 허가서/문서 양식 빌더 타입 정의
 * permit_form_templates.layout_json / print_overlay / signature_slots 구조의 SSOT.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'daterange'
  | 'time'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'checkbox_group'
  | 'table'
  | 'signature'
  | 'attachment'
  | 'auto';

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  width?: 1 | 2 | 3 | 4;
  placeholder?: string;
  options?: { value: string; label: string }[];
  rows?: number;
  columns?: { key: string; label: string; type?: 'text' | 'number' }[];
  signatureRole?: string;
  autoSource?:
    | 'today'
    | 'permit_date'
    | 'creator_name'
    | 'creator_company'
    | 'project_name'
    | 'project_owner';
  hint?: string;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
}

export interface FormHeader {
  title: string;
  doc_no?: string;
  rev?: string;
  issuer?: string;
  issuer_label?: string;
}

export interface FormLayout {
  header: FormHeader;
  sections: FormSection[];
}

// ────────────────── 인쇄 오버레이 ──────────────────

export type OverlayRenderKind = 'text' | 'check' | 'signature' | 'image';

export interface OverlayBox {
  id: string;
  field_key: string;
  page: number;
  x: number; // 0~1 normalized
  y: number;
  w: number;
  h: number;
  render: OverlayRenderKind;
  font_size?: number;
  align?: 'left' | 'center' | 'right';
  check_when?: string | boolean;
  ai_generated?: boolean; // AI가 자동 생성한 박스인지
  label_hint?: string; // AI가 인식한 원본 라벨 (툴팁용)
}

export interface OverlayPage {
  page: number;
  boxes: OverlayBox[];
}

export interface PrintOverlay {
  pages: OverlayPage[];
}

// ────────────────── 서명 슬롯 (결재라인 자동 매핑용) ──────────────────

export type SignatureRole =
  | 'creator'        // 작성자
  | 'contractor_pic' // 협력사 담당
  | 'sm'             // 안전관리자
  | 'site_director'  // 현장대리인
  | 'pm'             // 프로젝트 관리자
  | 'client'         // 발주처
  | 'master'         // 최종승인
  | 'custom';

export interface SignatureSlot {
  id: string;
  role: SignatureRole;
  label: string;          // 원본 양식의 라벨 (예: "안전관리자", "현장대리인")
  page: number;
  x: number;              // 0~1 normalized
  y: number;
  w: number;
  h: number;
  order: number;          // 결재 순서 (1부터)
  render_name?: boolean;  // 이름도 함께 표시
  render_date?: boolean;  // 승인일 표시
}

// ────────────────── AI 자동 분석 결과 ──────────────────

export interface AIAnalysisField {
  label: string;
  type: FieldType;
  page: number;
  bbox: [number, number, number, number]; // x,y,w,h (0~1)
}
export interface AIAnalysisCheckbox {
  label: string;
  page: number;
  bbox: [number, number, number, number];
}
export interface AIAnalysisSignature {
  label: string;
  role_hint: SignatureRole;
  page: number;
  bbox: [number, number, number, number];
}
export interface AIAnalysisResult {
  fields: AIAnalysisField[];
  checkboxes: AIAnalysisCheckbox[];
  signatures: AIAnalysisSignature[];
  detected_title?: string;
  page_count?: number;
}

// ────────────────── 기본값 ──────────────────

export const EMPTY_LAYOUT: FormLayout = {
  header: { title: '새 양식', doc_no: '', rev: 'Rev.0' },
  sections: [],
};

export const EMPTY_OVERLAY: PrintOverlay = { pages: [] };

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '한 줄 텍스트',
  textarea: '여러 줄 텍스트',
  number: '숫자',
  date: '날짜',
  daterange: '날짜 범위',
  time: '시간',
  select: '드롭다운',
  radio: '라디오 (단일 선택)',
  checkbox: '체크박스 (단일)',
  checkbox_group: '체크박스 그룹',
  table: '표',
  signature: '서명란',
  attachment: '첨부파일',
  auto: '자동값',
};

export const SIGNATURE_ROLE_LABELS: Record<SignatureRole, string> = {
  creator: '작성자',
  contractor_pic: '협력사 담당자',
  sm: '안전관리자',
  site_director: '현장대리인',
  pm: '프로젝트 관리자',
  client: '발주처',
  master: '최종승인',
  custom: '직접지정',
};

// 오버레이 박스 렌더 종류 → 편집기 색상
export const RENDER_COLORS: Record<OverlayRenderKind, { border: string; bg: string; label: string }> = {
  text:      { border: 'border-blue-500',   bg: 'bg-blue-500/10',   label: 'bg-blue-500' },
  check:     { border: 'border-emerald-500', bg: 'bg-emerald-500/10', label: 'bg-emerald-500' },
  signature: { border: 'border-orange-500', bg: 'bg-orange-500/10', label: 'bg-orange-500' },
  image:     { border: 'border-purple-500', bg: 'bg-purple-500/10', label: 'bg-purple-500' },
};

export function newField(type: FieldType, idx: number): FormField {
  const base: FormField = {
    key: `field_${Date.now().toString(36)}_${idx}`,
    label: FIELD_TYPE_LABELS[type],
    type,
    width: 2,
  };
  if (type === 'select' || type === 'radio' || type === 'checkbox_group') {
    base.options = [
      { value: 'opt1', label: '항목 1' },
      { value: 'opt2', label: '항목 2' },
    ];
  }
  if (type === 'textarea') base.rows = 3;
  if (type === 'table') {
    base.columns = [
      { key: 'col1', label: '항목', type: 'text' },
      { key: 'col2', label: '내용', type: 'text' },
    ];
  }
  if (type === 'signature') base.signatureRole = 'contractor_pic';
  if (type === 'auto') base.autoSource = 'today';
  return base;
}

export function newSection(idx: number): FormSection {
  return {
    id: `sec_${Date.now().toString(36)}_${idx}`,
    title: `섹션 ${idx + 1}`,
    fields: [],
  };
}

/** 두 박스가 얼마나 겹치는지 (0~1, 작은 박스 기준) */
export function overlapRatio(a: { x: number; y: number; w: number; h: number }, b: typeof a): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? inter / smaller : 0;
}
