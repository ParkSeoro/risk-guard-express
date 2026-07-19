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
      for (let p = 1; p <= maxPages; p++) {
        setProgress(`페이지 ${p}/${maxPages} 이미지화…`);
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.4 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        // JPEG 60% — 토큰 절약
        pageImages.push(canvas.toDataURL('image/jpeg', 0.6));
      }

      setProgress('AI 분석 중… (10~30초)');
      const { data, error } = await supabase.functions.invoke('analyze-permit-template', {
        body: { templateId, pageImages },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const detected = data.result?.detected_title;
      onApply({
        layout: data.layoutPatch,
        overlay: data.overlayPatch,
        signatureSlots: data.signatureSlots || [],
        detectedTitle: detected,
      });
      toast({
        title: 'AI 분석 완료',
        description: `필드 ${data.result?.fields?.length || 0}개, 체크박스 ${data.result?.checkboxes?.length || 0}개, 서명 ${data.result?.signatures?.length || 0}개를 인식했습니다.`,
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
