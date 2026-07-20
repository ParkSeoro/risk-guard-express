/**
 * OverlayFillForm — 원본 PDF 배경 위에 오버레이 좌표대로 실제 입력 위젯을 띄우는 컴포넌트.
 * 마스터가 SettingsPermitForms에서 디자인한 양식이 그대로 작성 화면이 됨.
 *   - 인쇄 시 printOverlay()가 쓰는 동일한 좌표/필드키/값이라 화면과 인쇄물이 100% 일치.
 *   - 필드 타입은 layout.sections[].fields[]에서 조회하여 위젯 종류를 결정.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, PenLine, X } from 'lucide-react';
import ResponsiveSignaturePad, { ResponsiveSignaturePadHandle } from '@/components/ResponsiveSignaturePad';
import { FormField, FormLayout, PrintOverlay, DataBinding } from '@/lib/permitFormTypes';

export interface OverlayFillContext {
  company?: { name?: string; representative?: string; business_no?: string; address?: string };
  author?: { name?: string; position?: string; phone?: string };
  project?: { name?: string; site_address?: string };
  permit?: { date?: string; work_description?: string; work_location?: string; work_period?: string };
}

function resolveBinding(b: DataBinding, ctx: OverlayFillContext): string | undefined {
  const today = new Date().toISOString().slice(0, 10);
  switch (b) {
    case 'company.name': return ctx.company?.name;
    case 'company.representative': return ctx.company?.representative;
    case 'company.business_no': return ctx.company?.business_no;
    case 'company.address': return ctx.company?.address;
    case 'author.name': return ctx.author?.name;
    case 'author.position': return ctx.author?.position;
    case 'author.phone': return ctx.author?.phone;
    case 'project.name': return ctx.project?.name;
    case 'project.site_address': return ctx.project?.site_address;
    case 'permit.date': return ctx.permit?.date || today;
    case 'permit.work_description': return ctx.permit?.work_description;
    case 'permit.work_location': return ctx.permit?.work_location;
    case 'permit.work_period': return ctx.permit?.work_period;
    case 'today': return today;
    default: return undefined;
  }
}

// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

interface Props {
  pdfUrl: string; // 스토리지 경로(permit-form-assets/…) 또는 절대 URL
  layout: FormLayout;
  overlay: PrintOverlay;
  values: Record<string, any>;
  signatures: Record<string, { name?: string; signature?: string; signed_at?: string }>;
  onChange: (values: Record<string, any>) => void;
  onSign: (role: string, sig: { name?: string; signature?: string; signed_at?: string }) => void;
  readOnly?: boolean;
}

export default function OverlayFillForm({
  pdfUrl, layout, overlay, values, signatures, onChange, onSign, readOnly,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [sigOpenRole, setSigOpenRole] = useState<string | null>(null);
  const sigPadRef = useRef<ResponsiveSignaturePadHandle>(null);

  const fieldMap = useMemo(() => {
    const m = new Map<string, FormField>();
    (layout?.sections || []).forEach((s) =>
      (s?.fields || []).forEach((f) => m.set(f.key, f)),
    );
    return m;
  }, [layout]);

  // Signed URL 확보 (private bucket) — 절대 URL이면 그대로 사용
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSignedUrl(null);
      if (!pdfUrl) return;
      if (/^https?:\/\//i.test(pdfUrl) && !pdfUrl.includes('permit-form-assets')) {
        if (!cancelled) setSignedUrl(pdfUrl);
        return;
      }
      try {
        const path = pdfUrl.replace(/^.*permit-form-assets\//, '');
        const { data } = await supabase.storage.from('permit-form-assets').createSignedUrl(path, 3600);
        if (!cancelled) setSignedUrl(data?.signedUrl || pdfUrl);
      } catch {
        if (!cancelled) setSignedUrl(pdfUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  // PDF 로드
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
      }
    })();
    return () => { cancelled = true; };
  }, [signedUrl]);

  // 페이지 렌더
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

  const pageBoxes = overlay.pages.find((p) => p.page === pageNum)?.boxes || [];

  const getValue = (baseKey: string, optValue?: string) => {
    const raw = values[baseKey];
    if (optValue === undefined) return raw;
    if (Array.isArray(raw)) return raw.includes(optValue);
    if (raw && typeof raw === 'object') return !!raw[optValue];
    return raw === optValue;
  };

  const setValue = (baseKey: string, optValue: string | undefined, next: any) => {
    if (optValue === undefined) {
      onChange({ ...values, [baseKey]: next });
      return;
    }
    const raw = values[baseKey];
    // 배열 형태 유지가 기본
    const arr: string[] = Array.isArray(raw) ? [...raw] : [];
    if (next) {
      if (!arr.includes(optValue)) arr.push(optValue);
    } else {
      const i = arr.indexOf(optValue);
      if (i >= 0) arr.splice(i, 1);
    }
    onChange({ ...values, [baseKey]: arr });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 print:hidden">
        <Button size="sm" variant="outline" onClick={() => setPageNum(Math.max(1, pageNum - 1))} disabled={pageNum <= 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">페이지 {pageNum} / {pdfDoc?.numPages || '?'}</span>
        <Button size="sm" variant="outline" onClick={() => setPageNum(Math.min(pdfDoc?.numPages || 1, pageNum + 1))} disabled={!pdfDoc || pageNum >= (pdfDoc?.numPages || 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">양식 위에 직접 입력하세요. 저장 후 인쇄물과 동일하게 출력됩니다.</span>
      </div>

      <div
        ref={wrapRef}
        className="relative inline-block border bg-white max-w-full overflow-auto"
      >
        <canvas ref={canvasRef} className="block" />
        {pageSize.w > 0 && pageBoxes.map((b) => {
          const [baseKey, optValue] = b.field_key.split('.');
          const field = fieldMap.get(baseKey);
          const style: React.CSSProperties = {
            position: 'absolute',
            left: b.x * pageSize.w,
            top: b.y * pageSize.h,
            width: b.w * pageSize.w,
            height: b.h * pageSize.h,
          };

          // 서명 박스
          if (b.render === 'signature') {
            const role = baseKey;
            const sig = signatures[role];
            return (
              <div key={b.id} style={style} className="border border-dashed border-primary/40">
                {sig?.signature ? (
                  <img src={sig.signature} alt="sig" className="w-full h-full object-contain" />
                ) : sig?.name ? (
                  <div className="w-full h-full flex items-center justify-center text-xs">{sig.name}</div>
                ) : null}
                {!readOnly && (
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center bg-primary/5 hover:bg-primary/15 text-[10px] text-primary opacity-0 hover:opacity-100 transition"
                    onClick={() => setSigOpenRole(role)}
                    title={`서명: ${role}`}
                  >
                    <PenLine className="h-3 w-3 mr-1" />서명
                  </button>
                )}
              </div>
            );
          }

          // 체크박스
          if (b.render === 'check') {
            const checked = !!getValue(baseKey, optValue);
            return (
              <label
                key={b.id}
                style={{ ...style, cursor: readOnly ? 'default' : 'pointer' }}
                className="flex items-center justify-center bg-transparent"
              >
                <Checkbox
                  disabled={readOnly}
                  checked={checked}
                  onCheckedChange={(v) => setValue(baseKey, optValue, !!v)}
                  className="h-full w-full max-h-6 max-w-6"
                />
              </label>
            );
          }

          // 텍스트/자동값 등 — 필드 타입에 따라 위젯
          const raw = getValue(baseKey, optValue);
          const commonInput: React.CSSProperties = {
            width: '100%', height: '100%',
            fontSize: (b.font_size || 10) * 1.4,
            textAlign: (b.align as any) || 'left',
            border: '1px dashed rgba(59,130,246,0.35)',
            background: 'rgba(255,255,255,0.55)',
            padding: '0 4px',
            color: '#111',
          };
          const t = field?.type;

          if (t === 'textarea') {
            return (
              <div key={b.id} style={style}>
                <Textarea
                  readOnly={readOnly}
                  value={raw ?? ''}
                  onChange={(e) => setValue(baseKey, optValue, e.target.value)}
                  style={commonInput}
                  className="resize-none rounded-none"
                />
              </div>
            );
          }

          const type =
            t === 'number' ? 'number' :
            t === 'date' ? 'date' :
            t === 'time' ? 'time' :
            'text';

          return (
            <div key={b.id} style={style}>
              <input
                type={type}
                readOnly={readOnly}
                value={raw ?? ''}
                onChange={(e) => setValue(baseKey, optValue, e.target.value)}
                style={commonInput}
              />
            </div>
          );
        })}
      </div>

      {/* 서명 다이얼로그 */}
      {sigOpenRole && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSigOpenRole(null)}>
          <div className="bg-white rounded-lg p-4 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">서명 — {sigOpenRole}</h3>
              <Button size="icon" variant="ghost" onClick={() => setSigOpenRole(null)}><X className="h-4 w-4" /></Button>
            </div>
            <Input
              placeholder="이름"
              className="mb-2"
              defaultValue={signatures[sigOpenRole]?.name || ''}
              onChange={(e) => onSign(sigOpenRole, { ...signatures[sigOpenRole], name: e.target.value })}
            />
            <ResponsiveSignaturePad ref={sigPadRef} />
            <div className="flex justify-end gap-2 mt-2">
              <Button size="sm" variant="outline" onClick={() => sigPadRef.current?.clear()}>지우기</Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
                    setSigOpenRole(null);
                    return;
                  }
                  const dataUrl = sigPadRef.current.toDataURL('image/png');
                  onSign(sigOpenRole, {
                    ...signatures[sigOpenRole],
                    signature: dataUrl,
                    signed_at: new Date().toISOString(),
                  });
                  setSigOpenRole(null);
                }}
              >저장</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
