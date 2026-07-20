/**
 * 마스터 전용 — 엑셀 허가서 양식 디자이너.
 * 1) xlsx 업로드 → 그리드 렌더 (병합·서식 보존)
 * 2) 셀 클릭 → 입력 셀로 지정 (텍스트/체크/서명/날짜 + field_key + 서명 role)
 * 3) 저장은 부모(SettingsPermitForms)에서 grid_snapshot / input_cells / source_xlsx_url을 DB에 기록.
 */
import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Upload, Trash2, FileSpreadsheet, Info } from 'lucide-react';
import { parseXlsxToGrid, type GridBook } from '@/lib/xlsxGrid';
import { InputCell, InputCellKind, KIND_LABEL, cellId } from '@/lib/permitGridTypes';
import GridSheetView from './GridSheetView';

interface Props {
  templateId: string;
  gridSnapshot: GridBook | null;
  inputCells: InputCell[];
  sourceXlsxUrl: string | null;
  onChange: (patch: {
    grid_snapshot?: GridBook | null;
    input_cells?: InputCell[];
    source_xlsx_url?: string | null;
  }) => void;
}

const KIND_OPTIONS: InputCellKind[] = ['text', 'check', 'sign', 'date'];
const SIGN_ROLES = [
  { value: 'contractor_pic', label: '작성자(협력사 담당)' },
  { value: 'cm', label: '건설사업관리자(CM)' },
  { value: 'safety_pic', label: '안전관리자' },
  { value: 'sm', label: '현장관리자(SM)' },
  { value: 'site_director', label: '현장소장' },
  { value: 'site_supervisor', label: '현장감독' },
];

export default function GridDesigner({
  templateId,
  gridSnapshot,
  inputCells,
  sourceXlsxUrl,
  onChange,
}: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<InputCell | null>(null);
  const [draft, setDraft] = useState<InputCell | null>(null);

  const openEditor = (row: number, col: number, existing?: InputCell) => {
    const base: InputCell = existing
      ? { ...existing }
      : {
          sheet: sheetIndex,
          row,
          col,
          kind: 'text',
          field_key: `f_${sheetIndex}_${row}_${col}`,
        };
    setEditing(existing || null);
    setDraft(base);
  };

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.field_key.trim()) {
      toast({ title: '필드 키를 입력하세요', variant: 'destructive' });
      return;
    }
    const others = inputCells.filter((c) => cellId(c) !== cellId(draft));
    // 동일 field_key 중복 확인 (서명은 role 기준으로 다중 허용)
    if (
      draft.kind !== 'sign' &&
      others.some((c) => c.field_key === draft.field_key)
    ) {
      toast({ title: '필드 키가 중복됩니다', variant: 'destructive' });
      return;
    }
    onChange({ input_cells: [...others, draft] });
    setDraft(null);
    setEditing(null);
  };

  const removeCurrent = () => {
    if (!editing) return;
    onChange({ input_cells: inputCells.filter((c) => cellId(c) !== cellId(editing)) });
    setDraft(null);
    setEditing(null);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const book = parseXlsxToGrid(buf);
      if (!book.sheets.length) throw new Error('시트를 찾지 못했습니다');

      const path = `permit-form-xlsx/${templateId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('permit-form-assets')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      onChange({
        grid_snapshot: book,
        input_cells: [],
        source_xlsx_url: path,
      });
      setSheetIndex(0);
      toast({ title: '엑셀 양식이 로드되었습니다', description: `${book.sheets.length}개 시트` });
    } catch (e: any) {
      toast({ title: '업로드 실패', description: e.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clearAll = () => {
    if (!confirm('로드된 엑셀 양식과 입력 셀 지정을 모두 지웁니다. 계속할까요?')) return;
    onChange({ grid_snapshot: null, input_cells: [], source_xlsx_url: null });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="h-4 w-4 mr-1" />
          {gridSnapshot ? '엑셀 다시 업로드' : '엑셀(.xlsx) 업로드'}
        </Button>
        {gridSnapshot && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={clearAll}>
            <Trash2 className="h-4 w-4 mr-1" />모두 지우기
          </Button>
        )}
        <Badge variant="outline" className="ml-auto">
          <FileSpreadsheet className="h-3 w-3 mr-1" />
          지정 셀 {inputCells.length}개
        </Badge>
      </div>

      {!gridSnapshot ? (
        <div className="border-2 border-dashed rounded p-10 text-center text-sm text-muted-foreground">
          <Info className="h-5 w-5 mx-auto mb-2" />
          기존 허가서 엑셀(.xlsx)을 업로드하면 원본 서식(병합·컬럼 폭·행 높이)이 유지된 채 그리드로 열립니다.<br />
          이후 <b>셀을 클릭</b>하여 사용자 입력·서명·체크·날짜 위치를 지정하세요.
        </div>
      ) : (
        <>
          {gridSnapshot.sheets.length > 1 && (
            <Tabs value={String(sheetIndex)} onValueChange={(v) => setSheetIndex(Number(v))}>
              <TabsList>
                {gridSnapshot.sheets.map((s, i) => (
                  <TabsTrigger key={i} value={String(i)}>{s.name}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <div className="text-[11px] text-muted-foreground">
            셀을 클릭하면 <b>입력 셀</b>로 지정됩니다. 지정된 셀을 다시 클릭하면 편집/삭제할 수 있습니다.
          </div>
          <GridSheetView
            book={gridSnapshot}
            sheetIndex={sheetIndex}
            inputCells={inputCells}
            mode="designer"
            onDesignateCell={(r, c) => openEditor(r, c)}
            onEditInput={(inp) => openEditor(inp.row, inp.col, inp)}
          />
        </>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? '입력 셀 편집' : '입력 셀 지정'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                시트 {draft.sheet + 1} · 행 {draft.row + 1} · 열 {draft.col + 1}
              </div>
              <div>
                <Label className="text-xs">종류</Label>
                <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as InputCellKind })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((k) => (
                      <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">필드 키(field_key)</Label>
                <Input
                  className="h-8"
                  value={draft.field_key}
                  onChange={(e) => setDraft({ ...draft, field_key: e.target.value })}
                  placeholder="예: work_desc, checkbox_ppe, sign_pm"
                />
              </div>
              <div>
                <Label className="text-xs">라벨(선택)</Label>
                <Input
                  className="h-8"
                  value={draft.label || ''}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="관리용 이름"
                />
              </div>
              {draft.kind === 'sign' && (
                <div>
                  <Label className="text-xs">결재선 역할</Label>
                  <Select value={draft.role || ''} onValueChange={(v) => setDraft({ ...draft, role: v })}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="역할 선택" /></SelectTrigger>
                    <SelectContent>
                      {SIGN_ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    결재 승인 시 해당 역할의 서명 이미지·이름·시간이 자동 표시됩니다.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {editing && (
              <Button variant="destructive" size="sm" onClick={removeCurrent}>
                <Trash2 className="h-4 w-4 mr-1" />삭제
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>취소</Button>
            <Button size="sm" onClick={saveDraft}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
