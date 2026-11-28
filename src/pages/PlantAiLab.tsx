/**
 * Master-only private lab: Air Liquide Industrial Gas Plant AI Lab.
 * Strictly hidden from all non-master users until approved for team workspace rollout.
 * Phase 1: Piping ISO AI Analysis + Vendor BOQ 1:1 Cross-Check + PSV/KGS/API 520-521 Safety Design Review.
 */
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDiff,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Loader2,
  Lock,
  ShieldAlert,
  Sparkles,
  Upload,
} from 'lucide-react';
import { GasPlantSimulatorPanel } from '@/components/plant/GasPlantSimulatorPanel';
import { PlantDocAnalyzerPanel } from '@/components/plant/PlantDocAnalyzerPanel';
import {
  SAMPLE_ISO_LOX,
  SAMPLE_VENDOR_BOQ_LOX,
  crossCheckIsoVsVendorBoq,
  derivePlantPermitChecklist,
  downloadBoqCrossCheckExcel,
  evaluateAirLiquideGasSafety,
  parseVendorBoqExcel,
  type BoqDiffStatus,
  type IsoAnalysisResult,
  type VendorBoqItem,
} from '@/lib/plantIsoEngine';

const GAS_OPTIONS = [
  { value: 'auto', label: '자동 판별 (도면 기준)' },
  { value: 'H2', label: 'H2 (수소)' },
  { value: 'LH2', label: 'LH2 (액화수소)' },
  { value: 'O2', label: 'O2 (기체산소)' },
  { value: 'LOX', label: 'LOX (액화산소 -183°C)' },
  { value: 'N2', label: 'N2 (질소)' },
  { value: 'LIN', label: 'LIN (액화질소 -196°C)' },
  { value: 'LAR', label: 'LAR (액화아르곤)' },
  { value: 'LCO2', label: 'LCO2 (액화이산화탄소)' },
  { value: 'SiH4', label: 'SiH4 / 특수가스' },
];

const DIFF_BADGE: Record<BoqDiffStatus, { label: string; cls: string }> = {
  overclaimed: { label: '과다청구', cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  not_in_drawing: { label: '도면 미기재', cls: 'bg-purple-500/10 text-purple-700 border-purple-300' },
  missing_in_boq: { label: '물량표 누락', cls: 'bg-amber-500/10 text-amber-700 border-amber-300' },
  underclaimed: { label: '과소청구', cls: 'bg-blue-500/10 text-blue-700 border-blue-300' },
  match: { label: '일치', cls: 'bg-success/10 text-success border-success/30' },
};

async function fileToBase64Image(file: File): Promise<{ base64: string; mimeType: string; textHint: string }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const textHint = textContent.items
      .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(viewport.width, 2000);
    canvas.height = Math.round((canvas.width / viewport.width) * viewport.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: (canvas.width / viewport.width) * 1.8 }) }).promise;
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg', textHint };
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      resolve({
        base64: dataUrl.split(',')[1] || '',
        mimeType: file.type || 'image/jpeg',
        textHint: '',
      });
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

export default function PlantAiLab() {
  const { hasRole } = useAuth();
  const isMaster = hasRole('master');
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'iso' | 'boq' | 'safety' | 'sim' | 'docs'>('iso');
  const [gasHint, setGasHint] = useState('auto');
  const [analyzing, setAnalyzing] = useState(false);
  const [isoFileName, setIsoFileName] = useState<string>('');
  const [isoResult, setIsoResult] = useState<IsoAnalysisResult | null>(null);
  const [vendorBoq, setVendorBoq] = useState<VendorBoqItem[]>([]);
  const [boqFileName, setBoqFileName] = useState<string>('');

  const ruleFindings = useMemo(
    () => (isoResult ? evaluateAirLiquideGasSafety(isoResult) : []),
    [isoResult],
  );
  const allFindings = useMemo(() => {
    if (!isoResult) return [];
    const ai = (isoResult.ai_findings || []).map((f) => ({ ...f, source: 'ai' as const }));
    return [...ruleFindings, ...ai];
  }, [isoResult, ruleFindings]);

  const permitChecks = useMemo(
    () => (isoResult ? derivePlantPermitChecklist(isoResult) : []),
    [isoResult],
  );

  const boqDiff = useMemo(
    () => (isoResult && vendorBoq.length > 0 ? crossCheckIsoVsVendorBoq(isoResult.bom, vendorBoq) : []),
    [isoResult, vendorBoq],
  );

  if (!isMaster) return <Navigate to="/app/admin" replace />;

  const handleIsoUpload = async (file: File) => {
    setAnalyzing(true);
    setIsoFileName(file.name);
    try {
      const { base64, mimeType, textHint } = await fileToBase64Image(file);
      const { data, error } = await supabase.functions.invoke('analyze-plant-iso', {
        body: {
          fileName: file.name,
          gasHint,
          extractedTextHint: textHint,
          images: base64 ? [{ base64, mimeType }] : [],
        },
      });
      if (error || !data?.ok || !data?.result) {
        throw new Error(data?.error || error?.message || 'ISO 분석 응답 오류');
      }
      setIsoResult(data.result as IsoAnalysisResult);
      toast({ title: '아이소(ISO) 도면 분석 완료', description: `${data.result.title_block?.line_no || file.name}` });
    } catch (e: any) {
      toast({ title: 'ISO 분석 실패', description: e?.message || '오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleBoqUpload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseVendorBoqExcel(buf);
      if (parsed.length === 0) {
        toast({ title: '물량표 파싱 실패', description: '품명·규격·수량 컬럼이 있는 엑셀을 올려주세요.', variant: 'destructive' });
        return;
      }
      setVendorBoq(parsed);
      setBoqFileName(file.name);
      setActiveTab('boq');
      toast({ title: `시공사 물량표 ${parsed.length}개 항목 로드 완료` });
    } catch (e: any) {
      toast({ title: '엑셀 읽기 실패', description: e?.message, variant: 'destructive' });
    }
  };

  const loadDemo = () => {
    setIsoFileName('ISO-LOX-204-R1.pdf (에어리퀴드 샘플)');
    setIsoResult(SAMPLE_ISO_LOX);
    setBoqFileName('시공사_LOX204_물량표_샘플.xlsx');
    setVendorBoq(SAMPLE_VENDOR_BOQ_LOX);
    toast({ title: '에어리퀴드 LOX 배관 ISO + 시공사 물량표 샘플을 불러왔습니다.' });
  };

  const criticalCount = allFindings.filter((f) => f.severity === 'critical').length;
  const overclaimCount = boqDiff.filter((d) => d.status === 'overclaimed' || d.status === 'not_in_drawing').length;
  const totalOverclaimKrw = boqDiff.reduce((sum, r) => sum + (r.estimated_overclaim_krw || 0), 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Master-Only Private Lab Header */}
      <div className="rounded-xl border bg-card px-5 py-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold">플랜트 AI 랩 · 아이소(ISO) &amp; 가스 안전설계</h1>
            <Badge variant="outline" className="text-[10px] gap-1 border-primary/40 text-primary bg-primary/5">
              <Lock className="h-3 w-3" /> 마스터 단독 비공개
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              🔜 3단계: 3D 모델링(IFC/GLB) · 팀별 워크스페이스
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            에어리퀴드 산업가스(H2·O2·N2·Ar·LCO2) 배관 ISO 판독 · 물량표 교차검증 · PSV 안전설계 · 실시간 가스 운전 시뮬레이터 · 통합 문서(Excel/Word/PPT/PDF) AI 비교
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={gasHint} onValueChange={setGasHint}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GAS_OPTIONS.map((g) => (
                <SelectItem key={g.value} value={g.value} className="text-xs">{g.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={loadDemo}>
            <Sparkles className="h-3.5 w-3.5 text-primary" /> LOX 샘플 체험
          </Button>

          <Button size="sm" className="h-8 text-xs gap-1.5" disabled={analyzing} onClick={() => document.getElementById('iso-file-input')?.click()}>
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {analyzing ? 'ISO AI 판독 중...' : 'ISO 도면 업로드 (PDF/이미지)'}
          </Button>
          <input
            id="iso-file-input"
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleIsoUpload(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* KPI Strip (shown when ISO is loaded) */}
      {isoResult && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3.5">
              <div className="text-[11px] text-muted-foreground">도면 / 라인번호</div>
              <div className="text-sm font-bold truncate mt-1">{isoResult.title_block.line_no || isoFileName}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                유체: <strong>{isoResult.title_block.fluid_gas || '미확인'}</strong> · {isoResult.title_block.design_pressure_bar ?? '—'} bar / {isoResult.title_block.design_temp_c ?? '—'}°C
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <div className="text-[11px] text-muted-foreground">추출 BOM / 용접 포인트</div>
              <div className="text-xl font-bold mt-0.5">{isoResult.bom.length}<span className="text-xs font-normal text-muted-foreground ml-1">품목</span></div>
              <div className="text-[11px] text-muted-foreground">
                Shop {isoResult.welds.shop_weld_count} · Field {isoResult.welds.field_weld_count} (총 {isoResult.welds.shop_weld_count + isoResult.welds.field_weld_count}포인트)
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <div className="text-[11px] text-muted-foreground">가스 안전설계(PSV/KGS) 지적</div>
              <div className={`text-xl font-bold mt-0.5 ${criticalCount > 0 ? 'text-destructive' : 'text-success'}`}>
                {criticalCount > 0 ? `치명 ${criticalCount}건` : '적정'}
              </div>
              <div className="text-[11px] text-muted-foreground">전체 검토 {allFindings.length}건 · 인허가 {permitChecks.length}건</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <div className="text-[11px] text-muted-foreground">시공사 물량표 교차검증</div>
              <div className={`text-xl font-bold mt-0.5 ${overclaimCount > 0 ? 'text-destructive' : 'text-foreground'}`}>
                {vendorBoq.length === 0 ? '미업로드' : overclaimCount > 0 ? `이상 ${overclaimCount}건` : '전항목 일치'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {totalOverclaimKrw > 0 ? `과다청구 추정 ₩${totalOverclaimKrw.toLocaleString()}` : boqFileName || '엑셀 업로드로 대조'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 5-Tab Master Lab Workspace */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'iso' | 'boq' | 'safety' | 'sim' | 'docs')} className="space-y-3">
        <TabsList className="w-full justify-start flex-wrap h-auto p-1 bg-muted/60 rounded-xl gap-1">
          <TabsTrigger value="iso" className="text-xs gap-1.5 rounded-lg">
            ① ISO 표제란 · BOM {isoResult && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{isoResult.bom.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="boq" className="text-xs gap-1.5 rounded-lg">
            ② 시공사 물량표 교차검증
            {overclaimCount > 0 && <Badge variant="destructive" className="text-[10px] h-4 px-1.5">{overclaimCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="safety" className="text-xs gap-1.5 rounded-lg">
            ③ 가스 안전설계 · 인허가
            {criticalCount > 0 && <Badge variant="destructive" className="text-[10px] h-4 px-1.5">치명 {criticalCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="sim" className="text-xs gap-1.5 rounded-lg">
            <Activity className="h-3.5 w-3.5 text-primary" /> ④ 가스 플랜트 운전 시뮬레이터
          </TabsTrigger>
          <TabsTrigger value="docs" className="text-xs gap-1.5 rounded-lg">
            <FileDiff className="h-3.5 w-3.5 text-primary" /> ⑤ 통합 문서 AI 분석·비교
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: ISO Title Block & BOM */}
        <TabsContent value="iso" className="space-y-3 mt-0">
          {!isoResult ? (
            <Card>
              <CardContent className="py-14 text-center space-y-3">
                <FlaskConical className="h-10 w-10 text-primary/40 mx-auto" />
                <h2 className="text-base font-bold">아이소(ISO) 도면을 올려 AI 분석을 시작하세요</h2>
                <p className="text-xs text-muted-foreground max-w-lg mx-auto leading-relaxed">
                  PDF 또는 이미지 형태의 Piping ISO를 업로드하면 표제란(라인번호·유체·압력·온도·재질), BOM 물량표, 용접 포인트, 그리고 KGS·API 520/521·EIGA 기준 PSV·탈지·방폭 안전설계 검토까지 자동으로 수행합니다.
                </p>
                <div className="flex justify-center gap-2 pt-2 flex-wrap">
                  <Button size="sm" onClick={() => document.getElementById('iso-file-input')?.click()}>
                    <Upload className="h-3.5 w-3.5 mr-1.5" /> ISO 도면 업로드
                  </Button>
                  <Button size="sm" variant="outline" onClick={loadDemo}>
                    <Sparkles className="h-3.5 w-3.5 mr-1.5 text-primary" /> 에어리퀴드 LOX 샘플 바로 보기
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setActiveTab('sim')}>
                    <Activity className="h-3.5 w-3.5 mr-1.5" /> 가스 운전 시뮬레이터 바로 체험
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-primary" /> 표제란(Title Block) &amp; 배관 제원
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2 text-xs">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <div className="p-2 rounded border bg-muted/20"><span className="text-muted-foreground block text-[10px]">도면번호 / Rev</span><strong>{isoResult.title_block.drawing_no || '—'} ({isoResult.title_block.revision || '—'})</strong></div>
                    <div className="p-2 rounded border bg-muted/20"><span className="text-muted-foreground block text-[10px]">재질 / Spec</span><strong>{isoResult.title_block.pipe_spec || '—'}</strong></div>
                    <div className="p-2 rounded border bg-muted/20"><span className="text-muted-foreground block text-[10px]">NDT (RT%) / PWHT</span><strong>RT {isoResult.title_block.nde_rt_percent ?? '미표기'}% · PWHT {isoResult.title_block.pwht_required ? '필요' : '불필요'}</strong></div>
                    <div className="p-2 rounded border bg-muted/20"><span className="text-muted-foreground block text-[10px]">산소탈지(O2 Clean) / PSV</span><strong>{isoResult.title_block.o2_cleaning_required ? '표기됨' : '미표기'} · PSV {isoResult.topology_counts.psv_count}개</strong></div>
                  </div>
                  {isoResult.summary && <p className="text-xs text-muted-foreground pt-1">{isoResult.summary}</p>}
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold">도면 BOM (Bill of Materials) 추출 결과</CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-muted/50 border-y text-muted-foreground">
                      <tr>
                        <th className="py-2 px-3 w-12">#</th>
                        <th className="py-2 px-3 w-24">분류</th>
                        <th className="py-2 px-3">품명 / 규격 설명</th>
                        <th className="py-2 px-3 w-20 text-center">관경</th>
                        <th className="py-2 px-3 w-28">재질</th>
                        <th className="py-2 px-3 w-24 text-right">도면 수량</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isoResult.bom.map((b, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 text-muted-foreground">{b.item_no || i + 1}</td>
                          <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{b.category}</Badge></td>
                          <td className="py-2 px-3 font-medium">{b.description}</td>
                          <td className="py-2 px-3 text-center font-mono">{b.size_inch}</td>
                          <td className="py-2 px-3 text-muted-foreground">{b.material || '—'}</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">{b.quantity} {b.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

            {/* Tab 2: Vendor BOQ Cross-Check */}
            <TabsContent value="boq" className="space-y-3 mt-0">
              <div className="rounded-xl border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs">
                  <span className="font-semibold">시공사 제출 물량표(Excel) 1:1 교차검증</span>
                  <span className="text-muted-foreground ml-2">{boqFileName || '품명·규격(DN/A/인치)·수량·단가 컬럼 자동 인식'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => document.getElementById('boq-excel-input')?.click()}>
                    <FileSpreadsheet className="h-3.5 w-3.5" /> 시공사 물량표 업로드 (.xlsx)
                  </Button>
                  {boqDiff.length > 0 && isoResult && (
                    <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => downloadBoqCrossCheckExcel(isoResult.title_block.line_no || 'ISO', boqDiff)}>
                      <Download className="h-3.5 w-3.5" /> 검증 리포트 엑셀 다운로드
                    </Button>
                  )}
                  <input
                    id="boq-excel-input"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleBoqUpload(f);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              {boqDiff.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-xs text-muted-foreground">
                    시공사가 제출한 물량표(.xlsx)를 올리면 도면 BOM과 관경(DN50/50A/2&quot;)을 자동 정규화해 과다청구·누락을 즉시 적발합니다.
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-muted/50 border-b text-muted-foreground">
                        <tr>
                          <th className="py-2.5 px-3 w-24">판정</th>
                          <th className="py-2.5 px-3 w-20">분류</th>
                          <th className="py-2.5 px-3 w-20 text-center">규격</th>
                          <th className="py-2.5 px-3">품명</th>
                          <th className="py-2.5 px-3 text-right">도면 BOM</th>
                          <th className="py-2.5 px-3 text-right">업체 청구</th>
                          <th className="py-2.5 px-3 text-right">차이</th>
                          <th className="py-2.5 px-3 text-right">과다청구 추정</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boqDiff.map((r) => {
                          const badge = DIFF_BADGE[r.status];
                          return (
                            <tr key={r.key} className="border-b hover:bg-muted/30">
                              <td className="py-2.5 px-3"><Badge variant="outline" className={`text-[10px] ${badge.cls}`}>{badge.label}</Badge></td>
                              <td className="py-2.5 px-3 text-muted-foreground">{r.category}</td>
                              <td className="py-2.5 px-3 text-center font-mono">{r.size_inch}</td>
                              <td className="py-2.5 px-3 font-medium">{r.description}</td>
                              <td className="py-2.5 px-3 text-right font-mono">{r.iso_qty} {r.unit}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-semibold">{r.vendor_qty} {r.unit}</td>
                              <td className={`py-2.5 px-3 text-right font-mono font-bold ${r.delta_qty > 0 ? 'text-destructive' : r.delta_qty < 0 ? 'text-amber-700' : 'text-success'}`}>
                                {r.delta_qty > 0 ? `+${r.delta_qty}` : r.delta_qty} {r.unit}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-destructive">
                                {r.estimated_overclaim_krw ? `₩${r.estimated_overclaim_krw.toLocaleString()}` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </TabsContent>

            {/* Tab 3: Gas Safety Design (PSV/KGS/API) & 6-Law Permits */}
            <TabsContent value="safety" className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-0">
              <div className="lg:col-span-7 space-y-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4 text-destructive" /> 에어리퀴드 가스 안전설계 &amp; PSV 법적 적정성 검토 ({allFindings.length}건)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5 pt-0">
                    {allFindings.length === 0 ? (
                      <div className="py-8 text-center text-xs text-success flex flex-col items-center gap-1.5">
                        <CheckCircle2 className="h-6 w-6" />
                        <span>치명적 안전설계 누락이 발견되지 않았습니다.</span>
                      </div>
                    ) : allFindings.map((f, i) => (
                      <div
                        key={i}
                        className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                          f.severity === 'critical'
                            ? 'border-destructive/40 bg-destructive/5'
                            : f.severity === 'warning'
                              ? 'border-amber-300 bg-amber-50/50'
                              : 'border-border bg-muted/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 font-bold">
                            <AlertTriangle className={`h-3.5 w-3.5 ${f.severity === 'critical' ? 'text-destructive' : 'text-amber-600'}`} />
                            <span>{f.title}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px]">{f.category}</Badge>
                            <Badge variant="secondary" className="text-[10px]">{f.rule_ref}</Badge>
                          </div>
                        </div>
                        <p className="text-muted-foreground leading-relaxed">{f.detail}</p>
                        <p className="font-medium text-foreground">▶ 조치 권고: {f.recommendation}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-5 space-y-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold">연관 법적 인허가 체크리스트 ({permitChecks.length}건)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5 pt-0">
                    {permitChecks.map((p, i) => (
                      <div key={i} className="rounded-lg border p-3 text-xs space-y-1 bg-background">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={p.required === '필수' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {p.law} · {p.required}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{p.rule_ref}</span>
                        </div>
                        <div className="font-semibold pt-0.5">{p.permit_name}</div>
                        <div className="text-[11px] text-muted-foreground">관할: {p.authority}</div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{p.reason}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            {/* Tab 4: Interactive Gas Plant Operational Simulator */}
            <TabsContent value="sim" className="mt-0">
              <GasPlantSimulatorPanel isoResult={isoResult} />
            </TabsContent>

            {/* Tab 5: Universal Office/PDF Document AI Analyzer & Diff */}
            <TabsContent value="docs" className="mt-0">
              <PlantDocAnalyzerPanel />
            </TabsContent>
          </Tabs>
    </div>
  );
}
