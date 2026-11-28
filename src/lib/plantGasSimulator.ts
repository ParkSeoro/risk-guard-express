/**
 * Air Liquide Industrial Gas Plant Operational Simulator Engine (Deterministic).
 * Models cryogenic liquid trapping (thermal expansion), compressor dead-head overpressure,
 * PSV relief activation (API 520/521 & KGS FP111), LCO2 triple-point dry-ice plugging,
 * and check-valve failure backflow on interactive P&ID/ISO circuits.
 */
import type { IsoAnalysisResult } from './plantIsoEngine';

export type SimGasCode = 'LOX' | 'LIN' | 'LAR' | 'H2' | 'LH2' | 'LCO2' | 'N2' | 'O2';

export type SimNodeKind =
  | 'source'
  | 'valve'
  | 'check_valve'
  | 'equipment'
  | 'psv'
  | 'consumer';

export type SimSegmentStatus = 'normal' | 'standby' | 'relieving' | 'warning' | 'critical';

export interface SimNode {
  id: string;
  label: string;
  tag: string;
  kind: SimNodeKind;
  x: number; // SVG coordinate (0..900)
  y: number; // SVG coordinate (0..320)
  /** For 'valve': true = OPEN, false = CLOSED */
  isOpen?: boolean;
  /** For 'psv': true = installed & active, false = missing / bypassed */
  psvInstalled?: boolean;
  /** For 'psv': relief set pressure (barG) */
  psvSetBar?: number;
  /** For 'psv': which segment ID it protects */
  protectsSegmentId?: string;
  /** For 'check_valve': true = healthy, false = stuck open (backflow risk) */
  checkHealthy?: boolean;
  /** For 'equipment': e.g. 'vaporizer' | 'compressor' | 'buffer_tank' | 'pump' */
  equipmentType?: 'vaporizer' | 'compressor' | 'buffer_tank' | 'pump';
}

export interface SimSegment {
  id: string;
  label: string;
  fromNodeId: string;
  toNodeId: string;
  sizeLabel: string;
  mawpBar: number;
  /** Whether cryogenic liquid can be trapped in this segment */
  isCryoLiquidSection?: boolean;
  /** Whether this segment is downstream of a compressor/pump discharge */
  isDischargeSection?: boolean;
}

export interface SimScenarioPreset {
  id: string;
  name: string;
  description: string;
  inletPressureBar: number;
  ambientHeatPct: number; // 0..100 (ambient heat inleak or load %)
  valveStates: Record<string, boolean>;
  psvStates?: Record<string, boolean>;
  checkValveStates?: Record<string, boolean>;
  downstreamBackpressureBar?: number;
}

export interface SimCircuitDefinition {
  id: string;
  name: string;
  subtitle: string;
  gas: SimGasCode;
  designPressureBar: number;
  designTempC: number;
  defaultInletPressureBar: number;
  defaultAmbientHeatPct: number;
  nodes: SimNode[];
  segments: SimSegment[];
  scenarios: SimScenarioPreset[];
}

export interface SimSegmentState {
  segmentId: string;
  pressureBar: number;
  tempC: number;
  flowRatePct: number; // 0 = stagnant, >0 = forward, <0 = backflow
  status: SimSegmentStatus;
  statusLabel: string;
  psvRelieving: boolean;
}

export interface SimAlarm {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  code:
    | 'THERMAL_TRAPPING_OVERPRESSURE'
    | 'DEAD_HEAD_OVERPRESSURE'
    | 'MAWP_EXCEEDED'
    | 'PSV_RELIEVING'
    | 'LCO2_DRY_ICE_PLUGGING'
    | 'BACKFLOW_HAZARD'
    | 'SYSTEM_NORMAL';
  segmentId?: string;
  title: string;
  detail: string;
  ruleRef: string;
  action: string;
}

export interface SimRunResult {
  overallStatus: 'normal' | 'warning' | 'critical';
  overallLabel: string;
  segments: Record<string, SimSegmentState>;
  relievingPsvIds: string[];
  alarms: SimAlarm[];
  maxPressureBar: number;
  deliveryFlowPct: number;
}

export interface SimRuntimeInputs {
  inletPressureBar: number;
  ambientHeatPct: number;
  downstreamBackpressureBar?: number;
  valveStates: Record<string, boolean>;
  psvStates: Record<string, boolean>;
  checkValveStates: Record<string, boolean>;
}

const GAS_BASE_TEMP: Record<SimGasCode, number> = {
  LOX: -183,
  LIN: -196,
  LAR: -186,
  LH2: -253,
  LCO2: -20,
  H2: 25,
  N2: 20,
  O2: 20,
};

export function isCryoGas(gas: SimGasCode): boolean {
  return gas === 'LOX' || gas === 'LIN' || gas === 'LAR' || gas === 'LH2';
}

/**
 * Preset 1: Air Liquide LOX Cryogenic Supply Line
 * Tank -> XV-101 -> Cryo Liquid Line (PSV-101) -> XV-102 -> Vaporizer -> XV-103 -> Consumer
 */
export const PRESET_LOX_CRYO: SimCircuitDefinition = {
  id: 'lox_cryo',
  name: 'LOX 극저온 공급계통 (저장탱크 → 기화기 → 수요처)',
  subtitle: '액화산소(-183°C) 이중 차단 시 액봉(Thermal Trapping) 및 Thermal PSV 작동 시뮬레이션',
  gas: 'LOX',
  designPressureBar: 16,
  designTempC: -183,
  defaultInletPressureBar: 11,
  defaultAmbientHeatPct: 45,
  nodes: [
    { id: 'src', label: 'LOX 저장탱크', tag: 'TK-201', kind: 'source', x: 70, y: 185 },
    { id: 'xv1', label: '탱크 출구밸브', tag: 'XV-201', kind: 'valve', x: 210, y: 185, isOpen: true },
    { id: 'psv1', label: 'Thermal PSV', tag: 'PSV-201', kind: 'psv', x: 335, y: 80, psvInstalled: true, psvSetBar: 16, protectsSegmentId: 'seg2' },
    { id: 'xv2', label: '기화기 입구밸브', tag: 'XV-202', kind: 'valve', x: 460, y: 185, isOpen: true },
    { id: 'vap', label: '대기식 기화기', tag: 'VAP-201', kind: 'equipment', equipmentType: 'vaporizer', x: 615, y: 185 },
    { id: 'xv3', label: '공급 차단밸브', tag: 'XV-203', kind: 'valve', x: 745, y: 185, isOpen: true },
    { id: 'dst', label: '수요처 헤더', tag: 'HDR-O2', kind: 'consumer', x: 850, y: 185 },
  ],
  segments: [
    { id: 'seg1', label: '탱크 인출배관', fromNodeId: 'src', toNodeId: 'xv1', sizeLabel: '2" (50A)', mawpBar: 16, isCryoLiquidSection: true },
    { id: 'seg2', label: '극저온 액체구간 (이중차단 위험)', fromNodeId: 'xv1', toNodeId: 'xv2', sizeLabel: '2" (50A)', mawpBar: 16, isCryoLiquidSection: true },
    { id: 'seg3', label: '기화기 인입배관', fromNodeId: 'xv2', toNodeId: 'vap', sizeLabel: '2" (50A)', mawpBar: 16, isCryoLiquidSection: true },
    { id: 'seg4', label: '기화기 출구배관', fromNodeId: 'vap', toNodeId: 'xv3', sizeLabel: '2" (50A)', mawpBar: 16 },
    { id: 'seg5', label: 'O2 공급헤더', fromNodeId: 'xv3', toNodeId: 'dst', sizeLabel: '2" (50A)', mawpBar: 16 },
  ],
  scenarios: [
    {
      id: 'normal',
      name: '정상 운전',
      description: '모든 차단밸브 개방, 11 bar 정상 기화 공급',
      inletPressureBar: 11,
      ambientHeatPct: 45,
      valveStates: { xv1: true, xv2: true, xv3: true },
      psvStates: { psv1: true },
    },
    {
      id: 'trapped_with_psv',
      name: '이중 차단 (PSV 정상 작동)',
      description: 'XV-201·XV-202 동시 폐쇄 → 외기 열유입으로 압력 상승 후 PSV-201 안전 방출',
      inletPressureBar: 11,
      ambientHeatPct: 75,
      valveStates: { xv1: false, xv2: false, xv3: true },
      psvStates: { psv1: true },
    },
    {
      id: 'trapped_no_psv',
      name: '사고 시나리오: PSV 누락 액봉 파열',
      description: 'PSV-201 미설치 상태에서 이중 차단 시 극저온 액체 기화로 80+ bar 과압 파열',
      inletPressureBar: 11,
      ambientHeatPct: 80,
      valveStates: { xv1: false, xv2: false, xv3: true },
      psvStates: { psv1: false },
    },
  ],
};

/**
 * Preset 2: Air Liquide H2 High-Pressure Compressor & Buffer Supply
 */
export const PRESET_H2_COMPRESSOR: SimCircuitDefinition = {
  id: 'h2_compressor',
  name: 'H2 고압 압축·공급 계통 (압축기 → 역지밸브 → 버퍼탱크)',
  subtitle: '수소(45 bar) 후단 폐쇄(Dead-head) 과압 · 역지밸브 고장 역류 · PSV 방출 시뮬레이션',
  gas: 'H2',
  designPressureBar: 45,
  designTempC: 40,
  defaultInletPressureBar: 32,
  defaultAmbientHeatPct: 50,
  nodes: [
    { id: 'src', label: 'H2 압축기', tag: 'C-101', kind: 'source', x: 70, y: 185 },
    { id: 'cv1', label: '토출 역지밸브', tag: 'CV-101', kind: 'check_valve', x: 215, y: 185, checkHealthy: true },
    { id: 'psv1', label: '토출 안전밸브', tag: 'PSV-101', kind: 'psv', x: 345, y: 80, psvInstalled: true, psvSetBar: 45, protectsSegmentId: 'seg2' },
    { id: 'buf', label: 'H2 버퍼탱크', tag: 'V-101', kind: 'equipment', equipmentType: 'buffer_tank', x: 475, y: 185 },
    { id: 'xv1', label: '공급 차단밸브', tag: 'XV-101', kind: 'valve', x: 645, y: 185, isOpen: true },
    { id: 'dst', label: '수소 수요처', tag: 'HDR-H2', kind: 'consumer', x: 840, y: 185 },
  ],
  segments: [
    { id: 'seg1', label: '압축기 토출관', fromNodeId: 'src', toNodeId: 'cv1', sizeLabel: '3" (80A)', mawpBar: 45, isDischargeSection: true },
    { id: 'seg2', label: '고압 버퍼 인입관', fromNodeId: 'cv1', toNodeId: 'buf', sizeLabel: '3" (80A)', mawpBar: 45, isDischargeSection: true },
    { id: 'seg3', label: '버퍼 출구관', fromNodeId: 'buf', toNodeId: 'xv1', sizeLabel: '3" (80A)', mawpBar: 45, isDischargeSection: true },
    { id: 'seg4', label: 'H2 공급헤더', fromNodeId: 'xv1', toNodeId: 'dst', sizeLabel: '3" (80A)', mawpBar: 45 },
  ],
  scenarios: [
    {
      id: 'normal',
      name: '정상 운전 (32 bar)',
      description: '압축기 정상 토출 및 버퍼 경유 수요처 공급',
      inletPressureBar: 32,
      ambientHeatPct: 50,
      valveStates: { xv1: true },
      psvStates: { psv1: true },
      checkValveStates: { cv1: true },
      downstreamBackpressureBar: 20,
    },
    {
      id: 'deadhead_psv',
      name: '후단 긴급차단 (PSV 정상 방출)',
      description: 'XV-101 폐쇄로 압축기 Dead-head 발생 → PSV-101 45 bar에서 안전 방출',
      inletPressureBar: 40,
      ambientHeatPct: 80,
      valveStates: { xv1: false },
      psvStates: { psv1: true },
      checkValveStates: { cv1: true },
    },
    {
      id: 'deadhead_no_psv',
      name: '사고 시나리오: PSV 고착 Dead-head 과압',
      description: 'XV-101 폐쇄 + PSV-101 미작동 시 64 bar 이상 과압 파열 위험',
      inletPressureBar: 40,
      ambientHeatPct: 85,
      valveStates: { xv1: false },
      psvStates: { psv1: false },
      checkValveStates: { cv1: true },
    },
    {
      id: 'backflow',
      name: '사고 시나리오: 역지밸브 고장 역류',
      description: '압축기 저압 정지 중 CV-101 고착(열림)으로 고압 H2 역류 발생',
      inletPressureBar: 12,
      ambientHeatPct: 30,
      valveStates: { xv1: true },
      psvStates: { psv1: true },
      checkValveStates: { cv1: false },
      downstreamBackpressureBar: 38,
    },
  ],
};

/**
 * Preset 3: Air Liquide LCO2 Supply (Triple Point Dry-Ice Plugging Hazard)
 */
export const PRESET_LCO2_SUPPLY: SimCircuitDefinition = {
  id: 'lco2_supply',
  name: 'LCO2 액화탄산 공급계통 (삼중점 드라이아이스 감시)',
  subtitle: 'LCO2(-20°C / 22 bar) 압력 강하 시 삼중점(5.18 bar abs) 이하 드라이아이스 배관 폐쇄 시뮬레이션',
  gas: 'LCO2',
  designPressureBar: 25,
  designTempC: -20,
  defaultInletPressureBar: 18,
  defaultAmbientHeatPct: 40,
  nodes: [
    { id: 'src', label: 'LCO2 탱크', tag: 'TK-301', kind: 'source', x: 70, y: 185 },
    { id: 'xv1', label: '인출 밸브', tag: 'XV-301', kind: 'valve', x: 225, y: 185, isOpen: true },
    { id: 'psv1', label: '라인 안전밸브', tag: 'PSV-301', kind: 'psv', x: 375, y: 80, psvInstalled: true, psvSetBar: 25, protectsSegmentId: 'seg2' },
    { id: 'vap', label: 'LCO2 기화기', tag: 'VAP-301', kind: 'equipment', equipmentType: 'vaporizer', x: 525, y: 185 },
    { id: 'xv2', label: '공급 밸브', tag: 'XV-302', kind: 'valve', x: 690, y: 185, isOpen: true },
    { id: 'dst', label: 'CO2 수요처', tag: 'HDR-CO2', kind: 'consumer', x: 845, y: 185 },
  ],
  segments: [
    { id: 'seg1', label: '탱크 인출관', fromNodeId: 'src', toNodeId: 'xv1', sizeLabel: '2" (50A)', mawpBar: 25, isCryoLiquidSection: true },
    { id: 'seg2', label: 'LCO2 액상배관', fromNodeId: 'xv1', toNodeId: 'vap', sizeLabel: '2" (50A)', mawpBar: 25, isCryoLiquidSection: true },
    { id: 'seg3', label: '기화기 출구관', fromNodeId: 'vap', toNodeId: 'xv2', sizeLabel: '2" (50A)', mawpBar: 25 },
    { id: 'seg4', label: 'CO2 공급헤더', fromNodeId: 'xv2', toNodeId: 'dst', sizeLabel: '2" (50A)', mawpBar: 25 },
  ],
  scenarios: [
    {
      id: 'normal',
      name: '정상 운전 (18 bar)',
      description: '삼중점(5.18 bar) 이상 유지로 안정적 액상 이송 및 기화',
      inletPressureBar: 18,
      ambientHeatPct: 40,
      valveStates: { xv1: true, xv2: true },
      psvStates: { psv1: true },
    },
    {
      id: 'dry_ice',
      name: '사고 시나리오: 삼중점 이하 드라이아이스 폐쇄',
      description: '탱크 압력 4.5 bar로 급감 → 액화탄산이 고체 드라이아이스로 변해 배관 막힘',
      inletPressureBar: 4.5,
      ambientHeatPct: 25,
      valveStates: { xv1: true, xv2: true },
      psvStates: { psv1: true },
    },
  ],
};

export const SIMULATOR_PRESETS: SimCircuitDefinition[] = [
  PRESET_LOX_CRYO,
  PRESET_H2_COMPRESSOR,
  PRESET_LCO2_SUPPLY,
];

function normalizeSimGas(raw: string | null | undefined): SimGasCode {
  const g = (raw || '').toUpperCase().trim();
  if (g.includes('LOX')) return 'LOX';
  if (g.includes('LIN')) return 'LIN';
  if (g.includes('LAR')) return 'LAR';
  if (g.includes('LH2')) return 'LH2';
  if (g.includes('LCO2') || g.includes('CO2')) return 'LCO2';
  if (g.includes('H2')) return 'H2';
  if (g.includes('O2')) return 'O2';
  return 'N2';
}

/**
 * Automatically synthesizes an executable P&ID/ISO simulation circuit
 * directly from the Tab 1 analyzed IsoAnalysisResult.
 */
export function buildCircuitFromIso(iso: IsoAnalysisResult): SimCircuitDefinition {
  const gas = normalizeSimGas(iso.title_block.fluid_gas);
  const mawp = Math.max(6, iso.title_block.design_pressure_bar ?? 16);
  const temp = iso.title_block.design_temp_c ?? GAS_BASE_TEMP[gas];
  const hasPsvInIso = iso.topology_counts.psv_count > 0;
  const lineSize = iso.bom.find((b) => b.category === 'pipe')?.size_inch || '2"';
  const lineNo = iso.title_block.line_no || iso.title_block.drawing_no || 'ISO-LINE';
  const cryo = isCryoGas(gas) || temp <= -40;

  return {
    id: `iso_${lineNo}`,
    name: `[도면 연동] ${lineNo} (${gas})`,
    subtitle: `분석된 ISO 도면 제원 자동 반영 — 설계압력 ${mawp} bar / ${temp}°C · 도면 내 PSV ${iso.topology_counts.psv_count}개 · 차단밸브 ${iso.topology_counts.block_valve_count}개`,
    gas,
    designPressureBar: mawp,
    designTempC: temp,
    defaultInletPressureBar: Math.round(mawp * 0.72 * 10) / 10,
    defaultAmbientHeatPct: 55,
    nodes: [
      { id: 'src', label: `${gas} 공급원`, tag: 'INLET', kind: 'source', x: 75, y: 185 },
      { id: 'xv1', label: '1차 차단밸브', tag: 'BV-01', kind: 'valve', x: 230, y: 185, isOpen: true },
      {
        id: 'psv1',
        label: hasPsvInIso ? '도면 PSV' : 'PSV (도면 누락!)',
        tag: 'PSV-01',
        kind: 'psv',
        x: 410,
        y: 80,
        psvInstalled: hasPsvInIso,
        psvSetBar: mawp,
        protectsSegmentId: 'seg2',
      },
      { id: 'xv2', label: '2차 차단밸브', tag: 'BV-02', kind: 'valve', x: 590, y: 185, isOpen: true },
      { id: 'dst', label: '하류 공정', tag: 'OUTLET', kind: 'consumer', x: 825, y: 185 },
    ],
    segments: [
      { id: 'seg1', label: '인입 구간', fromNodeId: 'src', toNodeId: 'xv1', sizeLabel: lineSize, mawpBar: mawp, isCryoLiquidSection: cryo },
      { id: 'seg2', label: `${lineNo} 본관 구간`, fromNodeId: 'xv1', toNodeId: 'xv2', sizeLabel: lineSize, mawpBar: mawp, isCryoLiquidSection: cryo, isDischargeSection: !cryo },
      { id: 'seg3', label: '출구 연결 구간', fromNodeId: 'xv2', toNodeId: 'dst', sizeLabel: lineSize, mawpBar: mawp },
    ],
    scenarios: [
      {
        id: 'iso_normal',
        name: '정상 통가스 테스트',
        description: '차단밸브 모두 개방, 정상 설계압력 72%로 가스 공급',
        inletPressureBar: Math.round(mawp * 0.72 * 10) / 10,
        ambientHeatPct: 50,
        valveStates: { xv1: true, xv2: true },
        psvStates: { psv1: hasPsvInIso },
      },
      {
        id: 'iso_trapped',
        name: '이중 차단 안전성 검증',
        description: hasPsvInIso
          ? '이중 차단 시 도면의 PSV가 정상 작동하는지 검증'
          : '도면에 PSV가 없는 상태에서 이중 차단 시 과압 파열 위험 재현',
        inletPressureBar: Math.round(mawp * 0.72 * 10) / 10,
        ambientHeatPct: 80,
        valveStates: { xv1: false, xv2: false },
        psvStates: { psv1: hasPsvInIso },
      },
      {
        id: 'iso_psv_fix',
        name: 'PSV 추가 설치 후 재검증',
        description: 'PSV를 설치(ON)하여 이중 차단 시에도 안전 방출되는지 확인',
        inletPressureBar: Math.round(mawp * 0.72 * 10) / 10,
        ambientHeatPct: 80,
        valveStates: { xv1: false, xv2: false },
        psvStates: { psv1: true },
      },
    ],
  };
}

/**
 * Runs deterministic physical & safety evaluation on a circuit for the current runtime inputs.
 */
export function runGasPlantSimulation(
  circuit: SimCircuitDefinition,
  inputs: SimRuntimeInputs,
): SimRunResult {
  const segmentsOut: Record<string, SimSegmentState> = {};
  const alarms: SimAlarm[] = [];
  const relievingPsvIds: string[] = [];

  const nodeMap = new Map(circuit.nodes.map((n) => [n.id, n]));
  const psvBySegment = new Map<string, SimNode>();
  for (const n of circuit.nodes) {
    if (n.kind === 'psv' && n.protectsSegmentId) {
      psvBySegment.set(n.protectsSegmentId, n);
    }
  }

  const isValveOpen = (nodeId: string): boolean => {
    const node = nodeMap.get(nodeId);
    if (!node) return true;
    if (node.kind === 'valve') {
      return inputs.valveStates[nodeId] ?? node.isOpen ?? true;
    }
    return true;
  };

  const isCheckHealthy = (nodeId: string): boolean => {
    const node = nodeMap.get(nodeId);
    if (!node || node.kind !== 'check_valve') return true;
    return inputs.checkValveStates[nodeId] ?? node.checkHealthy ?? true;
  };

  const isPsvActive = (psv: SimNode | undefined): boolean => {
    if (!psv) return false;
    return inputs.psvStates[psv.id] ?? psv.psvInstalled ?? false;
  };

  // Determine whether end-to-end forward path is open
  const allForwardOpen = circuit.nodes
    .filter((n) => n.kind === 'valve')
    .every((v) => isValveOpen(v.id));

  // Detect backflow condition (downstream backpressure > inlet pressure + stuck-open check valve)
  const backpressure = inputs.downstreamBackpressureBar ?? 0;
  const faultyCheckNode = circuit.nodes.find((n) => n.kind === 'check_valve' && !isCheckHealthy(n.id));
  const hasBackflow = Boolean(faultyCheckNode && allForwardOpen && backpressure > inputs.inletPressureBar + 3);

  const heatFactor = Math.max(0, Math.min(100, inputs.ambientHeatPct)) / 100;
  const baseTemp = circuit.designTempC ?? GAS_BASE_TEMP[circuit.gas];
  let upstreamConnected = true;
  let passedVaporizer = false;
  let maxPressureBar = 0;

  circuit.segments.forEach((seg, idx) => {
    const fromNode = nodeMap.get(seg.fromNodeId);
    const toNode = nodeMap.get(seg.toNodeId);
    const psv = psvBySegment.get(seg.id);
    const psvActive = isPsvActive(psv);
    const psvSet = psv?.psvSetBar ?? seg.mawpBar;

    if (fromNode?.kind === 'valve' && !isValveOpen(fromNode.id)) {
      upstreamConnected = false;
    }
    if (fromNode?.equipmentType === 'vaporizer') {
      passedVaporizer = true;
    }

    const downstreamBlocked = toNode?.kind === 'valve' && !isValveOpen(toNode.id);
    const upstreamBlocked = fromNode?.kind === 'valve' && !isValveOpen(fromNode.id);
    const isDoubleBlocked = upstreamBlocked && downstreamBlocked;

    let pressureBar = upstreamConnected
      ? Math.max(0, inputs.inletPressureBar - idx * 0.25)
      : Math.max(1, inputs.inletPressureBar * 0.55);
    let tempC = passedVaporizer ? Math.max(5, Math.round(15 + heatFactor * 10)) : baseTemp;
    let flowRatePct = allForwardOpen ? Math.round(70 + heatFactor * 30) : 0;
    let status: SimSegmentStatus = allForwardOpen ? 'normal' : 'standby';
    let statusLabel = allForwardOpen ? '정상 유동' : '차단 대기';
    let psvRelieving = false;

    // Case 1: Cryogenic Liquid Trapping (Double-blocked cryogenic liquid line)
    if (seg.isCryoLiquidSection && isDoubleBlocked && (isCryoGas(circuit.gas) || baseTemp <= -40)) {
      const trappedUnrelievedBar = Math.round((inputs.inletPressureBar + 25 + heatFactor * 95) * 10) / 10;
      tempC = Math.round(baseTemp + 15 + heatFactor * 45);
      flowRatePct = 0;

      if (psv && psvActive) {
        pressureBar = Math.round(psvSet * 1.03 * 10) / 10;
        psvRelieving = true;
        relievingPsvIds.push(psv.id);
        status = 'relieving';
        statusLabel = `PSV 방출 (${pressureBar} bar)`;
        alarms.push({
          id: `psv_${seg.id}`,
          severity: 'warning',
          code: 'PSV_RELIEVING',
          segmentId: seg.id,
          title: `[${seg.label}] 액봉 압력 상승 → ${psv.tag} 정상 방출 중`,
          detail: `양단 차단밸브 폐쇄로 극저온 유체가 갇혔으나 ${psv.tag}(설정압력 ${psvSet} bar)가 개방되어 배관 파열을 방지하고 있습니다.`,
          ruleRef: 'API 521 / EIGA Doc 24 / KGS FP111',
          action: '방출 벤트 방향 안전 확인 후, 한쪽 차단밸브를 서서히 개방하여 액봉을 해소하세요.',
        });
      } else {
        pressureBar = trappedUnrelievedBar;
        status = 'critical';
        statusLabel = `액봉 파열 위험 (${pressureBar} bar!)`;
        alarms.push({
          id: `trap_${seg.id}`,
          severity: 'critical',
          code: 'THERMAL_TRAPPING_OVERPRESSURE',
          segmentId: seg.id,
          title: `[${seg.label}] 극저온 액봉 과압 파열 위험 (${pressureBar} bar > MAWP ${seg.mawpBar} bar)`,
          detail: `극저온 액화가스(${circuit.gas})가 양단 차단밸브 사이에 갇혀 외기 열유입(${inputs.ambientHeatPct}%)으로 기화 팽창 중이나, Thermal Relief PSV가 없거나 차단되어 있습니다.`,
          ruleRef: 'KGS FP111 / API 520·521 / EIGA Doc 24 (절대 금지)',
          action: '즉시 Thermal Relief PSV를 설계·추가 설치하거나, 이중 차단 인터락을 적용하세요.',
        });
      }
    }
    // Case 2: Compressor/Pump Dead-head overpressure when downstream valve closes
    else if (seg.isDischargeSection && upstreamConnected && !allForwardOpen) {
      const deadheadBar = Math.round((inputs.inletPressureBar * (1.28 + heatFactor * 0.42)) * 10) / 10;
      flowRatePct = 0;

      if (deadheadBar > seg.mawpBar) {
        if (psv && psvActive) {
          pressureBar = Math.round(psvSet * 1.04 * 10) / 10;
          psvRelieving = true;
          relievingPsvIds.push(psv.id);
          status = 'relieving';
          statusLabel = `Dead-head PSV 방출 (${pressureBar} bar)`;
          alarms.push({
            id: `dh_psv_${seg.id}`,
            severity: 'warning',
            code: 'PSV_RELIEVING',
            segmentId: seg.id,
            title: `[${seg.label}] 후단 차단(Dead-head) → ${psv.tag} 안전 방출 작동`,
            detail: `하류 차단밸브 폐쇄로 압축기 토출 압력이 상승했으나 ${psv.tag}(${psvSet} bar)가 정상 개방되었습니다.`,
            ruleRef: 'API 520 / KGS FP111',
            action: '압축기 언로딩 또는 바이패스 운전으로 전환하고 하류 차단 원인을 확인하세요.',
          });
        } else {
          pressureBar = deadheadBar;
          status = 'critical';
          statusLabel = `Dead-head 과압 (${pressureBar} bar!)`;
          alarms.push({
            id: `dh_crit_${seg.id}`,
            severity: 'critical',
            code: 'DEAD_HEAD_OVERPRESSURE',
            segmentId: seg.id,
            title: `[${seg.label}] 압축기 Dead-head 과압 파열 위험 (${pressureBar} bar > MAWP ${seg.mawpBar} bar)`,
            detail: `하류 밸브가 닫힌 상태에서 압축기 토출압이 설계압력(${seg.mawpBar} bar)을 초과했으나 작동 가능한 PSV가 없습니다.`,
            ruleRef: 'API 521 / 산안법 안전보건규칙 제261조',
            action: '토출측 PSV 설치·복구 및 고압 차단 스위치(PSHH) 인터락을 구성하세요.',
          });
        }
      } else {
        pressureBar = deadheadBar;
        status = 'warning';
        statusLabel = `체절 압력 상승 (${pressureBar} bar)`;
      }
    }
    // Case 3: Backflow via stuck-open check valve
    else if (hasBackflow) {
      pressureBar = Math.round(backpressure * 10) / 10;
      flowRatePct = -65;
      status = 'critical';
      statusLabel = `역류 발생 (${pressureBar} bar ←)`;
      if (idx === 0) {
        alarms.push({
          id: `bf_${seg.id}`,
          severity: 'critical',
          code: 'BACKFLOW_HAZARD',
          segmentId: seg.id,
          title: `역지밸브(${faultyCheckNode?.tag}) 고착으로 고압 ${circuit.gas} 역류 발생`,
          detail: `하류 배압(${backpressure} bar)이 공급압(${inputs.inletPressureBar} bar)을 초과하고 역지밸브가 닫히지 않아 압축기/저압측으로 가스가 역류하고 있습니다.`,
          ruleRef: 'KGS FP111 / 산안법 안전보건규칙 제268조',
          action: '역지밸브(Check Valve) 점검·교체 및 이중 역류방지(긴급차단밸브 연동)를 적용하세요.',
        });
      }
    }
    // Case 4: LCO2 Triple-Point Dry-Ice Plugging (< 5.2 bar)
    else if (circuit.gas === 'LCO2' && seg.isCryoLiquidSection && pressureBar < 5.2) {
      flowRatePct = 0;
      tempC = -57;
      status = 'critical';
      statusLabel = `드라이아이스 폐쇄 (${pressureBar} bar!)`;
      if (!alarms.some((a) => a.code === 'LCO2_DRY_ICE_PLUGGING')) {
        alarms.push({
          id: `dryice_${seg.id}`,
          severity: 'critical',
          code: 'LCO2_DRY_ICE_PLUGGING',
          segmentId: seg.id,
          title: `[${seg.label}] LCO2 삼중점(5.18 bar) 이하 — 드라이아이스 배관 폐쇄 위험`,
          detail: `배관 압력이 ${pressureBar.toFixed(1)} bar로 떨어져 액화탄산이 고체 드라이아이스(-56.6°C)로 상변화하며 밸브·배관을 막고 2차 과압을 유발할 수 있습니다.`,
          ruleRef: 'EIGA Doc 66 (CO2 Safety) / KGS FP111',
          action: '저장탱크 압력 유지(≥ 12 bar) 및 감압 전 예열기·기화기 후단 감압 설계를 확인하세요.',
        });
      }
    }
    // Case 5: General MAWP Exceeded (e.g. operator raises inlet pressure above design pressure)
    else if (pressureBar > seg.mawpBar) {
      if (psv && psvActive) {
        pressureBar = Math.round(psvSet * 1.03 * 10) / 10;
        psvRelieving = true;
        relievingPsvIds.push(psv.id);
        status = 'relieving';
        statusLabel = `PSV 방출 (${pressureBar} bar)`;
        if (!alarms.some((a) => a.segmentId === seg.id && a.code === 'PSV_RELIEVING')) {
          alarms.push({
            id: `over_psv_${seg.id}`,
            severity: 'warning',
            code: 'PSV_RELIEVING',
            segmentId: seg.id,
            title: `[${seg.label}] 공급 과압 → ${psv.tag} 방출 작동`,
            detail: `운전 압력이 설계압력(${seg.mawpBar} bar)을 초과하여 ${psv.tag}가 압력을 해소 중입니다.`,
            ruleRef: 'API 520 / KGS FP111',
            action: '공급측 압력조절밸브(PRV) 설정치를 확인하세요.',
          });
        }
      } else {
        status = 'critical';
        statusLabel = `설계압 초과 (${pressureBar} bar!)`;
        if (!alarms.some((a) => a.code === 'MAWP_EXCEEDED')) {
          alarms.push({
            id: `mawp_${seg.id}`,
            severity: 'critical',
            code: 'MAWP_EXCEEDED',
            segmentId: seg.id,
            title: `[${seg.label}] 설계압력(MAWP ${seg.mawpBar} bar) 초과 (${pressureBar.toFixed(1)} bar)`,
            detail: `배관 허용압력을 초과한 가스가 유입되고 있으나 보호 PSV가 없습니다.`,
            ruleRef: 'ASME B31.3 / KGS FP111',
            action: '즉시 공급 압력을 낮추고 상류 PRV 및 PSV를 설치하세요.',
          });
        }
      }
    }

    pressureBar = Math.round(pressureBar * 10) / 10;
    if (pressureBar > maxPressureBar) maxPressureBar = pressureBar;

    segmentsOut[seg.id] = {
      segmentId: seg.id,
      pressureBar,
      tempC,
      flowRatePct,
      status,
      statusLabel,
      psvRelieving,
    };
  });

  if (alarms.length === 0) {
    alarms.push({
      id: 'ok',
      severity: 'info',
      code: 'SYSTEM_NORMAL',
      title: `${circuit.gas} 플랜트 계통 정상 운전 중`,
      detail: `모든 배관 구간이 설계압력(${circuit.designPressureBar} bar) 이내에서 안전하게 운전되고 있습니다.`,
      ruleRef: 'Air Liquide Safe Operating Envelope',
      action: '차단밸브를 클릭해 닫거나 PSV를 해제하여 이상 운전 시나리오를 검증해 보세요.',
    });
  }

  const hasCritical = alarms.some((a) => a.severity === 'critical');
  const hasWarning = alarms.some((a) => a.severity === 'warning');
  const overallStatus = hasCritical ? 'critical' : hasWarning ? 'warning' : 'normal';
  const overallLabel = hasCritical
    ? '위험 — 설계 보완 또는 즉시 차단 필요'
    : hasWarning
      ? '주의 — PSV 방출/체절 압력 감시 중'
      : '정상 — 안전 운전 범위(SOE) 이내';

  const lastSeg = circuit.segments[circuit.segments.length - 1];
  const deliveryFlowPct = lastSeg ? Math.max(0, segmentsOut[lastSeg.id]?.flowRatePct ?? 0) : 0;

  return {
    overallStatus,
    overallLabel,
    segments: segmentsOut,
    relievingPsvIds,
    alarms,
    maxPressureBar,
    deliveryFlowPct,
  };
}

export interface AiPidDesignAudit {
  overall_verdict: '적정' | '보완 필요' | '설계 결함(위험)';
  summary: string;
  correct_items: { tag: string; title: string; detail: string }[];
  defect_items: {
    severity: 'critical' | 'warning' | 'info';
    tag: string;
    title: string;
    detail: string;
    rule_ref: string;
    how_to_fix: string;
  }[];
  remediation_steps: string[];
}

/**
 * Normalizes an AI-extracted P&ID/ISO circuit into clean, non-overlapping SVG coordinates
 * so any uploaded real-world drawing renders cleanly as an executable simulator.
 */
export function normalizeAiPidCircuit(raw: any, fileName: string): SimCircuitDefinition {
  const gas = normalizeSimGas(raw?.gas);
  const mawp = Math.max(5, Number(raw?.designPressureBar) || 16);
  const temp = Number.isFinite(Number(raw?.designTempC)) ? Number(raw.designTempC) : GAS_BASE_TEMP[gas];
  const defaultInlet = Math.max(2, Number(raw?.defaultInletPressureBar) || Math.round(mawp * 0.72 * 10) / 10);
  const defaultHeat = Math.max(10, Math.min(100, Number(raw?.defaultAmbientHeatPct) || 55));

  const validKinds: SimNodeKind[] = ['source', 'valve', 'check_valve', 'equipment', 'psv', 'consumer'];
  const rawNodes: any[] = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const mainRaw = rawNodes.filter((n) => n && n.kind !== 'psv');
  const psvRaw = rawNodes.filter((n) => n && n.kind === 'psv');

  // Auto-layout main-line nodes evenly from x=75 to x=845, y=185
  const count = Math.max(mainRaw.length, 2);
  const mainNodes: SimNode[] = mainRaw.map((n, idx) => {
    const x = count === 1 ? 450 : Math.round(75 + (idx / (count - 1)) * 770);
    const kind: SimNodeKind = validKinds.includes(n.kind) ? n.kind : 'equipment';
    return {
      id: String(n.id || `n${idx + 1}`),
      label: String(n.label || n.tag || `노드 ${idx + 1}`),
      tag: String(n.tag || `TAG-${idx + 1}`),
      kind,
      x,
      y: 185,
      isOpen: kind === 'valve' ? (typeof n.isOpen === 'boolean' ? n.isOpen : true) : undefined,
      checkHealthy: kind === 'check_valve' ? (typeof n.checkHealthy === 'boolean' ? n.checkHealthy : true) : undefined,
      equipmentType: kind === 'equipment' ? (n.equipmentType || 'vaporizer') : undefined,
    };
  });

  const mainIdSet = new Set(mainNodes.map((n) => n.id));
  const rawSegs: any[] = Array.isArray(raw?.segments) ? raw.segments : [];
  let segments: SimSegment[] = rawSegs
    .filter((s) => s && mainIdSet.has(String(s.fromNodeId)) && mainIdSet.has(String(s.toNodeId)))
    .map((s, idx) => ({
      id: String(s.id || `seg${idx + 1}`),
      label: String(s.label || `구간 ${idx + 1}`),
      fromNodeId: String(s.fromNodeId),
      toNodeId: String(s.toNodeId),
      sizeLabel: String(s.sizeLabel || '2"'),
      mawpBar: Math.max(5, Number(s.mawpBar) || mawp),
      isCryoLiquidSection: Boolean(s.isCryoLiquidSection),
      isDischargeSection: Boolean(s.isDischargeSection),
    }));

  // Fallback: chain mainNodes sequentially if AI omitted valid segment edges
  if (segments.length === 0 && mainNodes.length >= 2) {
    const cryo = isCryoGas(gas) || temp <= -40;
    segments = mainNodes.slice(0, -1).map((n, idx) => ({
      id: `seg${idx + 1}`,
      label: `${n.tag} → ${mainNodes[idx + 1].tag}`,
      fromNodeId: n.id,
      toNodeId: mainNodes[idx + 1].id,
      sizeLabel: '2"',
      mawpBar: mawp,
      isCryoLiquidSection: cryo && idx < 2,
      isDischargeSection: !cryo && idx < 2,
    }));
  }

  const nodeById = new Map(mainNodes.map((n) => [n.id, n]));
  const psvNodes: SimNode[] = psvRaw.map((p, idx) => {
    const targetSeg =
      segments.find((s) => s.id === String(p.protectsSegmentId)) ||
      segments[Math.min(idx, Math.max(0, segments.length - 1))];
    const from = targetSeg ? nodeById.get(targetSeg.fromNodeId) : undefined;
    const to = targetSeg ? nodeById.get(targetSeg.toNodeId) : undefined;
    const x = from && to ? Math.round((from.x + to.x) / 2) : Math.round(280 + idx * 180);
    return {
      id: String(p.id || `psv${idx + 1}`),
      label: String(p.label || '안전밸브'),
      tag: String(p.tag || `PSV-${idx + 1}`),
      kind: 'psv',
      x,
      y: 78,
      psvInstalled: typeof p.psvInstalled === 'boolean' ? p.psvInstalled : true,
      psvSetBar: Math.max(5, Number(p.psvSetBar) || mawp),
      protectsSegmentId: targetSeg?.id,
    };
  });

  const nodes = [...mainNodes, ...psvNodes];

  const rawScenarios: SimScenarioPreset[] = Array.isArray(raw?.scenarios)
    ? raw.scenarios
        .filter((sc: any) => sc && sc.name)
        .map((sc: any, idx: number) => ({
          id: String(sc.id || `ai_sc_${idx + 1}`),
          name: String(sc.name),
          description: String(sc.description || ''),
          inletPressureBar: Number(sc.inletPressureBar) || defaultInlet,
          ambientHeatPct: Number(sc.ambientHeatPct) || defaultHeat,
          valveStates: sc.valveStates && typeof sc.valveStates === 'object' ? sc.valveStates : {},
          psvStates: sc.psvStates && typeof sc.psvStates === 'object' ? sc.psvStates : undefined,
          checkValveStates: sc.checkValveStates && typeof sc.checkValveStates === 'object' ? sc.checkValveStates : undefined,
          downstreamBackpressureBar: Number(sc.downstreamBackpressureBar) || 0,
        }))
    : [];

  if (rawScenarios.length === 0) {
    const allOpen: Record<string, boolean> = {};
    const allClosed: Record<string, boolean> = {};
    for (const n of mainNodes) {
      if (n.kind === 'valve') {
        allOpen[n.id] = true;
        allClosed[n.id] = false;
      }
    }
    rawScenarios.push(
      {
        id: 'ai_normal',
        name: '도면 기준 정상 운전',
        description: '업로드된 도면 원안 조건으로 정상 통가스 테스트',
        inletPressureBar: defaultInlet,
        ambientHeatPct: defaultHeat,
        valveStates: allOpen,
      },
      {
        id: 'ai_block',
        name: '긴급 차단 / 이상 운전 검증',
        description: '차단밸브 폐쇄 시 과압·액봉 및 PSV 작동 여부 검증',
        inletPressureBar: defaultInlet,
        ambientHeatPct: 80,
        valveStates: allClosed,
      },
    );
  }

  return {
    id: `ai_pid_${Date.now()}`,
    name: String(raw?.name || `[AI 도면 추출] ${fileName}`),
    subtitle: String(raw?.subtitle || `업로드 도면(${fileName})에서 AI가 자동 생성한 실행 회로`),
    gas,
    designPressureBar: mawp,
    designTempC: temp,
    defaultInletPressureBar: defaultInlet,
    defaultAmbientHeatPct: defaultHeat,
    nodes,
    segments,
    scenarios: rawScenarios,
  };
}
