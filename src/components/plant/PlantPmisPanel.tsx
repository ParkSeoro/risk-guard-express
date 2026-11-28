/**
 * Construction Site PMIS Panel: AI Manpower Report (인원보고) & Progress Claim (기성청구) Cross-Check.
 * Strictly Master-Only inside Plant AI Lab.
 */
import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  ClipboardCheck,
  Cpu,
  Download,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  SAMPLE_CLAIMS_YEOSU,
  SAMPLE_MANPOWER_YEOSU,
  auditPmisData,
  downloadPmisAuditExcel,
  parseManpowerExcel,
  parseProgressClaimExcel,
  type ManpowerRow,
  type ProgressClaimRow,
} from '@/lib/plantPmisEngine';

interface AiPmisOpinion {
  approval_recommendation: string;
  executive_opinion: string;
  key_risks: { severity: 'critical' | 'warning'; trade: string; title: string; detail: string; action: string }[];
  contractor_notice_draft: string;
}

export function PlantPmisPanel() {
  const { toast } = useToast();
  const [manpower, setManpower] = useState<ManpowerRow[]>(SAMPLE_MANPOWER_YEOSU);
  const [claims, setClaims] = useState<ProgressClaimRow[]>(SAMPLE_CLAIMS_YEOSU);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiOpinion, setAiOpinion] = useState<AiPmisOpinion | null>(null);
  const [aiModelUsed, setAiModelUsed] = useState('');

  const summary = useMemo(() => auditPmisData(manpower, claims), [manpower, claims]);

  const handleManpowerUpload = async (file: File) => {
    try {
      const parsed = parseManpowerExcel(await file.arrayBuffer());
      if (parsed.length === 0) throw new Error('공종·계획·투입 컬럼을 찾을 수 없습니다.');
      setManpower(parsed);
      setAiOpinion(null);
      toast({ title: `출역일보 ${parsed.length}개 공종 로드 완료` });
    } catch (e: any) {
      toast({ title: '출역일보 파싱 실패', description: e?.message, variant: 'destructive' });
    }
  };

  const handleClaimUpload = async (file: File) => {
    try {
      const parsed = parseProgressClaimExcel(await file.arrayBuffer());
      if (parsed.length === 0) throw new Error('공종·계약금액·금회청구 컬럼을 찾을 수 없습니다.');
      setClaims(parsed);
      setAiOpinion(null);
      toast({ title: `기성청구서 ${parsed.length}개 공종 로드 완료` });
    } catch (e: any) {
      toast({ title: '기성청구서 파싱 실패', description: e?.message, variant: 'destructive' });
    }
  };

  const runAiAudit = async () => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-plant-pmis', {
        body: { manpower, claims, anomalies: summary.anomalies },
      });
      if (error || !data?.ok || !data?.result) {
        throw new Error(data?.error || error?.message || 'AI PMIS 검토 실패');
      }
      setAiOpinion(data.result as AiPmisOpinion);
      setAiModelUsed(String(data.model || 'gemini-2.5-pro'));
      toast({ title: 'AI 기성·인원 교차검증 및 승인 의견서 작성 완료' });
    } catch (e: any) {
      toast({ title: 'AI 검토 실패', description: e?.message, variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              시공 PMIS · AI 인원보고(출역일보) &amp; 기성청구 교차검증
              {aiModelUsed && <Badge variant="outline" className="text-[10px] text-primary">AI: {aiModelUsed}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              출역 인원·TBM 이수율·NDT 품질성적서·기성청구액을 AI로 교차 대조해 과다청구·선기성·안전미충족 공종을 즉시 적발합니다.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => document.getElementById('pmis-mp-input')?.click()}>
              <Users className="h-3.5 w-3.5" /> 출역일보(.xlsx)
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => document.getElementById('pmis-claim-input')?.click()}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> 기성청구서(.xlsx)
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => downloadPmisAuditExcel(summary, claims)}>
              <Download className="h-3.5 w-3.5" /> 검토표 엑셀
            </Button>
            <Button size="sm" className="h-8 text-xs gap-1.5" disabled={analyzing} onClick={runAiAudit}>
              {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
              {analyzing ? 'AI 승인·감액 검토 중...' : 'AI 기성 승인·감액 의견서 생성'}
            </Button>
            <input id="pmis-mp-input" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleManpowerUpload(f); e.target.value = ''; }} />
            <input id="pmis-claim-input" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleClaimUpload(f); e.target.value = ''; }} />
          </div>
        </CardContent>
      </Card>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3.5"><div className="text-[11px] text-muted-foreground">당일 투입 인원</div><div className="text-lg font-bold mt-0.5">{summary.totalActualHeadcount} / {summary.totalPlannedHeadcount}명</div><div className="text-[11px] text-muted-foreground">계획 대비 {summary.headcountRatePct}%</div></CardContent></Card>
        <Card><CardContent className="p-3.5"><div className="text-[11px] text-muted-foreground">금회 기성 청구액</div><div className="text-lg font-bold mt-0.5">₩{summary.totalThisClaimKrw.toLocaleString()}</div><div className="text-[11px] text-muted-foreground">누계 진도율 {summary.cumulativeProgressPct}%</div></CardContent></Card>
        <Card><CardContent className="p-3.5"><div className="text-[11px] text-muted-foreground">탐지된 이상징후</div><div className={`text-lg font-bold mt-0.5 ${summary.anomalies.length > 0 ? 'text-destructive' : 'text-emerald-700'}`}>{summary.anomalies.length}건</div><div className="text-[11px] text-muted-foreground">과다청구·NDT·TBM 교차검증</div></CardContent></Card>
        <Card><CardContent className="p-3.5"><div className="text-[11px] text-muted-foreground">감액·유보 권고액</div><div className="text-lg font-bold mt-0.5 text-destructive">₩{summary.recommendedCutKrw.toLocaleString()}</div><div className="text-[11px] text-muted-foreground">실물 검측 및 성적서 확인 전 유보</div></CardContent></Card>
      </div>

      {/* Claims Table + Anomalies */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-7 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">공종별 출역 인원 · 기성청구 현황</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-muted/50 border-y text-muted-foreground">
                <tr>
                  <th className="py-2 px-3">공종</th>
                  <th className="py-2 px-3 text-right">인원(실/계)</th>
                  <th className="py-2 px-3 text-right">계약액</th>
                  <th className="py-2 px-3 text-right">금회청구</th>
                  <th className="py-2 px-3 text-right">누계(%)</th>
                  <th className="py-2 px-3 text-center">NDT/품질</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c, i) => {
                  const mp = manpower.find((m) => m.trade === c.trade);
                  return (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="py-2 px-3 font-medium">{c.trade}</td>
                      <td className="py-2 px-3 text-right font-mono">{mp ? `${mp.actual_headcount}/${mp.planned_headcount}` : '—'}</td>
                      <td className="py-2 px-3 text-right font-mono">₩{Math.round(c.contract_krw / 10000).toLocaleString()}만</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">₩{Math.round(c.this_claim_krw / 10000).toLocaleString()}만</td>
                      <td className={`py-2 px-3 text-right font-mono font-bold ${c.claimed_progress_pct > 100 ? 'text-destructive' : ''}`}>{c.claimed_progress_pct}%</td>
                      <td className="py-2 px-3 text-center">
                        <Badge variant={c.verified_ndt_done === false ? 'destructive' : 'outline'} className="text-[10px]">
                          {c.verified_ndt_done === false ? '미완료' : '확인'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold flex items-center justify-between">
              <span>자동 이상징후 &amp; AI 승인 의견</span>
              {aiOpinion && <Badge variant="destructive" className="text-[10px]">{aiOpinion.approval_recommendation}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2.5 text-xs">
            {aiOpinion && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> AI 총괄 의견: {aiOpinion.approval_recommendation}
                </div>
                <p className="leading-relaxed">{aiOpinion.executive_opinion}</p>
                {aiOpinion.contractor_notice_draft && (
                  <div className="rounded bg-background border p-2 text-[11px] text-muted-foreground">
                    <strong className="text-foreground block mb-0.5">시공사 통보문 초안:</strong>
                    {aiOpinion.contractor_notice_draft}
                  </div>
                )}
              </div>
            )}
            {summary.anomalies.map((a, i) => (
              <div key={i} className={`rounded-lg border p-2.5 space-y-1 ${a.severity === 'critical' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-300 bg-amber-50/50'}`}>
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${a.severity === 'critical' ? 'text-destructive' : 'text-amber-600'}`} />
                  <span>{a.title}</span>
                </div>
                <p className="text-muted-foreground">{a.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
