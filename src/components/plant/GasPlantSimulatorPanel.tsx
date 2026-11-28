/**
 * Interactive SVG P&ID Gas Plant Operational Simulator Panel (Master-Only Plant AI Lab).
 * Allows clicking valves, PSVs, and check valves directly on the schematic to test
 * Air Liquide industrial gas operational hazards in real time.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Flame,
  Gauge,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { IsoAnalysisResult } from '@/lib/plantIsoEngine';
import {
  SIMULATOR_PRESETS,
  buildCircuitFromIso,
  runGasPlantSimulation,
  type SimCircuitDefinition,
  type SimNode,
  type SimSegmentStatus,
} from '@/lib/plantGasSimulator';

interface Props {
  isoResult: IsoAnalysisResult | null;
}

const SEG_STROKE: Record<SimSegmentStatus, string> = {
  normal: '#10b981', // emerald-500
  standby: '#38bdf8', // sky-400
  relieving: '#f59e0b', // amber-500
  warning: '#f59e0b',
  critical: '#ef4444', // red-500
};

export function GasPlantSimulatorPanel({ isoResult }: Props) {
  const isoCircuit = useMemo(
    () => (isoResult ? buildCircuitFromIso(isoResult) : null),
    [isoResult],
  );

  const allCircuits = useMemo<SimCircuitDefinition[]>(
    () => (isoCircuit ? [isoCircuit, ...SIMULATOR_PRESETS] : SIMULATOR_PRESETS),
    [isoCircuit],
  );

  const [selectedId, setSelectedId] = useState<string>(allCircuits[0].id);
  const circuit = useMemo(
    () => allCircuits.find((c) => c.id === selectedId) || allCircuits[0],
    [allCircuits, selectedId],
  );

  const [inletPressureBar, setInletPressureBar] = useState(circuit.defaultInletPressureBar);
  const [ambientHeatPct, setAmbientHeatPct] = useState(circuit.defaultAmbientHeatPct);
  const [downstreamBackpressureBar, setDownstreamBackpressureBar] = useState(0);
  const [valveStates, setValveStates] = useState<Record<string, boolean>>({});
  const [psvStates, setPsvStates] = useState<Record<string, boolean>>({});
  const [checkValveStates, setCheckValveStates] = useState<Record<string, boolean>>({});

  // Sync defaults when switching circuits
  useEffect(() => {
    setInletPressureBar(circuit.defaultInletPressureBar);
    setAmbientHeatPct(circuit.defaultAmbientHeatPct);
    setDownstreamBackpressureBar(0);
    const vInit: Record<string, boolean> = {};
    const pInit: Record<string, boolean> = {};
    const cInit: Record<string, boolean> = {};
    for (const n of circuit.nodes) {
      if (n.kind === 'valve') vInit[n.id] = n.isOpen ?? true;
      if (n.kind === 'psv') pInit[n.id] = n.psvInstalled ?? true;
      if (n.kind === 'check_valve') cInit[n.id] = n.checkHealthy ?? true;
    }
    setValveStates(vInit);
    setPsvStates(pInit);
    setCheckValveStates(cInit);
  }, [circuit]);

  const sim = useMemo(
    () =>
      runGasPlantSimulation(circuit, {
        inletPressureBar,
        ambientHeatPct,
        downstreamBackpressureBar,
        valveStates,
        psvStates,
        checkValveStates,
      }),
    [circuit, inletPressureBar, ambientHeatPct, downstreamBackpressureBar, valveStates, psvStates, checkValveStates],
  );

  const nodeMap = useMemo(() => new Map(circuit.nodes.map((n) => [n.id, n])), [circuit]);

  const applyScenario = (scenarioId: string) => {
    const sc = circuit.scenarios.find((s) => s.id === scenarioId);
    if (!sc) return;
    setInletPressureBar(sc.inletPressureBar);
    setAmbientHeatPct(sc.ambientHeatPct);
    setDownstreamBackpressureBar(sc.downstreamBackpressureBar ?? 0);
    setValveStates((prev) => ({ ...prev, ...sc.valveStates }));
    if (sc.psvStates) setPsvStates((prev) => ({ ...prev, ...sc.psvStates }));
    if (sc.checkValveStates) setCheckValveStates((prev) => ({ ...prev, ...sc.checkValveStates }));
  };

  const toggleNode = (node: SimNode) => {
    if (node.kind === 'valve') {
      setValveStates((prev) => ({ ...prev, [node.id]: !(prev[node.id] ?? node.isOpen ?? true) }));
    } else if (node.kind === 'psv') {
      setPsvStates((prev) => ({ ...prev, [node.id]: !(prev[node.id] ?? node.psvInstalled ?? true) }));
    } else if (node.kind === 'check_valve') {
      setCheckValveStates((prev) => ({ ...prev, [node.id]: !(prev[node.id] ?? node.checkHealthy ?? true) }));
    }
  };

  return (
    <div className="space-y-4">
      {/* Circuit Selector + Scenario Buttons */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Activity className="h-4 w-4 text-primary" />
                <span className="text-sm font-bold">{circuit.name}</span>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {circuit.gas} · MAWP {circuit.designPressureBar} bar · {circuit.designTempC}°C
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{circuit.subtitle}</p>
            </div>

            <Badge
              variant={
                sim.overallStatus === 'critical'
                  ? 'destructive'
                  : sim.overallStatus === 'warning'
                    ? 'secondary'
                    : 'outline'
              }
              className={`text-xs px-2.5 py-1 ${
                sim.overallStatus === 'normal'
                  ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
                  : sim.overallStatus === 'warning'
                    ? 'border-amber-400 bg-amber-50 text-amber-800'
                    : ''
              }`}
            >
              {sim.overallStatus === 'critical' ? (
                <Flame className="h-3.5 w-3.5 mr-1 inline" />
              ) : sim.overallStatus === 'warning' ? (
                <AlertTriangle className="h-3.5 w-3.5 mr-1 inline" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1 inline" />
              )}
              {sim.overallLabel}
            </Badge>
          </div>

          {/* Preset Circuit Tabs */}
          <div className="flex flex-wrap gap-1.5">
            {allCircuits.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={c.id === circuit.id ? 'default' : 'outline'}
                className="h-7 text-[11px] gap-1"
                onClick={() => setSelectedId(c.id)}
              >
                {c.id.startsWith('iso_') && <Sparkles className="h-3 w-3" />}
                {c.name.split(' (')[0]}
              </Button>
            ))}
          </div>

          {/* One-Click Scenarios */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t">
            <span className="text-[11px] text-muted-foreground font-medium mr-1">시나리오 원클릭:</span>
            {circuit.scenarios.map((sc) => (
              <Button
                key={sc.id}
                size="sm"
                variant="secondary"
                className="h-7 text-[11px]"
                title={sc.description}
                onClick={() => applyScenario(sc.id)}
              >
                {sc.name}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] ml-auto gap-1"
              onClick={() => applyScenario(circuit.scenarios[0]?.id || 'normal')}
            >
              <RotateCcw className="h-3 w-3" /> 초기화
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Interactive P&ID Schematic + Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-8 overflow-hidden">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold">
              실시간 P&amp;ID 가스 유동 시뮬레이터 <span className="text-muted-foreground font-normal">(밸브·PSV·역지밸브를 클릭해 개폐/고장 테스트)</span>
            </CardTitle>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />정상</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />PSV 방출</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />위험/파열</span>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            {/* SVG Canvas */}
            <div className="rounded-xl border bg-slate-50 p-2 overflow-x-auto">
              <svg viewBox="0 0 920 275" className="w-full min-w-[680px] h-auto select-none">
                <defs>
                  <style>{`
                    @keyframes gasFlowForward { to { stroke-dashoffset: -28; } }
                    @keyframes gasFlowReverse { to { stroke-dashoffset: 28; } }
                    .flow-fwd { stroke-dasharray: 10 8; animation: gasFlowForward 0.7s linear infinite; }
                    .flow-rev { stroke-dasharray: 10 8; animation: gasFlowReverse 0.55s linear infinite; }
                  `}</style>
                </defs>

                {/* Pipe Segments */}
                {circuit.segments.map((seg) => {
                  const from = nodeMap.get(seg.fromNodeId);
                  const to = nodeMap.get(seg.toNodeId);
                  if (!from || !to) return null;
                  const st = sim.segments[seg.id];
                  const color = st ? SEG_STROKE[st.status] : '#94a3b8';
                  const midX = (from.x + to.x) / 2;
                  const midY = (from.y + to.y) / 2;
                  const flowCls =
                    st && st.flowRatePct > 0
                      ? 'flow-fwd'
                      : st && st.flowRatePct < 0
                        ? 'flow-rev'
                        : '';

                  return (
                    <g key={seg.id}>
                      {/* Base Pipe */}
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={color}
                        strokeWidth={st?.status === 'critical' ? 9 : 7}
                        strokeLinecap="round"
                        opacity={0.28}
                      />
                      {/* Animated Gas Flow Core */}
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={color}
                        strokeWidth={4}
                        strokeLinecap="round"
                        className={flowCls}
                      />
                      {/* Pressure / Temp Telemetry Pill */}
                      <rect
                        x={midX - 46}
                        y={midY + 18}
                        width={92}
                        height={36}
                        rx={6}
                        fill="#ffffff"
                        stroke={color}
                        strokeWidth={1.5}
                      />
                      <text x={midX} y={midY + 33} textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>
                        {st ? `${st.pressureBar} bar` : '—'}
                      </text>
                      <text x={midX} y={midY + 47} textAnchor="middle" fontSize="9.5" fill="#475569">
                        {st ? `${st.tempC}°C · ${seg.sizeLabel}` : seg.sizeLabel}
                      </text>
                    </g>
                  );
                })}

                {/* PSV Vertical Branch Connectors */}
                {circuit.nodes
                  .filter((n) => n.kind === 'psv' && n.protectsSegmentId)
                  .map((psv) => {
                    const seg = circuit.segments.find((s) => s.id === psv.protectsSegmentId);
                    const from = seg ? nodeMap.get(seg.fromNodeId) : null;
                    const to = seg ? nodeMap.get(seg.toNodeId) : null;
                    if (!from || !to) return null;
                    const branchX = (from.x + to.x) / 2;
                    const installed = psvStates[psv.id] ?? psv.psvInstalled ?? true;
                    const relieving = sim.relievingPsvIds.includes(psv.id);
                    return (
                      <g key={`branch_${psv.id}`}>
                        <line
                          x1={branchX}
                          y1={from.y}
                          x2={psv.x}
                          y2={psv.y + 22}
                          stroke={relieving ? '#f59e0b' : installed ? '#64748b' : '#cbd5e1'}
                          strokeWidth={relieving ? 4 : 2.5}
                          strokeDasharray={installed ? undefined : '4 4'}
                        />
                        {relieving && (
                          <text x={psv.x + 36} y={psv.y - 6} fontSize="11" fontWeight="700" fill="#d97706">
                            💨 안전 방출 중!
                          </text>
                        )}
                      </g>
                    );
                  })}

                {/* Nodes */}
                {circuit.nodes.map((node) => {
                  if (node.kind === 'valve') {
                    const open = valveStates[node.id] ?? node.isOpen ?? true;
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        className="cursor-pointer"
                        onClick={() => toggleNode(node)}
                      >
                        <circle
                          r={22}
                          fill={open ? '#ecfdf5' : '#fef2f2'}
                          stroke={open ? '#10b981' : '#ef4444'}
                          strokeWidth={2.5}
                        />
                        {/* Bowtie Valve Symbol */}
                        <polygon
                          points="-11,-8 0,0 -11,8"
                          fill={open ? '#10b981' : '#ef4444'}
                        />
                        <polygon
                          points="11,-8 0,0 11,8"
                          fill={open ? '#10b981' : '#ef4444'}
                        />
                        <text y={-28} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0f172a">
                          {node.tag}
                        </text>
                        <text y={-41} textAnchor="middle" fontSize="9.5" fill={open ? '#059669' : '#dc2626'} fontWeight="700">
                          {open ? 'OPEN (클릭 닫기)' : 'CLOSED (클릭 열기)'}
                        </text>
                      </g>
                    );
                  }

                  if (node.kind === 'psv') {
                    const installed = psvStates[node.id] ?? node.psvInstalled ?? true;
                    const relieving = sim.relievingPsvIds.includes(node.id);
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        className="cursor-pointer"
                        onClick={() => toggleNode(node)}
                      >
                        <rect
                          x={-34}
                          y={-22}
                          width={68}
                          height={44}
                          rx={8}
                          fill={relieving ? '#fef3c7' : installed ? '#eff6ff' : '#fef2f2'}
                          stroke={relieving ? '#f59e0b' : installed ? '#2563eb' : '#ef4444'}
                          strokeWidth={2}
                          strokeDasharray={installed ? undefined : '4 3'}
                        />
                        <text y={-4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0f172a">
                          {node.tag}
                        </text>
                        <text y={11} textAnchor="middle" fontSize="9" fontWeight="700" fill={installed ? '#1d4ed8' : '#dc2626'}>
                          {installed ? `ON (${node.psvSetBar}b)` : '미설치/OFF'}
                        </text>
                        <text y={-28} textAnchor="middle" fontSize="9" fill="#64748b">
                          클릭하여 PSV 토글
                        </text>
                      </g>
                    );
                  }

                  if (node.kind === 'check_valve') {
                    const healthy = checkValveStates[node.id] ?? node.checkHealthy ?? true;
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        className="cursor-pointer"
                        onClick={() => toggleNode(node)}
                      >
                        <circle
                          r={20}
                          fill={healthy ? '#f0fdf4' : '#fef2f2'}
                          stroke={healthy ? '#16a34a' : '#dc2626'}
                          strokeWidth={2}
                        />
                        <polygon points="-7,-8 9,0 -7,8" fill={healthy ? '#16a34a' : '#dc2626'} />
                        <text y={-26} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">
                          {node.tag}
                        </text>
                        <text y={-38} textAnchor="middle" fontSize="9" fontWeight="700" fill={healthy ? '#16a34a' : '#dc2626'}>
                          {healthy ? '역류방지 정상' : '고착(역류 위험!)'}
                        </text>
                      </g>
                    );
                  }

                  // Source, Equipment, Consumer
                  const isSource = node.kind === 'source';
                  const isConsumer = node.kind === 'consumer';
                  return (
                    <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                      <rect
                        x={-44}
                        y={-28}
                        width={88}
                        height={56}
                        rx={isSource || isConsumer ? 12 : 8}
                        fill={isSource ? '#e0f2fe' : isConsumer ? '#f1f5f9' : '#ede9fe'}
                        stroke={isSource ? '#0284c7' : isConsumer ? '#475569' : '#7c3aed'}
                        strokeWidth={2}
                      />
                      <text y={-4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0f172a">
                        {node.tag}
                      </text>
                      <text y={12} textAnchor="middle" fontSize="9.5" fill="#334155">
                        {node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Process Parameter Sliders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="rounded-lg border p-3 space-y-2 bg-background">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Gauge className="h-3.5 w-3.5 text-primary" /> 공급 압력 (Inlet Pressure)
                  </span>
                  <span className="font-mono font-bold text-primary">
                    {inletPressureBar.toFixed(1)} bar <span className="text-muted-foreground font-normal">/ MAWP {circuit.designPressureBar}</span>
                  </span>
                </div>
                <Slider
                  min={2}
                  max={Math.round(circuit.designPressureBar * 1.4)}
                  step={0.5}
                  value={[inletPressureBar]}
                  onValueChange={([v]) => setInletPressureBar(v)}
                />
              </div>

              <div className="rounded-lg border p-3 space-y-2 bg-background">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 text-amber-600" /> 외기 열유입 / 압축 부하
                  </span>
                  <span className="font-mono font-bold text-amber-700">{ambientHeatPct}%</span>
                </div>
                <Slider
                  min={10}
                  max={100}
                  step={5}
                  value={[ambientHeatPct]}
                  onValueChange={([v]) => setAmbientHeatPct(v)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: Real-Time HAZOP Diagnosis & Engineering Verdict */}
        <Card className="lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4 text-primary" /> 실시간 HAZOP 공정안전 진단
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border p-2.5 bg-muted/20">
                <div className="text-[10px] text-muted-foreground">계통 최고압력</div>
                <div
                  className={`text-base font-bold font-mono mt-0.5 ${
                    sim.maxPressureBar > circuit.designPressureBar ? 'text-destructive' : 'text-foreground'
                  }`}
                >
                  {sim.maxPressureBar} bar
                </div>
              </div>
              <div className="rounded-lg border p-2.5 bg-muted/20">
                <div className="text-[10px] text-muted-foreground">수요처 공급 유량</div>
                <div className="text-base font-bold font-mono mt-0.5">{sim.deliveryFlowPct}%</div>
              </div>
            </div>

            <div className="space-y-2.5">
              {sim.alarms.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                    a.severity === 'critical'
                      ? 'border-destructive/40 bg-destructive/5'
                      : a.severity === 'warning'
                        ? 'border-amber-300 bg-amber-50/70'
                        : 'border-emerald-300 bg-emerald-50/60'
                  }`}
                >
                  <div className="font-bold flex items-start gap-1.5">
                    {a.severity === 'critical' ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                    ) : a.severity === 'warning' ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    )}
                    <span>{a.title}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{a.detail}</p>
                  <div className="text-[10px] text-muted-foreground">근거: {a.ruleRef}</div>
                  <p className="font-medium text-foreground">▶ {a.action}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
