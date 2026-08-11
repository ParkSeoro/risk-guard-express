import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, ArrowUp, ArrowDown, RefreshCw, Users, Save } from 'lucide-react';
import {
  FIXED_APPROVAL_STEPS,
  POSITION_LABELS as SSOT_POSITION_LABELS,
  filterApproversForStep,
  type EligibleApprover,
} from '@/lib/approvalRules';
import { normalizeCompanyType } from '@/lib/companyTypes';

interface ApprovalLine {
  id?: string;
  project_id: string;
  step_order: number;
  step_label: string;
  position: string;
  company_id: string | null;
  user_id: string | null;
  user_name: string;
  company_name: string;
}

interface ProjectMember {
  user_id: string;
  display_name: string;
  company: string;
  company_id: string | null;
  position: string;
  role: string;
}

interface Company {
  id: string;
  name: string;
  type: string;
}

interface Props {
  projectId: string;
  /** Used only to resolve the current user's company when RPC submitter id is needed. */
  projectMembers: ProjectMember[];
  companies: Company[];
  readOnly?: boolean;
  onLinesChanged?: (lines: ApprovalLine[]) => void;
}

const POSITION_LABELS: Record<string, string> = {
  ...SSOT_POSITION_LABELS,
  CEO: '대표이사',
  EXECUTIVE: '임원',
  SITE_MANAGER: '현장소장',
  HSE_MANAGER: '안전보건관리자',
  CONSTRUCTION_MGR: '공사관리자',
  FIELD_ENGINEER: '현장기사',
  FOREMAN: '작업반장',
  WORKER: '작업자',
  OWNER_PM: '발주처 PM',
  OWNER_CM: '발주처 CM',
  OWNER_SM: '발주처 SM',
  OWNER_HSE: '발주처 SM',
  SUPERVISOR: '감리',
  SITE_SUPERVISOR: '관리감독자',
};

const STEP_TEMPLATES = FIXED_APPROVAL_STEPS.map((s) => ({
  step_label: s.label,
  position: s.position,
}));

function toMemberLike(a: EligibleApprover): ProjectMember {
  return {
    user_id: a.out_user_id,
    display_name: a.out_display_name || '',
    company: a.out_company_name || '',
    company_id: a.out_company_id,
    position: a.out_position || '',
    role: a.out_role || '',
  };
}

export default function ApprovalLineManager({
  projectId,
  projectMembers,
  companies,
  readOnly,
  onLinesChanged,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [lines, setLines] = useState<ApprovalLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  /** When off: 시공(상신) 단계에서 기안 회사만. 발주처/시공사 단계는 항상 해당 회사 유형 표시. */
  const [showPeerContractors, setShowPeerContractors] = useState(false);
  const [eligible, setEligible] = useState<EligibleApprover[]>([]);
  const [eligibleError, setEligibleError] = useState<string | null>(null);

  const currentMember = projectMembers.find((m) => m.user_id === user?.id);
  const authorCompanyId =
    currentMember?.company_id ||
    eligible.find((a) => a.out_user_id === user?.id)?.out_company_id ||
    null;
  const authorCompanyType = useMemo(() => {
    if (!authorCompanyId) return null;
    const fromEligible = eligible.find((a) => a.out_company_id === authorCompanyId)?.out_company_type;
    if (fromEligible) return normalizeCompanyType(fromEligible) || fromEligible;
    const co = companies.find((c) => c.id === authorCompanyId);
    return normalizeCompanyType(co?.type) || co?.type || null;
  }, [authorCompanyId, eligible, companies]);

  const filterCtx = useMemo(
    () => ({ authorCompanyId, authorCompanyType }),
    [authorCompanyId, authorCompanyType],
  );

  const loadEligible = useCallback(async () => {
    setEligibleError(null);
    const submitterCompanyId = authorCompanyId || currentMember?.company_id || null;
    const { data, error } = await supabase.rpc('get_eligible_approvers', {
      _project_id: projectId,
      _submitter_company_id: submitterCompanyId,
    });
    if (error) {
      console.warn('[ApprovalLineManager] get_eligible_approvers failed:', error.message);
      setEligibleError(error.message);
      // Fallback: projectMembers (may be company-scoped by parent) so UI still works
      setEligible(
        projectMembers
          .filter((m) => m.user_id && !String(m.user_id).startsWith('mgr:'))
          .map((m) => ({
            out_user_id: m.user_id,
            out_display_name: m.display_name,
            out_company_id: m.company_id,
            out_company_name: m.company,
            out_company_type:
              companies.find((c) => c.id === m.company_id)?.type || '',
            out_position: m.position,
            out_role: m.role,
          })),
      );
      return;
    }
    setEligible(((data as EligibleApprover[]) || []).filter((a) => !!a.out_user_id));
  }, [projectId, authorCompanyId, currentMember?.company_id, projectMembers, companies]);

  const fetchLines = useCallback(async () => {
    const { data } = await supabase
      .from('approval_lines')
      .select('*')
      .eq('project_id', projectId)
      .order('step_order');
    if (data && data.length > 0) {
      setLines(data as ApprovalLine[]);
    } else {
      setLines([]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void fetchLines();
  }, [fetchLines]);

  useEffect(() => {
    void loadEligible();
  }, [loadEligible]);

  useEffect(() => {
    onLinesChanged?.(lines);
  }, [lines, onLinesChanged]);

  const optionsForStep = useCallback(
    (position: string): EligibleApprover[] => {
      if (!position) return [];
      let list = filterApproversForStep(eligible, position, filterCtx);
      // Optional: peer 협력사도 시공(상신) 단계에 표시
      if (
        showPeerContractors &&
        (position === 'contractor_supervisor' || position === 'site_supervisor' || position === 'supervisor')
      ) {
        const peers = eligible.filter((a) => {
          const t = normalizeCompanyType(a.out_company_type);
          const pos = (a.out_position || '').toUpperCase();
          const role = (a.out_role || '').toLowerCase();
          return (
            (t === 'contractor' || t === 'vendor') &&
            a.out_company_id !== authorCompanyId &&
            (pos === 'SITE_SUPERVISOR' || role === 'site_supervisor')
          );
        });
        const seen = new Set(list.map((a) => a.out_user_id));
        for (const p of peers) {
          if (!seen.has(p.out_user_id)) list = [...list, p];
        }
      }
      return list;
    },
    [eligible, filterCtx, showPeerContractors, authorCompanyId],
  );

  const autoGenerate = () => {
    if (!user) return;
    const find = (positionKey: string) => optionsForStep(positionKey)[0];
    const pushStep = (
      stepOrder: number,
      label: string,
      positionKey: string,
      a: EligibleApprover | undefined,
    ) => {
      newLines.push({
        project_id: projectId,
        step_order: stepOrder,
        step_label: label,
        position: positionKey,
        company_id: a?.out_company_id || null,
        user_id: a?.out_user_id || null,
        user_name: a?.out_display_name || '',
        company_name: a?.out_company_name || '',
      });
    };

    const newLines: ApprovalLine[] = [];
    const steps = FIXED_APPROVAL_STEPS;
    // Prefer current user on 시공(상신) when eligible
    const s1Pool = optionsForStep(steps[0].position);
    const s1 = s1Pool.find((a) => a.out_user_id === user.id) || s1Pool[0];
    pushStep(0, steps[0].label, steps[0].position, s1);
    pushStep(1, steps[1].label, steps[1].position, find(steps[1].position));
    pushStep(2, steps[2].label, steps[2].position, find(steps[2].position));
    pushStep(3, steps[3].label, steps[3].position, find(steps[3].position));
    pushStep(4, steps[4].label, steps[4].position, find(steps[4].position));

    setLines(newLines);
    setDirty(true);
    const filled = newLines.filter((l) => l.user_id).length;
    const hasClient = eligible.some(
      (a) => normalizeCompanyType(a.out_company_type) === 'client',
    );
    toast({
      title: `결재라인 5단계 생성 (지정 ${filled}/5)`,
      description:
        filled < 5
          ? hasClient
            ? '미지정 단계는 수동으로 결재자를 선택하세요.'
            : '발주처(client) 멤버가 프로젝트에 없거나 직책이 비어 있습니다. 멤버·직책을 확인하세요.'
          : undefined,
    });
  };

  const handleSave = async () => {
    const invalidLines = lines.filter(
      (l) => l.user_id && !eligible.some((a) => a.out_user_id === l.user_id),
    );
    if (invalidLines.length > 0) {
      toast({
        title: '결재자가 선택 가능한 후보에 없습니다.',
        description: '발주처/시공사 멤버가 프로젝트에 등록돼 있는지 확인하세요.',
        variant: 'destructive',
      });
      return;
    }

    await supabase.from('approval_lines').delete().eq('project_id', projectId);
    if (lines.length > 0) {
      const inserts = lines.map((l, i) => ({
        project_id: projectId,
        step_order: i,
        step_label: l.step_label,
        position: l.position,
        company_id: l.company_id || null,
        user_id: l.user_id || null,
        user_name: l.user_name || '',
        company_name: l.company_name || '',
      }));
      await supabase.from('approval_lines').insert(inserts);
    }
    setDirty(false);
    toast({ title: '결재라인 저장 완료' });
    fetchLines();
  };

  const addStep = () => {
    setLines((prev) => [
      ...prev,
      {
        project_id: projectId,
        step_order: prev.length,
        step_label: '',
        position: '',
        company_id: null,
        user_id: null,
        user_name: '',
        company_name: '',
      },
    ]);
    setDirty(true);
  };

  const removeStep = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= lines.length) return;
    const updated = [...lines];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setLines(updated);
    setDirty(true);
  };

  const updateLine = (index: number, field: string, value: any) => {
    setLines((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };

      if (field === 'step_label' && value) {
        const template = STEP_TEMPLATES.find((t) => t.step_label === value);
        if (template) {
          updated[index].position = template.position;
          // Clear approver when step type changes — old person may be wrong company
          updated[index].user_id = null;
          updated[index].user_name = '';
          updated[index].company_id = null;
          updated[index].company_name = '';
        }
      }

      if (field === 'user_id' && value) {
        const a = eligible.find((m) => m.out_user_id === value);
        if (a) {
          updated[index].user_name = a.out_display_name;
          updated[index].company_name = a.out_company_name || '';
          updated[index].company_id = a.out_company_id || null;
        } else {
          const member = toMemberLike({
            out_user_id: value,
            out_display_name: '',
            out_company_id: null,
            out_company_name: '',
            out_company_type: '',
            out_position: '',
            out_role: '',
          });
          const m = projectMembers.find((x) => x.user_id === value) || member;
          updated[index].user_name = m.display_name;
          updated[index].company_name = m.company || '';
          updated[index].company_id = m.company_id || null;
        }
      }
      return updated;
    });
    setDirty(true);
  };

  if (loading) return <div className="text-xs text-muted-foreground p-4">결재라인 로딩 중...</div>;

  const clientCount = eligible.filter((a) => normalizeCompanyType(a.out_company_type) === 'client').length;
  const gcCount = eligible.filter((a) => normalizeCompanyType(a.out_company_type) === 'gc').length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Users className="h-4 w-4" /> 결재라인 설정
          </CardTitle>
          {!readOnly && (
            <div className="flex gap-1.5 items-center">
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer select-none mr-1">
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={showPeerContractors}
                  onChange={(e) => setShowPeerContractors(e.target.checked)}
                />
                타 협력사 포함
              </label>
              <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={autoGenerate}>
                <RefreshCw className="h-3 w-3" /> 자동 생성
              </Button>
              <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={addStep}>
                <Plus className="h-3 w-3" /> 단계 추가
              </Button>
              {dirty && (
                <Button size="sm" className="gap-1 text-xs h-7" onClick={handleSave}>
                  <Save className="h-3 w-3" /> 저장
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          후보: 발주처 {clientCount}명 · 시공사 {gcCount}명 · 전체 {eligible.length}명
          {eligibleError ? ` · RPC 실패(폴백): ${eligibleError}` : ''}
        </p>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            결재라인이 설정되지 않았습니다.
            {!readOnly && (
              <p className="mt-1 text-xs">[자동 생성] 버튼으로 프로젝트 멤버 기반 결재라인을 만들 수 있습니다.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="border px-2 py-1.5 text-left font-medium w-10">순서</th>
                  <th className="border px-2 py-1.5 text-left font-medium">구분</th>
                  <th className="border px-2 py-1.5 text-left font-medium">직책</th>
                  <th className="border px-2 py-1.5 text-left font-medium">결재자</th>
                  <th className="border px-2 py-1.5 text-left font-medium">소속</th>
                  {!readOnly && <th className="border px-2 py-1.5 text-center font-medium w-24">작업</th>}
                </tr>
              </thead>
              <tbody>
                {lines
                  .filter((l) => !(readOnly && l.position === 'cooperator' && !l.user_id))
                  .map((line, i) => {
                    const options = optionsForStep(line.position);
                    const selected =
                      line.user_id && !options.some((a) => a.out_user_id === line.user_id)
                        ? eligible.find((a) => a.out_user_id === line.user_id)
                        : undefined;
                    const dropdown = selected ? [selected, ...options] : options;
                    return (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="border px-2 py-1 text-center font-medium">{i + 1}</td>
                        <td className="border px-2 py-1">
                          {readOnly ? (
                            <span>{line.step_label || '—'}</span>
                          ) : (
                            <Select
                              value={line.step_label}
                              onValueChange={(v) => updateLine(i, 'step_label', v)}
                            >
                              <SelectTrigger className="h-7 text-xs border-0 shadow-none">
                                <SelectValue placeholder="구분 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {STEP_TEMPLATES.map((t) => (
                                  <SelectItem key={t.step_label} value={t.step_label}>
                                    {t.step_label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="border px-2 py-1">
                          <Badge variant="outline" className="text-[10px]">
                            {POSITION_LABELS[line.position] || line.position || '미지정'}
                          </Badge>
                        </td>
                        <td className="border px-2 py-1">
                          {readOnly ? (
                            <span>{line.user_name || '미지정'}</span>
                          ) : (
                            <Select
                              value={line.user_id || ''}
                              onValueChange={(v) => updateLine(i, 'user_id', v)}
                              disabled={!line.position}
                            >
                              <SelectTrigger className="h-7 text-xs border-0 shadow-none">
                                <SelectValue placeholder="결재자 선택">
                                  {line.user_name || '선택...'}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {!line.position && (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">
                                    먼저 구분을 선택하세요.
                                  </div>
                                )}
                                {line.position && dropdown.length === 0 && (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">
                                    {(line.position === 'owner_sm' || line.position === 'owner_cm')
                                      ? '발주처(client) 멤버·직책(OWNER_SM/CM)이 없습니다. 프로젝트 멤버를 확인하세요.'
                                      : '해당 단계에 맞는 결재자가 없습니다.'}
                                  </div>
                                )}
                                {dropdown.map((a) => (
                                  <SelectItem key={a.out_user_id} value={a.out_user_id}>
                                    {a.out_display_name}{' '}
                                    ({POSITION_LABELS[a.out_position] || a.out_position || a.out_role})
                                    {a.out_company_name && ` · ${a.out_company_name}`}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="border px-2 py-1 text-muted-foreground">
                          {line.company_name || '—'}
                        </td>
                        {!readOnly && (
                          <td className="border px-2 py-1">
                            <div className="flex items-center justify-center gap-0.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => moveStep(i, -1)}
                                disabled={i === 0}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => moveStep(i, 1)}
                                disabled={i === lines.length - 1}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-destructive"
                                onClick={() => removeStep(i)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { ApprovalLine };
