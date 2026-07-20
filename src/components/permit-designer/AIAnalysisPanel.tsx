/**
 * AI 자동 양식 분석 패널
 * - 원본 PDF 각 페이지를 렌더링 → base64로 edge function에 전송
 * - AI가 2단계(감지+검증)로 분석
 * - 결과를 이미지 위에 시각적으로 미리보기 → 사용자 확인 후 적용
 */
import { useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Sparkles, AlertTriangle, Check, X, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { FormLayout, PrintOverlay, SignatureSlot } from '@/lib/permitFormTypes';

// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

interface Props {
  templateId: string;
  originalPdfUrl: string | null;
  onApply: (result: {
    layout: FormLayout;
    overlay: PrintOverlay;
    signatureSlots: SignatureSlot[];
    detectedTitle?: string;
  }) => void;
}

type AIResult = {
  layoutPatch: FormLayout;
  overlayPatch: PrintOverlay;
  signatureSlots: SignatureSlot[];
  result: any;
  diagnostics: any;
};

export default function AIAnalysisPanel({ templateId, originalPdfUrl, onApply }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  const runAnalysis = async (opts?: { refine?: boolean }): Promise<{ imgs: string[]; res: AIResult } | null> => {
    if (!originalPdfUrl) {
      toast({ title: '원본 PDF를 먼저 업로드하세요.', variant: 'destructive' });
      return null;
    }
    setProgress('PDF 로드 중…');
    const path = originalPdfUrl.replace(/^.*permit-form-assets\//, '');
    const { data: signed, error: sErr } = await supabase.storage
      .from('permit-form-assets').createSignedUrl(path, 600);
    if (sErr) throw sErr;

    const res = await fetch(signed!.signedUrl);
    const buf = await res.arrayBuffer();
    const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;

    const maxPages = Math.min(pdf.numPages, 6);
    const imgs: string[] = [];
    const MAX_PER_PAGE = 4_000_000;
    for (let p = 1; p <= maxPages; p++) {
      setProgress(`페이지 ${p}/${maxPages} 고해상도 렌더…`);
      const page = await pdf.getPage(p);
      let dataUrl = '';
      for (const [scale, quality] of [[2.4, 0.85], [1.9, 0.8], [1.5, 0.7]] as const) {
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= MAX_PER_PAGE) break;
      }
      imgs.push(dataUrl);
    }

    setProgress(opts?.refine ? 'AI 정밀 분석 중… (60~120초)' : 'AI 1차 감지 중… (20~40초)');
    const { data, error } = await supabase.functions.invoke('analyze-permit-template', {
      body: {
        templateId,
        pageImages: imgs,
        enableRefine: !!opts?.refine,
        enableSweep: !!opts?.refine,
      },
    });
    if (error) {
      // Supabase invoke throws generic "non-2xx" — try to surface real message from response body
      let detail = error.message || String(error);
      try {
        const ctx: any = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          const body = await ctx.json();
          if (body?.error) detail = body.error;
        } else if (ctx && typeof ctx.text === 'function') {
          const t = await ctx.text();
          if (t) detail = t.slice(0, 400);
        }
      } catch { /* ignore */ }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    console.log('[AIAnalysisPanel] diagnostics:', data.diagnostics);
    return { imgs, res: data as AIResult };
  };

  const run = async () => {
    setBusy(true);
    try {
      const out = await runAnalysis();
      if (!out) return;
      const { imgs, res } = out;

      const total = (res.result?.fields?.length || 0)
        + (res.result?.checkboxes?.length || 0)
        + (res.result?.signatures?.length || 0);
      if (total === 0) {
        toast({
          title: 'AI가 요소를 인식하지 못했습니다',
          description: '더 선명한 PDF로 다시 시도하거나, 오버레이 탭에서 수동으로 배치하세요.',
          variant: 'destructive',
        });
        return;
      }
      setPageImages(imgs);
      setAiResult(res);
      setPreviewPage(1);
      setPreviewOpen(true);
    } catch (e: any) {
      console.error(e);
      toast({ title: 'AI 분석 실패', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const reAnalyze = async () => {
    setBusy(true);
    try {
      const out = await runAnalysis();
      if (out) {
        setPageImages(out.imgs);
        setAiResult(out.res);
        toast({ title: '재분석 완료', description: '박스 위치가 갱신되었습니다.' });
      }
    } catch (e: any) {
      toast({ title: '재분석 실패', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const apply = () => {
    if (!aiResult) return;
    onApply({
      layout: aiResult.layoutPatch,
      overlay: aiResult.overlayPatch,
      signatureSlots: aiResult.signatureSlots || [],
      detectedTitle: aiResult.result?.detected_title,
    });
    setPreviewOpen(false);
    toast({
      title: '적용 완료',
      description: '오버레이 편집기에서 개별 박스를 미세조정할 수 있습니다.',
    });
  };

  // 페이지별 박스 (파랑=텍스트, 초록=체크, 주황=서명)
  const currentBoxes = useMemo(() => {
    if (!aiResult) return [] as Array<{ x: number; y: number; w: number; h: number; kind: 'text' | 'check' | 'sig'; label: string }>;
    const boxes: any[] = [];
    (aiResult.result?.fields || []).forEach((f: any) => {
      if ((Number(f.page) || 1) === previewPage && Array.isArray(f.bbox)) {
        boxes.push({ x: f.bbox[0], y: f.bbox[1], w: f.bbox[2], h: f.bbox[3], kind: 'text', label: f.label || '' });
      }
    });
    (aiResult.result?.checkboxes || []).forEach((c: any) => {
      if ((Number(c.page) || 1) === previewPage && Array.isArray(c.bbox)) {
        boxes.push({ x: c.bbox[0], y: c.bbox[1], w: c.bbox[2], h: c.bbox[3], kind: 'check', label: c.label || '' });
      }
    });
    (aiResult.result?.signatures || []).forEach((s: any) => {
      if ((Number(s.page) || 1) === previewPage && Array.isArray(s.bbox)) {
        boxes.push({ x: s.bbox[0], y: s.bbox[1], w: s.bbox[2], h: s.bbox[3], kind: 'sig', label: s.label || '' });
      }
    });
    return boxes;
  }, [aiResult, previewPage]);

  const kindColor = (k: string) =>
    k === 'text' ? 'rgba(37,99,235,0.85)' : k === 'check' ? 'rgba(22,163,74,0.85)' : 'rgba(234,88,12,0.85)';
  const kindBg = (k: string) =>
    k === 'text' ? 'rgba(37,99,235,0.15)' : k === 'check' ? 'rgba(22,163,74,0.18)' : 'rgba(234,88,12,0.18)';

  return (
    <div className="space-y-2">
      <Alert>
        <Sparkles className="h-4 w-4" />
        <AlertDescription className="text-xs">
          업로드한 원본 PDF를 AI가 <b>2단계(감지 → 우측/누락 검증)</b> 로 분석합니다.
          결과는 <b>이미지 위에 미리보기</b>로 확인한 뒤 적용/재분석을 선택하세요.
        </AlertDescription>
      </Alert>
      <Button
        onClick={run}
        disabled={busy || !originalPdfUrl}
        className="bg-gradient-to-r from-primary to-primary/80"
      >
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
        {busy ? (progress || 'AI 분석 중…') : 'AI 자동 분석 실행'}
      </Button>
      {!originalPdfUrl && (
        <div className="text-xs text-warning flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> 먼저 "원본 PDF 오버레이" 탭에서 PDF를 업로드하세요.
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        ※ 적용 시 기존 AI 자동 생성 박스는 교체되고, 사용자가 직접 만든 박스는 보존됩니다.
      </p>

      {/* 미리보기 다이얼로그 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[95vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              AI 분석 결과 미리보기
              <Badge variant="secondary">
                필드 {aiResult?.result?.fields?.length || 0} ·
                체크 {aiResult?.result?.checkboxes?.length || 0} ·
                서명 {aiResult?.result?.signatures?.length || 0}
              </Badge>
              {aiResult?.diagnostics?.refine_applied && (
                <Badge className="bg-emerald-600">2차 검증 완료</Badge>
              )}
              {(aiResult?.diagnostics?.sweep_added ?? 0) > 0 && (
                <Badge className="bg-indigo-600">3차 스윕 +{aiResult?.diagnostics?.sweep_added}개</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-500/60 border border-blue-600" />입력란</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-500/60 border border-green-600" />체크박스</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-orange-500/60 border border-orange-600" />서명란</span>
              <span className="text-muted-foreground">
                우측(x&gt;0.5) {aiResult?.diagnostics?.right_side_count ?? 0}개 · 하단(y&gt;0.65) {aiResult?.diagnostics?.bottom_count ?? 0}개
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" className="h-7 w-7"
                onClick={() => setPreviewPage(Math.max(1, previewPage - 1))}
                disabled={previewPage <= 1}><ChevronLeft className="h-3 w-3" /></Button>
              <span>페이지 {previewPage} / {pageImages.length}</span>
              <Button size="icon" variant="outline" className="h-7 w-7"
                onClick={() => setPreviewPage(Math.min(pageImages.length, previewPage + 1))}
                disabled={previewPage >= pageImages.length}><ChevronRight className="h-3 w-3" /></Button>
            </div>
          </div>

          <div className="relative border rounded bg-muted/20 overflow-auto flex-1">
            {pageImages[previewPage - 1] && (
              <div className="relative inline-block">
                <img
                  ref={imgRef}
                  src={pageImages[previewPage - 1]}
                  alt={`page-${previewPage}`}
                  className="block max-w-full"
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setImgSize({ w: el.clientWidth, h: el.clientHeight });
                  }}
                />
                {imgSize.w > 0 && currentBoxes.map((b, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: b.x * imgSize.w,
                      top: b.y * imgSize.h,
                      width: b.w * imgSize.w,
                      height: b.h * imgSize.h,
                      border: `2px solid ${kindColor(b.kind)}`,
                      background: kindBg(b.kind),
                      pointerEvents: 'none',
                    }}
                    title={b.label}
                  >
                    <span
                      className="absolute -top-4 left-0 text-[9px] px-1 rounded whitespace-nowrap text-white"
                      style={{ background: kindColor(b.kind), maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {b.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {aiResult?.diagnostics?.right_side_count === 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                우측 영역에서 요소가 하나도 감지되지 않았습니다. 원본에 우측 체크박스가 있다면 <b>재분석</b>을 눌러 재시도하세요.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              <X className="h-4 w-4 mr-1" />취소
            </Button>
            <Button variant="outline" onClick={reAnalyze} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              재분석
            </Button>
            <Button onClick={apply} disabled={busy}>
              <Check className="h-4 w-4 mr-1" />적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
