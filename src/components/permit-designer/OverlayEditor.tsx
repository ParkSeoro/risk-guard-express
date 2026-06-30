/**
 * 인쇄 오버레이 편집기 — 원본 PDF 페이지 위에 사각형을 그려 필드 좌표를 매핑.
 * 좌표는 페이지 크기에 대한 0~1 비율로 저장 (해상도 독립).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Upload, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { FormLayout, PrintOverlay, OverlayBox, OverlayRenderKind } from '@/lib/permitFormTypes';

// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

interface Props {
  templateId: string;
  layout: FormLayout;
  overlay: PrintOverlay;
  originalPdfUrl: string | null;
  onChange: (overlay: PrintOverlay, originalPdfUrl: string | null) => void;
}

const RENDER_LABELS: Record<OverlayRenderKind, string> = {
  text: '텍스트',
  check: '체크 ✓',
  signature: '서명 이미지',
  image: '이미지',
};

export default function OverlayEditor({ templateId, layout, overlay, originalPdfUrl, onChange }: Props) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [uploading, setUploading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const allFieldKeys = useMemo(() => {
    const ks: { key: string; label: string }[] = [];
    layout.sections.forEach((s) =>
      s.fields.forEach((f) => {
        if (f.type === 'checkbox_group' && f.options) {
          f.options.forEach((o) => ks.push({ key: `${f.key}.${o.value}`, label: `${f.label} → ${o.label}` }));
        } else {
          ks.push({ key: f.key, label: f.label });
        }
      }),
    );
    return ks;
  }, [layout]);

  // signed URL 가져오기 (private bucket)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSignedUrl(null);
      if (!originalPdfUrl) return;
      try {
        const path = originalPdfUrl.replace(/^.*permit-form-assets\//, '');
        const { data, error } = await supabase.storage.from('permit-form-assets').createSignedUrl(path, 3600);
        if (!error && data?.signedUrl && !cancelled) setSignedUrl(data.signedUrl);
        else if (!cancelled) setSignedUrl(originalPdfUrl); // fallback
      } catch {
        if (!cancelled) setSignedUrl(originalPdfUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [originalPdfUrl]);

  // PDF 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!signedUrl) { setPdfDoc(null); return; }
      try {
        const res = await fetch(signedUrl);
        const buf = await res.arrayBuffer();
        const doc = await (pdfjsLib as any).getDocument({ data: buf }).promise;
        if (!cancelled) {
          setPdfDoc(doc);
          setPageNum(1);
        }
      } catch (e) {
        console.error('PDF load failed', e);
        toast({ title: 'PDF 로드 실패', variant: 'destructive' });
      }
    })();
    return () => { cancelled = true; };
  }, [signedUrl]);

  // 페이지 렌더
  useEffect(() => {
    (async () => {
      if (!pdfDoc || !canvasRef.current) return;
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setPageSize({ w: viewport.width, h: viewport.height });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    })();
  }, [pdfDoc, pageNum]);

  const upload = async (file: File) => {
    setUploading(true);
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `templates/${templateId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('permit-form-assets').upload(path, file, { upsert: true });
    setUploading(false);
    if (error) return toast({ title: '업로드 실패', description: error.message, variant: 'destructive' });
    onChange(overlay, path);
    toast({ title: '원본 PDF가 업로드되었습니다.' });
  };

  // 박스 그리기 (드래그)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDrag({ x0: x, y0: y, x1: x, y1: y });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDrag({ ...drag, x1: x, y1: y });
  };
  const onMouseUp = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (w < 0.005 || h < 0.005) return;
    const newBox: OverlayBox = {
      id: `box_${Date.now().toString(36)}`,
      field_key: allFieldKeys[0]?.key || '',
      page: pageNum,
      x, y, w, h,
      render: 'text',
      font_size: 10,
      align: 'left',
    };
    const pages = [...overlay.pages];
    let p = pages.find((pg) => pg.page === pageNum);
    if (!p) {
      p = { page: pageNum, boxes: [] };
      pages.push(p);
    }
    p.boxes = [...p.boxes, newBox];
    onChange({ pages }, originalPdfUrl);
  };

  const pageBoxes = overlay.pages.find((p) => p.page === pageNum)?.boxes || [];

  const updateBox = (id: string, patch: Partial<OverlayBox>) => {
    const pages = overlay.pages.map((pg) =>
      pg.page === pageNum ? { ...pg, boxes: pg.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) } : pg,
    );
    onChange({ pages }, originalPdfUrl);
  };
  const removeBox = (id: string) => {
    const pages = overlay.pages.map((pg) =>
      pg.page === pageNum ? { ...pg, boxes: pg.boxes.filter((b) => b.id !== id) } : pg,
    );
    onChange({ pages }, originalPdfUrl);
  };

  if (!originalPdfUrl) {
    return (
      <div className="border-2 border-dashed rounded p-8 text-center bg-muted/30">
        <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground mb-3">
          원본 PDF 양식을 업로드하면, 각 입력 위치를 마우스로 매핑해 인쇄 시 원본과 동일하게 출력됩니다.
        </p>
        <Input
          type="file"
          accept="application/pdf"
          className="max-w-xs mx-auto"
          disabled={uploading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Button size="sm" variant="outline" onClick={() => setPageNum(Math.max(1, pageNum - 1))} disabled={pageNum <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">페이지 {pageNum} / {pdfDoc?.numPages || '?'}</span>
          <Button size="sm" variant="outline" onClick={() => setPageNum(Math.min(pdfDoc?.numPages || 1, pageNum + 1))} disabled={!pdfDoc || pageNum >= pdfDoc.numPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Badge variant="outline" className="ml-2">박스 {pageBoxes.length}</Badge>
          <div className="ml-auto">
            <Input
              type="file"
              accept="application/pdf"
              className="h-8 text-xs w-56"
              disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
            />
          </div>
        </div>
        <div
          ref={wrapRef}
          className="relative inline-block border bg-white max-w-full overflow-auto"
          style={{ cursor: 'crosshair' }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={() => setDrag(null)}
            className="block"
          />
          {/* 기존 박스 */}
          {pageSize.w > 0 && pageBoxes.map((b) => (
            <div
              key={b.id}
              className="absolute border-2 border-primary bg-primary/10 pointer-events-none"
              style={{
                left: b.x * pageSize.w,
                top: b.y * pageSize.h,
                width: b.w * pageSize.w,
                height: b.h * pageSize.h,
              }}
            >
              <div className="text-[10px] bg-primary text-primary-foreground px-1 absolute -top-4 left-0 whitespace-nowrap">
                {b.field_key}
              </div>
            </div>
          ))}
          {/* 드래그중 */}
          {drag && pageSize.w > 0 && (
            <div
              className="absolute border-2 border-dashed border-amber-500 bg-amber-500/10 pointer-events-none"
              style={{
                left: Math.min(drag.x0, drag.x1) * pageSize.w,
                top: Math.min(drag.y0, drag.y1) * pageSize.h,
                width: Math.abs(drag.x1 - drag.x0) * pageSize.w,
                height: Math.abs(drag.y1 - drag.y0) * pageSize.h,
              }}
            />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          PDF 위에서 마우스로 사각형을 그려 박스를 만들고, 오른쪽 목록에서 필드와 표시 방식을 지정하세요.
        </p>
      </div>

      <div className="border rounded p-2 max-h-[75vh] overflow-auto">
        <h4 className="text-sm font-semibold mb-2">이 페이지의 박스 ({pageBoxes.length})</h4>
        {pageBoxes.length === 0 && <p className="text-xs text-muted-foreground">박스가 없습니다.</p>}
        <div className="space-y-2">
          {pageBoxes.map((b) => (
            <div key={b.id} className="border rounded p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-muted-foreground">
                  {(b.x * 100).toFixed(1)}, {(b.y * 100).toFixed(1)}
                </span>
                <Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={() => removeBox(b.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div>
                <Label className="text-[10px]">필드</Label>
                <Select value={b.field_key} onValueChange={(v) => updateBox(b.id, { field_key: v })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allFieldKeys.map((k) => <SelectItem key={k.key} value={k.key}>{k.label} ({k.key})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <Label className="text-[10px]">표시</Label>
                  <Select value={b.render} onValueChange={(v) => updateBox(b.id, { render: v as OverlayRenderKind })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(RENDER_LABELS) as OverlayRenderKind[]).map((k) =>
                        <SelectItem key={k} value={k}>{RENDER_LABELS[k]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {b.render === 'text' && (
                  <div>
                    <Label className="text-[10px]">정렬</Label>
                    <Select value={b.align || 'left'} onValueChange={(v) => updateBox(b.id, { align: v as any })}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">왼쪽</SelectItem>
                        <SelectItem value="center">가운데</SelectItem>
                        <SelectItem value="right">오른쪽</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {b.render === 'text' && (
                <div>
                  <Label className="text-[10px]">폰트 크기 (pt)</Label>
                  <Input
                    type="number"
                    className="h-7 text-xs"
                    value={b.font_size || 10}
                    onChange={(e) => updateBox(b.id, { font_size: Number(e.target.value) })}
                  />
                </div>
              )}
              {b.render === 'check' && (
                <div>
                  <Label className="text-[10px]">체크 조건 (이 값일 때 ✓)</Label>
                  <Input
                    className="h-7 text-xs"
                    placeholder="true 또는 특정 값"
                    value={String(b.check_when ?? 'true')}
                    onChange={(e) => updateBox(b.id, { check_when: e.target.value })}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
