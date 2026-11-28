/**
 * Interactive Browser 3D Plant Model Viewer (IFC / OBJ / STL / GLB) + AI Clash & Operability Review.
 * Strictly Master-Only inside Plant AI Lab.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Cpu,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  SAMPLE_LOX_SKID_3D,
  parsePlant3dBuffer,
  run3dSpatialPreCheck,
  type Plant3dCategory,
  type Plant3dModelSummary,
} from '@/lib/plant3dAnalyzer';

interface Ai3dReview {
  overall_verdict: string;
  executive_summary: string;
  findings: {
    severity: 'critical' | 'warning' | 'info';
    category: string;
    target_elements: string;
    title: string;
    detail: string;
    rule_ref: string;
    how_to_fix: string;
  }[];
  constructability_checklist: string[];
}

const CAT_COLOR: Record<Plant3dCategory, string> = {
  tank: '#0284c7',
  equipment: '#7c3aed',
  pipe: '#10b981',
  valve: '#f59e0b',
  psv: '#ef4444',
  structure: '#64748b',
  other: '#94a3b8',
};

export function Plant3dViewerPanel() {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [model, setModel] = useState<Plant3dModelSummary>(SAMPLE_LOX_SKID_3D);
  const [yaw, setYaw] = useState(-0.65);
  const [pitch, setPitch] = useState(0.42);
  const [zoom, setZoom] = useState(1.0);
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const [analyzing, setAnalyzing] = useState(false);
  const [aiReview, setAiReview] = useState<Ai3dReview | null>(null);
  const [aiModelUsed, setAiModelUsed] = useState('');

  const preChecks = useMemo(() => run3dSpatialPreCheck(model), [model]);

  const handleUpload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parsePlant3dBuffer(file.name, buf);
      setModel(parsed);
      setAiReview(null);
      toast({
        title: `3D 모델 로드 완료 (${parsed.format.toUpperCase()})`,
        description: `${file.name} · ${parsed.elementCount}개 객체 / ${parsed.vertexCount.toLocaleString()} 정점`,
      });
    } catch (e: any) {
      toast({ title: '3D 모델 파싱 실패', description: e?.message, variant: 'destructive' });
    }
  };

  const runAiAudit = async () => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-plant-3d', {
        body: {
          fileName: model.fileName,
          elements: model.elements,
          preChecks,
          gasContext: '에어리퀴드 산업가스 플랜트(LOX/H2/N2)',
        },
      });
      if (error || !data?.ok || !data?.result) {
        throw new Error(data?.error || error?.message || '3D AI 검토 실패');
      }
      setAiReview(data.result as Ai3dReview);
      setAiModelUsed(String(data.model || 'gemini-2.5-pro'));
      toast({ title: 'AI 3D 간섭 · 접근성 · 시공성 검토 완료' });
    } catch (e: any) {
      toast({ title: 'AI 3D 검토 오류', description: e?.message, variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  // Render interactive 3D orthographic/perspective projection on HTML5 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    const b = model.boundsMeters;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(4, b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
    const scale = (Math.min(w, h) * 0.58 * zoom) / span;

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

    const project = (px: number, py: number, pz: number) => {
      const x0 = px - cx;
      const y0 = py - cy;
      const z0 = pz - cz;
      // Rotate around vertical Z axis (yaw)
      const rx = x0 * cosY - y0 * sinY;
      const ry = x0 * sinY + y0 * cosY;
      // Tilt (pitch)
      const rz = z0 * cosP - ry * sinP;
      const depth = ry * cosP + z0 * sinP;
      return {
        sx: w / 2 + rx * scale,
        sy: h / 2 - rz * scale,
        depth,
      };
    };

    // Draw ground grid (z = 0)
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    const gridHalf = Math.ceil(span / 2) + 1;
    for (let g = -gridHalf; g <= gridHalf; g++) {
      const a1 = project(cx + g, cy - gridHalf, 0);
      const a2 = project(cx + g, cy + gridHalf, 0);
      ctx.beginPath(); ctx.moveTo(a1.sx, a1.sy); ctx.lineTo(a2.sx, a2.sy); ctx.stroke();

      const b1 = project(cx - gridHalf, cy + g, 0);
      const b2 = project(cx + gridHalf, cy + g, 0);
      ctx.beginPath(); ctx.moveTo(b1.sx, b1.sy); ctx.lineTo(b2.sx, b2.sy); ctx.stroke();
    }

    // Painter's algorithm: sort elements back-to-front by center depth
    const sorted = model.elements
      .map((el) => ({ el, center: project(el.x, el.y, el.z) }))
      .sort((a, b2) => a.center.depth - b2.center.depth);

    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [1, 2, 6, 5],
      [0, 3, 7, 4],
    ];

    for (const { el, center } of sorted) {
      const hx = el.dx / 2, hy = el.dy / 2, hz = el.dz / 2;
      const pts = [
        project(el.x - hx, el.y - hy, el.z - hz),
        project(el.x + hx, el.y - hy, el.z - hz),
        project(el.x + hx, el.y + hy, el.z - hz),
        project(el.x - hx, el.y + hy, el.z - hz),
        project(el.x - hx, el.y - hy, el.z + hz),
        project(el.x + hx, el.y - hy, el.z + hz),
        project(el.x + hx, el.y + hy, el.z + hz),
        project(el.x - hx, el.y + hy, el.z + hz),
      ];
      const color = CAT_COLOR[el.category] || '#64748b';

      // Translucent shaded faces
      ctx.fillStyle = `${color}30`;
      for (const f of faces) {
        ctx.beginPath();
        ctx.moveTo(pts[f[0]].sx, pts[f[0]].sy);
        ctx.lineTo(pts[f[1]].sx, pts[f[1]].sy);
        ctx.lineTo(pts[f[2]].sx, pts[f[2]].sy);
        ctx.lineTo(pts[f[3]].sx, pts[f[3]].sy);
        ctx.closePath();
        ctx.fill();
      }

      // Crisp wireframe edges
      ctx.strokeStyle = color;
      ctx.lineWidth = el.category === 'psv' || el.category === 'valve' ? 2 : 1.4;
      for (const [i, j] of edges) {
        ctx.beginPath();
        ctx.moveTo(pts[i].sx, pts[i].sy);
        ctx.lineTo(pts[j].sx, pts[j].sy);
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(el.name.slice(0, 18), center.sx, center.sy - 6);
      ctx.fillStyle = '#475569';
      ctx.font = '9px monospace';
      ctx.fillText(`EL+${el.z.toFixed(1)}m`, center.sx, center.sy + 6);
    }
  }, [model, yaw, pitch, zoom]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
              <Box className="h-4 w-4 text-primary" />
              3D 플랜트 모델링 뷰어 &amp; AI 간섭·접근성 검토 (IFC / OBJ / STL / GLB)
              {aiModelUsed && <Badge variant="outline" className="text-[10px] text-primary">AI: {aiModelUsed}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              BIM/PDMS/E3D에서 내보낸 3D 모델을 브라우저에서 360° 회전·입면 확인하고, AI로 배관 간섭(Clash)·밸브 조작높이(1.8m)·이격거리를 자동 점검합니다.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => { setModel(SAMPLE_LOX_SKID_3D); setAiReview(null); }}>
              <Sparkles className="h-3.5 w-3.5 text-primary" /> LOX 스키드 3D 샘플
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => document.getElementById('plant-3d-input')?.click()}>
              <Upload className="h-3.5 w-3.5" /> 3D 모델 업로드 (.ifc/.obj/.glb/.stl)
            </Button>
            <Button size="sm" className="h-8 text-xs gap-1.5" disabled={analyzing} onClick={runAiAudit}>
              {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
              {analyzing ? 'AI 3D 정밀 검토 중...' : 'AI 3D 간섭·시공성 검토 실행'}
            </Button>
            <input
              id="plant-3d-input"
              type="file"
              accept=".ifc,.obj,.stl,.glb,.gltf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = '';
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Interactive 3D Canvas */}
        <Card className="lg:col-span-7 overflow-hidden">
          <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-xs font-semibold truncate">
              {model.fileName} <span className="text-muted-foreground font-normal">({model.elementCount}개 객체 · 마우스 드래그로 360° 회전)</span>
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => { setYaw(-0.65); setPitch(0.42); setZoom(1.0); }}>ISO 뷰</Button>
              <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => { setYaw(0); setPitch(1.48); setZoom(1.0); }}>평면(Plan)</Button>
              <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => { setYaw(0); setPitch(0.05); setZoom(1.0); }}>입면(EL)</Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setZoom((z) => Math.min(2.2, z + 0.2))}>+</Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>-</Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setYaw(-0.65); setPitch(0.42); setZoom(1.0); }}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <canvas
              ref={canvasRef}
              width={720}
              height={400}
              className="w-full h-[360px] rounded-xl border cursor-grab active:cursor-grabbing bg-slate-50"
              onMouseDown={(e) => {
                setDragging(true);
                lastPos.current = { x: e.clientX, y: e.clientY };
              }}
              onMouseMove={(e) => {
                if (!dragging) return;
                const dx = e.clientX - lastPos.current.x;
                const dy = e.clientY - lastPos.current.y;
                lastPos.current = { x: e.clientX, y: e.clientY };
                setYaw((y) => y + dx * 0.01);
                setPitch((p) => Math.max(-1.45, Math.min(1.5, p + dy * 0.01)));
              }}
              onMouseUp={() => setDragging(false)}
              onMouseLeave={() => setDragging(false)}
            />
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              {Object.entries(CAT_COLOR).map(([k, col]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: col }} />
                  {k.toUpperCase()}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Spatial Pre-Check + AI 3D Audit */}
        <Card className="lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold flex items-center justify-between gap-2">
              <span>3D 공간 간섭 · 접근성 · AI 시공성 진단</span>
              {aiReview && <Badge variant="destructive" className="text-[10px]">{aiReview.overall_verdict}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3 text-xs max-h-[420px] overflow-y-auto">
            {aiReview ? (
              <>
                <p className="rounded-lg bg-muted/40 p-2.5 leading-relaxed">{aiReview.executive_summary}</p>
                {aiReview.findings.map((f, i) => (
                  <div key={i} className={`rounded-lg border p-2.5 space-y-1 ${f.severity === 'critical' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-300 bg-amber-50/50'}`}>
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <span className="font-bold">{f.title}</span>
                      <Badge variant="outline" className="text-[10px]">{f.category}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">대상: {f.target_elements} · 근거: {f.rule_ref}</div>
                    <p className="text-muted-foreground">{f.detail}</p>
                    <p className="font-semibold text-foreground">▶ 조치: {f.how_to_fix}</p>
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="text-[11px] text-muted-foreground">
                  자동 3D 공간 사전진단 결과 ({preChecks.length}건) — 상단 <strong>AI 3D 간섭·시공성 검토 실행</strong>을 누르면 고성능 AI가 KGS/산안법 기준 정밀 리포트를 작성합니다.
                </div>
                {preChecks.length === 0 ? (
                  <div className="py-6 text-center text-emerald-700 flex flex-col items-center gap-1">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>자동 3D 공간 간섭이 발견되지 않았습니다.</span>
                  </div>
                ) : (
                  preChecks.map((p, i) => (
                    <div key={i} className={`rounded-lg border p-2.5 space-y-1 ${p.severity === 'critical' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-300 bg-amber-50/50'}`}>
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className={`h-3.5 w-3.5 ${p.severity === 'critical' ? 'text-destructive' : 'text-amber-600'}`} />
                        <span>{p.title}</span>
                      </div>
                      <p className="text-muted-foreground">{p.detail}</p>
                      <p className="font-medium text-foreground">▶ {p.recommendation}</p>
                    </div>
                  ))
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
