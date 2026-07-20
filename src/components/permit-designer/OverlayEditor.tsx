/**
 * 인쇄 오버레이 편집기 v3
 * v2 대비 개선:
 *  1) [BUG-FIX] 드래그 시 window pointer 이벤트 + setPointerCapture 사용
 *     → 박스가 캔버스 밖으로 나가도, 다른 박스 위로 지나가도 마우스 놓는 순간 정확히 고정됨
 *  2) 8방향 리사이즈 핸들 (N/S/E/W + 4모서리)
 *  3) 스냅 & 정렬 가이드 (다른 박스의 가장자리·중앙선과 자동 정렬, Shift 누르면 무시)
 *  4) 잠금(🔒) 지원 — 잠긴 박스는 이동/리사이즈/삭제 금지
 *  5) Undo/Redo (Ctrl/⌘+Z, Ctrl+Shift+Z) — 최대 40단계
 *  6) 이동 중엔 로컬 좌표만 갱신하고 pointerup 시점에만 커밋 → 리렌더 폭주 방지
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  MousePointer2, AlertTriangle, Sparkles, Lock, Unlock, Undo2, Redo2,
} from 'lucide-react';
import {
  FormLayout, PrintOverlay, OverlayBox, OverlayRenderKind, RENDER_COLORS, overlapRatio,
  DATA_BINDING_LABELS, SIGNATURE_ROLE_LABELS,
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
type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const TOOLS: { id: Tool; label: string; icon: any; kind?: OverlayRenderKind }[] = [
  { id: 'select', label: '선택/이동', icon: MousePointer2 },
  { id: 'text', label: '텍스트', icon: Type, kind: 'text' },
  { id: 'check', label: '체크박스', icon: CheckSquare, kind: 'check' },
  { id: 'signature', label: '서명', icon: PenTool, kind: 'signature' },
  { id: 'image', label: '이미지', icon: ImageIcon, kind: 'image' },
];

// px 단위 스냅 임계값
const SNAP_PX = 6;
const MIN_SIZE = 0.008;

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
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  // Undo/Redo: overlay 스냅샷 스택
  const historyRef = useRef<PrintOverlay[]>([]);
  const historyIdxRef = useRef<number>(-1);
  const [historyTick, setHistoryTick] = useState(0);
  const pushHistory = useCallback((next: PrintOverlay) => {
    const hist = historyRef.current.slice(0, historyIdxRef.current + 1);
    hist.push(JSON.parse(JSON.stringify(next)));
    if (hist.length > 40) hist.shift();
    historyRef.current = hist;
    historyIdxRef.current = hist.length - 1;
    setHistoryTick((t) => t + 1);
  }, []);
  useEffect(() => {
    if (historyRef.current.length === 0) {
      historyRef.current = [JSON.parse(JSON.stringify(overlay))];
      historyIdxRef.current = 0;
      setHistoryTick(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;

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
    // 시스템 자동값
    ks.push({ key: '__meta.today', label: '자동 · 오늘 날짜' });
    ks.push({ key: '__meta.author_name', label: '자동 · 작성자 이름' });
    ks.push({ key: '__meta.company_name', label: '자동 · 회사명' });
    ks.push({ key: '__meta.doc_no', label: '자동 · 문서번호' });
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

  const commitNoHistory = useCallback((nextBoxes: OverlayBox[]) => {
    const pages = [...overlay.pages];
    const idx = pages.findIndex((p) => p.page === pageNum);
    if (idx >= 0) pages[idx] = { ...pages[idx], boxes: nextBoxes };
    else pages.push({ page: pageNum, boxes: nextBoxes });
    onChange({ pages }, originalPdfUrl);
    return { pages };
  }, [overlay, pageNum, onChange, originalPdfUrl]);

  const commit = useCallback((nextBoxes: OverlayBox[]) => {
    const next = commitNoHistory(nextBoxes);
    pushHistory(next);
  }, [commitNoHistory, pushHistory]);

  const removeBox = (id: string) => {
    const b = pageBoxes.find((x) => x.id === id);
    if (b?.locked) return;
    commit(pageBoxes.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const updateBoxProps = (id: string, patch: Partial<OverlayBox>) => {
    commit(pageBoxes.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  // ─────────── 드래그 상태 (ref로 관리해 리렌더 최소화) ───────────
  type Drag =
    | { mode: 'create'; kind: OverlayRenderKind; x0: number; y0: number; x1: number; y1: number; pointerId: number }
    | { mode: 'move'; id: string; startX: number; startY: number; boxX: number; boxY: number; pointerId: number }
    | { mode: 'resize'; id: string; handle: Handle; startX: number; startY: number; box: OverlayBox; pointerId: number };
  const dragRef = useRef<Drag | null>(null);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; w: number; h: number; kind: OverlayRenderKind } | null>(null);

  const getPt = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  // 스냅: 다른 박스의 좌/우/중앙 X, 상/하/중앙 Y와 SNAP_PX 이내면 붙임
  const snap = useCallback((x: number, y: number, shiftHeld: boolean, excludeId?: string): { x: number; y: number; gv: number[]; gh: number[] } => {
    if (shiftHeld || pageSize.w === 0) return { x, y, gv: [], gh: [] };
    const px = SNAP_PX / pageSize.w;
    const py = SNAP_PX / pageSize.h;
    const vLines: number[] = [];
    const hLines: number[] = [];
    pageBoxes.forEach((b) => {
      if (b.id === excludeId) return;
      vLines.push(b.x, b.x + b.w / 2, b.x + b.w);
      hLines.push(b.y, b.y + b.h / 2, b.y + b.h);
    });
    let outX = x;
    let outY = y;
    const gv: number[] = [];
    const gh: number[] = [];
    for (const v of vLines) if (Math.abs(v - x) < px) { outX = v; gv.push(v); break; }
    for (const h of hLines) if (Math.abs(h - y) < py) { outY = h; gh.push(h); break; }
    return { x: outX, y: outY, gv, gh };
  }, [pageBoxes, pageSize]);

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!canvasRef.current || e.button !== 0) return;
    if (tool === 'select') { setSelectedId(null); return; }
    const { x, y } = getPt(e.clientX, e.clientY);
    setSelectedId(null);
    dragRef.current = { mode: 'create', kind: tool as OverlayRenderKind, x0: x, y0: y, x1: x, y1: y, pointerId: e.pointerId };
    canvasRef.current.setPointerCapture(e.pointerId);
    setDragPreview({ x, y, w: 0, h: 0, kind: tool as OverlayRenderKind });
  };

  const onBoxPointerDown = (e: React.PointerEvent, b: OverlayBox) => {
    e.stopPropagation();
    if (tool !== 'select' || b.locked) { setSelectedId(b.id); return; }
    const { x, y } = getPt(e.clientX, e.clientY);
    setSelectedId(b.id);
    dragRef.current = { mode: 'move', id: b.id, startX: x, startY: y, boxX: b.x, boxY: b.y, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onHandlePointerDown = (e: React.PointerEvent, b: OverlayBox, handle: Handle) => {
    e.stopPropagation();
    if (b.locked) return;
    const { x, y } = getPt(e.clientX, e.clientY);
    setSelectedId(b.id);
    dragRef.current = { mode: 'resize', id: b.id, handle, startX: x, startY: y, box: { ...b }, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  // ── window 레벨 pointermove/up: 캔버스/박스 밖으로 나가도 안정적 ──
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !canvasRef.current) return;
      const { x, y } = getPt(e.clientX, e.clientY);
      const shift = e.shiftKey;

      if (d.mode === 'create') {
        d.x1 = x; d.y1 = y;
        setDragPreview({
          x: Math.min(d.x0, x), y: Math.min(d.y0, y),
          w: Math.abs(x - d.x0), h: Math.abs(y - d.y0), kind: d.kind,
        });
      } else if (d.mode === 'move') {
        const b = pageBoxes.find((x) => x.id === d.id);
        if (!b) return;
        let nx = Math.max(0, Math.min(1 - b.w, d.boxX + (x - d.startX)));
        let ny = Math.max(0, Math.min(1 - b.h, d.boxY + (y - d.startY)));
        const sn = snap(nx, ny, shift, d.id);
        nx = sn.x; ny = sn.y;
        setGuides({ v: sn.gv, h: sn.gh });
        // DOM 직접 갱신 (리렌더 없음)
        const el = document.getElementById(`obox-${d.id}`);
        if (el && pageSize.w > 0) {
          el.style.left = `${nx * pageSize.w}px`;
          el.style.top = `${ny * pageSize.h}px`;
          (el as any).__pending = { x: nx, y: ny };
        }
      } else if (d.mode === 'resize') {
        const b = d.box;
        let nx = b.x, ny = b.y, nw = b.w, nh = b.h;
        const dx = x - d.startX, dy = y - d.startY;
        if (d.handle.includes('e')) nw = Math.max(MIN_SIZE, Math.min(1 - b.x, b.w + dx));
        if (d.handle.includes('s')) nh = Math.max(MIN_SIZE, Math.min(1 - b.y, b.h + dy));
        if (d.handle.includes('w')) { nx = Math.max(0, Math.min(b.x + b.w - MIN_SIZE, b.x + dx)); nw = b.w + (b.x - nx); }
        if (d.handle.includes('n')) { ny = Math.max(0, Math.min(b.y + b.h - MIN_SIZE, b.y + dy)); nh = b.h + (b.y - ny); }
        const el = document.getElementById(`obox-${d.id}`);
        if (el && pageSize.w > 0) {
          el.style.left = `${nx * pageSize.w}px`;
          el.style.top = `${ny * pageSize.h}px`;
          el.style.width = `${nw * pageSize.w}px`;
          el.style.height = `${nh * pageSize.h}px`;
          (el as any).__pending = { x: nx, y: ny, w: nw, h: nh };
        }
      }
    };

    const onUp = (_e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setGuides({ v: [], h: [] });

      if (d.mode === 'create') {
        setDragPreview(null);
        const x = Math.min(d.x0, d.x1);
        const y = Math.min(d.y0, d.y1);
        const w = Math.abs(d.x1 - d.x0);
        const h = Math.abs(d.y1 - d.y0);
        if (w < MIN_SIZE || h < MIN_SIZE) return;
        const newBox: OverlayBox = {
          id: `box_${Date.now().toString(36)}`,
          field_key: allFieldKeys[0]?.key || '',
          page: pageNum,
          x, y, w, h,
          render: d.kind,
          font_size: 10,
          align: 'left',
        };
        if (d.kind === 'check') newBox.check_when = 'true';
        commit([...pageBoxes, newBox]);
        setSelectedId(newBox.id);
        setTool('select');
      } else if (d.mode === 'move' || d.mode === 'resize') {
        const el = document.getElementById(`obox-${d.id}`);
        const pending = el ? (el as any).__pending : null;
        if (pending) {
          commit(pageBoxes.map((b) => (b.id === d.id ? { ...b, ...pending } : b)));
          if (el) (el as any).__pending = null;
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [pageBoxes, pageNum, pageSize, snap, commit, allFieldKeys]);

  // Undo/Redo 실행
  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const snap = JSON.parse(JSON.stringify(historyRef.current[historyIdxRef.current]));
    onChange(snap, originalPdfUrl);
    setHistoryTick((t) => t + 1);
  }, [onChange, originalPdfUrl]);
  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    const snap = JSON.parse(JSON.stringify(historyRef.current[historyIdxRef.current]));
    onChange(snap, originalPdfUrl);
    setHistoryTick((t) => t + 1);
  }, [onChange, originalPdfUrl]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (inField) return;

      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (meta && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }

      if (!selectedId) return;
      const b = pageBoxes.find((x) => x.id === selectedId);
      if (!b) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !b.locked) {
        e.preventDefault(); removeBox(selectedId); return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !b.locked) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const patch: Partial<OverlayBox> = {};
        if (e.key === 'ArrowUp') patch.y = Math.max(0, b.y - step);
        if (e.key === 'ArrowDown') patch.y = Math.min(1 - b.h, b.y + step);
        if (e.key === 'ArrowLeft') patch.x = Math.max(0, b.x - step);
        if (e.key === 'ArrowRight') patch.x = Math.min(1 - b.w, b.x + step);
        updateBoxProps(b.id, patch);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, pageBoxes, undo, redo]);

  // 겹침 감지
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

  const HANDLES: { h: Handle; style: React.CSSProperties }[] = [
    { h: 'nw', style: { left: -5, top: -5, cursor: 'nwse-resize' } },
    { h: 'n',  style: { left: '50%', top: -5, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { h: 'ne', style: { right: -5, top: -5, cursor: 'nesw-resize' } },
    { h: 'e',  style: { right: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
    { h: 'se', style: { right: -5, bottom: -5, cursor: 'nwse-resize' } },
    { h: 's',  style: { left: '50%', bottom: -5, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { h: 'sw', style: { left: -5, bottom: -5, cursor: 'nesw-resize' } },
    { h: 'w',  style: { left: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
      <div>
        {/* 툴바 */}
        <div className="flex items-center gap-1 mb-2 p-1 bg-muted/40 rounded flex-wrap">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <Button key={t.id} size="sm" variant={active ? 'default' : 'outline'}
                className={`h-8 ${active ? '' : 'bg-background'}`}
                onClick={() => setTool(t.id)}>
                <Icon className="h-3.5 w-3.5 mr-1" />
                {t.label}
              </Button>
            );
          })}
          <div className="mx-2 h-6 w-px bg-border" />
          <Button size="sm" variant="outline" className="h-8" onClick={undo} disabled={!canUndo} title="실행 취소 (Ctrl+Z)">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
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
            ? '박스 클릭 → 이동 · 8방향 핸들로 크기조절 · Shift 드래그=스냅 무시 · 화살표(±Shift) 미세이동 · Delete 삭제 · Ctrl+Z 되돌리기'
            : `${TOOLS.find((t) => t.id === tool)?.label} 박스를 마우스로 드래그하여 그리세요.`}
        </p>

        <div
          ref={wrapRef}
          className="relative inline-block border bg-white max-w-full overflow-auto select-none"
          style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onCanvasPointerDown}
            className="block touch-none"
          />
          {/* 스냅 가이드 라인 */}
          {pageSize.w > 0 && guides.v.map((v, i) => (
            <div key={`gv${i}`} className="absolute bg-fuchsia-500 pointer-events-none"
              style={{ left: v * pageSize.w, top: 0, width: 1, height: pageSize.h }} />
          ))}
          {pageSize.w > 0 && guides.h.map((h, i) => (
            <div key={`gh${i}`} className="absolute bg-fuchsia-500 pointer-events-none"
              style={{ left: 0, top: h * pageSize.h, width: pageSize.w, height: 1 }} />
          ))}
          {/* 기존 박스 */}
          {pageSize.w > 0 && pageBoxes.map((b) => {
            const color = RENDER_COLORS[b.render];
            const isSel = selectedId === b.id;
            const hasOverlap = overlapWarn[b.id];
            return (
              <div
                key={b.id}
                id={`obox-${b.id}`}
                className={`absolute border-2 ${color.border} ${color.bg} ${b.ai_generated ? 'border-dashed' : ''} ${isSel ? 'ring-2 ring-offset-1 ring-primary' : ''} ${b.locked ? 'opacity-70' : ''}`}
                style={{
                  left: b.x * pageSize.w,
                  top: b.y * pageSize.h,
                  width: b.w * pageSize.w,
                  height: b.h * pageSize.h,
                  cursor: tool === 'select' ? (b.locked ? 'not-allowed' : 'move') : 'crosshair',
                  pointerEvents: tool === 'select' ? 'auto' : 'none',
                  touchAction: 'none',
                }}
                onPointerDown={(e) => onBoxPointerDown(e, b)}
                title={b.label_hint || b.field_key}
              >
                <div className={`text-[10px] ${color.label} text-white px-1 absolute -top-4 left-0 whitespace-nowrap flex items-center gap-1 rounded-sm`}>
                  {b.ai_generated && <Sparkles className="h-2.5 w-2.5" />}
                  {b.locked && <Lock className="h-2.5 w-2.5" />}
                  {b.label_hint || b.field_key || '(미지정)'}
                  {hasOverlap && <AlertTriangle className="h-3 w-3 text-red-400" />}
                </div>
                {isSel && tool === 'select' && !b.locked && HANDLES.map((h) => (
                  <div
                    key={h.h}
                    className="absolute w-2.5 h-2.5 bg-primary border-2 border-background rounded-sm z-10"
                    style={{ ...h.style, touchAction: 'none' }}
                    onPointerDown={(e) => onHandlePointerDown(e, b, h.h)}
                  />
                ))}
              </div>
            );
          })}
          {/* 드래그중 (생성) */}
          {dragPreview && pageSize.w > 0 && (
            <div
              className="absolute border-2 border-dashed border-amber-500 bg-amber-500/10 pointer-events-none"
              style={{
                left: dragPreview.x * pageSize.w,
                top: dragPreview.y * pageSize.h,
                width: dragPreview.w * pageSize.w,
                height: dragPreview.h * pageSize.h,
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
          <span className="ml-auto text-[10px] text-muted-foreground">
            History {historyIdxRef.current + 1}/{historyRef.current.length}
          </span>
        </div>
      </div>

      {/* 우측: 선택된 박스 속성 or 전체 목록 */}
      <div className="border rounded p-2 max-h-[75vh] overflow-auto">
        {selected ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                박스 속성
                {selected.ai_generated && <Badge className="bg-primary text-[10px]"><Sparkles className="h-2.5 w-2.5 mr-1" />AI</Badge>}
              </h4>
              <Button size="sm" variant="ghost" className="h-7 px-2"
                onClick={() => updateBoxProps(selected.id, { locked: !selected.locked })}
                title={selected.locked ? '잠금 해제' : '잠그기'}>
                {selected.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div>
              <Label className="text-[10px]">매핑 필드</Label>
              <Select value={selected.field_key} onValueChange={(v) => updateBoxProps(selected.id, { field_key: v })}>
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
              <Select value={selected.render} onValueChange={(v) => updateBoxProps(selected.id, { render: v as OverlayRenderKind })}>
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
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <Label className="text-[10px]">정렬</Label>
                  <Select value={selected.align || 'left'} onValueChange={(v) => updateBoxProps(selected.id, { align: v as any })}>
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
                    onChange={(e) => updateBoxProps(selected.id, { font_size: Number(e.target.value) })} />
                </div>
              </div>
            )}
            {selected.render === 'text' && (
              <div>
                <Label className="text-[10px]">자동 채움 (data binding)</Label>
                <Select value={selected.data_binding || '__none__'} onValueChange={(v) => updateBoxProps(selected.id, { data_binding: v === '__none__' ? undefined : v as any })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="없음" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">사용 안함</SelectItem>
                    {Object.entries(DATA_BINDING_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{String(l)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">지정 시 작성 화면에서 로그인 사용자/회사/프로젝트 값을 자동 입력합니다.</p>
              </div>
            )}
            {selected.render === 'signature' && (
              <div>
                <Label className="text-[10px]">서명 역할 (결재라인 자동 매핑)</Label>
                <Select value={selected.signature_role || '__none__'} onValueChange={(v) => updateBoxProps(selected.id, { signature_role: v === '__none__' ? undefined : v as any })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="없음" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">사용 안함</SelectItem>
                    {Object.entries(SIGNATURE_ROLE_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{String(l)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">결재 완료 시 해당 단계의 서명/이름/시간이 자동 표시됩니다.</p>
              </div>
            )}
            {selected.render === 'check' && (
              <div>
                <Label className="text-[10px]">체크 조건 (이 값일 때 ✓)</Label>
                <Input className="h-7 text-xs" placeholder="true 또는 값"
                  value={String(selected.check_when ?? 'true')}
                  onChange={(e) => updateBoxProps(selected.id, { check_when: e.target.value })} />
              </div>
            )}
            <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
              <div>X: {(selected.x * 100).toFixed(1)}%</div>
              <div>Y: {(selected.y * 100).toFixed(1)}%</div>
              <div>W: {(selected.w * 100).toFixed(1)}%</div>
              <div>H: {(selected.h * 100).toFixed(1)}%</div>
            </div>
            <Button size="sm" variant="destructive" className="w-full h-7"
              onClick={() => removeBox(selected.id)} disabled={selected.locked}>
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
                    {b.locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                    {b.ai_generated && <Sparkles className="h-3 w-3 text-primary" />}
                    {overlapWarn[b.id] && <AlertTriangle className="h-3 w-3 text-destructive" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/* historyTick 사용 (린트) */}
        <span className="hidden">{historyTick}</span>
      </div>
    </div>
  );
}
