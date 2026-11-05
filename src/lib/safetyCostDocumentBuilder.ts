import { categoryTaxAllocationNotes } from '@/lib/safetyCostItemEvidence';
import {
  formatKRW,
  isSafetyCostLegacyImport,
  SAFETY_COST_CATEGORIES,
  sumSafetyCostByCategory,
} from '@/lib/safetyCost';

export type SafetyCostDocItem = {
  id?: string;
  category_code?: string | null;
  category_name?: string | null;
  amount?: number | string | null;
  item_name?: string | null;
  supplier_name?: string | null;
  is_deleted?: boolean | null;
};

export type SafetyCostDocFile = {
  id: string;
  item_id?: string | null;
  report_id?: string | null;
  evidence_kind: string;
  category_code?: string | null;
  note?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  mime_type?: string | null;
};

/** 예시 PDF의 1~14는 편철 번호다. 법령 비목 코드가 아니다. */
export const SAFETY_COST_BIND_NO: Record<string, number> = {
  '1': 3,
  '2': 4,
  '3': 5,
  '4': 9,
  '5': 10,
  '6': 11,
  '7': 12,
  '8': 13,
  '9': 14,
};

export type SafetyCostPrintScope = {
  cover: boolean;
  toc: boolean;
  summary: boolean;
  items: boolean;
  categorySheets: boolean;
  ledger: boolean;
  stock: boolean;
  originals: boolean;
};

export function defaultSafetyCostPrintScope(legacy: boolean): SafetyCostPrintScope {
  if (legacy) {
    return {
      cover: true, toc: false, summary: true, items: true,
      categorySheets: false, ledger: false, stock: false, originals: false,
    };
  }
  return {
    cover: true, toc: true, summary: true, items: true,
    categorySheets: true, ledger: true, stock: false, originals: false,
  };
}

export type SafetyCostSigner = {
  title: string;
  name: string;
  company: string;
  status: string;
  approvedAt: string;
};

export type SafetyCostLedgerRow = {
  item_name?: string | null;
  worker_name?: string | null;
  signature_data?: string | null;
  qty?: number | null;
  signed_at?: string | null;
};

export type SafetyCostStockMove = {
  movement_type?: string | null;
  item_name?: string | null;
  qty?: number | null;
  movement_date?: string | null;
  note?: string | null;
};

export type SafetyCostDocInput = {
  report: {
    id?: string;
    year_month?: string | null;
    status?: string | null;
    source?: string | null;
    cumulative_progress_rate?: number | null;
    safety_cost_total?: number | null;
    contract_amount?: number | null;
    construction_name?: string | null;
  };
  companyName?: string | null;
  companyAddress?: string | null;
  clientName?: string | null;
  items: SafetyCostDocItem[];
  files: SafetyCostDocFile[];
  /** 직전 확정 월까지의 비목별 누계. 없으면 당월만 쓴다. */
  priorByCategory?: Record<string, number>;
  ledger?: SafetyCostLedgerRow[];
  stock?: SafetyCostStockMove[];
  signers?: SafetyCostSigner[];
  /** 원본 전체 선택 때만 채운다. file id -> PNG data URL. */
  pageImages?: Record<string, string[]>;
  unopened?: string[];
};

const KIND_LABEL: Record<string, string> = {
  transaction: '거래명세서',
  tax_invoice: '세금계산서',
  site_photo: '현장 사진',
  certificate: '인증서',
  ppe_ledger: '지급대장',
  payroll: '급여',
  appointment: '선임',
  education_log: '교육',
  report: '결과·보고',
  other: '기타',
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '';
  return formatKRW(Number(value));
}

/** 공정률이 없으면 사용기준금액은 빈칸이다. 0으로 채우지 않는다. */
export function usageBasisAmount(
  progressRate: number | null | undefined,
  safetyCostTotal: number | null | undefined,
): number | null {
  if (progressRate == null || !Number.isFinite(Number(progressRate))) return null;
  return Math.round(Number(safetyCostTotal || 0) * Number(progressRate) / 100);
}

export function isInspectionPhoto(file: Pick<SafetyCostDocFile, 'evidence_kind' | 'note'>): boolean {
  if (file.evidence_kind !== 'site_photo') return false;
  const note = String(file.note || '');
  return note.includes('검수') || note.includes('반입');
}

export function upperPhotoCaption(files: SafetyCostDocFile[]): string {
  const hasTx = files.some((f) => f.evidence_kind === 'transaction');
  const hasInspect = files.some(isInspectionPhoto);
  if (hasTx && hasInspect) return '거래명세표/검수';
  if (hasTx) return '거래명세표';
  const first = files.find((f) => f.evidence_kind !== 'site_photo' && f.evidence_kind !== 'tax_invoice');
  return KIND_LABEL[first?.evidence_kind || ''] || '첨부';
}

export function lowerPhotoCaption(code: string, files: SafetyCostDocFile[]): string {
  const hasInspect = files.some(isInspectionPhoto);
  const hasDrawing = files.some((f) => String(f.note || '').includes('도면'));
  const hasEdu = files.some((f) => f.evidence_kind === 'education_log');
  const hasReport = files.some((f) => f.evidence_kind === 'report');
  if (code === '2') return hasDrawing ? '안전시설물 설치/위치도면' : '안전시설물 설치';
  if (code === '3') return hasInspect ? '보호구 검수' : '보호구 사진';
  if (code === '4') return '안전보건진단';
  if (code === '5') return hasEdu ? '이수증' : '교육 사진';
  if (code === '6') {
    if (hasReport) return '결과지';
    if (hasInspect) return '검수';
    return '사진';
  }
  if (code === '9') {
    if (hasReport && hasInspect) return '위험성평가표/검수';
    if (hasReport) return '위험성평가표';
    if (hasInspect) return '검수';
    return '사진';
  }
  return '사진';
}

export function ledgerPrintStatus(category3Amount: number, signatureCount: number): '해당 없음' | '미작성' | 'rows' {
  if (category3Amount <= 0) return '해당 없음';
  if (signatureCount <= 0) return '미작성';
  return 'rows';
}

export function stockMoveLabel(type: string | null | undefined): string {
  if (type === 'in') return '입고';
  if (type === 'out') return '출고';
  if (type === 'return') return '입고(반품)';
  if (type === 'dispose') return '출고(폐기)';
  return '조정 메모';
}

function filesForItem(files: SafetyCostDocFile[], itemId: string | undefined) {
  if (!itemId) return [];
  return files.filter((f) => f.item_id === itemId);
}

function uniqueTaxFiles(files: SafetyCostDocFile[], code: string, catItems: SafetyCostDocItem[]) {
  const itemIds = new Set(catItems.map((item) => item.id).filter(Boolean));
  const seen = new Set<string>();
  const out: SafetyCostDocFile[] = [];
  for (const file of files) {
    if (file.evidence_kind !== 'tax_invoice') continue;
    const inCategory = file.category_code === code || (!!file.item_id && itemIds.has(file.item_id));
    if (!inCategory) continue;
    const key = file.file_path || file.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

function vendorName(items: SafetyCostDocItem[]): string {
  const names = [...new Set(items.map((i) => String(i.supplier_name || '').trim()).filter(Boolean))];
  return names.length === 1 ? names[0] : '거래처 미상';
}

const CSS = `
@page { size: A4 portrait; margin: 10mm; }
@page landscape-page { size: A4 landscape; margin: 10mm; }
body { font-family: 'Malgun Gothic', sans-serif; color: #111; font-size: 11px; }
.sc-page { width: 190mm; min-height: 277mm; page-break-after: always; break-after: page; box-sizing: border-box; }
.sc-page.landscape { page: landscape-page; width: 277mm; min-height: 190mm; }
h1 { font-size: 18px; text-align: center; margin: 8px 0; }
h2 { font-size: 14px; margin: 8px 0; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #222; padding: 4px 6px; vertical-align: top; }
th { background: #f3f4f6; }
.note { border: 2px solid #1d4ed8; color: #1e3a8a; padding: 8px; margin-top: 8px; white-space: pre-wrap; }
.photo { max-width: 100%; max-height: 90mm; object-fit: contain; }
.muted { color: #4b5563; }
.sign td { height: 28mm; width: 33%; }
`;

function page(inner: string, landscape = false): string {
  return `<section class="sc-page${landscape ? ' landscape' : ''}">${inner}</section>`;
}

function imageOrName(file: SafetyCostDocFile, pageImages?: Record<string, string[]>): string {
  const pages = pageImages?.[file.id] || [];
  if (pages.length) {
    return pages.map((src) => `<div><img class="photo" src="${esc(src)}" alt="${esc(file.file_name)}" /></div>`).join('');
  }
  if (file.file_url && String(file.mime_type || '').startsWith('image/')) {
    return `<img class="photo" src="${esc(file.file_url)}" alt="${esc(file.file_name)}" />`;
  }
  return `<p class="muted">${esc(file.file_name || '파일')}</p>`;
}

export function buildSafetyCostDocument(input: SafetyCostDocInput, scope: SafetyCostPrintScope): {
  html: string;
  files: SafetyCostDocFile[];
} {
  const legacy = isSafetyCostLegacyImport(input.report.source);
  const active: SafetyCostPrintScope = legacy
    ? { ...scope, toc: false, categorySheets: false, ledger: false, stock: false, originals: false }
    : scope;
  const month = input.report.year_month || '';
  const items = input.items || [];
  const files = input.files || [];
  const current = sumSafetyCostByCategory(items);
  const prior = input.priorByCategory || {};
  const basis = usageBasisAmount(input.report.cumulative_progress_rate, input.report.safety_cost_total);
  const pages: string[] = [];

  if (active.cover) {
    const signs = (input.signers || [
      { title: '안전관리자', name: '', company: '', status: '', approvedAt: '' },
      { title: '안전보건관리책임자', name: '', company: '', status: '', approvedAt: '' },
      { title: '발주처/감리', name: '', company: '', status: '', approvedAt: '' },
    ]).slice(0, 3);
    pages.push(page(`
      <h1>산업안전보건관리비 사용내역서</h1>
      <p>${esc(month)} · ${esc(input.report.construction_name || '')}</p>
      <table>
        <tr><th>회사</th><td>${esc(input.companyName || '')}</td><th>주소</th><td>${esc(input.companyAddress || '')}</td></tr>
        <tr><th>발주처</th><td>${esc(input.clientName || '')}</td><th>공사기간</th><td></td></tr>
        <tr><th>도급금액</th><td>${money(input.report.contract_amount)}</td><th>계상된 안전관리비</th><td>${money(input.report.safety_cost_total)}</td></tr>
        <tr><th>누계 공정률</th><td>${input.report.cumulative_progress_rate == null ? '' : `${esc(input.report.cumulative_progress_rate)}%`}</td><th>사용기준금액</th><td>${basis == null ? '' : money(basis)}</td></tr>
      </table>
      <table class="sign" style="margin-top:8px">
        <tr>${signs.map((s) => `<th>${esc(s.title)}</th>`).join('')}</tr>
        <tr>${signs.map((s) => `<td>${esc(s.name)}<br/>${esc(s.company)}<br/>${esc(s.status)} ${esc(s.approvedAt)}</td>`).join('')}</tr>
      </table>
      ${legacy ? '<p>이관 월입니다. 증빙 원본은 이 출력에 포함하지 않습니다.</p>' : ''}
    `));
  }

  if (active.toc) {
    const lines = [
      '1. 사용내역 총괄',
      '2. 항목별 사용내역',
      ...SAFETY_COST_CATEGORIES.map((c) => `${SAFETY_COST_BIND_NO[c.code]}. ${c.name}`),
      '6. 보호구 수불 (선택)',
      '7. 개인보호구 지급대장',
      '8. 인증서 원본 (선택)',
    ];
    pages.push(page(`<h2>목차</h2><ol>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`));
  }

  if (active.summary) {
    const rows = SAFETY_COST_CATEGORIES.map((c) => {
      const cur = current[c.code] || 0;
      const acc = (prior[c.code] || 0) + cur;
      return `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${money(cur)}</td><td>${money(acc)}</td></tr>`;
    }).join('');
    pages.push(page(`<h2>1. 사용내역 총괄</h2><table><tr><th>코드</th><th>비목</th><th>당월</th><th>누계</th></tr>${rows}</table>`));
  }

  if (active.items) {
    const rows = items.map((item, i) => `<tr><td>${i + 1}</td><td>${esc(item.category_code)}</td><td>${esc(item.item_name)}</td><td>${esc(item.supplier_name || '')}</td><td>${money(Number(item.amount || 0))}</td></tr>`).join('');
    pages.push(page(`<h2>2. 항목별 사용내역</h2><table><tr><th>No</th><th>비목</th><th>항목</th><th>거래처</th><th>금액</th></tr>${rows || '<tr><td colspan="5">항목 없음</td></tr>'}</table>`));
  }

  if (active.categorySheets) {
    for (const cat of SAFETY_COST_CATEGORIES) {
      const catItems = items.filter((item) => item.category_code === cat.code);
      const amount = current[cat.code] || 0;
      const bind = SAFETY_COST_BIND_NO[cat.code];
      if (amount <= 0) {
        pages.push(page(`<h2>${bind}. ${esc(cat.name)}</h2><p>당월 사용내역 없음</p>`));
        continue;
      }
      if (cat.code === '1') {
        const wageFiles = files.filter((f) => f.evidence_kind !== 'tax_invoice' && (f.category_code === '1' || catItems.some((item) => item.id && f.item_id === item.id)));
        const ordered = [...wageFiles].sort((a, b) => {
          const rank = (k: string) => (k === 'appointment' ? 0 : k === 'payroll' ? 1 : 2);
          return rank(a.evidence_kind) - rank(b.evidence_kind);
        });
        pages.push(page(`<h2>${bind}. ${esc(cat.name)}</h2><ul>${ordered.map((f) => `<li>${esc(KIND_LABEL[f.evidence_kind] || f.evidence_kind)} · ${esc(f.file_name)}</li>`).join('') || '<li>첨부 없음</li>'}</ul>`));
      } else {
      pages.push(page(`<h2>${bind}. ${esc(cat.name)}</h2><p>당월 ${money(amount)}</p>`));
      for (const item of catItems) {
        const itemFiles = filesForItem(files, item.id).filter((f) => f.evidence_kind !== 'tax_invoice' && f.evidence_kind !== 'certificate');
        if (!itemFiles.length) continue;
        const upper = itemFiles.filter((f) => f.evidence_kind === 'transaction' || f.evidence_kind === 'other' || f.evidence_kind === 'report' || isInspectionPhoto(f));
        const lower = itemFiles.filter((f) => !upper.includes(f) && (f.evidence_kind === 'site_photo' || f.evidence_kind === 'education_log' || f.evidence_kind === 'report'));
        pages.push(page(`
          <h2>${bind}. ${esc(item.item_name || cat.name)}</h2>
          <p>${esc(upperPhotoCaption(itemFiles))}</p>
          ${upper.map((f) => imageOrName(f, input.pageImages)).join('')}
          ${lower.length ? `<p>${esc(lowerPhotoCaption(cat.code, itemFiles))}</p>${lower.map((f) => imageOrName(f, input.pageImages)).join('')}` : ''}
        `));
      }
      }
      for (const tax of uniqueTaxFiles(files, cat.code, catItems)) {
        const notes = categoryTaxAllocationNotes(
          catItems.map((item) => ({ ...item, id: item.id || '' })),
          [tax],
          cat.code,
        );
        const note = String(notes[0] || '').trim();
        pages.push(page(`
          <h2>${bind}. 세금계산서</h2>
          <table><tr><th>거래처</th><td>${esc(vendorName(catItems))}</td></tr><tr><th>파일</th><td>${esc(tax.file_name)}</td></tr></table>
          <div class="note">${note ? esc(note) : `배분 메모 없음<br/>${esc(tax.file_name)}`}</div>
          ${imageOrName(tax, input.pageImages)}
        `));
      }
    }
  }

  if (active.ledger) {
    const status = ledgerPrintStatus(current['3'] || 0, (input.ledger || []).filter((r) => r.signature_data).length);
    if (status === 'rows') {
      const rows = (input.ledger || []).map((r) => `<tr><td>${esc(r.item_name)}</td><td>${esc(r.worker_name)}</td><td>${esc(r.qty ?? '')}</td><td>${r.signature_data ? '서명' : ''}</td></tr>`).join('');
      pages.push(page(`<h2>7. 개인보호구 지급대장</h2><table><tr><th>품목</th><th>근로자</th><th>수량</th><th>서명</th></tr>${rows}</table>`));
    } else {
      pages.push(page(`<h2>7. 개인보호구 지급대장</h2><p>${status}</p>`));
    }
  }

  if (active.stock && (input.stock || []).length) {
    const rows = (input.stock || []).map((m) => `<tr><td>${esc(m.movement_date)}</td><td>${esc(m.item_name)}</td><td>${esc(stockMoveLabel(m.movement_type))}</td><td>${esc(m.qty ?? '')}</td><td>${esc(m.note || '')}</td></tr>`).join('');
    pages.push(page(`<h2>6. 보호구 수불</h2><table><tr><th>날짜</th><th>품목</th><th>구분</th><th>수량</th><th>메모</th></tr>${rows}</table>`, true));
  }

  if (active.originals) {
    const originals = files.filter((f) => f.evidence_kind === 'certificate' || (f.evidence_kind === 'report' && String(f.mime_type || '').includes('pdf')));
    for (const file of originals) {
      pages.push(page(`<h2>8. 원본</h2><p>${esc(file.file_name)}</p>${imageOrName(file, input.pageImages)}`));
    }
  }

  if ((input.unopened || []).length) {
    pages.push(page(`<h2>열지 못한 파일</h2><ul>${input.unopened!.map((name) => `<li>${esc(name)}</li>`).join('')}</ul>`));
  }

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/><title>산업안전보건관리비 사용내역서 ${esc(month)}</title><style>${CSS}</style></head><body>${pages.join('')}</body></html>`;
  return { html, files };
}

export function safetyCostFileGroup(kind: string): string {
  if (kind === 'transaction') return '거래명세서';
  if (kind === 'tax_invoice') return '세금계산서';
  if (kind === 'site_photo') return '현장 사진';
  if (kind === 'certificate') return '인증서';
  if (kind === 'ppe_ledger') return '지급대장';
  if (kind === 'payroll' || kind === 'appointment' || kind === 'education_log') return '급여·선임·교육';
  return '기타';
}

export function categoryLabelWithBind(code: string): string {
  const name = SAFETY_COST_CATEGORIES.find((c) => c.code === code)?.name || code;
  const bind = SAFETY_COST_BIND_NO[code];
  return bind ? `${bind}. ${name}` : name;
}
