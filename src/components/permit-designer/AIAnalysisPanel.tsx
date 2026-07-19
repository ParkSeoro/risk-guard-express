/**
 * AI 자동 양식 분석 패널
 * - 원본 PDF 각 페이지를 렌더링 → base64로 edge function에 전송
 * - 결과(layout, overlay, signature_slots)를 상위에 반환
 */
import { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
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

export default function AIAnalysisPanel({ templateId, originalPdfUrl, onApply }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>('');

  const run = async () => {
    if (!originalPdfUrl) {
      toast({ title: '원본 PDF를 먼저 업로드하세요.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    setProgress('PDF 로드 중…');
    try {
      // signed url
      const path = originalPdfUrl.replace(/^.*permit-form-assets\//, '');
      const { data: signed, error: sErr } = await supabase.storage
        .from('permit-form-assets').createSignedUrl(path, 600);
      if (sErr) throw sErr;

      const res = await fetch(signed!.signedUrl);
      const buf = await res.arrayBuffer();
      const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;

      const maxPages = Math.min(pdf.numPages, 6);
      const pageImages: string[] = [];
      const MAX_PER_PAGE = 4_000_000; // ~4MB base64 상한
      for (let p = 1; p <= maxPages; p++) {
        setProgress(`페이지 ${p}/${maxPages} 이미지화(고해상도)…`);
        const page = await pdf.getPage(p);
        // 고해상도 우선 → 크기 초과 시 자동 축소 재시도
        let dataUrl = '';
        for (const [scale, quality] of [[2.2, 0.85], [1.8, 0.8], [1.4, 0.7]] as const) {
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (dataUrl.length <= MAX_PER_PAGE) break;
        }
        pageImages.push(dataUrl);
      }

      setProgress('AI 분석 중… (Gemini Pro, 15~40초)');
      const { data, error } = await supabase.functions.invoke('analyze-permit-template', {
        body: { templateId, pageImages },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const fCount = data.result?.fields?.length || 0;
      const cCount = data.result?.checkboxes?.length || 0;
      const sCount = data.result?.signatures?.length || 0;
      const total = fCount + cCount + sCount;
      const modelUsed = data.diagnostics?.model_used || '(unknown)';
      // 진단 정보는 항상 콘솔에 남김
      console.log('[AIAnalysisPanel] diagnostics:', data.diagnostics);

      if (total === 0) {
        toast({
          title: 'AI가 요소를 인식하지 못했습니다',
          description: `사용 모델: ${modelUsed}. PDF가 스캔 이미지이거나 텍스트 해상도가 낮을 수 있습니다. "원본 PDF 오버레이" 탭에서 수동으로 배치하거나, 더 선명한 PDF로 다시 시도해 주세요.`,
          variant: 'destructive',
        });
        // 빌더로 이동 X — 기존 상태 유지
        return;
      }

      const detected = data.result?.detected_title;
      onApply({
        layout: data.layoutPatch,
        overlay: data.overlayPatch,
        signatureSlots: data.signatureSlots || [],
        detectedTitle: detected,
      });
      toast({
        title: 'AI 분석 완료',
        description: `필드 ${fCount}개, 체크박스 ${cCount}개, 서명 ${sCount}개 인식 (모델: ${modelUsed}).`,
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'AI 분석 실패',
        description: e.message || String(e),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div className="space-y-2">
      <Alert>
        <Sparkles className="h-4 w-4" />
        <AlertDescription className="text-xs">
          업로드한 원본 PDF를 AI가 분석하여 <b>입력란·체크박스·서명란</b>을 자동으로 인식하고
          레이아웃/오버레이/결재라인 초안을 만들어 줍니다. 결과는 이후 수동으로 미세조정할 수 있습니다.
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
        ※ AI 결과 적용 시 기존 <b>AI 자동 생성</b>(점선) 박스는 교체되고, 사용자가 직접 만든 박스는 보존됩니다.
      </p>
    </div>
  );
}
