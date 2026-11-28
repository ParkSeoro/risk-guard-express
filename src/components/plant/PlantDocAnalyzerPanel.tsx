/**
 * Tier 1 Universal Document AI Analyzer & Rev.0 vs Rev.1 Diff Panel (Master-Only Plant AI Lab).
 * Supports Excel (.xlsx/.csv), Word (.docx), PowerPoint (.pptx), PDF (.pdf), and Text.
 */
import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDiff,
  FileText,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  SAMPLE_SPEC_REV0,
  SAMPLE_SPEC_REV1,
  compareDocumentTexts,
  downloadDocDiffExcel,
  parsePlantDocumentBuffer,
  type ParsedPlantDocument,
} from '@/lib/plantDocAnalyzer';

interface AiDocReview {
  executive_summary: string;
  key_specs: { label: string; value: string }[];
  risk_findings: {
    severity: 'critical' | 'warning' | 'info';
    category: string;
    title: string;
    detail: string;
    recommendation: string;
  }[];
  action_items: string[];
}

export function PlantDocAnalyzerPanel() {
  const { toast } = useToast();
  const [docA, setDocA] = useState<ParsedPlantDocument | null>(null);
  const [docB, setDocB] = useState<ParsedPlantDocument | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiReview, setAiReview] = useState<AiDocReview | null>(null);

  const diff = useMemo(
    () => (docA && docB ? compareDocumentTexts(docA.fullText, docB.fullText) : null),
    [docA, docB],
  );

  const handleFile = async (file: File, slot: 'A' | 'B') => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parsePlantDocumentBuffer(file.name, buf);
      if (slot === 'A') setDocA(parsed);
      else setDocB(parsed);
      setAiReview(null);
      toast({ title: `${slot === 'A' ? '기준 문서(Rev.0)' : '비교 문서(Rev.1)'} 파싱 완료`, description: `${file.name} (${parsed.charCount.toLocaleString()}자)` });
    } catch (e: any) {
      toast({ title: '문서 파싱 실패', description: e?.message || '지원하지 않는 형식입니다.', variant: 'destructive' });
    }
  };

  const loadSamplePair = () => {
    setDocA(SAMPLE_SPEC_REV0);
    setDocB(SAMPLE_SPEC_REV1);
    setAiReview(null);
    toast({ title: '에어리퀴드 LOX 시방서 Rev.0 vs 시공사 수정본 Rev.1 샘플을 불러왔습니다.' });
  };

  const runAiReview = async () => {
    if (!docA) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-plant-doc', {
        body: {
          mode: docB ? 'compare' : 'single',
          docAName: docA.fileName,
          docAText: docA.fullText,
          docBName: docB?.fileName,
          docBText: docB?.fullText,
        },
      });
      if (error || !data?.ok || !data?.result) {
        throw new Error(data?.error || error?.message || 'AI 문서 분석 실패');
      }
      setAiReview(data.result as AiDocReview);
      toast({ title: docB ? 'Rev.0 vs Rev.1 AI 리스크 정밀 비교 완료' : 'AI 문서 리스크 분석 완료' });
    } catch (e: any) {
      toast({ title: 'AI 분석 오류', description: e?.message, variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold flex items-center gap-1.5">
                <FileDiff className="h-4 w-4 text-primary" /> 통합 문서 AI 분석 · Rev.0 vs Rev.1 자동 비교
              </div>
              <p className="text-xs text-muted-foreground">
                Excel(.xlsx) · Word(.docx) · PowerPoint(.pptx) · PDF 문서를 서버 추가 비용 없이 즉시 추출하고, 숨겨진 스펙 하향·비용 증액 함정을 AI가 적발합니다.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={loadSamplePair}>
                <Sparkles className="h-3.5 w-3.5 text-primary" /> 시방서 변경 함정 샘플 체험
              </Button>
              <Button size="sm" className="h-8 text-xs gap-1.5" disabled={!docA || analyzing} onClick={runAiReview}>
                {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {analyzing ? 'AI 정밀 검토 중...' : docB ? 'AI 변경 리스크 비교 실행' : 'AI 단일 문서 검토 실행'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {/* Slot A */}
            <div className="rounded-lg border p-3 bg-muted/20 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-primary">① 기준 문서 (필수 · Rev.0 / 발주 시방서)</div>
                <div className="text-xs font-medium truncate mt-0.5">{docA ? docA.fileName : '파일을 업로드하세요'}</div>
                {docA && (
                  <div className="text-[10px] text-muted-foreground">
                    {docA.kind.toUpperCase()} · {docA.sectionCount}개 섹션 · {docA.charCount.toLocaleString()}자
                  </div>
                )}
              </div>
              <Button size="sm" variant="outline" className="h-8 text-xs shrink-0 gap-1" onClick={() => document.getElementById('plant-doc-a')?.click()}>
                <Upload className="h-3.5 w-3.5" /> 업로드
              </Button>
              <input
                id="plant-doc-a"
                type="file"
                accept=".xlsx,.xls,.csv,.docx,.pptx,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f, 'A');
                  e.target.value = '';
                }}
              />
            </div>

            {/* Slot B */}
            <div className="rounded-lg border p-3 bg-muted/20 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-amber-700">② 비교 문서 (선택 · Rev.1 / 시공사 수정본)</div>
                <div className="text-xs font-medium truncate mt-0.5">{docB ? docB.fileName : '비교할 문서 업로드 시 Diff 자동 계산'}</div>
                {docB && (
                  <div className="text-[10px] text-muted-foreground">
                    {docB.kind.toUpperCase()} · {docB.sectionCount}개 섹션 · {docB.charCount.toLocaleString()}자
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {docB && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setDocB(null); setAiReview(null); }}>
                    해제
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => document.getElementById('plant-doc-b')?.click()}>
                  <Upload className="h-3.5 w-3.5" /> 업로드
                </Button>
              </div>
              <input
                id="plant-doc-b"
                type="file"
                accept=".xlsx,.xls,.csv,.docx,.pptx,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f, 'B');
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deterministic Diff Table */}
      {diff && docA && docB && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-xs font-semibold flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-primary" />
              조항·수치 변경 자동 비교 (수정 {diff.modifiedCount} · 추가 {diff.addedCount} · 삭제 {diff.removedCount} · 수치변경 {diff.numericChangeCount}건)
            </CardTitle>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => downloadDocDiffExcel(docA.fileName, docB.fileName, diff)}>
              <Download className="h-3 w-3" /> 비교표 엑셀 다운로드
            </Button>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-muted/50 border-y text-muted-foreground">
                <tr>
                  <th className="py-2 px-3 w-24">유형</th>
                  <th className="py-2 px-3">기준 문서 (Rev.0)</th>
                  <th className="py-2 px-3">비교 문서 (Rev.1)</th>
                </tr>
              </thead>
              <tbody>
                {diff.entries.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-muted-foreground">두 문서의 텍스트가 완전히 동일합니다.</td>
                  </tr>
                ) : (
                  diff.entries.map((e, idx) => (
                    <tr key={idx} className="border-b hover:bg-muted/30">
                      <td className="py-2 px-3 align-top">
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant="outline"
                            className={`text-[10px] w-fit ${
                              e.type === 'modified'
                                ? 'border-amber-400 bg-amber-50 text-amber-800'
                                : e.type === 'removed'
                                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                  : 'border-blue-400 bg-blue-50 text-blue-700'
                            }`}
                          >
                            {e.type === 'modified' ? '수정됨' : e.type === 'removed' ? '삭제됨' : '추가됨'}
                          </Badge>
                          {e.hasNumericChange && (
                            <Badge variant="destructive" className="text-[9px] w-fit">수치변경</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 align-top text-muted-foreground">{e.before || '—'}</td>
                      <td className="py-2 px-3 align-top font-medium text-foreground">{e.after || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* AI Review Result */}
      {aiReview && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Card className="lg:col-span-7">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-destructive" /> AI 적발 리스크 &amp; 함정 검토 ({aiReview.risk_findings.length}건)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2.5">
              <p className="text-xs bg-muted/40 rounded-lg p-3 leading-relaxed">{aiReview.executive_summary}</p>
              {aiReview.risk_findings.map((f, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 text-xs space-y-1 ${
                    f.severity === 'critical'
                      ? 'border-destructive/40 bg-destructive/5'
                      : f.severity === 'warning'
                        ? 'border-amber-300 bg-amber-50/60'
                        : 'border-border bg-muted/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold">{f.title}</span>
                    <Badge variant="outline" className="text-[10px]">{f.category}</Badge>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{f.detail}</p>
                  <p className="font-medium text-foreground">▶ 조치: {f.recommendation}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold">핵심 스펙 &amp; 발주처 체크리스트</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3 text-xs">
              {aiReview.key_specs.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {aiReview.key_specs.map((s, i) => (
                    <div key={i} className="rounded border p-2 bg-muted/20">
                      <div className="text-[10px] text-muted-foreground">{s.label}</div>
                      <div className="font-semibold mt-0.5">{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {aiReview.action_items.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t">
                  <div className="font-semibold text-[11px]">즉시 확인 / 협상 조치사항</div>
                  {aiReview.action_items.map((a, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
