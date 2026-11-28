/**
 * Air Liquide Industrial Gas Plant ISO Analysis, Deterministic PSV/KGS Safety Engine,
 * 6-Law Permit Mapper, and Vendor BOQ vs ISO BOM 1:1 Cross-Check Engine.
 */
import * as XLSX from 'xlsx';

export type IsoBomCategory =
  | 'pipe'
  | 'elbow'
  | 'tee'
  | 'reducer'
  | 'flange'
  | 'valve'
  | 'psv'
  | 'bolt_gasket'
  | 'support'
  | 'other';

export interface IsoTitleBlock {
  drawing_no: string | null;
  line_no: string | null;
  revision: string | null;
  fluid_gas: string | null;
  pipe_spec: string | null;
  design_pressure_bar: number | null;
  design_temp_c: number | null;
  insulation_type: string | null;
  nde_rt_percent: number | null;
  pwht_required: boolean | null;
  o2_cleaning_required: boolean | null;
}

export interface IsoBomItem {
  item_no: string;
  category: IsoBomCategory;
  description: string;
  size_inch: string;
  material: string | null;
  quantity: number;
  unit: 'm' | 'EA';
}

export interface GasSafetyFinding {
  severity: 'critical' | 'warning' | 'info';
  category: 'PSV' | '재질·탈지' | '방폭·이격' | '역류·차단' | '용접·NDT' | '인허가';
  rule_ref: string;
  title: string;
  detail: string;
  recommendation: string;
  source?: 'rule_engine' | 'ai';
}

export interface IsoAnalysisResult {
  title_block: IsoTitleBlock;
  welds: {
    shop_weld_count: number;
    field_weld_count: number;
  };
  topology_counts: {
    psv_count: number;
    block_valve_count: number;
    check_valve_count: number;
    vent_drain_count: number;
  };
  bom: IsoBomItem[];
  ai_findings: GasSafetyFinding[];
  summary: string;
}

export interface VendorBoqItem {
  row_no: number;
  category: IsoBomCategory;
  description: string;
  size_inch: string;
  quantity: number;
  unit: 'm' | 'EA';
  unit_price?: number;
}

export type BoqDiffStatus = 'match' | 'overclaimed' | 'underclaimed' | 'missing_in_boq' | 'not_in_drawing';

export interface BoqDiffRow {
  key: string;
  category: IsoBomCategory;
  size_inch: string;
  description: string;
  unit: 'm' | 'EA';
  iso_qty: number;
  vendor_qty: number;
  delta_qty: number; // vendor - iso (+ means vendor overclaimed)
  status: BoqDiffStatus;
  estimated_overclaim_krw?: number;
}

export interface PlantPermitCheck {
  law: '고압가스안전관리법' | '산업안전보건법' | '화학물질관리법' | '건설기술진흥법' | '소방시설공사업법';
  permit_name: string;
  authority: string;
  rule_ref: string;
  required: '필수' | '검토필요';
  reason: string;
}

const DN_TO_INCH: Record<string, string> = {
  '15': '1/2"',
  '20': '3/4"',
  '25': '1"',
  '32': '1-1/4"',
  '40': '1-1/2"',
  '50': '2"',
  '65': '2-1/2"',
  '80': '3"',
  '100': '4"',
  '125': '5"',
  '150': '6"',
  '200': '8"',
  '250': '10"',
  '300': '12"',
};

/** Normalize pipe sizes like 'DN50', '50A', '2 inch', '2"' into canonical inch format ('2"'). */
export function normalizePipeSize(raw: string | null | undefined): string {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return 'N/A';
  const dnMatch = s.match(/(?:DN|NB)?\s*(\d{2,3})\s*A?\b/);
  if (dnMatch && DN_TO_INCH[dnMatch[1]] && (s.includes('DN') || s.includes('A') || Number(dnMatch[1]) >= 15)) {
    return DN_TO_INCH[dnMatch[1]];
  }
  const inchMatch = s.match(/(\d+(?:-\d+\/\d+|\/\d+)?)\s*(?:"|''|IN|INCH)/);
  if (inchMatch) return `${inchMatch[1]}"`;
  const bareNum = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bareNum) return `${bareNum[1]}"`;
  return s;
}

export function inferBomCategory(text: string): IsoBomCategory {
  const s = (text || '').toLowerCase();
  if (s.includes('psv') || s.includes('안전밸브') || s.includes('relief') || s.includes('prv')) return 'psv';
  if (s.includes('valve') || s.includes('밸브') || s.includes('v/v')) return 'valve';
  if (s.includes('elbow') || s.includes('엘보') || s.includes('90deg') || s.includes('45deg')) return 'elbow';
  if (s.includes('tee') || s.includes('티')) return 'tee';
  if (s.includes('reducer') || s.includes('레듀샤') || s.includes('리듀서')) return 'reducer';
  if (s.includes('flange') || s.includes('플랜지') || s.includes('wnrf') || s.includes('blrf')) return 'flange';
  if (s.includes('bolt') || s.includes('gasket') || s.includes('볼트') || s.includes('가스켓')) return 'bolt_gasket';
  if (s.includes('support') || s.includes('서포트') || s.includes('hanger')) return 'support';
  if (s.includes('pipe') || s.includes('파이프') || s.includes('배관') || s.includes('smls')) return 'pipe';
  return 'other';
}

/** Deterministic Air Liquide Gas Safety & PSV/KGS/API 520-521 Rule Engine (zero hallucination). */
export function evaluateAirLiquideGasSafety(iso: IsoAnalysisResult): GasSafetyFinding[] {
  const findings: GasSafetyFinding[] = [];
  const tb = iso.title_block;
  const gas = (tb.fluid_gas || '').trim().toUpperCase();
  const temp = tb.design_temp_c;
  const press = tb.design_pressure_bar;
  const psvBomCount = iso.bom.filter((b) => b.category === 'psv').reduce((a, b) => a + (b.quantity || 0), 0);
  const psvCount = Math.max(iso.topology_counts.psv_count || 0, psvBomCount);
  const blockValves = iso.topology_counts.block_valve_count || 0;

  const isCryo =
    ['LIN', 'LOX', 'LAR', 'LH2', 'LCO2'].includes(gas) ||
    (temp !== null && temp <= -40);
  const isOxygen = gas === 'O2' || gas === 'LOX' || gas === 'GOX';
  const isHydrogen = gas === 'H2' || gas === 'LH2' || gas === 'GH2';
  const isCo2 = gas === 'LCO2' || gas === 'CO2';
  const isHighPressure = press !== null && press >= 10;

  // 1. Cryogenic Thermal Relief PSV rule
  if (isCryo && blockValves >= 2 && psvCount === 0) {
    findings.push({
      severity: 'critical',
      category: 'PSV',
      rule_ref: 'KGS FP111 · API 521 §4.4.12 · EIGA IGC Doc 24',
      title: '초저온 액체 차단구간 열팽창 안전밸브(Thermal Relief PSV) 누락',
      detail: `유체 ${gas || '초저온'}(설계온도 ${temp ?? '저온'}°C) 배관에 차단밸브 ${blockValves}개가 존재하나 안전밸브(PSV)가 0개입니다. 액체가 양단 차단되면 기화 팽창(최대 700배)으로 배관 파열 위험이 매우 높습니다.`,
      recommendation: '양단 차단 가능 구간마다 Thermal Relief PSV(1/2"×3/4" 이상)를 배치하고 MAWP 이하로 설정압력을 지정하세요.',
      source: 'rule_engine',
    });
  } else if (isHighPressure && psvCount === 0) {
    findings.push({
      severity: 'warning',
      category: 'PSV',
      rule_ref: 'KGS FP111 · API 520 Part I',
      title: '고압 배관 구간 PSV 보호 여부 확인 필요',
      detail: `설계압력 ${press} bar 고압 라인이나 본 ISO 도면 내 PSV가 표기되지 않았습니다.`,
      recommendation: '상위 P&ID에서 인접 용기/헤더 측 PSV로 과압 보호가 커버되는지 확인하고 설정압력 근거를 첨부하세요.',
      source: 'rule_engine',
    });
  }

  // 2. Oxygen cleaning & material rule
  if (isOxygen && tb.o2_cleaning_required !== true) {
    findings.push({
      severity: 'critical',
      category: '재질·탈지',
      rule_ref: 'EIGA IGC Doc 33/18 · EIGA Doc 13/12',
      title: '산소(O2/LOX) 배관 탈지(O2 Cleaning) 표기 누락',
      detail: '산소 배관에 유지류·이물질이 잔류할 경우 단열압축·입자충돌로 즉각 발화·배관 연소 사고로 이어집니다.',
      recommendation: '도면 주기(Notes)에 "CLEANED FOR OXYGEN SERVICE (EIGA 33/18)" 및 탄소강 구간 유속 제한 기준을 명시하세요.',
      source: 'rule_engine',
    });
  }

  // 3. Cryogenic material check
  if (isCryo && tb.pipe_spec && /\b(CS|A106|A53|CARBON)\b/i.test(tb.pipe_spec)) {
    findings.push({
      severity: 'critical',
      category: '재질·탈지',
      rule_ref: 'ASME B31.3 §323.2.2 · KGS AC111',
      title: '초저온 라인에 탄소강(Carbon Steel) 재질 표기 의심',
      detail: `설계온도 ${temp ?? '-196'}°C 초저온 조건에 탄소강(${tb.pipe_spec}) 적용 시 저온취성 파괴 위험이 있습니다.`,
      recommendation: '오스테나이트계 스테인리스강(ASTM A312 TP304L / TP316L)으로 재질 규격을 즉시 재확인하세요.',
      source: 'rule_engine',
    });
  }

  // 4. Hydrogen explosion-proof & flange minimization
  if (isHydrogen) {
    const flangeCount = iso.bom.filter((b) => b.category === 'flange').reduce((a, b) => a + (b.quantity || 0), 0);
    findings.push({
      severity: flangeCount >= 6 ? 'warning' : 'info',
      category: '방폭·이격',
      rule_ref: 'KGS FP111 · ASME B31.12 · EIGA Doc 121',
      title: `수소(H2) 배관 방폭·누출 및 NDT 검증 (플랜지 ${flangeCount}개)`,
      detail: `수소는 최소점화에너지가 극도로 낮아 플랜지 누출 위험이 높습니다. (도면 RT 비율: ${tb.nde_rt_percent ?? '미표기'}%)`,
      recommendation: '불필요한 플랜지는 맞대기 용접(BW)으로 축소하고, RT 100%(또는 KGS 규정 비율), IIC 방폭등급, 상부 수소감지기 및 Vent Stack 이격거리를 확인하세요.',
      source: 'rule_engine',
    });
  }

  // 5. LCO2 triple-point dry-ice blockage rule
  if (isCo2) {
    findings.push({
      severity: 'warning',
      category: '역류·차단',
      rule_ref: 'EIGA IGC Doc 70 · KGS FP111',
      title: 'LCO2 감압 시 드라이아이스 폐색(삼중점) 및 저지대 질식 검토',
      detail: '액화 CO2는 5.18 bar 이하 급감압 시 드라이아이스(-56.6°C)로 고체화되어 PSV·벤트 배관을 막을 수 있습니다.',
      recommendation: 'PSV 방출 배관 크기·배압 검토 및 저지대/피트 CO2 체류 방지 배기 위치를 확인하세요.',
      source: 'rule_engine',
    });
  }

  // 6. Field weld NDT check
  if ((iso.welds.field_weld_count || 0) > 0 && tb.nde_rt_percent === null) {
    findings.push({
      severity: 'warning',
      category: '용접·NDT',
      rule_ref: 'ASME B31.3 Table 341.3.2 · KGS FP111',
      title: '현장 용접(Field Weld) 비파괴검사(RT/UT) 비율 미표기',
      detail: `현장 용접 ${iso.welds.field_weld_count}포인트가 있으나 표제란에 비파괴검사(NDT) 비율이 표기되지 않았습니다.`,
      recommendation: '유체 등급(가연성/독성/고압)에 맞는 RT 10%~100% 기준과 수압/기밀시험 압력을 도면에 명시하세요.',
      source: 'rule_engine',
    });
  }

  return findings;
}

/** Auto-map Korean 6-Law regulatory permits from ISO gas/pressure/temp triggers. */
export function derivePlantPermitChecklist(iso: IsoAnalysisResult): PlantPermitCheck[] {
  const tb = iso.title_block;
  const gas = (tb.fluid_gas || '').trim().toUpperCase();
  const press = tb.design_pressure_bar ?? 0;
  const isFlammableOrToxic = ['H2', 'LH2', 'SIH4', 'NH3', 'HCL', 'NF3'].includes(gas);
  const checks: PlantPermitCheck[] = [];

  if (press >= 10 || ['H2', 'LH2', 'O2', 'LOX', 'N2', 'LIN', 'AR', 'LAR', 'LCO2'].includes(gas)) {
    checks.push({
      law: '고압가스안전관리법',
      permit_name: 'KGS 기술검토 · 제조/저장 허가 및 완성검사',
      authority: '한국가스안전공사(KGS) · 관할 지자체',
      rule_ref: '고가법 제4조·제16조 · KGS FP111/FU111',
      required: '필수',
      reason: `취급 가스(${gas || '고압가스'}), 설계압력 ${press || '고압'} bar 기준 고압가스 시설 기술검토 및 배관 비파괴·내압 완성검사 대상`,
    });
  }

  if (isFlammableOrToxic) {
    checks.push({
      law: '산업안전보건법',
      permit_name: '공정안전보고서(PSM) 심사 및 현장확인 (착공 30일 전)',
      authority: '고용노동부 · 안전보건공단 중대산업사고예방센터',
      rule_ref: '산안법 제44조 · 시행령 별표 13',
      required: '필수',
      reason: `인화성/독성 가스(${gas}) 규정량 이상 취급 시 착공 30일 전 PSM 제출 필수 (PSM 제출 시 유해위험방지계획서 중복 면제)`,
    });
    checks.push({
      law: '화학물질관리법',
      permit_name: '화학사고예방관리계획서 & 취급시설 설치검사',
      authority: '화학물질안전원 · 지방환경청 · KGS/KOSHA',
      rule_ref: '화관법 제23조·제24조',
      required: '검토필요',
      reason: '유해화학물질(암모니아·염화수소 등) 취급량 해당 시 가동 전 설치검사 필수',
    });
  }

  checks.push({
    law: '산업안전보건법',
    permit_name: '유해·위험방지계획서 & 작업계획서(중량물/배관양중)',
    authority: '안전보건공단(KOSHA)',
    rule_ref: '산안법 제42조 · 안전보건규칙 제38조',
    required: '검토필요',
    reason: '플랜트 배관 양중·고소·화기·밀폐작업 착공 전 계획서 및 안전보건대장 확인',
  });

  checks.push({
    law: '소방시설공사업법',
    permit_name: '소방시설 착공신고 · 완공검사 (가스감지·살수설비)',
    authority: '관할 소방서',
    rule_ref: '소방시설공사업법 제13조·제14조',
    required: '검토필요',
    reason: '고압·가연성 가스 설비 구역 물분무/소화설비 및 위험물 연동 여부 확인',
  });

  return checks;
}

/** Parse contractor-submitted BOQ Excel (.xlsx/.xls/.csv) into normalized VendorBoqItem[]. */
export function parseVendorBoqExcel(buffer: ArrayBuffer): VendorBoqItem[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const out: VendorBoqItem[] = [];

  rows.forEach((r, idx) => {
    const entries = Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), String(v ?? '').trim()] as const);
    const pick = (keys: string[]) =>
      entries.find(([k]) => keys.some((t) => k.includes(t)))?.[1] || '';

    const desc = pick(['품명', '품목', '항목', 'description', 'item', '자재']);
    const spec = pick(['규격', '관경', 'size', 'spec', '호칭']);
    const qtyRaw = pick(['수량', '물량', 'qty', 'quantity']);
    const unitRaw = pick(['단위', 'unit']);
    const priceRaw = pick(['단가', 'unit_price', 'price']);

    const qty = Number(qtyRaw.replace(/,/g, ''));
    if (!desc || !Number.isFinite(qty) || qty <= 0) return;

    const unit: 'm' | 'EA' = unitRaw.toLowerCase() === 'm' || unitRaw.includes('미터') ? 'm' : 'EA';
    const price = Number(priceRaw.replace(/,/g, ''));
    out.push({
      row_no: idx + 2,
      category: inferBomCategory(`${desc} ${spec}`),
      description: desc,
      size_inch: normalizePipeSize(spec || desc),
      quantity: qty,
      unit,
      unit_price: Number.isFinite(price) && price > 0 ? price : undefined,
    });
  });

  return out;
}

/** 1:1 Cross-check between ISO BOM and Vendor BOQ by normalized (category + size + unit). */
export function crossCheckIsoVsVendorBoq(
  isoBom: IsoBomItem[],
  vendorBoq: VendorBoqItem[],
): BoqDiffRow[] {
  const isoMap = new Map<string, { category: IsoBomCategory; size: string; unit: 'm' | 'EA'; qty: number; desc: string }>();
  for (const item of isoBom) {
    const size = normalizePipeSize(item.size_inch);
    const key = `${item.category}|${size}|${item.unit}`;
    const cur = isoMap.get(key);
    if (cur) {
      cur.qty = Number((cur.qty + item.quantity).toFixed(2));
    } else {
      isoMap.set(key, {
        category: item.category,
        size,
        unit: item.unit,
        qty: Number(item.quantity.toFixed(2)),
        desc: item.description,
      });
    }
  }

  const vendorMap = new Map<string, { category: IsoBomCategory; size: string; unit: 'm' | 'EA'; qty: number; desc: string; unitPrice?: number }>();
  for (const item of vendorBoq) {
    const size = normalizePipeSize(item.size_inch);
    const key = `${item.category}|${size}|${item.unit}`;
    const cur = vendorMap.get(key);
    if (cur) {
      cur.qty = Number((cur.qty + item.quantity).toFixed(2));
      if (!cur.unitPrice && item.unit_price) cur.unitPrice = item.unit_price;
    } else {
      vendorMap.set(key, {
        category: item.category,
        size,
        unit: item.unit,
        qty: Number(item.quantity.toFixed(2)),
        desc: item.description,
        unitPrice: item.unit_price,
      });
    }
  }

  const allKeys = new Set([...isoMap.keys(), ...vendorMap.keys()]);
  const diff: BoqDiffRow[] = [];

  for (const key of allKeys) {
    const i = isoMap.get(key);
    const v = vendorMap.get(key);
    const isoQty = i?.qty ?? 0;
    const vendorQty = v?.qty ?? 0;
    const delta = Number((vendorQty - isoQty).toFixed(2));

    let status: BoqDiffStatus = 'match';
    if (!i && v) status = 'not_in_drawing';
    else if (i && !v) status = 'missing_in_boq';
    else if (delta > 0.01) status = 'overclaimed';
    else if (delta < -0.01) status = 'underclaimed';

    diff.push({
      key,
      category: (i?.category || v?.category || 'other') as IsoBomCategory,
      size_inch: i?.size || v?.size || 'N/A',
      description: i?.desc || v?.desc || '',
      unit: i?.unit || v?.unit || 'EA',
      iso_qty: isoQty,
      vendor_qty: vendorQty,
      delta_qty: delta,
      status,
      estimated_overclaim_krw: delta > 0 && v?.unitPrice ? Math.round(delta * v.unitPrice) : undefined,
    });
  }

  const order: Record<BoqDiffStatus, number> = {
    overclaimed: 0,
    not_in_drawing: 1,
    missing_in_boq: 2,
    underclaimed: 3,
    match: 4,
  };
  return diff.sort((a, b) => order[a.status] - order[b.status]);
}

export function downloadBoqCrossCheckExcel(lineNo: string, rows: BoqDiffRow[]) {
  const STATUS_KR: Record<BoqDiffStatus, string> = {
    match: '일치',
    overclaimed: '과다청구',
    underclaimed: '과소청구',
    missing_in_boq: '물량표 누락',
    not_in_drawing: '도면 미기재',
  };
  const sheetRows = rows.map((r) => ({
    판정: STATUS_KR[r.status],
    분류: r.category,
    규격: r.size_inch,
    품명: r.description,
    단위: r.unit,
    도면BOM수량: r.iso_qty,
    업체청구수량: r.vendor_qty,
    차이: r.delta_qty,
    과다청구추정액: r.estimated_overclaim_krw ?? '',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, '물량표_교차검증');
  XLSX.writeFile(wb, `ISO_물량교차검증_${(lineNo || 'LINE').replace(/[^\w-]/g, '_')}.xlsx`);
}

/** Built-in realistic Air Liquide sample ISO + Vendor BOQ for instant verification. */
export const SAMPLE_ISO_LOX: IsoAnalysisResult = {
  title_block: {
    drawing_no: 'ISO-LOX-204-R1',
    line_no: '2"-LOX-204-SS316L-C',
    revision: 'Rev.1',
    fluid_gas: 'LOX',
    pipe_spec: 'ASTM A312 TP316L SCH40S',
    design_pressure_bar: 25,
    design_temp_c: -196,
    insulation_type: 'Vacuum Jacket / Cryo Cold',
    nde_rt_percent: 100,
    pwht_required: false,
    o2_cleaning_required: false, // Intentional defect for demo verification
  },
  welds: { shop_weld_count: 14, field_weld_count: 8 },
  topology_counts: { psv_count: 0, block_valve_count: 2, check_valve_count: 1, vent_drain_count: 1 },
  bom: [
    { item_no: '1', category: 'pipe', description: 'SMLS PIPE SUS316L SCH40S', size_inch: '2"', material: 'TP316L', quantity: 24.5, unit: 'm' },
    { item_no: '2', category: 'elbow', description: '90DEG LR ELBOW BW', size_inch: '2"', material: 'TP316L', quantity: 6, unit: 'EA' },
    { item_no: '3', category: 'flange', description: 'WNRF FLANGE 300#', size_inch: '2"', material: 'F316L', quantity: 4, unit: 'EA' },
    { item_no: '4', category: 'valve', description: 'CRYOGENIC GLOBE VALVE 300#', size_inch: '2"', material: 'CF8M', quantity: 2, unit: 'EA' },
    { item_no: '5', category: 'bolt_gasket', description: 'SPIRAL WOUND GASKET & STUD BOLT SET', size_inch: '2"', material: 'SUS316/PTFE', quantity: 2, unit: 'EA' },
  ],
  ai_findings: [],
  summary: '액화산소(LOX, -196°C, 25bar) 2인치 이송 배관 ISO. 양단 차단밸브(2개) 구간 내 Thermal Relief PSV 누락 및 O2 Cleaning 표기 누락 확인됨.',
};

export const SAMPLE_VENDOR_BOQ_LOX: VendorBoqItem[] = [
  { row_no: 2, category: 'pipe', description: 'SUS316L 배관 파이프', size_inch: '50A', quantity: 32, unit: 'm', unit_price: 85000 },
  { row_no: 3, category: 'elbow', description: '90도 엘보 SUS316L', size_inch: 'DN50', quantity: 8, unit: 'EA', unit_price: 35000 },
  { row_no: 4, category: 'flange', description: 'WNRF 플랜지 300#', size_inch: '2"', quantity: 4, unit: 'EA', unit_price: 55000 },
  { row_no: 5, category: 'valve', description: '초저온 글로브 밸브', size_inch: '2"', quantity: 2, unit: 'EA', unit_price: 680000 },
  { row_no: 6, category: 'tee', description: '이경 티 SUS316L', size_inch: '2"', quantity: 2, unit: 'EA', unit_price: 45000 },
];
