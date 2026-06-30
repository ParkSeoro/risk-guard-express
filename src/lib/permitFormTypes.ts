/**
 * 허가서/문서 양식 빌더 타입 정의
 * permit_form_templates.layout_json 구조와 print_overlay 구조의 SSOT.
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
  | 'auto'; // 자동값 (오늘날짜/시공사/작성자 등)

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  width?: 1 | 2 | 3 | 4; // 12-col grid에서 차지 폭 (1=3col, 2=6col, 3=9col, 4=12col)
  placeholder?: string;
  options?: { value: string; label: string }[]; // select/radio/checkbox_group
  rows?: number; // textarea
  // table 전용
  columns?: { key: string; label: string; type?: 'text' | 'number' }[];
  // signature 전용
  signatureRole?: string; // 예: 'contractor_pic', 'sm', 'site_director'
  // auto 전용
  autoSource?:
    | 'today'
    | 'permit_date'
    | 'creator_name'
    | 'creator_company'
    | 'project_name'
    | 'project_owner';
  // 도움말
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
  field_key: string; // 매핑 대상 필드 key (체크박스 그룹은 'field_key.option_value' 사용 가능)
  page: number; // 1-base
  x: number; // 0~1 normalized (페이지 좌상단 기준)
  y: number;
  w: number;
  h: number;
  render: OverlayRenderKind;
  font_size?: number; // text 전용 (pt), 기본 10
  align?: 'left' | 'center' | 'right';
  // checkbox 전용: 어떤 값일 때 체크할지
  check_when?: string | boolean;
}

export interface OverlayPage {
  page: number;
  boxes: OverlayBox[];
}

export interface PrintOverlay {
  pages: OverlayPage[];
}

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
