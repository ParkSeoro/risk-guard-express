/**
 * 프로젝트별 허가서「표시 양식」SSOT.
 *
 * 안전 원칙:
 * - form_data / signatures 키·결재·연장·종료 로직은 절대 바꾸지 않는다.
 * - display_template 은 화면 라벨·섹션 숨김만 담당한다.
 * - 템플릿이 없거나 비어 있으면 DigPermitForm 기본(하드코딩)과 100% 동일.
 */
import type { PermitType } from '@/components/permits/DigPermitForm';
import type { StandardLabels, StandardStyle } from '@/lib/permitStandardStyle';
import {
  DEFAULT_STANDARD_LABELS,
  DEFAULT_STANDARD_STYLE,
} from '@/lib/permitStandardStyle';

export type PermitDisplaySectionId =
  | 'header'
  | 'approval_matrix'
  | 'work_datetime'
  | 'work_summary'
  | 'attachments'
  | 'safety_checklist'
  | 'hazard_confirm'
  | 'gas_measurement'
  | 'site_confirm'
  | 'extension'
  | 'footer_notes'
  | 'cs_type'
  | 'cs_safety'
  | 'cs_gas'
  | 'hw_type'
  | 'hw_safety'
  | 'hw_gas'
  | 'ex_dims'
  | 'ex_equipment'
  | 'ex_underground'
  | 'ex_safety';

export interface PermitDisplaySectionDef {
  id: PermitDisplaySectionId;
  /** UI 표시명 */
  label: string;
  /** 적용 허가서 종류 (비우면 공통) */
  kinds: Array<PermitType | 'all'>;
  /** true 면 숨기기 불가 — 결재/핵심 일정/종료·연장 */
  locked: boolean;
  description?: string;
}

/** 숨기면 안 되는 섹션 (결재·핵심 일정·현장확인·연장) */
export const LOCKED_DISPLAY_SECTIONS: ReadonlySet<PermitDisplaySectionId> = new Set([
  'header',
  'approval_matrix',
  'work_datetime',
  'work_summary',
  'site_confirm',
  'extension',
]);

export const PERMIT_DISPLAY_SECTIONS: PermitDisplaySectionDef[] = [
  { id: 'header', label: '상단 제목·문서번호', kinds: ['all'], locked: true },
  { id: 'approval_matrix', label: '결재·서명란', kinds: ['all'], locked: true, description: '결재 규칙과 연동 — 숨길 수 없음' },
  { id: 'work_datetime', label: '작업일시', kinds: ['general'], locked: true },
  { id: 'work_summary', label: '작업명·내용·장소·인원', kinds: ['general'], locked: true },
  { id: 'attachments', label: '첨부서류 체크', kinds: ['general'], locked: false },
  { id: 'safety_checklist', label: '안전조치 체크리스트', kinds: ['general'], locked: false },
  { id: 'hazard_confirm', label: '위험작업 확인', kinds: ['general'], locked: false },
  { id: 'gas_measurement', label: '가스측정', kinds: ['general'], locked: false },
  { id: 'site_confirm', label: '작업완료·현장확인', kinds: ['general'], locked: true },
  { id: 'extension', label: '연장 작업', kinds: ['general'], locked: true },
  { id: 'footer_notes', label: '하단 안내문구', kinds: ['general'], locked: false },
  { id: 'cs_type', label: '밀폐 — 작업종류', kinds: ['confined_space'], locked: false },
  { id: 'cs_safety', label: '밀폐 — 안전조치', kinds: ['confined_space'], locked: false },
  { id: 'cs_gas', label: '밀폐 — 가스농도', kinds: ['confined_space'], locked: false },
  { id: 'hw_type', label: '화기 — 작업종류', kinds: ['hot_work'], locked: false },
  { id: 'hw_safety', label: '화기 — 안전조치', kinds: ['hot_work'], locked: false },
  { id: 'hw_gas', label: '화기 — 가스농도', kinds: ['hot_work'], locked: false },
  { id: 'ex_dims', label: '굴착 — 규모·공법', kinds: ['excavation'], locked: false },
  { id: 'ex_equipment', label: '굴착 — 중장비', kinds: ['excavation'], locked: false },
  { id: 'ex_underground', label: '굴착 — 지장물', kinds: ['excavation'], locked: false },
  { id: 'ex_safety', label: '굴착 — 안전조치', kinds: ['excavation'], locked: false },
];

/** 디자이너에서 편집 가능한 라벨 키 → 기본 문구 */
export const DEFAULT_DISPLAY_LABELS: Record<string, string> = {
  'general.title': '안전작업허가서',
  'confined_space.title': '밀폐공간 작업허가서',
  'hot_work.title': '화기작업허가서',
  'excavation.title': '굴착·중장비 작업허가서',
  'general.contractor': '공사업체',
  'general.approverCompany': '승인업체',
  'general.reviewDate': '검토일',
  'general.approveDate': '승인일',
  'general.workDatetime': '작업일시',
  'general.workName': '작업명',
  'general.workDescription': '작업내용',
  'general.workLocation': '작업장소',
  'general.personnel': '투입인원',
  'general.attachments': '첨부서류',
  'general.safetyChecklist': '안전조치 확인',
  'general.hazardConfirm': '위험작업 확인',
  'general.gasMeasurement': '가스측정',
  'general.siteConfirm': '작업완료 확인',
  'general.extension': '연장 작업',
  'general.footerNote': '※ 본 허가서는 당일 작업에 한하며, 작업 전 안전조치를 확인한 후 승인한다.',
  docNoPrefix: DEFAULT_STANDARD_LABELS.docNoPrefix || 'GEN-000000-SF003',
  approverCompany: DEFAULT_STANDARD_LABELS.approverCompany || 'Air Liquide Korea',
};

export interface PermitDisplayTemplate {
  version: 1;
  /** 라벨 키 → 표시 문구 (없는 키는 DigPermitForm 기본 문구) */
  labels: Record<string, string>;
  /** 숨길 섹션 id (locked 섹션은 런타임에서 무시) */
  hiddenSections: PermitDisplaySectionId[];
}

export interface PermitLayoutJson {
  standard_style?: Partial<StandardStyle> | null;
  standard_labels?: Partial<StandardLabels> | null;
  display_template?: PermitDisplayTemplate | null;
  /** legacy free-builder leftovers — ignored by DigPermitForm */
  header?: unknown;
  sections?: unknown;
}

export function emptyDisplayTemplate(): PermitDisplayTemplate {
  return {
    version: 1,
    labels: { ...DEFAULT_DISPLAY_LABELS },
    hiddenSections: [],
  };
}

export function normalizeDisplayTemplate(raw: unknown): PermitDisplayTemplate {
  const base = emptyDisplayTemplate();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as any;
  const labels: Record<string, string> = { ...DEFAULT_DISPLAY_LABELS };
  if (o.labels && typeof o.labels === 'object') {
    for (const [k, v] of Object.entries(o.labels)) {
      if (typeof v === 'string' && v.trim()) labels[k] = v;
    }
  }
  const hiddenRaw = Array.isArray(o.hiddenSections) ? o.hiddenSections : [];
  const hiddenSections = hiddenRaw
    .map((x: unknown) => String(x))
    .filter((id: string): id is PermitDisplaySectionId =>
      PERMIT_DISPLAY_SECTIONS.some((s) => s.id === id) && !LOCKED_DISPLAY_SECTIONS.has(id as PermitDisplaySectionId),
    );
  return { version: 1, labels, hiddenSections };
}

export function parseLayoutJson(raw: unknown): PermitLayoutJson {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as any;
  return {
    standard_style: o.standard_style ?? null,
    standard_labels: o.standard_labels ?? null,
    display_template: o.display_template
      ? normalizeDisplayTemplate(o.display_template)
      : null,
  };
}

export function buildCloneLayoutJson(): PermitLayoutJson {
  return {
    standard_style: { ...DEFAULT_STANDARD_STYLE },
    standard_labels: { ...DEFAULT_STANDARD_LABELS },
    display_template: emptyDisplayTemplate(),
  };
}

export function isSectionHidden(
  display: PermitDisplayTemplate | null | undefined,
  sectionId: PermitDisplaySectionId,
): boolean {
  if (!display) return false;
  if (LOCKED_DISPLAY_SECTIONS.has(sectionId)) return false;
  return display.hiddenSections.includes(sectionId);
}

export function displayLabel(
  display: PermitDisplayTemplate | null | undefined,
  key: string,
  fallback: string,
): string {
  const v = display?.labels?.[key];
  if (typeof v === 'string' && v.trim()) return v;
  const def = DEFAULT_DISPLAY_LABELS[key];
  if (typeof def === 'string' && def.trim() && fallback === def) return def;
  return fallback;
}

export function sectionsForKind(kind: PermitType): PermitDisplaySectionDef[] {
  return PERMIT_DISPLAY_SECTIONS.filter(
    (s) => s.kinds.includes('all') || s.kinds.includes(kind),
  );
}

export type PermitTemplateRow = {
  id: string;
  project_id: string | null;
  code: string;
  name: string;
  version: string;
  layout_json: unknown;
  is_default: boolean;
  is_active: boolean;
  permit_type: string | null;
};

/**
 * 프로젝트 전용 표시 양식만 고른다.
 * 없으면 null → DigPermitForm 내장 기본 (기존 동작 유지).
 */
export function pickProjectDisplayTemplate(
  list: PermitTemplateRow[],
  projectId: string | null | undefined,
  permitType: PermitType,
): PermitTemplateRow | null {
  if (!projectId) return null;
  const forProject = list.filter(
    (t) => t.project_id === projectId && t.is_active !== false,
  );
  if (forProject.length === 0) return null;

  const exactDefault = forProject.find(
    (t) => t.permit_type === permitType && t.is_default,
  );
  if (exactDefault) return exactDefault;

  const exact = forProject.find((t) => t.permit_type === permitType);
  if (exact) return exact;

  const generalDefault = forProject.find(
    (t) => (!t.permit_type || t.permit_type === 'general') && t.is_default,
  );
  if (generalDefault) return generalDefault;

  return forProject.find((t) => !t.permit_type || t.permit_type === 'general') || null;
}

export const PERMIT_KIND_CLONE_META: Array<{
  permit_type: PermitType;
  codeSuffix: string;
  name: string;
}> = [
  { permit_type: 'general', codeSuffix: 'GEN', name: '안전작업허가서 (표시양식)' },
  { permit_type: 'confined_space', codeSuffix: 'CS', name: '밀폐공간 작업허가서 (표시양식)' },
  { permit_type: 'hot_work', codeSuffix: 'HW', name: '화기작업허가서 (표시양식)' },
  { permit_type: 'excavation', codeSuffix: 'EX', name: '굴착·중장비 작업허가서 (표시양식)' },
];
