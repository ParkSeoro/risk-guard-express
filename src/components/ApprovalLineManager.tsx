import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, ArrowUp, ArrowDown, RefreshCw, Users, Save } from 'lucide-react';

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
  projectMembers: ProjectMember[];
  companies: Company[];
  readOnly?: boolean;
  onLinesChanged?: (lines: ApprovalLine[]) => void;
}

const POSITION_LABELS: Record<string, string> = {
  // legacy project_role values stored in approval_lines.position
  supervisor: '관리감독자',
  safety_manager: '안전관리자',
  site_manager: '현장대리인',
  project_admin: '프로젝트 관리자',
  worker: '작업자',
  viewer: '열람자',
  // new project_position enum (project_members.position_new)
  CEO: '대표이사',
  EXECUTIVE: '임원',
  SITE_MANAGER: '현장소장',
  HSE_MANAGER: '안전보건관리자',
  CONSTRUCTION_MGR: '공사관리자',
  FIELD_ENGINEER: '현장기사',
  FOREMAN: '작업반장',
  WORKER: '작업자',
  OWNER_PM: '발주처PM',
  OWNER_HSE: '발주처안전',
  SUPERVISOR: '감리원',
};

const STEP_TEMPLATES = [
  { step_label: '작성', position: 'supervisor' },
  { step_label: '안전관리자 검토', position: 'safety_manager' },
  { step_label: '현장대리인 확인', position: 'site_manager' },
  { step_label: '최종승인', position: 'project_admin' },
];

export default function ApprovalLineManager({ projectId, projectMembers, companies, readOnly, onLinesChanged }: Props) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [lines, setLines] = useState<ApprovalLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [showAllCompanies, setShowAllCompanies] = useState(false);

  // 작성자(현재 사용자) 소속 회사 — 결재선 드롭다운 기본 필터
  const currentMember = projectMembers.find(m => m.user_id === user?.id);
  const authorCompanyId = currentMember?.company_id || null;
  const OWNER_ROLES = new Set(['master', 'project_admin', 'safety_manager']);
  const visibleMembers = showAllCompanies || !authorCompanyId
    ? projectMembers
    : projectMembers.filter(m =>
        m.company_id === authorCompanyId || OWNER_ROLES.has(m.role)
      );

  const fetchLines = useCallback(async () => {
    const { data } = await supabase
      .from('approval_lines')
      .select('*')
      .eq('project_id', projectId)
      .order('step_order');
    if (data && data.length > 0) {
      setLines(data as ApprovalLine[]);
    } else {
      // No lines saved yet — don't auto-generate, leave empty
      setLines([]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchLines(); }, [fetchLines]);
  useEffect(() => { onLinesChanged?.(lines); }, [lines]);

  const autoGenerate = () => {
    if (!user) return;
    const currentMember = projectMembers.find(m => m.user_id === user.id);
    const authorCompanyId = currentMember?.company_id || null;
    const newLines: ApprovalLine[] = [];

    // Step 1: 작성자 (current user)
    newLines.push({
      project_id: projectId, step_order: 0, step_label: '작성',
      position: 'supervisor', company_id: authorCompanyId,
      user_id: user.id, user_name: currentMember?.display_name || '',
      company_name: currentMember?.company || '',
    });

    // Step 2: 안전관리자 — same company first, then any
    const safetyMgr = projectMembers.find(m =>
      m.position === 'safety_manager' && (authorCompanyId ? m.company_id === authorCompanyId : true)
    ) || projectMembers.find(m => m.position === 'safety_manager');
    if (safetyMgr) {
      newLines.push({
        project_id: projectId, step_order: 1, step_label: '안전관리자 검토',
        position: 'safety_manager', company_id: safetyMgr.company_id || null,
        user_id: safetyMgr.user_id, user_name: safetyMgr.display_name,
        company_name: safetyMgr.company || '',
      });
    }

    // Step 3: 현장대리인 — same company first, then any
    const siteMgr = projectMembers.find(m =>
      m.position === 'site_manager' && (authorCompanyId ? m.company_id === authorCompanyId : true)
    ) || projectMembers.find(m => m.position === 'site_manager');
    if (siteMgr) {
      newLines.push({
        project_id: projectId, step_order: 2, step_label: '현장대리인 확인',
        position: 'site_manager', company_id: siteMgr.company_id || null,
        user_id: siteMgr.user_id, user_name: siteMgr.display_name,
        company_name: siteMgr.company || '',
      });
    }

    // Step 4: 최종승인 — project_admin/master
    const adminMember = projectMembers.find(m => m.role === 'project_admin' || m.role === 'master');
    if (adminMember) {
      newLines.push({
        project_id: projectId, step_order: 3, step_label: '최종승인',
        position: 'project_admin', company_id: adminMember.company_id || null,
        user_id: adminMember.user_id, user_name: adminMember.display_name,
        company_name: adminMember.company || '',
      });
    }

    setLines(newLines);
    setDirty(true);
    toast({ title: `결재라인 ${newLines.length}단계 자동 생성` });
  };

  const handleSave = async () => {
    // Validate: all lines must belong to same projectId
    const invalidLines = lines.filter(l => l.user_id && !projectMembers.find(m => m.user_id === l.user_id));
    if (invalidLines.length > 0) {
      toast({ title: '결재자가 프로젝트 멤버가 아닙니다.', variant: 'destructive' });
      return;
    }

    // Delete existing and re-insert
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
    setLines(prev => [...prev, {
      project_id: projectId, step_order: prev.length,
      step_label: '', position: '', company_id: null,
      user_id: null, user_name: '', company_name: '',
    }]);
    setDirty(true);
  };

  const removeStep = (index: number) => {
    setLines(prev => prev.filter((_, i) => i !== index));
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
    setLines(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };

      // When step_label changes, auto-fill position
      if (field === 'step_label' && value) {
        const template = STEP_TEMPLATES.find(t => t.step_label === value);
        if (template) {
          updated[index].position = template.position;
        }
      }

      // When user_id changes, auto-fill user_name and company
      if (field === 'user_id' && value) {
        const member = projectMembers.find(m => m.user_id === value);
        if (member) {
          updated[index].user_name = member.display_name;
          updated[index].company_name = member.company || '';
          updated[index].company_id = member.company_id || null;
        }
      }
      return updated;
    });
    setDirty(true);
  };

  if (loading) return <div className="text-xs text-muted-foreground p-4">결재라인 로딩 중...</div>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Users className="h-4 w-4" /> 결재라인 설정
          </CardTitle>
          {!readOnly && (
            <div className="flex gap-1.5">
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
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            결재라인이 설정되지 않았습니다.
            {!readOnly && <p className="mt-1 text-xs">[자동 생성] 버튼으로 프로젝트 멤버 기반 결재라인을 만들 수 있습니다.</p>}
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
                {lines.map((line, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="border px-2 py-1 text-center font-medium">{i + 1}</td>
                    <td className="border px-2 py-1">
                      {readOnly ? (
                        <span>{line.step_label || '—'}</span>
                      ) : (
                        <Select value={line.step_label} onValueChange={v => updateLine(i, 'step_label', v)}>
                          <SelectTrigger className="h-7 text-xs border-0 shadow-none"><SelectValue placeholder="구분 선택" /></SelectTrigger>
                          <SelectContent>
                            {STEP_TEMPLATES.map(t => (
                              <SelectItem key={t.step_label} value={t.step_label}>{t.step_label}</SelectItem>
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
                        <Select value={line.user_id || ''} onValueChange={v => updateLine(i, 'user_id', v)}>
                          <SelectTrigger className="h-7 text-xs border-0 shadow-none">
                            <SelectValue placeholder="결재자 선택">{line.user_name || '선택...'}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {visibleMembers.length === 0 && (
                              <div className="px-3 py-2 text-xs text-muted-foreground">표시할 결재자가 없습니다.</div>
                            )}
                            {visibleMembers.map(m => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {m.display_name} ({POSITION_LABELS[m.position] || m.position || m.role})
                                {m.company && ` · ${m.company}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="border px-2 py-1 text-muted-foreground">{line.company_name || '—'}</td>
                    {!readOnly && (
                      <td className="border px-2 py-1">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveStep(i, 1)} disabled={i === lines.length - 1}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeStep(i)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { ApprovalLine };
