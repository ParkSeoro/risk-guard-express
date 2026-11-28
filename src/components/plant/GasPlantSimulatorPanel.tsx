/**
 * AI-Driven P&ID / ISO Gas Plant Operational Simulator Panel (Master-Only Plant AI Lab).
 * Users upload real P&ID / ISO drawings (PDF/Image) or enter design basis notes ->
 * High-reasoning AI extracts the real plant topology, audits what is right vs wrong/missing,
 * and renders an executable As-Is vs To-Be operational simulator.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Flame,
  Gauge,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Upload,
  Wrench,
} from 'lucide-react';
import type { IsoAnalysisResult } from '@/lib/plantIsoEngine';
import {
  SIMULATOR_PRESETS,
  buildCircuitFromIso,
  normalizeAiPidCircuit,
  runGasPlantSimulation,
  type AiPidDesignAudit,
  type SimCircuitDefinition,
  type SimNode,
  type SimSegmentStatus,
} from '@/lib/plantGasSimulator';

interface Props {
  isoResult: IsoAnalysisResult | null;
}

const SEG_STROKE: Record<SimSegmentStatus, string> = {
  normal: '#10b981',
  standby: '#38bdf8',
  relieving: '#f59e0b',
  warning: '#f59e0b',
  critical: '#ef4444',
};

async function drawingFileToImage(file: File): Promise<{ base64: string; mimeType: string; textHint: string }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await pdf.getPage(1);
    const tc = await page.getTextContent();
    const textHint = tc.items
      .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const vp = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(vp.width, 2000);
    canvas.height = Math.round((canvas.width / vp.width) * vp.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: (canvas.width / vp.width) * 1.8 }) }).promise;
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg', textHint };
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      resolve({ base64: dataUrl.split(',')[1] || '', mimeType: file.type || 'image/jpeg', textHint: '' });
    };
    reader.onerror = () => reject(new Error('도면 파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

export function GasPlantSimulatorPanel({ isoResult }: Props) {
  const { toast } = useToast();

  // AI-generated circuit & audit from real user P&ID / ISO / design basis
  const [aiCircuit, setAiCircuit] = useState<SimCircuitDefinition | null>(null);
  const [aiAudit, setAiAudit] = useState<AiPidDesignAudit | null>(null);
  const [aiModelUsed, setAiModelUsed] = useState<string>('');
  const [analyzingPid, setAnalyzingPid] = useState(false);
  const [processNotes, setProcessNotes] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [designMode, setDesignMode] = useState<'as_is' | 'to_be'>('as_is');

  const isoCircuit = useMemo(
    () => (isoResult ? buildCircuitFromIso(isoResult) : null),
    [isoResult],
  );

  const allCircuits = useMemo<SimCircuitDefinition[]>(() => {
    const list: SimCircuitDefinition[] = [];
    if (aiCircuit) list.push(aiCircuit);
    if (isoCircuit) list.push(isoCircuit);
    return [...list, ...SIMULATOR_PRESETS];
  }, [aiCircuit, isoCircuit]);

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

  useEffect(() => {
    setInletPressureBar(circuit.defaultInletPressureBar);
    setAmbientHeatPct(circuit.defaultAmbientHeatPct);
    setDownstreamBackpressureBar(0);
    setDesignMode('as_is');
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

  const handleAnalyzeDrawing = async (file?: File) => {
    if (!file && !processNotes.trim()) {
      toast({ title: '입력 필요', description: 'P&ID/ISO 도면을 올리거나 공정 설계 조건을 입력해 주세요.', variant: 'destructive' });
      return;
    }
    setAnalyzingPid(true);
    try {
      let images: { base64: string; mimeType: string }[] = [];
      let textHint = '';
      const fName = file ? file.name : '공정설계_텍스트입력';
      setUploadedFileName(fName);

      if (file) {
        const img = await drawingFileToImage(file);
        if (img.base64) images = [{ base64: img.base64, mimeType: img.mimeType }];
        textHint = img.textHint;
      }

      const { data, error } = await supabase.functions.invoke('analyze-plant-pid', {
        body: {
          fileName: fName,
          processNotes: processNotes.trim(),
          extractedTextHint: textHint,
          images,
        },
      });
      if (error || !data?.ok || !data?.result?.circuit) {
        throw new Error(data?.error || error?.message || 'AI P&ID 도면 판독 실패');
      }

      const normalized = normalizeAiPidCircuit(data.result.circuit, fName);
      setAiCircuit(normalized);
      setAiAudit((data.result.design_audit as AiPidDesignAudit) || null);
      setAiModelUsed(String(data.model || 'gemini-2.5-pro'));
      setSelectedId(normalized.id);
      toast({
        title: 'AI 도면 기반 시뮬레이터 생성 완료',
        description: `${normalized.name} (${data.model || 'AI'}) — 설계 적정성 판정 완료`,
      });
    } catch (e: any) {
      toast({ title: 'AI 도면 분석 실패', description: e?.message || '오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setAnalyzingPid(false);
    }
  };

  // Toggle As-Is (uploaded drawing original PSV/check states) vs To-Be (AI recommended protections enabled)
  const switchDesignMode = (mode: 'as_is' | 'to_be') => {
    setDesignMode(mode);
    const nextPsv: Record<string, boolean> = {};
    const nextChk: Record<string, boolean> = {};
    for (const n of circuit.nodes) {
      if (n.kind === 'psv') nextPsv[n.id] = mode === 'to_be' ? true : (n.psvInstalled ?? true);
      if (n.kind === 'check_valve') nextChk[n.id] = mode === 'to_be' ? true : (n.checkHealthy ?? true);
    }
    setPsvStates(nextPsv);
    setCheckValveStates(nextChk);
  };

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
      {/* 1. AI Real Drawing Input Hub */}
      <Card className="border-primary/30 bg-primary/[0.02]">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
                <Cpu className="h-4 w-4 text-primary" />
                AI 도면 기반 가스 플랜트 운전 시뮬레이터 &amp; 설계 적정성 판독
                {aiModelUsed && (
                  <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                    AI 모델: {aiModelUsed}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                실제 P&amp;ID / ISO 도면(PDF·이미지)과 운전조건을 입력하면 AI가 도면 그대로 시뮬레이터 회로를 자동 생성하고, 도면의 정상 설계·결함·개선 방안을 찾아냅니다.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={analyzingPid}
                onClick={() => document.getElementById('pid-sim-file-input')?.click()}
              >
                {analyzingPid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {analyzingPid ? 'AI 도면 판독·회로 생성 중...' : 'P&ID / ISO 도면 업로드 → AI 시뮬레이터 생성'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                disabled={analyzingPid || !processNotes.trim()}
                onClick={() => void handleAnalyzeDrawing()}
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" /> 설계조건 텍스트로 AI 생성
              </Button>
              <input
                id="pid-sim-file-input"
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleAnalyzeDrawing(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <Textarea
            value={processNotes}
            onChange={(e) => setProcessNotes(e.target.value)}
            placeholder="선택 입력: 도면과 함께 검토할 운전·설계 조건을 적으세요 (예: 'LOX 저장탱크 14bar/-183°C → 차단밸브 XV-01 → 대기식 기화기 → XV-02 → 수요처. 도면에 Thermal PSV가 없는데 안전한지 검증해줘')"
            className="text-xs min-h-[54px] bg-background"
          />

          {/* Circuit Switcher (AI Generated first, then ISO, then Reference Presets) */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t">
            <span className="text-[11px] text-muted-foreground font-medium mr-1">활성 회로:</span>
            {allCircuits.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={c.id === circuit.id ? 'default' : 'outline'}
                className="h-7 text-[11px] gap-1"
                onClick={() => setSelectedId(c.id)}
              >
                {(c.id.startsWith('ai_pid_') || c.id.startsWith('iso_')) && <Sparkles className="h-3 w-3" />}
                {c.name.split(' (')[0]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 2. AI Engineering Design Verdict (Shown when AI analyzed a real drawing/spec) */}
      {aiAudit && (
        <Card className="border-amber-300/70">
          <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-xs font-bold flex items-center gap-1.5">
              <Wrench className="h-4 w-4 text-primary" />
              AI 도면 설계 적정성 판정 ({uploadedFileName})
              <Badge
                variant={
                  aiAudit.overall_verdict === '설계 결함(위험)'
                    ? 'destructive'
                    : aiAudit.overall_verdict === '보완 필요'
                      ? 'secondary'
                      : 'outline'
                }
                className="text-[10px]"
              >
                {aiAudit.overall_verdict}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={designMode === 'as_is' ? 'destructive' : 'outline'}
                className="h-7 text-[11px]"
                onClick={() => switchDesignMode('as_is')}
              >
                도면 원안 (As-Is)
              </Button>
              <Button
                size="sm"
                variant={designMode === 'to_be' ? 'default' : 'outline'}
                className="h-7 text-[11px]"
                onClick={() => switchDesignMode('to_be')}
              >
                AI 보완안 적용 (To-Be)
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3 text-xs">
            <p className="rounded-lg bg-muted/40 p-2.5 leading-relaxed">{aiAudit.summary}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Correct Items */}
              <div className="space-y-1.5">
                <div className="font-semibold text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 도면 정상 설계 항목 ({aiAudit.correct_items?.length || 0}건)
                </div>
                {(aiAudit.correct_items || []).map((item, idx) => (
                  <div key={idx} className="rounded border border-emerald-200 bg-emerald-50/50 p-2 space-y-0.5">
                    <div className="font-semibold">{item.tag ? `[${item.tag}] ` : ''}{item.title}</div>
                    <div className="text-[11px] text-muted-foreground">{item.detail}</div>
                  </div>
                ))}
              </div>
              {/* Defect Items */}
              <div className="space-y-1.5">
                <div className="font-semibold text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> 도면 결함 · 누락 및 개선안 ({aiAudit.defect_items?.length || 0}건)
                </div>
                {(aiAudit.defect_items || []).map((d, idx) => (
                  <div key={idx} className="rounded border border-destructive/30 bg-destructive/5 p-2 space-y-1">
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <span className="font-bold">{d.tag ? `[${d.tag}] ` : ''}{d.title}</span>
                      <Badge variant="secondary" className="text-[10px]">{d.rule_ref}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{d.detail}</div>
                    <div className="text-[11px] font-semibold text-foreground">▶ 수정 방법: {d.how_to_fix}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. Executable P&ID Schematic + Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-8 overflow-hidden">
          <CardHeader className="pb-2 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" />
                {circuit.name}
                <Badge variant="outline" className="text-[10px] font-mono">
                  {circuit.gas} · MAWP {circuit.designPressureBar} bar · {circuit.designTempC}°C
                </Badge>
              </CardTitle>
              <Badge
                variant={sim.overallStatus === 'critical' ? 'destructive' : sim.overallStatus === 'warning' ? 'secondary' : 'outline'}
                className={`text-[11px] ${
                  sim.overallStatus === 'normal'
                    ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
                    : sim.overallStatus === 'warning'
                      ? 'border-amber-400 bg-amber-50 text-amber-800'
                      : ''
                }`}
              >
                {sim.overallLabel}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">운전 테스트:</span>
              {circuit.scenarios.map((sc) => (
                <Button key={sc.id} size="sm" variant="secondary" className="h-6 text-[11px]" title={sc.description} onClick={() => applyScenario(sc.id)}>
                  {sc.name}
                </Button>
              ))}
              <Button size="sm" variant="ghost" className="h-6 text-[11px] ml-auto gap-1" onClick={() => applyScenario(circuit.scenarios[0]?.id || 'normal')}>
                <RotateCcw className="h-3 w-3" /> 초기화
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
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

                {circuit.segments.map((seg) => {
                  const from = nodeMap.get(seg.fromNodeId);
                  const to = nodeMap.get(seg.toNodeId);
                  if (!from || !to) return null;
                  const st = sim.segments[seg.id];
                  const color = st ? SEG_STROKE[st.status] : '#94a3b8';
                  const midX = (from.x + to.x) / 2;
                  const midY = (from.y + to.y) / 2;
                  const flowCls = st && st.flowRatePct > 0 ? 'flow-fwd' : st && st.flowRatePct < 0 ? 'flow-rev' : '';
                  return (
                    <g key={seg.id}>
                      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={st?.status === 'critical' ? 9 : 7} strokeLinecap="round" opacity={0.28} />
                      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={4} strokeLinecap="round" className={flowCls} />
                      <rect x={midX - 46} y={midY + 18} width={92} height={36} rx={6} fill="#ffffff" stroke={color} strokeWidth={1.5} />
                      <text x={midX} y={midY + 33} textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>
                        {st ? `${st.pressureBar} bar` : '—'}
                      </text>
                      <text x={midX} y={midY + 47} textAnchor="middle" fontSize="9.5" fill="#475569">
                        {st ? `${st.tempC}°C · ${seg.sizeLabel}` : seg.sizeLabel}
                      </text>
                    </g>
                  );
                })}

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

                {circuit.nodes.map((node) => {
                  if (node.kind === 'valve') {
                    const open = valveStates[node.id] ?? node.isOpen ?? true;
                    return (
                      <g key={node.id} transform={`translate(${node.x}, ${node.y})`} className="cursor-pointer" onClick={() => toggleNode(node)}>
                        <circle r={22} fill={open ? '#ecfdf5' : '#fef2f2'} stroke={open ? '#10b981' : '#ef4444'} strokeWidth={2.5} />
                        <polygon points="-11,-8 0,0 -11,8" fill={open ? '#10b981' : '#ef4444'} />
                        <polygon points="11,-8 0,0 11,8" fill={open ? '#10b981' : '#ef4444'} />
                        <text y={-28} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0f172a">{node.tag}</text>
                        <text y={-41} textAnchor="middle" fontSize="9.5" fill={open ? '#059669' : '#dc2626'} fontWeight="700">
                          {open ? 'OPEN' : 'CLOSED'}
                        </text>
                      </g>
                    );
                  }
                  if (node.kind === 'psv') {
                    const installed = psvStates[node.id] ?? node.psvInstalled ?? true;
                    const relieving = sim.relievingPsvIds.includes(node.id);
                    return (
                      <g key={node.id} transform={`translate(${node.x}, ${node.y})`} className="cursor-pointer" onClick={() => toggleNode(node)}>
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
                        <text y={-4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0f172a">{node.tag}</text>
                        <text y={11} textAnchor="middle" fontSize="9" fontWeight="700" fill={installed ? '#1d4ed8' : '#dc2626'}>
                          {installed ? `ON (${node.psvSetBar}b)` : '미설치/OFF'}
                        </text>
                      </g>
                    );
                  }
                  if (node.kind === 'check_valve') {
                    const healthy = checkValveStates[node.id] ?? node.checkHealthy ?? true;
                    return (
                      <g key={node.id} transform={`translate(${node.x}, ${node.y})`} className="cursor-pointer" onClick={() => toggleNode(node)}>
                        <circle r={20} fill={healthy ? '#f0fdf4' : '#fef2f2'} stroke={healthy ? '#16a34a' : '#dc2626'} strokeWidth={2} />
                        <polygon points="-7,-8 9,0 -7,8" fill={healthy ? '#16a34a' : '#dc2626'} />
                        <text y={-26} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">{node.tag}</text>
                        <text y={-38} textAnchor="middle" fontSize="9" fontWeight="700" fill={healthy ? '#16a34a' : '#dc2626'}>
                          {healthy ? '역류방지 정상' : '고착(역류!)'}
                        </text>
                      </g>
                    );
                  }
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
                      <text y={-4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0f172a">{node.tag}</text>
                      <text y={12} textAnchor="middle" fontSize="9.5" fill="#334155">{node.label}</text>
                    </g>
                  );
                })}
              </svg>
            </div>

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
                <Slider min={2} max={Math.round(circuit.designPressureBar * 1.4)} step={0.5} value={[inletPressureBar]} onValueChange={([v]) => setInletPressureBar(v)} />
              </div>

              <div className="rounded-lg border p-3 space-y-2 bg-background">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 text-amber-600" /> 외기 열유입 / 압축 부하
                  </span>
                  <span className="font-mono font-bold text-amber-700">{ambientHeatPct}%</span>
                </div>
                <Slider min={10} max={100} step={5} value={[ambientHeatPct]} onValueChange={([v]) => setAmbientHeatPct(v)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: Real-Time HAZOP Diagnosis */}
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
                <div className={`text-base font-bold font-mono mt-0.5 ${sim.maxPressureBar > circuit.designPressureBar ? 'text-destructive' : 'text-foreground'}`}>
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
