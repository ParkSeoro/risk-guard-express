/**
 * 산안비 실무 증빙 패키지 SSOT
 * 근거: 고용노동부 고시 별지 제1호 + 현장 승인본(하이테크 7월 사용내역서) TOC
 */

export type EvidenceKind =
  | 'transaction' // 거래명세서
  | 'tax_invoice' // 세금계산서
  | 'site_photo' // 사진대지
  | 'certificate' // 안전인증서 등
  | 'ppe_ledger' // 보호구 지급대장 (파일 또는 시스템 대장)
  | 'payroll' // 급여/이체
  | 'appointment' // 선임·지정
  | 'education_log' // 교육일지·명단
  | 'report' // 결과보고서/지도일지
  | 'other';

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  transaction: '거래명세서',
  tax_invoice: '세금계산서',
  site_photo: '사진대지',
  certificate: '인증서/성적서',
  ppe_ledger: '보호구 지급대장',
  payroll: '급여·이체 증빙',
  appointment: '선임·지정 서류',
  education_log: '교육일지·명단',
  report: '결과서·지도일지',
  other: '기타 증빙',
};

export type PackRequirement = {
  kind: EvidenceKind;
  label: string;
  /** true면 해당 비목에 금액이 있을 때 상신 차단 */
  hard: boolean;
};

export type CategoryPack = {
  code: string;
  name: string;
  requirements: PackRequirement[];
  tips: string[];
  /** 출력/철 순서 (작을수록 앞) */
  bindOrder: number;
};

/** 비목별 필수·권장 증빙 (금액>0일 때 적용) */
export const CATEGORY_EVIDENCE_PACK: CategoryPack[] = [
  {
    code: '1',
    name: '안전·보건관리자 임금 등',
    bindOrder: 10,
    requirements: [
      { kind: 'payroll', label: '급여명세서/이체증', hard: true },
      { kind: 'appointment', label: '선임·지정 서류', hard: true },
      { kind: 'other', label: '근무확인서/근무일지', hard: false },
    ],
    tips: ['현장 기능공 노무비와 구분', '8번 본사 전담과 중복 금지'],
  },
  {
    code: '2',
    name: '안전시설비 등',
    bindOrder: 20,
    requirements: [
      { kind: 'site_photo', label: '안전시설물 사진대지', hard: true },
      { kind: 'transaction', label: '거래명세서', hard: true },
      { kind: 'tax_invoice', label: '세금계산서', hard: true },
      { kind: 'certificate', label: '인증서(해당 시)', hard: false },
    ],
    tips: ['설치 위치·수량이 사진에 보이도록', '일반 가설재·공사 자재 제외'],
  },
  {
    code: '3',
    name: '보호구 등',
    bindOrder: 30,
    requirements: [
      { kind: 'site_photo', label: '보호구 사진대지', hard: true },
      { kind: 'certificate', label: '안전인증서', hard: false },
      { kind: 'ppe_ledger', label: '보호구 지급대장(수령 서명)', hard: true },
      { kind: 'transaction', label: '거래명세서', hard: true },
      { kind: 'tax_invoice', label: '세금계산서', hard: true },
    ],
    tips: ['구매만으로는 부족 — 누구에게 지급했는지 서명 필수', '작업용 일반 공구·작업복만인 경우 제외 검토'],
  },
  {
    code: '4',
    name: '안전보건진단비 등',
    bindOrder: 40,
    requirements: [
      { kind: 'transaction', label: '계약/견적·거래명세', hard: true },
      { kind: 'tax_invoice', label: '세금계산서', hard: true },
      { kind: 'report', label: '진단·점검 결과보고서', hard: true },
    ],
    tips: ['수행기관·목적 명시'],
  },
  {
    code: '5',
    name: '안전보건교육비 등',
    bindOrder: 50,
    requirements: [
      { kind: 'site_photo', label: '교육 사진대지', hard: false },
      { kind: 'education_log', label: '교육일지·참석명단', hard: true },
      { kind: 'transaction', label: '거래명세서/영수증', hard: true },
      { kind: 'tax_invoice', label: '세금계산서(해당 시)', hard: false },
    ],
    tips: ['회식·간식비는 교육비로 보기 어려움'],
  },
  {
    code: '6',
    name: '근로자 건강장해 예방비 등',
    bindOrder: 60,
    requirements: [
      { kind: 'site_photo', label: '시설·물품 사진대지', hard: true },
      { kind: 'transaction', label: '거래명세서', hard: true },
      { kind: 'tax_invoice', label: '세금계산서', hard: true },
    ],
    tips: ['복리후생·식대와 구분 (생수·음료만 있는 경우 검토)'],
  },
  {
    code: '7',
    name: '건설재해예방 전문지도기관 기술지도비',
    bindOrder: 70,
    requirements: [
      { kind: 'report', label: '기술지도 계약·지도일지', hard: true },
      { kind: 'tax_invoice', label: '세금계산서', hard: true },
    ],
    tips: [
      '2022.8.18 이후 계약의무 주체가 발주자 등으로 변경 — 해당 없으면 0원·사용내역 없음으로 두는 것이 일반적',
    ],
  },
  {
    code: '8',
    name: '본사 전담조직 근로자 임금 등',
    bindOrder: 80,
    requirements: [
      { kind: 'appointment', label: '전담조직 구성·업무분장', hard: true },
      { kind: 'payroll', label: '급여명세서/이체증', hard: true },
    ],
    tips: ['총액의 한도·1번과 중복 금지'],
  },
  {
    code: '9',
    name: '위험성평가 등에 따른 소요비용',
    bindOrder: 90,
    requirements: [
      { kind: 'site_photo', label: '조치 전·후 사진대지', hard: false },
      { kind: 'report', label: '위험성평가/개선 기록', hard: true },
      { kind: 'transaction', label: '거래명세서', hard: true },
      { kind: 'tax_invoice', label: '세금계산서', hard: true },
    ],
    tips: ['일반 공사비·생산설비비와 구분'],
  },
];

/** 철 순서(TOC) — 출력/감사 대응 */
export const EVIDENCE_BIND_TOC = [
  { id: 'summary', title: '1. 산업안전보건관리비 사용내역서(총괄)' },
  { id: 'monthly', title: '2. 월별 집계표' },
  { id: 'company', title: '3. 업체별 집계표' },
  { id: 'evidence_calc', title: '4. 증빙서류 목록' },
  { id: 'by_category', title: '5. 항목별 사용내역 + 증빙(1~9)' },
] as const;

export type EvidenceFileLike = {
  item_id?: string | null;
  report_id?: string | null;
  evidence_kind?: string | null;
  category_code?: string | null;
};

export type ItemLike = {
  id: string;
  category_code?: string | null;
  category_name?: string | null;
  amount?: number | string | null;
  classification_status?: string | null;
  item_name?: string | null;
};

export type PackCheckRow = {
  code: string;
  name: string;
  amount: number;
  requirement: PackRequirement;
  ok: boolean;
  count: number;
};

export function sumByCategory(items: ItemLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const code = String(it.category_code || '');
    if (!code) continue;
    out[code] = (out[code] || 0) + Number(it.amount || 0);
  }
  return out;
}

/**
 * 보고서 단위 증빙 종류 집계.
 * item에 붙은 파일 + report 단위(item_id null) 파일 모두 반영.
 * category_code가 파일에 없으면 item을 통해 추론.
 */
export function countKindsByCategory(
  items: ItemLike[],
  files: EvidenceFileLike[],
): Record<string, Record<string, number>> {
  const itemCat = new Map(items.map((i) => [i.id, String(i.category_code || '')]));
  const out: Record<string, Record<string, number>> = {};
  for (const f of files) {
    const kind = String(f.evidence_kind || 'other');
    let cat = String(f.category_code || '');
    if (!cat && f.item_id) cat = itemCat.get(f.item_id) || '';
    if (!cat) continue;
    out[cat] = out[cat] || {};
    out[cat][kind] = (out[cat][kind] || 0) + 1;
  }
  return out;
}

export type CategoryReconcile = {
  code: string;
  name: string;
  usableTotal: number;
  statementLinkedTotal: number;
  difference: number;
  ok: boolean;
};

export function isPackEligibleItem(item: ItemLike): boolean {
  if (item.classification_status === "warning") return false;
  return Number(item.amount || 0) > 0 && Boolean(String(item.category_code || ""));
}

export function itemHasEvidenceKind(files: EvidenceFileLike[], itemId: string, kind: string) {
  return (files || []).some((f) => f.item_id === itemId && String(f.evidence_kind || "") === kind);
}

/** 비목 사용 가능 합 vs 거래명세가 연결된 줄 합. 1원 이내는 일치. */
export function reconcileCategoryTotals(
  items: ItemLike[],
  files: EvidenceFileLike[],
): CategoryReconcile[] {
  const eligible = items.filter(isPackEligibleItem);
  const out: CategoryReconcile[] = [];
  for (const pack of CATEGORY_EVIDENCE_PACK) {
    if (!pack.requirements.some((r) => r.kind === "transaction" && r.hard)) continue;
    const rows = eligible.filter((it) => String(it.category_code) === pack.code);
    const usableTotal = rows.reduce((s, it) => s + Number(it.amount || 0), 0);
    if (usableTotal <= 0) continue;
    const statementLinkedTotal = rows
      .filter((it) => itemHasEvidenceKind(files, it.id, "transaction"))
      .reduce((s, it) => s + Number(it.amount || 0), 0);
    const difference = Math.round((usableTotal - statementLinkedTotal) * 100) / 100;
    out.push({
      code: pack.code,
      name: pack.name,
      usableTotal,
      statementLinkedTotal,
      difference,
      ok: Math.abs(difference) <= 1,
    });
  }
  return out;
}

export function evaluateEvidencePack(input: {
  items: ItemLike[];
  files: EvidenceFileLike[];
  /** 시스템 보호구 지급대장에 서명된 수령 건수 */
  ppeLedgerSignedCount?: number;
  /** 승인본 이관 월 — 항목별 증빙 게이트 면제 */
  exempt?: boolean;
}): {
  rows: PackCheckRow[];
  hardMissing: PackCheckRow[];
  softMissing: PackCheckRow[];
  ready: boolean;
  exempt: boolean;
  eligibleItems: ItemLike[];
  reconcile: CategoryReconcile[];
} {
  if (input.exempt) {
    return {
      rows: [],
      hardMissing: [],
      softMissing: [],
      ready: true,
      exempt: true,
      eligibleItems: [],
      reconcile: [],
    };
  }
  const eligibleItems = input.items.filter(isPackEligibleItem);
  const amounts = sumByCategory(eligibleItems);
  const kindMap = countKindsByCategory(eligibleItems, input.files);
  const rows: PackCheckRow[] = [];

  for (const pack of CATEGORY_EVIDENCE_PACK) {
    const amount = amounts[pack.code] || 0;
    if (amount <= 0) continue;
    for (const req of pack.requirements) {
      let count = kindMap[pack.code]?.[req.kind] || 0;
      if (req.kind === "ppe_ledger" && (input.ppeLedgerSignedCount || 0) > 0) {
        count = Math.max(count, input.ppeLedgerSignedCount || 0);
      }
      rows.push({
        code: pack.code,
        name: pack.name,
        amount,
        requirement: req,
        ok: count > 0,
        count,
      });
    }
  }

  const hardMissing = rows.filter((r) => r.requirement.hard && !r.ok);
  const softMissing = rows.filter((r) => !r.requirement.hard && !r.ok);
  const reconcile = reconcileCategoryTotals(eligibleItems, input.files);
  return {
    rows,
    hardMissing,
    softMissing,
    ready: hardMissing.length === 0 && reconcile.every((r) => r.ok),
    exempt: false,
    eligibleItems,
    reconcile,
  };
}

export function getCategoryPack(code?: string | null): CategoryPack | null {
  if (!code) return null;
  return CATEGORY_EVIDENCE_PACK.find((p) => p.code === String(code)) || null;
}
