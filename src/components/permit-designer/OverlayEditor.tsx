/**
 * 인쇄 오버레이 편집기 v2
 * - 원본 PDF 페이지 위에 사각형을 그려 필드 좌표를 매핑
 * - 타입별 색상 (텍스트=파랑, 체크=초록, 서명=주황, 이미지=보라)
 * - 상단 툴바: [텍스트][체크박스][서명][이미지] 중 하나 선택 후 드래그로 생성
 * - 박스 클릭 → 드래그로 이동, 우하단 핸들 → 리사이즈, Delete/BackSpace 삭제
 * - 다른 박스와 30% 이상 겹치면 빨간 경고
 * - AI 자동 생성 박스는 점선 테두리 + "AI" 뱃지
 * - 좌표는 0~1 비율 저장 (해상도 독립)
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
import {
  Upload, Trash2, ChevronLeft, ChevronRight, Type, CheckSquare, PenTool, Image as ImageIcon,
  MousePointer2, AlertTriangle, Sparkles,
} from 'lucide-react';
import {
  FormLayout, PrintOverlay, OverlayBox, OverlayRenderKind, RENDER_COLORS, overlapRatio,
} from '@/lib/permitFormTypes';

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

type Tool = 'select' | OverlayRenderKind;

const TOOLS: { id: Tool; label: string; icon: any; kind?: OverlayRenderKind }[] = [
  { id: 'select', label: '선택/이동', icon: MousePointer2 },
  { id: 'text', label: '텍스트', icon: Type, kind: 'text' },
  { id: 'check', label: '체크박스', icon: CheckSquare, kind: 'check' },
  { id: 'signature', label: '서명', icon: PenTool, kind: 'signature' },
  { id: 'image', label: '이미지', icon: ImageIcon, kind: 'image' },
];

export default function OverlayEditor({ templateId, layout, overlay, originalPdfUrl, onChange }: Props) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [uploading, setUploading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allFieldKeys = useMemo(() => {
    const ks: { key: string; label: string }[] = [];
    (layout?.sections || []).forEach((s) =>
      (s?.fields || []).forEach((f) => {
        if (f.type === 'checkbox_group' && Array.isArray(f.options)) {
          f.options.forEach((o) => ks.push({ key: `${f.key}.${o.value}`, label: `${f.label} → ${o.label}` }));
        } else {
          ks.push({ key: f.key, label: f.label });
        }
      }),
    );
    return ks;
  }, [layout]);

  // signed URL
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSignedUrl(null);
      if (!originalPdfUrl) return;
      try {
        const path = originalPdfUrl.replace(/^.*permit-form-assets\//, '');
        const { data, error } = await supabase.storage.from('permit-form-assets').createSignedUrl(path, 3600);
        if (!error && data?.signedUrl && !cancelled) setSignedUrl(data.signedUrl);
        else if (!cancelled) setSignedUrl(originalPdfUrl);
      } catch {
        if (!cancelled) setSignedUrl(originalPdfUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [originalPdfUrl]);

  // PDF load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!signedUrl) { setPdfDoc(null); return; }
      try {
        const res = await fetch(signedUrl);
        const buf = await res.arrayBuffer();
        const doc = await (pdfjsLib as any).getDocument({ data: buf }).promise;
        if (!cancelled) { setPdfDoc(doc); setPageNum(1); }
      } catch (e) {
        console.error('PDF load failed', e);
        toast({ title: 'PDF 로드 실패', variant: 'destructive' });
      }
    })();
    return () => { cancelled = true; };
  }, [signedUrl]);

  // Render page
  useEffect(() => {
    (async () => {
      if (!pdfDoc || !canvasRef.current) return;
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.4 });
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

  const pageBoxes = overlay.pages.find((p) => p.page === pageNum)?.boxes || [];
  const selected = pageBoxes.find((b) => b.id === selectedId) || null;

  const commit = (nextBoxes: OverlayBox[]) => {
    const pages = [...overlay.pages];
    const idx = pages.findIndex((p) => p.page === pageNum);
    if (idx >= 0) pages[idx] = { ...pages[idx], boxes: nextBoxes };
    else pages.push({ page: pageNum, boxes: nextBoxes });
    onChange({ pages }, originalPdfUrl);
  };

  const updateBox = (id: string, patch: Partial<OverlayBox>) => {
    commit(pageBoxes.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };
  const removeBox = (id: string) => {
    commit(pageBoxes.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // ─────────── 상호작용: 드래그(생성/이동/리사이즈) ───────────
  type Drag =
    | { mode: 'create'; kind: OverlayRenderKind; x0: number; y0: number; x1: number; y1: number }
    | { mode: 'move'; id: string; startX: number; startY: number; boxX: number; boxY: number }
    | { mode: 'resize'; id: string; startX: number; startY: number; boxW: number; boxH: number };
  const [drag, setDrag] = useState<Drag | null>(null);

  const getPt = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    if (tool === 'select') { setSelectedId(null); return; }
    const { x, y } = getPt(e);
    setSelectedId(null);
    setDrag({ mode: 'create', kind: tool as OverlayRenderKind, x0: x, y0: y, x1: x, y1: y });
  };

  const onBoxMouseDown = (e: React.MouseEvent, b: OverlayBox) => {
    e.stopPropagation();
    if (tool !== 'select') return;
    const { x, y } = getPt(e);
    setSelectedId(b.id);
    setDrag({ mode: 'move', id: b.id, startX: x, startY: y, boxX: b.x, boxY: b.y });
  };
  const onHandleMouseDown = (e: React.MouseEvent, b: OverlayBox) => {
    e.stopPropagation();
    const { x, y } = getPt(e);
    setSelectedId(b.id);
    setDrag({ mode: 'resize', id: b.id, startX: x, startY: y, boxW: b.w, boxH: b.h });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag || !canvasRef.current) return;
    const { x, y } = getPt(e);
    if (drag.mode === 'create') {
      setDrag({ ...drag, x1: x, y1: y });
    } else if (drag.mode === 'move') {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      updateBox(drag.id, {
        x: Math.max(0, Math.min(1 - 0.005, drag.boxX + dx)),
        y: Math.max(0, Math.min(1 - 0.005, drag.boxY + dy)),
      });
    } else if (drag.mode === 'resize') {
      const dw = x - drag.startX;
      const dh = y - drag.startY;
      updateBox(drag.id, {
        w: Math.max(0.01, Math.min(1, drag.boxW + dw)),
        h: Math.max(0.01, Math.min(1, drag.boxH + dh)),
      });
    }
  };

  const onMouseUp = () => {
    if (!drag) return;
    if (drag.mode === 'create') {
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
        render: drag.kind,
        font_size: 10,
        align: 'left',
      };
      if (drag.kind === 'check') newBox.check_when = 'true';
      commit([...pageBoxes, newBox]);
      setSelectedId(newBox.id);
      setTool('select'); // 생성 후 자동으로 선택 툴로
      return;
    }
    setDrag(null);
  };

  // Delete 키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        // Input 안이면 무시
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        removeBox(selectedId);
      }
      if (selectedId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const b = pageBoxes.find((x) => x.id === selectedId);
        if (!b) return;
        if (e.key === 'ArrowUp') updateBox(b.id, { y: Math.max(0, b.y - step) });
        if (e.key === 'ArrowDown') updateBox(b.id, { y: Math.min(1 - b.h, b.y + step) });
        if (e.key === 'ArrowLeft') updateBox(b.id, { x: Math.max(0, b.x - step) });
        if (e.key === 'ArrowRight') updateBox(b.id, { x: Math.min(1 - b.w, b.x + step) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, pageBoxes]);

  // 겹침 감지 맵
  const overlapWarn = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (let i = 0; i < pageBoxes.length; i++) {
      for (let j = i + 1; j < pageBoxes.length; j++) {
        if (overlapRatio(pageBoxes[i], pageBoxes[j]) > 0.3) {
          map[pageBoxes[i].id] = true;
          map[pageBoxes[j].id] = true;
        }
      }
    }
    return map;
  }, [pageBoxes]);

  if (!originalPdfUrl) {
    return (
      <div className="border-2 border-dashed rounded p-8 text-center bg-muted/30">
        <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground mb-3">
          원본 PDF 양식을 업로드하면, 각 입력 위치를 마우스로 매핑해 인쇄 시 원본과 동일하게 출력됩니다.
        </p>
        <Input
          type="file" accept="application/pdf" className="max-w-xs mx-auto" disabled={uploading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
      <div>
        {/* 툴바 */}
        <div className="flex items-center gap-1 mb-2 p-1 bg-muted/40 rounded flex-wrap">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <Button
                key={t.id}
                size="sm"
                variant={active ? 'default' : 'outline'}
                className={`h-8 ${active ? '' : 'bg-background'}`}
                onClick={() => setTool(t.id)}
              >
                <Icon className="h-3.5 w-3.5 mr-1" />
                {t.label}
              </Button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8"
              onClick={() => setPageNum(Math.max(1, pageNum - 1))} disabled={pageNum <= 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs">P {pageNum}/{pdfDoc?.numPages || '?'}</span>
            <Button size="sm" variant="outline" className="h-8"
              onClick={() => setPageNum(Math.min(pdfDoc?.numPages || 1, pageNum + 1))}
              disabled={!pdfDoc || pageNum >= pdfDoc.numPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Badge variant="outline" className="text-[10px]">박스 {pageBoxes.length}</Badge>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground mb-1">
          {tool === 'select'
            ? '박스를 클릭해 선택 · 드래그로 이동 · 우하단 핸들로 크기조절 · 화살표키(±Shift) 미세이동 · Delete 삭제'
            : `${TOOLS.find((t) => t.id === tool)?.label} 박스를 마우스로 드래그하여 그리세요.`}
        </p>

        <div
          ref={wrapRef}
          className="relative inline-block border bg-white max-w-full overflow-auto"
          style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={() => drag?.mode === 'create' && setDrag(null)}
            className="block"
          />
          {/* 기존 박스 */}
          {pageSize.w > 0 && pageBoxes.map((b) => {
            const color = RENDER_COLORS[b.render];
            const isSel = selectedId === b.id;
            const hasOverlap = overlapWarn[b.id];
            return (
              <div
                key={b.id}
                className={`absolute border-2 ${color.border} ${color.bg} ${b.ai_generated ? 'border-dashed' : ''} ${isSel ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
                style={{
                  left: b.x * pageSize.w,
                  top: b.y * pageSize.h,
                  width: b.w * pageSize.w,
                  height: b.h * pageSize.h,
                  cursor: tool === 'select' ? 'move' : 'crosshair',
                  pointerEvents: tool === 'select' ? 'auto' : 'none',
                }}
                onMouseDown={(e) => onBoxMouseDown(e, b)}
                title={b.label_hint || b.field_key}
              >
                <div className={`text-[10px] ${color.label} text-white px-1 absolute -top-4 left-0 whitespace-nowrap flex items-center gap-1`}>
                  {b.ai_generated && <Sparkles className="h-2.5 w-2.5" />}
                  {b.label_hint || b.field_key || '(미지정)'}
                  {hasOverlap && <AlertTriangle className="h-3 w-3 text-red-400" />}
                </div>
                {/* 리사이즈 핸들 */}
                {isSel && tool === 'select' && (
                  <div
                    className="absolute w-3 h-3 bg-primary border-2 border-background rounded-sm"
                    style={{ right: -6, bottom: -6, cursor: 'nwse-resize' }}
                    onMouseDown={(e) => onHandleMouseDown(e, b)}
                  />
                )}
              </div>
            );
          })}
          {/* 드래그중 (생성) */}
          {drag?.mode === 'create' && pageSize.w > 0 && (
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
        <div className="flex items-center gap-2 mt-2">
          <Input
            type="file" accept="application/pdf" className="h-8 text-xs w-64" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          />
          <span className="text-[11px] text-muted-foreground">원본 PDF 교체</span>
        </div>
      </div>

      {/* 우측: 선택된 박스 속성 or 전체 목록 */}
      <div className="border rounded p-2 max-h-[75vh] overflow-auto">
        {selected ? (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              박스 속성
              {selected.ai_generated && <Badge className="bg-primary text-[10px]"><Sparkles className="h-2.5 w-2.5 mr-1" />AI</Badge>}
            </h4>
            <div>
              <Label className="text-[10px]">매핑 필드</Label>
              <Select value={selected.field_key} onValueChange={(v) => updateBox(selected.id, { field_key: v })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="필드 선택" /></SelectTrigger>
                <SelectContent>
                  {allFieldKeys.map((k) =>
                    <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {!selected.field_key && (
                <p className="text-[10px] text-warning mt-0.5">⚠ 필드가 지정되지 않았습니다.</p>
              )}
            </div>
            <div>
              <Label className="text-[10px]">타입</Label>
              <Select value={selected.render} onValueChange={(v) => updateBox(selected.id, { render: v as OverlayRenderKind })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">텍스트</SelectItem>
                  <SelectItem value="check">체크 ✓</SelectItem>
                  <SelectItem value="signature">서명 이미지</SelectItem>
                  <SelectItem value="image">이미지</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selected.render === 'text' && (
              <>
                <div className="grid grid-cols-2 gap-1">
                  <div>
                    <Label className="text-[10px]">정렬</Label>
                    <Select value={selected.align || 'left'} onValueChange={(v) => updateBox(selected.id, { align: v as any })}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">왼쪽</SelectItem>
                        <SelectItem value="center">가운데</SelectItem>
                        <SelectItem value="right">오른쪽</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">폰트(pt)</Label>
                    <Input type="number" className="h-7 text-xs"
                      value={selected.font_size || 10}
                      onChange={(e) => updateBox(selected.id, { font_size: Number(e.target.value) })} />
                  </div>
                </div>
              </>
            )}
            {selected.render === 'check' && (
              <div>
                <Label className="text-[10px]">체크 조건 (이 값일 때 ✓)</Label>
                <Input className="h-7 text-xs" placeholder="true 또는 값"
                  value={String(selected.check_when ?? 'true')}
                  onChange={(e) => updateBox(selected.id, { check_when: e.target.value })} />
              </div>
            )}
            <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
              <div>X: {(selected.x * 100).toFixed(1)}%</div>
              <div>Y: {(selected.y * 100).toFixed(1)}%</div>
              <div>W: {(selected.w * 100).toFixed(1)}%</div>
              <div>H: {(selected.h * 100).toFixed(1)}%</div>
            </div>
            <Button size="sm" variant="destructive" className="w-full h-7" onClick={() => removeBox(selected.id)}>
              <Trash2 className="h-3 w-3 mr-1" /> 삭제 (Delete)
            </Button>
          </div>
        ) : (
          <div>
            <h4 className="text-sm font-semibold mb-2">이 페이지 박스 ({pageBoxes.length})</h4>
            {pageBoxes.length === 0 && <p className="text-xs text-muted-foreground">상단 툴바에서 타입 선택 후 PDF 위에 드래그하세요.</p>}
            <div className="space-y-1">
              {pageBoxes.map((b) => {
                const c = RENDER_COLORS[b.render];
                return (
                  <button key={b.id}
                    className="w-full text-left border rounded px-2 py-1 hover:bg-accent flex items-center gap-2"
                    onClick={() => { setTool('select'); setSelectedId(b.id); }}>
                    <span className={`inline-block w-2 h-2 rounded-full ${c.label}`} />
                    <span className="text-xs truncate flex-1">{b.label_hint || b.field_key || '(미지정)'}</span>
                    {b.ai_generated && <Sparkles className="h-3 w-3 text-primary" />}
                    {overlapWarn[b.id] && <AlertTriangle className="h-3 w-3 text-destructive" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
