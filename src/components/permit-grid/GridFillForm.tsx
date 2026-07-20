/**
 * 사용자 — 마스터가 지정한 셀만 입력할 수 있는 그리드 폼.
 * 결재/서명 이미지가 있으면 서명 셀에 자동 반영된다.
 */
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import SignaturePad from '@/components/permits/SignaturePad';
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
            <SignaturePad
              onSave={(dataUrl) => {
                updateValue(signTarget.field_key, {
                  signature: dataUrl,
                  signed_at: new Date().toISOString(),
                });
                setSignTarget(null);
              }}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignTarget(null)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
