/**
 * 사용자 — 마스터가 지정한 셀만 입력할 수 있는 그리드 폼.
 * 결재/서명 이미지가 있으면 서명 셀에 자동 반영된다.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import GridSheetView from './GridSheetView';
import type { GridBook } from '@/lib/xlsxGrid';
import type { InputCell } from '@/lib/permitGridTypes';

interface Props {
  book: GridBook;
  inputCells: InputCell[];
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
  readOnly?: boolean;
}

export default function GridFillForm({ book, inputCells, values, onChange, readOnly }: Props) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const [signTarget, setSignTarget] = useState<InputCell | null>(null);

  const updateValue = (key: string, v: any) => {
    if (readOnly) return;
    onChange({ ...values, [key]: v });
  };

  return (
    <div className="space-y-3">
      {book.sheets.length > 1 && (
        <Tabs value={String(sheetIndex)} onValueChange={(v) => setSheetIndex(Number(v))}>
          <TabsList>
            {book.sheets.map((s, i) => (
              <TabsTrigger key={i} value={String(i)}>{s.name}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <GridSheetView
        book={book}
        sheetIndex={sheetIndex}
        inputCells={inputCells}
        values={values}
        mode={readOnly ? 'print' : 'fill'}
        onValueChange={updateValue}
        onSignatureClick={(inp) => setSignTarget(inp)}
      />

      <Dialog open={!!signTarget} onOpenChange={(o) => !o && setSignTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>서명</DialogTitle>
          </DialogHeader>
          {signTarget && (
            <InlineSignaturePad
              onSave={(dataUrl) => {
                updateValue(signTarget.field_key, {
                  signature: dataUrl,
                  signed_at: new Date().toISOString(),
                });
                setSignTarget(null);
              }}
              onCancel={() => setSignTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InlineSignaturePad({
  onSave,
  onCancel,
}: {
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  const getCtx = () => canvasRef.current?.getContext('2d') || null;

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    const ctx = getCtx();
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    ctx.stroke();
    setDirty(true);
  };
  const end = () => (drawing.current = false);

  const clear = () => {
    const ctx = getCtx();
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setDirty(false);
  };

  const save = () => {
    if (!canvasRef.current || !dirty) return;
    onSave(canvasRef.current.toDataURL('image/png'));
  };

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        width={500}
        height={180}
        className="border rounded touch-none bg-white w-full"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <DialogFooter className="gap-2">
        <Button variant="ghost" size="sm" onClick={clear}>지우기</Button>
        <Button variant="outline" size="sm" onClick={onCancel}>취소</Button>
        <Button size="sm" onClick={save} disabled={!dirty}>저장</Button>
      </DialogFooter>
    </div>
  );
}
