import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ban, Copy, RotateCcw, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { GRADES, getGradeClassName } from '@/lib/riskGrade';
import { isAiFailedRiskItem, isFillableRiskItem } from '@/lib/riskAutoGenAI';

export interface InspectorMember {
  user_id: string;
  display_name: string;
}

interface Props {
  item: any | null;
  index: number;
  canEdit: boolean;
  projectMembers: InspectorMember[];
  itemIssues?: Array<{ field?: string; message: string }>;
  onEditField: (id: string, field: string, value: any) => void;
  onChangeAssignee: (id: string, userId: string) => void;
  onDuplicate: (item: any) => void;
  onDelete: (id: string) => void;
  onExclude: (id: string) => void;
  onRetryAi?: (item: any) => void;
  onFillAi?: () => void;
  aiRunning?: boolean;
}

const ITEM_STATUSES = ['초안', '제출', '검토대기', '반려', '보완중', '승인', '폐기', '미착수', '진행', '완료'];

export function RiskItemInspectorPanel({
  item,
  index,
  canEdit,
  projectMembers,
  itemIssues = [],
  onEditField,
  onChangeAssignee,
  onDuplicate,
  onDelete,
  onExclude,
  onRetryAi,
  onFillAi,
  aiRunning,
}: Props) {
  const [draft, setDraft] = useState({
    process: '',
    sub_task: '',
    hazard: '',
    hazard_situation: '',
    existing_measure: '',
    improvement_measure: '',
  });

  useEffect(() => {
    if (!item) return;
    setDraft({
      process: item.process || '',
      sub_task: item.sub_task || '',
      hazard: item.hazard || '',
      hazard_situation: item.hazard_situation || '',
      existing_measure: item.existing_measure || '',
      improvement_measure: item.improvement_measure || '',
    });
  }, [
    item?.id,
    item?.process,
    item?.sub_task,
    item?.hazard,
    item?.hazard_situation,
    item?.existing_measure,
    item?.improvement_measure,
  ]);

  if (!item) {
    return (
      <div className="h-full min-h-[360px] flex flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground bg-muted/20">
        <Sparkles className="h-6 w-6 mb-2 opacity-40" />
        <p className="font-medium text-foreground">좌측 표에서 항목을 선택하세요</p>
        <p className="mt-1">선택한 위험요인의 대책·등급·보호구·법적근거를 넓게 편집할 수 있습니다.</p>
      </div>
    );
  }

  const commit = (field: keyof typeof draft) => {
    if (!canEdit) return;
    const prev = (item[field] || '') as string;
    if (draft[field] !== prev) {
      onEditField(item.id, field, draft[field]);
    }
  };

  const aiFailed = isAiFailedRiskItem(item);
  const aiFillable = isFillableRiskItem(item);
  const ppeList: string[] = Array.isArray(item.ppe) ? item.ppe : [];
  const legalList: string[] = Array.isArray(item.legal_basis) ? item.legal_basis : [];

  return (
    <div className="p-4 space-y-3.5 bg-muted/20 h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">항목 #{index + 1} 상세 편집</div>
          <h3 className="text-sm font-bold truncate mt-0.5">
            {(item.process || '').trim() || '(미분류)'}
            {item.sub_task ? ` › ${item.sub_task}` : ''}
          </h3>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="복제" onClick={() => onDuplicate(item)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="해당없음 제외" onClick={() => onExclude(item.id)}>
              <Ban className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="삭제" onClick={() => onDelete(item.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Proactive AI Assist Card */}
      {canEdit && (aiFailed || aiFillable) && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <p className="font-semibold text-primary">
              {aiFailed ? 'AI 생성 재시도 필요' : 'AI로 빈칸 채우기 가능'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {aiFailed
                ? '이 행의 AI 대책 생성이 중단되었습니다.'
                : '비어 있는 대책·보호구·법적근거를 라이브러리 + AI로 채웁니다.'}
            </p>
          </div>
          {aiFailed && onRetryAi ? (
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0 gap-1" onClick={() => onRetryAi(item)}>
              <RotateCcw className="h-3 w-3" /> 재시도
            </Button>
          ) : onFillAi ? (
            <Button size="sm" className="h-7 text-xs shrink-0 gap-1" disabled={aiRunning} onClick={onFillAi}>
              <Wand2 className="h-3 w-3" /> AI 채우기
            </Button>
          ) : null}
        </div>
      )}

      {/* Validation issues */}
      {itemIssues.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-[11px] text-destructive space-y-0.5">
          <div className="font-semibold">품질 점검 지적사항 ({itemIssues.length}건)</div>
          {itemIssues.map((iss, i) => (
            <div key={i}>• {iss.message}</div>
          ))}
        </div>
      )}

      {/* Process & Sub-task */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">공정</Label>
          <Input
            className="h-8 text-xs bg-background"
            value={draft.process}
            disabled={!canEdit}
            onChange={(e) => setDraft((p) => ({ ...p, process: e.target.value }))}
            onBlur={() => commit('process')}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">세부작업</Label>
          <Input
            className="h-8 text-xs bg-background"
            value={draft.sub_task}
            disabled={!canEdit}
            onChange={(e) => setDraft((p) => ({ ...p, sub_task: e.target.value }))}
            onBlur={() => commit('sub_task')}
          />
        </div>
      </div>

      {/* Hazard & Situation */}
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">위험요인</Label>
        <Input
          className="h-8 text-xs bg-background"
          value={draft.hazard}
          disabled={!canEdit}
          onChange={(e) => setDraft((p) => ({ ...p, hazard: e.target.value }))}
          onBlur={() => commit('hazard')}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">위험발생상황</Label>
        <Textarea
          rows={2}
          className="text-xs bg-background resize-none"
          value={draft.hazard_situation}
          disabled={!canEdit}
          onChange={(e) => setDraft((p) => ({ ...p, hazard_situation: e.target.value }))}
          onBlur={() => commit('hazard_situation')}
        />
      </div>

      {/* Existing & Improvement Measures */}
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">기존 대책</Label>
        <Textarea
          rows={2}
          className="text-xs bg-background resize-none"
          value={draft.existing_measure}
          disabled={!canEdit}
          onChange={(e) => setDraft((p) => ({ ...p, existing_measure: e.target.value }))}
          onBlur={() => commit('existing_measure')}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] font-semibold">개선 대책 (핵심)</Label>
        <Textarea
          rows={3}
          className="text-xs bg-background border-primary/40 focus-visible:ring-primary/40 resize-none"
          value={draft.improvement_measure}
          disabled={!canEdit}
          onChange={(e) => setDraft((p) => ({ ...p, improvement_measure: e.target.value }))}
          onBlur={() => commit('improvement_measure')}
        />
      </div>

      {/* Risk Grades: Before & After */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="rounded-lg border bg-background p-2.5 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground font-medium">개선 전 위험도</span>
            <span className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getGradeClassName(item.risk_grade || '중')}`}>
              {item.risk_grade || '중'}
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-1 text-[10px]">
              <span className="text-muted-foreground">가능성</span>
              <div className="flex gap-1">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onEditField(item.id, 'likelihood_grade', g)}
                    className={`w-6 h-6 rounded text-[10px] font-bold border transition ${
                      (item.likelihood_grade || '중') === g
                        ? `${getGradeClassName(g)} border-current`
                        : 'bg-muted/40 text-muted-foreground border-transparent hover:border-border'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-1 text-[10px]">
              <span className="text-muted-foreground">중대성</span>
              <div className="flex gap-1">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onEditField(item.id, 'severity_grade', g)}
                    className={`w-6 h-6 rounded text-[10px] font-bold border transition ${
                      (item.severity_grade || '중') === g
                        ? `${getGradeClassName(g)} border-current`
                        : 'bg-muted/40 text-muted-foreground border-transparent hover:border-border'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-background p-2.5 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground font-medium">개선 후 잔여</span>
            <span className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getGradeClassName(item.improved_risk_grade || '하')}`}>
              {item.improved_risk_grade || '하'}
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-1 text-[10px]">
              <span className="text-muted-foreground">가능성'</span>
              <div className="flex gap-1">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onEditField(item.id, 'improved_likelihood_grade', g)}
                    className={`w-6 h-6 rounded text-[10px] font-bold border transition ${
                      (item.improved_likelihood_grade || '하') === g
                        ? `${getGradeClassName(g)} border-current`
                        : 'bg-muted/40 text-muted-foreground border-transparent hover:border-border'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-1 text-[10px]">
              <span className="text-muted-foreground">중대성'</span>
              <div className="flex gap-1">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onEditField(item.id, 'improved_severity_grade', g)}
                    className={`w-6 h-6 rounded text-[10px] font-bold border transition ${
                      (item.improved_severity_grade || '하') === g
                        ? `${getGradeClassName(g)} border-current`
                        : 'bg-muted/40 text-muted-foreground border-transparent hover:border-border'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PPE & Legal Basis */}
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">보호구 · 법적근거</Label>
        <div className="flex flex-wrap gap-1">
          {ppeList.map((p, i) => (
            <Badge key={`ppe-${i}`} variant="secondary" className="text-[10px] font-normal">
              {p}
            </Badge>
          ))}
          {legalList.map((l, i) => (
            <Badge key={`leg-${i}`} variant="outline" className="text-[10px] font-normal">
              {l}
            </Badge>
          ))}
          {ppeList.length === 0 && legalList.length === 0 && (
            <span className="text-[11px] text-muted-foreground">미입력 (상단 AI 나머지 채우기로 자동 입력 가능)</span>
          )}
        </div>
      </div>

      {/* Assignee & Status */}
      <div className="grid grid-cols-2 gap-2.5 pt-2 border-t">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">담당자</Label>
          {canEdit ? (
            <Select
              value={item.assignee_user_id || '__none__'}
              onValueChange={(v) => v !== '__none__' && onChangeAssignee(item.id, v)}
            >
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue placeholder="담당자 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(미지정)</SelectItem>
                {projectMembers.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="text-xs py-1.5 text-muted-foreground">{item.assignee || '—'}</div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">항목 상태</Label>
          {canEdit ? (
            <Select value={item.status || '초안'} onValueChange={(v) => onEditField(item.id, 'status', v)}>
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="text-xs py-1.5 text-muted-foreground">{item.status || '—'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
