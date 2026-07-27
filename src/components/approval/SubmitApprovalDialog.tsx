import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, ArrowUp, ArrowDown, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ENTITY_LABELS as SSOT_ENTITY_LABELS,
  POSITION_LABELS as SSOT_POSITION_LABELS,
  APPROVAL_POLICY,
  buildDefaultSteps,
  filterApproversForStep,
  sortStepsByHierarchy,
  validateStepsHierarchy,
  type ApprovalEntityType as SSOTApprovalEntityType,
} from '@/lib/approvalRules';


// Re-export SSOT types/labels so existing imports keep working.
export type ApprovalEntityType = SSOTApprovalEntityType;
export const ENTITY_LABELS = SSOT_ENTITY_LABELS;

interface ApproverOption {
  out_user_id: string;
  out_display_name: string;
  out_company_id: string | null;
  out_company_name: string;
  out_company_type: string;
  out_position: string;
  out_role: string;
}

interface Step {
  label: string;
  position: string;
  user_id: string;
  user_name: string;
  company_id: string | null;
  company_name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: ApprovalEntityType;
  entityId: string;
  projectId: string;
  /** 작성자가 속한(또는 이 문서가 귀속된) 회사 */
  submitterCompanyId: string | null;
  /** 상신 성공 후 콜백 (status 변경 등) */
  onSubmitted?: () => void;
  title?: string;
}

const POSITION_LABELS = SSOT_POSITION_LABELS;

export default function SubmitApprovalDialog({
  open, onOpenChange, entityType, entityId, projectId, submitterCompanyId, onSubmitted, title,
}: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [reason, setReason] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const [{ data: ap, error: apErr }, { data: tpl }] = await Promise.all([
          supabase.rpc('get_eligible_approvers', {
            _project_id: projectId,
            _submitter_company_id: submitterCompanyId,
          }),
          supabase
            .from('approval_route_templates')
            .select('*')
            .eq('project_id', projectId)
            .eq('entity_type', entityType)
            .eq('is_deleted', false)
            .order('is_default', { ascending: false }),
        ]);
        if (apErr) throw apErr;
        setApprovers((ap as any) || []);
        setTemplates(tpl || []);

        // 우선순위: 1) 본인 전용 기본 2) 본인 전용 3) 회사 기본 4) 회사 5) 프로젝트 기본 6) 첫 항목
        const list = (tpl || []) as any[];
        const uid = (await supabase.auth.getUser()).data.user?.id;
        const mine = list.filter((t) => t.owner_user_id === uid);
        const co = list.filter((t) => !t.owner_user_id && t.company_id === submitterCompanyId);
        const shared = list.filter((t) => !t.owner_user_id && !t.company_id);
        const def =
          mine.find((t) => t.is_default) || mine[0] ||
          co.find((t) => t.is_default) || co[0] ||
          shared.find((t) => t.is_default) || shared[0];
        if (def) {
          setSelectedTemplateId(def.id);
          setSteps(sortStepsByHierarchy(normalizeSteps(def.steps)));
        } else {
          setSelectedTemplateId('');
          // 전자결재 SSOT(approvalRules.ts)의 엔티티별 기본 결재선 사용
          setSteps(sortStepsByHierarchy(buildDefaultSteps(entityType)));
        }



      } catch (e: any) {
        toast.error('결재선 정보를 불러오지 못했습니다: ' + (e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, projectId, entityType, submitterCompanyId]);

  const normalizeSteps = (raw: any): Step[] => {
    if (!Array.isArray(raw)) return [];
    return raw.map((s: any) => ({
      label: s.label || s.step_label || '결재',
      position: s.position || '',
      user_id: s.user_id || '',
      user_name: s.user_name || '',
      company_id: s.company_id || null,
      company_name: s.company_name || '',
    }));
  };

  const onPickTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setSteps(sortStepsByHierarchy(normalizeSteps(t.steps)));
  };

  const addStep = () =>
    setSteps((s) => sortStepsByHierarchy([...s, { label: '결재', position: '', user_id: '', user_name: '', company_id: null, company_name: '' }]));
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));
  // 위계 자동 정렬 정책상 수동 이동 후에도 재정렬한다.
  const move = (i: number, dir: -1 | 1) => {
    setSteps((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return sortStepsByHierarchy(next);
    });
  };

  const setApprover = (i: number, userId: string) => {
    const a = approvers.find((x) => x.out_user_id === userId);
    if (!a) return;
    setSteps((s) => s.map((st, idx) => idx === i ? {
      ...st,
      user_id: a.out_user_id,
      user_name: a.out_display_name,
      company_id: a.out_company_id,
      company_name: a.out_company_name,
      position: st.position || a.out_position,
    } : st));
  };

  const sortedApprovers = useMemo(() => {
    // 상위 회사 우선, 그 다음 직책
    const order = ['client', 'gc', 'contractor', 'master'];
    return [...approvers].sort((a, b) => {
      const oa = order.indexOf((a.out_company_type || '').toLowerCase());
      const ob = order.indexOf((b.out_company_type || '').toLowerCase());
      if (oa !== ob) return oa - ob;
      return (a.out_display_name || '').localeCompare(b.out_display_name || '');
    });
  }, [approvers]);

  const submit = async () => {
    if (steps.length === 0) return toast.error('결재선을 1단계 이상 지정하세요');
    if (steps.some((s) => !s.user_id)) return toast.error('각 단계의 결재자를 지정하세요');

    // 위계(협력사 → 시공사 → 발주처) 강제 정렬 & 검증
    const orderedSteps = sortStepsByHierarchy(steps);
    const v = validateStepsHierarchy(orderedSteps);
    if (!v.ok) return toast.error(v.message || '결재 단계 순서가 위계에 어긋납니다');
    // 정렬된 결과를 화면에도 반영하여 사용자에게 최종 순서를 보여준다.
    if (orderedSteps.some((s, i) => s !== steps[i])) setSteps(orderedSteps);

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('submit_approval', {
        _entity_type: entityType,
        _entity_id: entityId,
        _project_id: projectId,
        _company_id: submitterCompanyId,
        _steps: orderedSteps as any,
        _reason: reason || null,
      });
      if (error) throw error;


      if (saveAsDefault) {
        await supabase.from('approval_route_templates').insert({
          project_id: projectId,
          entity_type: entityType,
          owner_user_id: user?.id, // 본인 전용 템플릿으로 저장
          company_id: null,
          name: `${ENTITY_LABELS[entityType]} 내 결재선`,
          assessment_type: '정기',
          is_default: true,
          steps: steps as any,
          created_by: user?.id,
        });
      }


      toast.success('결재가 상신되었습니다');
      onOpenChange(false);
      onSubmitted?.();
    } catch (e: any) {
      toast.error('상신 실패: ' + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title || `${ENTITY_LABELS[entityType]} 결재 상신`}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> 결재선 로드 중…
          </div>
        ) : (
          <div className="space-y-4">
            {templates.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">템플릿 불러오기</Label>
                <Select value={selectedTemplateId} onValueChange={onPickTemplate}>
                  <SelectTrigger><SelectValue placeholder="템플릿 선택" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} {t.is_default && '★'} {t.company_id ? '(회사전용)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">결재선 ({steps.length}단계)</Label>
                <Button size="sm" variant="outline" onClick={addStep}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> 단계 추가
                </Button>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="border rounded p-2 space-y-2 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{i + 1}단계</Badge>
                    <Input
                      className="h-8 flex-1"
                      value={s.label}
                      onChange={(e) => setSteps((arr) => arr.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                      placeholder="단계명 (예: 안전관리자 검토)"
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === steps.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeStep(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {(() => {
                    const filtered = s.position
                      ? filterApproversForStep(sortedApprovers as any, s.position, {
                          authorCompanyId: submitterCompanyId,
                        })
                      : sortedApprovers;
                    return (
                      <Select value={s.user_id} onValueChange={(v) => setApprover(i, v)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder={`결재자 선택 · ${POSITION_LABELS[s.position] || s.position || '직책 미지정'}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {filtered.length === 0 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              해당 직책({POSITION_LABELS[s.position] || s.position || '-'})의 결재자가 없습니다
                            </div>
                          )}
                          {filtered.map((a) => (
                            <SelectItem key={a.out_user_id} value={a.out_user_id}>
                              {a.out_display_name || '(이름없음)'} · {a.out_company_name} · {POSITION_LABELS[a.out_position] || a.out_position || a.out_role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">상신 사유 / 메모 (선택)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="재상신 사유 등" />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={saveAsDefault} onCheckedChange={(v) => setSaveAsDefault(!!v)} />
              현재 결재선을 회사 기본 템플릿으로 저장
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>취소</Button>
          <Button onClick={submit} disabled={submitting || loading}>
            {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            결재 상신
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
