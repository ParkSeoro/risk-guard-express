import { WAGE_DOCUMENT_KINDS } from '@/lib/safetyCostEvidencePack';
import { parseSafetyCostMoneyNote } from '@/lib/safetyCostMoneyNote';
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
  supply_amount?: number | string | null;
  vat_amount?: number | string | null;
  item_name?: string | null;
  specification?: string | null;
  supplier_name?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unit_price?: number | string | null;
  transaction_date?: string | null;
  usage_date?: string | null;
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
  certificates: boolean;
  emptyDividers: boolean;
};

export function defaultSafetyCostPrintScope(legacy: boolean): SafetyCostPrintScope {
  if (legacy) {
    return {
      cover: true, toc: false, summary: true, items: true,
      categorySheets: false, ledger: false, stock: false, originals: false,
      certificates: false, emptyDividers: false,
    };
  }
  return {
    cover: true, toc: true, summary: true, items: true,
    categorySheets: true, ledger: true, stock: false, originals: false,
    certificates: true, emptyDividers: false,
  };
}

export function safetyCostPrintPreset(name: 'claim' | 'supervise' | 'close', legacy: boolean): SafetyCostPrintScope {
  const base = defaultSafetyCostPrintScope(legacy);
  if (legacy || name === 'claim') {
    return { ...base, toc: !legacy, categorySheets: false, ledger: false, stock: false, originals: false, certificates: false, emptyDividers: false };
  }
  if (name === 'close') {
    return { ...base, emptyDividers: true, originals: true, certificates: true, ledger: true };
  }
  return base;
}

export function safetyCostPrintTitle(input: {
  construction?: string | null;
  company?: string | null;
  yearMonth?: string | null;
}): string {
  const [year, month] = String(input.yearMonth || '').split('-');
  const when = year && month ? `${year}년 ${Number(month)}월분` : '';
  return `[${input.construction || ''}] ${input.company || ''}_산업안전보건관리비사용내역서(${when})`;
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
  qualification: '자격증 사본',
  employment_contract: '근로계약서',
  employment_certificate: '재직증명서',
  payroll: '급여명세서·이체확인증',
  appointment: '선임신고필증',
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
@page { size: A4 portrait; margin: 0; }
@page landscape-page { size: A4 landscape; margin: 0; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Malgun Gothic', sans-serif; color: #111; font-size: 10.5pt; }
.sc-page { width: 210mm; height: 297mm; padding: 12mm 15mm; box-sizing: border-box; page-break-after: always; break-after: page; overflow: hidden; position: relative; }
.sc-page:last-child { page-break-after: auto; break-after: auto; }
.sc-page.landscape { page: landscape-page; width: 297mm; height: 210mm; }
.cover { height: 100%; display: flex; flex-direction: column; }
.cover .mid { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 14pt; }
h1 { font-size: 18pt; text-align: center; margin: 8mm 0; letter-spacing: 0.45em; font-weight: 700; }
.cover-month { text-align: center; font-size: 14pt; margin: 0; }
h2 { font-size: 13pt; margin: 0 0 4mm; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #222; padding: 4px 6px; vertical-align: middle; }
th { background: #f3f4f6; font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.items { font-size: 9.5pt; }
.items th, .items td { padding: 3px 5px; }
.toc { border: 1.5px solid #111; padding: 8mm; }
.toc p { margin: 1.5mm 0; }
.note { border: 2px solid #1d4ed8; color: #1e3a8a; padding: 8px; margin-top: 4mm; text-align: center; white-space: pre-wrap; font-size: 12pt; }
.sheet-title { text-align: center; letter-spacing: 0.45em; font-weight: 700; border-top: 2px solid #111; border-bottom: 2px solid #111; margin: 0 0 2mm; padding: 1mm 0; }
.slot { height: 78mm; display: flex; gap: 4mm; align-items: center; justify-content: center; }
.slot .cell { flex: 1; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.slot img.doc, .slot img.shot { max-width: 100%; max-height: 76mm; object-fit: contain; }
.missing { height: 40mm; display: flex; align-items: center; justify-content: center; border: 1px dashed #666; }
.muted { color: #4b5563; }
.sign td { height: 28mm; width: 33%; }
`;

function page(inner: string, landscape = false): string {
  return `<section class="sc-page${landscape ? ' landscape' : ''}">${inner}</section>`;
}

function monthHeading(yearMonth: string): string {
  const [year, month] = String(yearMonth || '').split('-');
  if (!year || !month) return yearMonth;
  return `${year}년 ${Number(month)}월`;
}

function itemDate(item: SafetyCostDocItem): string {
  return String(item.transaction_date || item.usage_date || '').slice(0, 10);
}

function slotCells(files: SafetyCostDocFile[], pageImages?: Record<string, string[]>): string {
  return files.map((file) => {
    const raster = pageImages?.[file.id]?.[0];
    const src = raster || (file.file_url && String(file.mime_type || '').startsWith('image/') ? file.file_url : '');
    const doc = file.evidence_kind === 'transaction' || file.evidence_kind === 'tax_invoice' || file.evidence_kind === 'payroll';
    if (!src) return `<div class="cell"><p class="muted">${esc(file.file_name || '파일')}</p></div>`;
    return `<div class="cell"><img class="${doc ? 'doc' : 'shot'}" src="${esc(src)}" alt="${esc(file.file_name || '')}" /></div>`;
  }).join('');
}

function catItemsOf(items: SafetyCostDocItem[], code: string): SafetyCostDocItem[] {
  return items.filter((item) => item.category_code === code);
}

function pushFilePages(pages: string[], title: string, file: SafetyCostDocFile, pageImages?: Record<string, string[]>): void {
  const images = pageImages?.[file.id] || [];
  if (!images.length) {
    pages.push(page(`<h2>${esc(title)}</h2><div class="slot">${slotCells([file], pageImages)}</div>`));
    return;
  }
  images.forEach((src, index) => {
    pages.push(page(`<h2>${esc(title)}${index ? ' (계속)' : ''}</h2><p>${esc(file.file_name)}</p><div class="slot"><div class="cell"><img class="doc" src="${esc(src)}" alt="" /></div></div>`));
  });
}

function taxCallout(catName: string, tax: SafetyCostDocFile, catItems: SafetyCostDocItem[], siblingCount: number): string {
  const parsed = parseSafetyCostMoneyNote(tax.note);
  if (parsed.text && parsed.total == null && parsed.part == null) {
    return `<div class="note">${esc(parsed.text)}</div>`;
  }
  const only = siblingCount === 1;
  const part = parsed.part != null
    ? parsed.part
    : (only && !parsed.text ? catItems.reduce((sum, item) => sum + Number(item.amount || 0), 0) : null);
  if (parsed.total == null && part == null) {
    return `<div class="note">배분 금액을 적어 주세요<br/>${esc(tax.file_name)}</div>`;
  }
  return `<div class="note">세금계산서 총액 ${parsed.total == null ? '' : money(parsed.total)} 중<br/>${esc(catName)} 사용 금액<br/>${part == null ? '' : money(part)}</div>`;
}

export function buildSafetyCostDocument(input: SafetyCostDocInput, scope: SafetyCostPrintScope): {
  html: string;
  files: SafetyCostDocFile[];
} {
  const legacy = isSafetyCostLegacyImport(input.report.source);
  const active: SafetyCostPrintScope = legacy
    ? { ...scope, toc: false, categorySheets: false, ledger: false, stock: false, originals: false, certificates: false, emptyDividers: false }
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
      <div class="cover">
        <p class="cover-month">${esc(monthHeading(month))}</p>
        <h1>산업안전보건관리비<br/>사용내역서</h1>
        <div class="mid">공사명<br/>${esc(input.report.construction_name || '')}</div>
        <p style="text-align:center">${esc(input.companyName || '')}</p>
        <table class="sign">
          <tr>${signs.map((s) => `<th>${esc(s.title)}</th>`).join('')}</tr>
          <tr>${signs.map((s) => `<td>${esc(s.name)}<br/>${esc(s.company)}<br/>${esc(s.status)} ${esc(s.approvedAt)}</td>`).join('')}</tr>
        </table>
        ${legacy ? '<p>이관 월. 항목별 증빙은 이 출력에 없습니다.</p>' : ''}
      </div>
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
    pages.push(page(`<h2>목차</h2><div class="toc">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`));
  }

  if (active.summary) {
    const monthTotal = SAFETY_COST_CATEGORIES.reduce((sum, c) => sum + (current[c.code] || 0), 0);
    const priorTotal = SAFETY_COST_CATEGORIES.reduce((sum, c) => sum + (prior[c.code] || 0), 0);
    const accTotal = priorTotal + monthTotal;
    const budget = input.report.safety_cost_total == null ? null : Number(input.report.safety_cost_total);
    const remain = budget == null ? null : budget - accTotal;
    const rate = budget != null && budget > 0 ? `${(accTotal / budget * 100).toFixed(2)}%` : '';
    const rows = SAFETY_COST_CATEGORIES.map((c) => {
      const cur = current[c.code] || 0;
      const prev = prior[c.code] || 0;
      return `<tr><td>${esc(c.code)}. ${esc(c.name)}</td><td class="num">${money(prev)}</td><td class="num">${money(cur)}</td><td class="num">${money(prev + cur)}</td><td></td></tr>`;
    }).join('');
    const signs = (input.signers || []).slice(0, 3);
    pages.push(page(`
      <h2>1. 사용내역 총괄</h2>
      <table>
        <tr><th>건설업체명</th><td>${esc(input.companyName || '')}</td><th>대표자</th><td></td></tr>
        <tr><th>소재지</th><td colspan="3">${esc(input.companyAddress || '')}</td></tr>
        <tr><th>공사명</th><td colspan="3">${esc(input.report.construction_name || '')}</td></tr>
        <tr><th>발주처</th><td>${esc(input.clientName || '')}</td><th>공사기간</th><td></td></tr>
        <tr><th>계약금액</th><td class="num">${money(input.report.contract_amount)}</td><th>공정률</th><td>${input.report.cumulative_progress_rate == null ? '' : `${esc(input.report.cumulative_progress_rate)}%`}</td></tr>
        <tr><th>계상된 안전관리비</th><td class="num">${money(input.report.safety_cost_total)}</td><th>사용기준금액</th><td>${basis == null ? '' : money(basis)}</td></tr>
        <tr><th>잔여금액</th><td class="num">${remain == null ? '' : money(remain)}</td><th>누계집행율</th><td>${rate}</td></tr>
      </table>
      <table style="margin-top:4mm">
        <tr><th>항목</th><th>전월</th><th>금월</th><th>누계</th><th>기준비율(%)</th></tr>
        <tr><td>계</td><td class="num">${money(priorTotal)}</td><td class="num">${money(monthTotal)}</td><td class="num">${money(accTotal)}</td><td></td></tr>
        ${rows}
      </table>
      <p>「건설업 산업안전보건관리비 계상 및 사용기준」 제10조제1항에 따라 위와 같이 사용내역서를 작성하였습니다.</p>
      <table class="sign">
        <tr><th>작성자</th><th>제출자</th><th>승인자</th></tr>
        <tr>${signs.map((s) => `<td>${esc(s.name)}<br/>${esc(s.company)}<br/>${esc(s.status)} ${esc(s.approvedAt)}</td>`).join('') || '<td></td><td></td><td></td>'}</tr>
      </table>
    `));
  }

  if (active.items) {
    const monthTotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const body: string[] = [];
    for (const cat of SAFETY_COST_CATEGORIES) {
      const catItems = items.filter((item) => item.category_code === cat.code);
      if (!catItems.length) continue;
      const sub = catItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const pct = monthTotal > 0 ? `${(sub / monthTotal * 100).toFixed(1)}%` : '';
      catItems.forEach((item, index) => {
        const spec = item.specification ? ` ${esc(item.specification)}` : '';
        const price = item.unit_price == null || item.unit_price === '' ? '' : money(Number(item.unit_price));
        body.push(`<tr><td>${esc(cat.name)}</td><td>${index + 1}</td><td>${esc(itemDate(item))}</td><td>${esc(item.item_name || '')}${spec}</td><td class="num">${esc(item.quantity ?? '')}</td><td>${esc(item.unit || '')}</td><td class="num">${price}</td><td class="num">${money(Number(item.amount || 0))}</td><td>${esc(item.supplier_name || '')}</td></tr>`);
      });
      body.push(`<tr><td colspan="4">소계</td><td></td><td></td><td></td><td class="num">${money(sub)}</td><td class="num">${pct}</td></tr>`);
    }
    const chunks: string[][] = [];
    for (let i = 0; i < body.length; i += 22) chunks.push(body.slice(i, i + 22));
    const head = `<tr><th rowspan="2">구분</th><th rowspan="2">No</th><th rowspan="2">월일</th><th rowspan="2">사용항목</th><th colspan="4">산출근거</th><th rowspan="2">비율</th></tr><tr><th>수량</th><th>단위</th><th>단가</th><th>금액</th></tr>`;
    if (!chunks.length) {
      pages.push(page(`<h2>2. 항목별 사용내역</h2><table class="items">${head}<tr><td colspan="9">항목 없음</td></tr></table>`));
    }
    chunks.forEach((chunk, index) => {
      const totalRow = index === chunks.length - 1 ? `<tr><td colspan="4">총계</td><td></td><td></td><td></td><td class="num">${money(monthTotal)}</td><td class="num">100%</td></tr>` : '';
      pages.push(page(`<h2>2. 항목별 사용내역${index ? ' (계속)' : ''}</h2><table class="items">${head}${chunk.join('')}${totalRow}</table>`));
    });
  }

  if (active.categorySheets) {
    for (const cat of SAFETY_COST_CATEGORIES) {
      const catItems = items.filter((item) => item.category_code === cat.code);
      const amount = current[cat.code] || 0;
      const bind = SAFETY_COST_BIND_NO[cat.code];
      if (amount <= 0) {
        if (active.emptyDividers) pages.push(page(`<h2>${bind}. ${esc(cat.name)}</h2><div class="missing">당월 사용내역 없음</div>`));
        continue;
      }
      const wage = cat.code === '1' || cat.code === '8';
      if (wage) {
        const wageFiles = files.filter((f) => WAGE_DOCUMENT_KINDS.includes(f.evidence_kind as typeof WAGE_DOCUMENT_KINDS[number]) && (f.category_code === cat.code || catItems.some((item) => item.id && f.item_id === item.id)));
        const missing = WAGE_DOCUMENT_KINDS.filter((kind) => !wageFiles.some((f) => f.evidence_kind === kind)).map((kind) => KIND_LABEL[kind] || kind);
        pages.push(page(`<h2>${bind}. ${esc(cat.name)}</h2><p>당월 ${money(amount)}</p>${missing.map((name) => `<p class="missing">${esc(name)} 없음</p>`).join('')}`));
        for (const kind of WAGE_DOCUMENT_KINDS) {
          for (const file of wageFiles.filter((f) => f.evidence_kind === kind)) {
            const images = input.pageImages?.[file.id] || [];
            if (images.length) {
              for (const src of images) {
                pages.push(page(`<h2>${bind}. ${esc(KIND_LABEL[kind] || kind)}</h2><div class="slot"><div class="cell"><img class="doc" src="${esc(src)}" alt="" /></div></div>`));
              }
            } else {
              pages.push(page(`<h2>${bind}. ${esc(KIND_LABEL[kind] || kind)}</h2><p>${esc(file.file_name)}</p>${slotCells([file], input.pageImages)}`));
            }
          }
        }
      } else {
      for (const item of catItems) {
        const itemFiles = filesForItem(files, item.id).filter((f) => f.evidence_kind !== 'tax_invoice' && f.evidence_kind !== 'certificate');
        if (!itemFiles.length) continue;
        const upper = itemFiles.filter((f) => f.evidence_kind === 'transaction' || f.evidence_kind === 'other' || f.evidence_kind === 'report' || isInspectionPhoto(f));
        const lower = itemFiles.filter((f) => !upper.includes(f) && (f.evidence_kind === 'site_photo' || f.evidence_kind === 'education_log' || f.evidence_kind === 'report'));
        const upperCaption = upperPhotoCaption(itemFiles);
        const lowerCaption = lowerPhotoCaption(cat.code, itemFiles);
        const sheets: Array<{ upper: SafetyCostDocFile[]; lower: SafetyCostDocFile[] }> = [];
        for (let u = 0, l = 0; u < upper.length || l < lower.length || sheets.length === 0; u += 2, l += 2) {
          sheets.push({ upper: upper.slice(u, u + 2), lower: lower.slice(l, l + 2) });
          if (u + 2 >= upper.length && l + 2 >= lower.length) break;
        }
        sheets.forEach((sheet, index) => {
          if (!sheet.upper.length && !sheet.lower.length) return;
          const title = `${bind}. ${esc(cat.name)}${index ? ' (계속)' : ''}`;
          pages.push(page(`
            <h2>${title}</h2>
            <p>${esc(item.item_name || '')}</p>
            ${sheet.upper.length ? `<p class="sheet-title">사 진 대 지</p><div class="slot">${slotCells(sheet.upper, input.pageImages)}</div><p>${esc(upperCaption)}</p>` : ''}
            ${sheet.lower.length ? `<p class="sheet-title">사 진 대 지</p><div class="slot">${slotCells(sheet.lower, input.pageImages)}</div><p>${esc(lowerCaption)}</p>` : ''}
          `));
        });
      }
      }
      const taxes = uniqueTaxFiles(files, cat.code, catItems);
      for (const tax of taxes) {
        const images = input.pageImages?.[tax.id] || [];
        const body = `
          <h2>${bind}. 세금계산서</h2>
          <p class="sheet-title">사 진 대 지</p>
          <table><tr><th>업체</th><td>${esc(vendorName(catItems))}</td><th>파일</th><td>${esc(tax.file_name)}</td></tr></table>
          ${taxCallout(cat.name, tax, catItems, taxes.length)}
          ${images.length ? '' : `<div class="slot">${slotCells([tax], input.pageImages)}</div>`}
        `;
        if (!images.length) pages.push(page(body));
        images.forEach((src, index) => {
          pages.push(page(`${index === 0 ? body : `<h2>${bind}. 세금계산서 (계속)</h2>`}<div class="slot"><div class="cell"><img class="doc" src="${esc(src)}" alt="" /></div></div>`));
        });
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

  const certificateFiles = files.filter((f) => f.evidence_kind === 'certificate' && (f.category_code === '3' || catItemsOf(items, '3').some((item) => item.id && f.item_id === item.id)));
  if (active.certificates) {
    for (const file of certificateFiles) pushFilePages(pages, '인증서', file, input.pageImages);
  }
  if (active.originals) {
    const originals = files.filter((f) => (f.evidence_kind === 'certificate' && !certificateFiles.includes(f)) || (f.evidence_kind === 'report' && String(f.mime_type || '').includes('pdf')));
    for (const file of originals) pushFilePages(pages, '8. 원본', file, input.pageImages);
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
