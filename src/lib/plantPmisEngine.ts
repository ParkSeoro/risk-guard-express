/**
 * Construction Site PMIS Engine: Manpower Daily Report (출역일보) & Progress Claim (기성청구)
 * Deterministic cross-check, over-claim / productivity anomaly detector, and Excel export.
 */
import * as XLSX from 'xlsx';

export interface ManpowerRow {
  trade: string; // 공종 (배관, 용접, 비계, 보온, 전기계장 등)
  planned_headcount: number;
  actual_headcount: number;
  tbm_completed: number;
  remarks?: string;
}

export interface ProgressClaimRow {
  trade: string;
  contract_krw: number;
  prev_claimed_krw: number;
  this_claim_krw: number;
  claimed_progress_pct: number; // 누계 청구 진도율 (%)
  verified_ndt_done?: boolean;
}

export interface PmisAnomaly {
  severity: 'critical' | 'warning' | 'info';
  trade: string;
  category: '기성 과다청구' | '계약액 초과' | '투입인원 괴리' | '안전·품질 미충족';
  title: string;
  detail: string;
  recommended_cut_krw?: number;
}

export interface PmisSummary {
  totalPlannedHeadcount: number;
  totalActualHeadcount: number;
  headcountRatePct: number;
  totalContractKrw: number;
  totalPrevClaimedKrw: number;
  totalThisClaimKrw: number;
  cumulativeProgressPct: number;
  recommendedCutKrw: number;
  anomalies: PmisAnomaly[];
}

function toNum(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function parseManpowerExcel(buffer: ArrayBuffer): ManpowerRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  return rows
    .map((r) => {
      const keys = Object.keys(r);
      const find = (re: RegExp) => {
        const k = keys.find((x) => re.test(x));
        return k ? r[k] : '';
      };
      const trade = String(find(/공종|직종|trade|work/i) || '').trim();
      if (!trade) return null;
      const planned = toNum(find(/계획|plan/i));
      const actual = toNum(find(/투입|실제|출역|actual/i));
      const tbm = toNum(find(/tbm|안전|교육/i)) || actual;
      return {
        trade,
        planned_headcount: planned,
        actual_headcount: actual,
        tbm_completed: tbm,
        remarks: String(find(/비고|메모|remark/i) || '').trim(),
      };
    })
    .filter((x): x is ManpowerRow => Boolean(x));
}

export function parseProgressClaimExcel(buffer: ArrayBuffer): ProgressClaimRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  return rows
    .map((r) => {
      const keys = Object.keys(r);
      const find = (re: RegExp) => {
        const k = keys.find((x) => re.test(x));
        return k ? r[k] : '';
      };
      const trade = String(find(/공종|품목|trade|item/i) || '').trim();
      if (!trade) return null;
      const contract = toNum(find(/계약|도급|contract/i));
      const prev = toNum(find(/전회|이전|prev/i));
      const curr = toNum(find(/금회|당월|청구|this/i));
      const pctRaw = toNum(find(/진도|공정률|progress|%/i));
      const pct = pctRaw > 0 ? pctRaw : contract > 0 ? Math.round(((prev + curr) / contract) * 1000) / 10 : 0;
      const ndtVal = String(find(/ndt|rt|검사|품질/i) || '').toLowerCase();
      return {
        trade,
        contract_krw: contract,
        prev_claimed_krw: prev,
        this_claim_krw: curr,
        claimed_progress_pct: pct,
        verified_ndt_done: ndtVal ? !/미|no|false|n|미완료/.test(ndtVal) : true,
      };
    })
    .filter((x): x is ProgressClaimRow => Boolean(x));
}

export function auditPmisData(manpower: ManpowerRow[], claims: ProgressClaimRow[]): PmisSummary {
  const anomalies: PmisAnomaly[] = [];
  const mpByTrade = new Map(manpower.map((m) => [m.trade.trim(), m]));

  for (const m of manpower) {
    if (m.actual_headcount > 0 && m.tbm_completed < m.actual_headcount) {
      anomalies.push({
        severity: 'warning',
        trade: m.trade,
        category: '안전·품질 미충족',
        title: `[${m.trade}] TBM/안전교육 미이수 인원 투입 (${m.tbm_completed}/${m.actual_headcount}명)`,
        detail: `실제 투입 인원 ${m.actual_headcount}명 중 ${m.actual_headcount - m.tbm_completed}명이 당일 TBM 확인이 누락되었습니다.`,
      });
    }
  }

  for (const c of claims) {
    const cum = c.prev_claimed_krw + c.this_claim_krw;
    // 1. Contract overrun
    if (c.contract_krw > 0 && cum > c.contract_krw) {
      const over = cum - c.contract_krw;
      anomalies.push({
        severity: 'critical',
        trade: c.trade,
        category: '계약액 초과',
        title: `[${c.trade}] 누계 기성청구액이 계약금액 초과 (+₩${over.toLocaleString()})`,
        detail: `계약액 ₩${c.contract_krw.toLocaleString()} 대비 누계 청구액 ₩${cum.toLocaleString()}로 승인 없는 설계변경/증액이 포함되어 있습니다.`,
        recommended_cut_krw: over,
      });
    }
    // 2. Progress > 100%
    if (c.claimed_progress_pct > 100) {
      anomalies.push({
        severity: 'critical',
        trade: c.trade,
        category: '기성 과다청구',
        title: `[${c.trade}] 누계 진도율 100% 초과 (${c.claimed_progress_pct}%)`,
        detail: '실제 도급 범위를 초과한 진도율이 청구되었습니다.',
      });
    }
    // 3. NDT / Quality gate missing on high claim
    if (c.verified_ndt_done === false && c.this_claim_krw > 0) {
      anomalies.push({
        severity: 'critical',
        trade: c.trade,
        category: '안전·품질 미충족',
        title: `[${c.trade}] 비파괴검사(RT/NDT)·품질검측 미완료 상태에서 기성 청구`,
        detail: `금회 ₩${c.this_claim_krw.toLocaleString()}가 청구되었으나 필수 품질/NDT 성적서가 미확인 상태입니다.`,
        recommended_cut_krw: Math.round(c.this_claim_krw * 0.3),
      });
    }
    // 4. Manpower vs Claimed Progress mismatch
    const mp = mpByTrade.get(c.trade.trim());
    if (mp && mp.planned_headcount > 0 && c.contract_krw > 0) {
      const mpRatio = mp.actual_headcount / mp.planned_headcount;
      const thisPct = (c.this_claim_krw / c.contract_krw) * 100;
      if (mpRatio < 0.65 && thisPct >= 25) {
        anomalies.push({
          severity: 'warning',
          trade: c.trade,
          category: '투입인원 괴리',
          title: `[${c.trade}] 투입인원 저조(${Math.round(mpRatio * 100)}%) 대비 금회 기성 과다(${thisPct.toFixed(1)}%)`,
          detail: `계획 인원 ${mp.planned_headcount}명 중 ${mp.actual_headcount}명만 투입되었으나 금회 ₩${c.this_claim_krw.toLocaleString()}가 청구되었습니다. 현장 실물 물량 검측이 필요합니다.`,
          recommended_cut_krw: Math.round(c.this_claim_krw * 0.2),
        });
      }
    }
  }

  const totalPlannedHeadcount = manpower.reduce((s, r) => s + r.planned_headcount, 0);
  const totalActualHeadcount = manpower.reduce((s, r) => s + r.actual_headcount, 0);
  const totalContractKrw = claims.reduce((s, r) => s + r.contract_krw, 0);
  const totalPrevClaimedKrw = claims.reduce((s, r) => s + r.prev_claimed_krw, 0);
  const totalThisClaimKrw = claims.reduce((s, r) => s + r.this_claim_krw, 0);
  const recommendedCutKrw = anomalies.reduce((s, a) => s + (a.recommended_cut_krw || 0), 0);

  return {
    totalPlannedHeadcount,
    totalActualHeadcount,
    headcountRatePct: totalPlannedHeadcount > 0 ? Math.round((totalActualHeadcount / totalPlannedHeadcount) * 1000) / 10 : 0,
    totalContractKrw,
    totalPrevClaimedKrw,
    totalThisClaimKrw,
    cumulativeProgressPct:
      totalContractKrw > 0 ? Math.round(((totalPrevClaimedKrw + totalThisClaimKrw) / totalContractKrw) * 1000) / 10 : 0,
    recommendedCutKrw,
    anomalies,
  };
}

export function downloadPmisAuditExcel(summary: PmisSummary, claims: ProgressClaimRow[]): void {
  const ws1 = XLSX.utils.json_to_sheet(
    claims.map((c) => ({
      공종: c.trade,
      계약금액: c.contract_krw,
      전회누계: c.prev_claimed_krw,
      금회청구: c.this_claim_krw,
      누계진도율_pct: c.claimed_progress_pct,
      품질NDT완료: c.verified_ndt_done ? 'Y' : 'N (유보)',
    })),
  );
  const ws2 = XLSX.utils.json_to_sheet(
    summary.anomalies.map((a, i) => ({
      번호: i + 1,
      심각도: a.severity,
      공종: a.trade,
      분류: a.category,
      지적사항: a.title,
      상세내용: a.detail,
      감액권고금액: a.recommended_cut_krw || 0,
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, '기성청구내역');
  XLSX.utils.book_append_sheet(wb, ws2, '이상징후_감액검토');
  XLSX.writeFile(wb, `시공PMIS_기성인원_검토결과.xlsx`);
}

export const SAMPLE_MANPOWER_YEOSU: ManpowerRow[] = [
  { trade: '극저온 배관·용접', planned_headcount: 14, actual_headcount: 8, tbm_completed: 8, remarks: '용접사 2명 야간 교대' },
  { trade: '기화기·설비 설치', planned_headcount: 8, actual_headcount: 8, tbm_completed: 8, remarks: '크레인 양중 완료' },
  { trade: '초저온 보온공사', planned_headcount: 6, actual_headcount: 3, tbm_completed: 2, remarks: '신규 투입 1명 TBM 미서명' },
  { trade: '전기·계장(PSV/XV)', planned_headcount: 6, actual_headcount: 6, tbm_completed: 6, remarks: '루프테스트 진행' },
];

export const SAMPLE_CLAIMS_YEOSU: ProgressClaimRow[] = [
  { trade: '극저온 배관·용접', contract_krw: 180_000_000, prev_claimed_krw: 72_000_000, this_claim_krw: 63_000_000, claimed_progress_pct: 75, verified_ndt_done: false },
  { trade: '기화기·설비 설치', contract_krw: 95_000_000, prev_claimed_krw: 57_000_000, this_claim_krw: 38_000_000, claimed_progress_pct: 100, verified_ndt_done: true },
  { trade: '초저온 보온공사', contract_krw: 42_000_000, prev_claimed_krw: 25_000_000, this_claim_krw: 21_000_000, claimed_progress_pct: 109.5, verified_ndt_done: true },
  { trade: '전기·계장(PSV/XV)', contract_krw: 68_000_000, prev_claimed_krw: 20_400_000, this_claim_krw: 20_400_000, claimed_progress_pct: 60, verified_ndt_done: true },
];
