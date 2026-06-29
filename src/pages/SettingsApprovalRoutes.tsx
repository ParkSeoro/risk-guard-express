import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, GitBranch, Plus, Trash2, ArrowUp, ArrowDown, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ENTITY_LABELS, type ApprovalEntityType } from '@/components/approval/SubmitApprovalDialog';

const PROJECT_KEY = 'selected_project_id';

interface Step { label: string; position: string; user_id: string; user_name: string; company_id: string | null; company_name: string }

type ScopeFilter = 'mine' | 'company' | 'shared' | 'all';

export default function SettingsApprovalRoutes() {
  const navigate = useNavigate();
  const { hasRole, user, profile } = useAuth();
  const canEdit = !!user; // 누구나 본인 전용 템플릿 관리 가능. 회사/프로젝트 공용은 isOwnerSide 만.
  const projectId = localStorage.getItem(PROJECT_KEY) || '';
  const myCompanyId: string | null = (profile as any)?.company_id || null;
  const isOwnerSide = hasRole('master') || hasRole('project_admin');

  const [entityType, setEntityType] = useState<ApprovalEntityType>('assessment_run');
  const [scope, setScope] = useState<ScopeFilter>('mine');
  const [templates, setTemplates] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [approvers, setApprovers] = useState<any[]>([]);

  const [search, setSearch] = useState('');

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    const [{ data: tpl }, { data: cos }] = await Promise.all([
      supabase.from('approval_route_templates').select('*')
        .eq('project_id', projectId).eq('entity_type', entityType).eq('is_deleted', false)
        .order('owner_user_id', { ascending: false, nullsFirst: false })
        .order('is_default', { ascending: false }),
      supabase.from('companies').select('id,name,type').eq('project_id', projectId).eq('is_deleted', false),
    ]);
    setTemplates(tpl || []);
    setCompanies(cos || []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    if (!projectId) return;
    const ch = supabase
      .channel(`approval_routes:${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_route_templates', filter: `project_id=eq.${projectId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    /* eslint-disable-next-line */
  }, [projectId, entityType]);


  // 본인 / 회사 / 프로젝트 공용 가시성 필터
  const visibleTemplates = templates.filter((t) => {
    const isMine = t.owner_user_id === user?.id;
    const isMyCompany = !t.owner_user_id && t.company_id && myCompanyId && t.company_id === myCompanyId;
    const isShared = !t.owner_user_id && !t.company_id;
    const isOtherCompany = !t.owner_user_id && t.company_id && t.company_id !== myCompanyId;
    // 마스터/PA만 타회사 전용 템플릿 조회 가능
    if (!isOwnerSide && isOtherCompany) return false;
    if (scope === 'mine') return isMine;
    if (scope === 'company') return isMyCompany;
    if (scope === 'shared') return isShared;
    return true;
  });

  const startCreate = () => setEditing({
    id: null, name: '', entity_type: entityType, project_id: projectId,
    owner_user_id: user?.id, // 기본 "내 전용"
    company_id: null, is_default: false, steps: [],
  });

  const refreshApproversFor = async (cid: string | null) => {
    const { data } = await supabase.rpc('get_eligible_approvers', {
      _project_id: projectId, _submitter_company_id: cid,
    });
    setApprovers((data as any) || []);
  };

  const startEdit = async (t: any) => {
    setEditing({ ...t, steps: Array.isArray(t.steps) ? t.steps : [] });
    await refreshApproversFor(t.company_id || myCompanyId);
  };

  const onScopeChange = async (s: 'mine' | 'company' | 'shared') => {
    setEditing((e: any) => ({
      ...e,
      owner_user_id: s === 'mine' ? user?.id : null,
      company_id: s === 'company' ? myCompanyId : null,
    }));
    await refreshApproversFor(s === 'company' ? myCompanyId : myCompanyId);
  };

  const onCompanyChange = async (cid: string) => {
    const next = cid === '__none__' ? null : cid;
    setEditing((e: any) => ({ ...e, company_id: next, owner_user_id: null }));
    await refreshApproversFor(next || myCompanyId);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name) return toast.error('템플릿 이름을 입력하세요');
    if (!Array.isArray(editing.steps) || editing.steps.length === 0) return toast.error('1단계 이상 추가하세요');
    const payload = {
      project_id: projectId,
      entity_type: editing.entity_type,
      owner_user_id: editing.owner_user_id || null,
      company_id: editing.company_id,
      name: editing.name,
      assessment_type: '정기',
      is_default: !!editing.is_default,
      steps: editing.steps,
      created_by: user?.id,
    };
    const { error } = editing.id
      ? await supabase.from('approval_route_templates').update(payload).eq('id', editing.id)
      : await supabase.from('approval_route_templates').insert(payload);
    if (error) return toast.error(error.message);
    toast.success('저장되었습니다');
    setEditing(null);
    load();
  };


  const remove = async (id: string) => {
    if (!confirm('이 템플릿을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('approval_route_templates')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: user?.id })
      .eq('id', id);
    if (error) return toast.error(error.message);
    load();
  };

  const updateStep = (idx: number, patch: Partial<Step>) => {
    setEditing((e: any) => ({ ...e, steps: e.steps.map((s: Step, i: number) => i === idx ? { ...s, ...patch } : s) }));
  };
  const moveStep = (idx: number, dir: -1 | 1) => {
    setEditing((e: any) => {
      const next = [...e.steps];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return e;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...e, steps: next };
    });
  };

  if (!canEdit) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold flex items-center gap-2"><GitBranch className="h-5 w-5" /> 결재선 관리</h1>
        </div>
        <Card><CardContent className="py-12 text-center text-muted-foreground">마스터 또는 프로젝트 관리자 권한이 필요합니다.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>설정</span><span>/</span><span>결재선 관리</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2"><GitBranch className="h-5 w-5" /> 결재선 관리</h1>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">문서 유형</CardTitle>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as ApprovalEntityType)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ENTITY_LABELS) as ApprovalEntityType[]).map((k) => (
                    <SelectItem key={k} value={k}>{ENTITY_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={startCreate}><Plus className="h-4 w-4 mr-1" /> 새 템플릿</Button>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground mr-1">보기:</span>
            {([
              { v: 'mine', label: '내 전용' },
              { v: 'company', label: '회사 공용' },
              { v: 'shared', label: '프로젝트 공용' },
              { v: 'all', label: '전체' },
            ] as { v: ScopeFilter; label: string }[]).map((s) => (
              <Button key={s.v} size="sm" variant={scope === s.v ? 'default' : 'outline'} className="h-7"
                onClick={() => setScope(s.v)}>{s.label}</Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            결재선은 <b>로그인 사용자별</b>로 다를 수 있습니다. "내 전용" 템플릿은 본인만 사용·수정할 수 있고,
            "회사 공용"은 소속 회사 사용자가 공유합니다.
          </p>
        </CardHeader>
        <CardContent>
          {loading && <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
          {!loading && visibleTemplates.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">등록된 템플릿이 없습니다</div>
          )}
          <div className="space-y-2">
            {visibleTemplates.map((t) => {
              const isMine = t.owner_user_id === user?.id;
              const canMutate = isMine || (isOwnerSide);
              return (
                <div key={t.id} className="border rounded p-3 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {t.name}
                      {t.is_default && <Badge variant="secondary">기본</Badge>}
                      {isMine
                        ? <Badge className="bg-primary/10 text-primary border-primary/30" variant="outline">내 전용</Badge>
                        : t.company_id
                          ? <Badge variant="outline">{companies.find((c) => c.id === t.company_id)?.name || '회사 공용'}</Badge>
                          : <Badge variant="outline">프로젝트 공용</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(Array.isArray(t.steps) ? t.steps : []).map((s: any, i: number) => `${i + 1}. ${s.label || s.step_label} (${s.user_name || '-'})`).join(' → ')}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => startEdit(t)} disabled={!canMutate}>편집</Button>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(t.id)} disabled={!canMutate}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>


      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? '템플릿 편집' : '새 결재선 템플릿'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs">템플릿 이름</label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs">적용 범위</label>
                  <div className="flex gap-1 mt-1">
                    {([
                      { v: 'mine', label: '내 전용' },
                      { v: 'company', label: '회사 공용', disabled: !myCompanyId },
                      { v: 'shared', label: '프로젝트 공용', disabled: !isOwnerSide },
                    ] as { v: 'mine' | 'company' | 'shared'; label: string; disabled?: boolean }[]).map((s) => {
                      const active =
                        (s.v === 'mine' && editing.owner_user_id) ||
                        (s.v === 'company' && !editing.owner_user_id && editing.company_id) ||
                        (s.v === 'shared' && !editing.owner_user_id && !editing.company_id);
                      return (
                        <Button key={s.v} type="button" size="sm" variant={active ? 'default' : 'outline'} className="h-8 flex-1"
                          disabled={s.disabled} onClick={() => onScopeChange(s.v)}>{s.label}</Button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {isOwnerSide && !editing.owner_user_id && (
                <div>
                  <label className="text-xs">회사 공용으로 지정할 회사 (마스터/관리자 전용)</label>
                  <Select value={editing.company_id || '__none__'} onValueChange={onCompanyChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">프로젝트 공용</SelectItem>
                      {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!editing.is_default}
                  onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
                기본 템플릿으로 설정 (해당 범위 내에서 우선 적용)
              </label>


              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">결재선 ({editing.steps.length}단계)</label>
                  <Button size="sm" variant="outline" onClick={() => setEditing({
                    ...editing,
                    steps: [...editing.steps, { label: '결재', position: '', user_id: '', user_name: '', company_id: null, company_name: '' }],
                  })}><Plus className="h-3.5 w-3.5 mr-1" /> 단계 추가</Button>
                </div>
                {editing.steps.map((s: Step, i: number) => (
                  <div key={i} className="border rounded p-2 space-y-2 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{i + 1}</Badge>
                      <Input className="h-8 flex-1" value={s.label} onChange={(e) => updateStep(i, { label: e.target.value })} placeholder="단계명" />
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveStep(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveStep(i, 1)} disabled={i === editing.steps.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                        onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_: any, idx: number) => idx !== i) })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Select value={s.user_id} onValueChange={(v) => {
                      const a = approvers.find((x: any) => x.out_user_id === v);
                      if (!a) return;
                      updateStep(i, { user_id: a.out_user_id, user_name: a.out_display_name, company_id: a.out_company_id, company_name: a.out_company_name, position: s.position || a.out_position });
                    }}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="결재자 선택 (회사를 먼저 지정)" /></SelectTrigger>
                      <SelectContent>
                        {approvers.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">후보가 없습니다. 회사를 지정하세요.</div>}
                        {approvers.map((a: any) => (
                          <SelectItem key={a.out_user_id} value={a.out_user_id}>
                            {a.out_display_name || '(이름없음)'} · {a.out_company_name} · {a.out_position || a.out_role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>취소</Button>
            <Button onClick={save}><Save className="h-4 w-4 mr-1" /> 저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
