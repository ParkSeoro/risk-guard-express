import type React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Ban, Upload, Users, XCircle } from 'lucide-react';

export function ExcludeItemDialog({
  open,
  reason,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>해당없음 처리</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">이 항목을 '해당없음'으로 처리하면 검증 시 누락으로 잡히지 않습니다.</p>
          <div className="space-y-1">
            <Label>제외 사유 (필수)</Label>
            <Textarea
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="예: 해당 회차 범위에 미포함, 작업 미수행, 현장 조건상 없음..."
              rows={2}
            />
          </div>
          <Button onClick={onConfirm} className="w-full" disabled={!reason.trim()}>
            <Ban className="h-3.5 w-3.5 mr-1.5" /> 해당없음 처리
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveRunDialog({
  open,
  onOpenChange,
  reason,
  onReasonChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>회차 폐기</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-destructive">⚠ 폐기된 회차는 목록에서 비활성 표시됩니다.</p>
          <div className="space-y-1">
            <Label>삭제 사유 (필수)</Label>
            <Textarea
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="삭제 사유를 입력하세요..."
              rows={3}
            />
          </div>
          <Button onClick={onConfirm} variant="destructive" className="w-full" disabled={!reason.trim()}>
            폐기 확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const EXCEL_COLUMN_FIELDS = [
  { key: 'process', label: '공정' },
  { key: 'sub_task', label: '세부작업' },
  { key: 'hazard', label: '위험요인' },
  { key: 'hazard_situation', label: '위험발생상황' },
  { key: 'existing_measure', label: '기존대책' },
  { key: 'improvement_measure', label: '개선대책' },
  { key: 'likelihood_grade', label: '가능성' },
  { key: 'severity_grade', label: '중대성' },
  { key: 'risk_grade', label: '위험도' },
  { key: 'improved_severity_grade', label: '개선후 중대성' },
  { key: 'improved_likelihood_grade', label: '개선후 가능성' },
  { key: 'improved_risk_grade', label: '개선후 위험도' },
  { key: 'legal_basis', label: '법적근거' },
] as const;

export function ExcelUploadDialog({
  open,
  onOpenChange,
  step,
  fileName,
  parseError,
  dataCount,
  headers,
  columnMap,
  onColumnMapChange,
  issues,
  onFileChange,
  onValidate,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: 'upload' | 'map' | 'result';
  fileName: string;
  parseError: string | null;
  dataCount: number;
  headers: string[];
  columnMap: Record<string, string>;
  onColumnMapChange: (key: string, value: string) => void;
  issues: Array<{ severity: string; message: string }>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onValidate: () => void;
  onImport: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>협력사 엑셀 업로드 검증</DialogTitle></DialogHeader>
        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              협력사가 제공한 위험성평가 엑셀(XLSX/CSV)을 선택하면 바로 읽습니다. 별도 저장 버튼은 없습니다.
              표지/안내 시트나 제목 행이 있어도 공정·위험요인 표를 찾아 갑니다.
            </p>
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} />
            {fileName && <p className="text-xs text-muted-foreground">선택됨: {fileName}</p>}
            {parseError && <p className="text-sm text-destructive whitespace-pre-wrap">{parseError}</p>}
          </div>
        )}
        {step === 'map' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{dataCount}행 파싱 완료. 컬럼을 매핑하세요.</p>
            <div className="grid grid-cols-2 gap-2">
              {EXCEL_COLUMN_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs w-28 shrink-0">{label}</span>
                  <Select
                    value={columnMap[key] || '__none__'}
                    onValueChange={(v) => onColumnMapChange(key, v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(없음)</SelectItem>
                      {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button onClick={onValidate} className="w-full">검증 실행</Button>
          </div>
        )}
        {step === 'result' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xl font-bold">{dataCount}</p>
                <p className="text-xs text-muted-foreground">총 행수</p>
              </div>
              <div className={`p-3 rounded-lg ${issues.length === 0 ? 'bg-success/10' : 'bg-warning/10'}`}>
                <p className="text-xl font-bold">{issues.length}</p>
                <p className="text-xs text-muted-foreground">지적사항</p>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {issues.map((iss, i) => (
                <div key={i} className={`text-xs p-2 rounded ${iss.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5'}`}>
                  {iss.severity === 'error'
                    ? <XCircle className="h-3 w-3 text-destructive inline mr-1" />
                    : <AlertTriangle className="h-3 w-3 text-warning inline mr-1" />}
                  {iss.message}
                </div>
              ))}
              {issues.length === 0 && <p className="text-center text-success py-3">✅ 문제 없음</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>닫기</Button>
              <Button className="flex-1 gap-1.5" onClick={onImport}>
                <Upload className="h-3.5 w-3.5" /> 반영 ({dataCount}건)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function BatchApplyAssigneeDialog({
  open,
  onOpenChange,
  assigneeUserId,
  onAssigneeChange,
  projectMembers,
  selectedRowCount,
  scope,
  onScopeChange,
  overrideManual,
  onOverrideManualChange,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assigneeUserId: string;
  onAssigneeChange: (value: string) => void;
  projectMembers: Array<{ user_id: string; display_name: string }>;
  selectedRowCount: number;
  scope: 'empty' | 'all' | 'selected';
  onScopeChange: (value: 'empty' | 'all' | 'selected') => void;
  overrideManual: boolean;
  onOverrideManualChange: (value: boolean) => void;
  loading: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>담당자 일괄 지정</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>담당자</Label>
            <Select
              value={assigneeUserId || '__none__'}
              onValueChange={(v) => onAssigneeChange(v === '__none__' ? '' : v)}
            >
              <SelectTrigger className="text-xs"><SelectValue placeholder="담당자 선택" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(선택)</SelectItem>
                {projectMembers.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {selectedRowCount > 0 ? `선택한 ${selectedRowCount}행에 적용합니다.` : '담당자가 비어 있는 행만 채웁니다.'}
            </p>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">고급</summary>
            <div className="mt-2 space-y-2">
              <Select value={scope} onValueChange={(v: 'empty' | 'all' | 'selected') => onScopeChange(v)}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="empty">빈 칸만 채우기</SelectItem>
                  <SelectItem value="all">전체 항목 덮어쓰기</SelectItem>
                  <SelectItem value="selected" disabled={selectedRowCount === 0}>
                    선택한 행만 ({selectedRowCount}건)
                  </SelectItem>
                </SelectContent>
              </Select>
              {scope !== 'empty' && (
                <div className="flex items-center gap-2">
                  <Checkbox checked={overrideManual} onCheckedChange={(c) => onOverrideManualChange(!!c)} />
                  <span className="text-muted-foreground">이미 지정된 담당자도 덮어쓰기</span>
                </div>
              )}
            </div>
          </details>
          <Button onClick={onConfirm} className="w-full gap-1.5" disabled={!assigneeUserId || loading}>
            <Users className="h-3.5 w-3.5" /> {loading ? '적용 중...' : '일괄 적용'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
