import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Building2, ChevronLeft, Trash2, Plus, Save, UserPlus } from 'lucide-react';

interface Company {
  id: string; project_id: string; name: string; type: string;
  business_no: string; contact: string; address: string; scope: string; period: string;
}

const POSITION_OPTIONS = [
  { value: 'site_manager', label: '현장소장' },
  { value: 'safety_manager', label: '안전관리자' },
  { value: 'construction_mgr', label: '공사팀장' },
  { value: 'field_engineer', label: '공무팀장' },
  { value: 'foreman', label: '직장/반장' },
  { value: 'supervisor', label: '관리감독자' },
  { value: 'manager', label: '기타 관리자' },
];

const positionLabel = (v: string) => POSITION_OPTIONS.find(p => p.value === v)?.label || v;

export default function CompanyDetail() {
  const { id: companyId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { isMaster, isProjectAdmin, isSafetyManager, userCompanyId } = useProjectAccess();
  const { user } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const canEdit = useMemo(() => {
    if (!company) return false;
    if (isMaster || isProjectAdmin || isSafetyManager) return true;
    return userCompanyId === company.id;
  }, [company, isMaster, isProjectAdmin, isSafetyManager, userCompanyId]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
      if (cancelled) return;
      setCompany(data as any);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">로딩 중...</div>;
  if (!company) return <div className="p-6 text-sm text-destructive">회사를 찾을 수 없습니다.</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/companies" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <Building2 className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">{company.name}</h1>
        <Badge variant="secondary">{company.type}</Badge>
        {!canEdit && <Badge variant="outline">조회 전용</Badge>}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">회사 개요</TabsTrigger>
          <TabsTrigger value="construction">공사 개요</TabsTrigger>
          <TabsTrigger value="departments">조직도</TabsTrigger>
          <TabsTrigger value="managers">관리자</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab company={company} canEdit={canEdit} onSaved={setCompany} /></TabsContent>
        <TabsContent value="construction"><ConstructionTab company={company} canEdit={canEdit} /></TabsContent>
        <TabsContent value="departments"><DepartmentsTab company={company} canEdit={canEdit} /></TabsContent>
        <TabsContent value="managers"><ManagersTab company={company} canEdit={canEdit} currentUserId={user?.id} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ----------------------------- Overview ----------------------------- */
function OverviewTab({ company, canEdit, onSaved }: { company: Company; canEdit: boolean; onSaved: (c: Company) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState(company);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(company); }, [company]);

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.from('companies').update({
      name: form.name,
      business_no: form.business_no,
      contact: form.contact,
      address: form.address,
    }).eq('id', company.id).select().single();
    setSaving(false);
    if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
    onSaved(data as any);
    toast({ title: '저장되었습니다.' });
  };

  const field = (label: string, key: keyof Company) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={(form as any)[key] || ''} disabled={!canEdit}
        onChange={e => setForm({ ...form, [key]: e.target.value } as Company)} />
    </div>
  );

  return (
    <Card><CardContent className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {field('회사명', 'name')}
        {field('사업자번호', 'business_no')}
        {field('대표/연락처', 'contact')}
        {field('본사 주소', 'address')}
      </div>
      {canEdit && (
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '저장'}
        </Button>
      )}
    </CardContent></Card>
  );
}

/* ----------------------------- Construction ----------------------------- */
function ConstructionTab({ company, canEdit }: { company: Company; canEdit: boolean }) {
  const { toast } = useToast();
  const [info, setInfo] = useState<any>({
    construction_name: '', construction_type: '',
    construction_period_start: '', construction_period_end: '',
    construction_amount: 0,
  });
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('company_construction_info')
        .select('*')
        .eq('company_id', company.id)
        .eq('project_id', company.project_id)
        .maybeSingle();
      if (data) {
        setInfo({
          construction_name: data.construction_name || '',
          construction_type: data.construction_type || '',
          construction_period_start: data.construction_period_start || '',
          construction_period_end: data.construction_period_end || '',
          construction_amount: data.construction_amount || 0,
        });
        setExistingId(data.id);
      }
    })();
  }, [company.id, company.project_id]);

  const save = async () => {
    setSaving(true);
    const payload = {
      company_id: company.id,
      project_id: company.project_id,
      construction_name: info.construction_name,
      construction_type: info.construction_type,
      construction_period_start: info.construction_period_start || null,
      construction_period_end: info.construction_period_end || null,
      construction_amount: Number(info.construction_amount) || 0,
    };
    const { error } = existingId
      ? await supabase.from('company_construction_info').update(payload).eq('id', existingId)
      : await supabase.from('company_construction_info').insert([payload]);
    setSaving(false);
    if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '저장되었습니다.' });
  };

  return (
    <Card><CardContent className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">공사명</Label>
          <Input disabled={!canEdit} value={info.construction_name} onChange={e => setInfo({ ...info, construction_name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">공종</Label>
          <Input disabled={!canEdit} value={info.construction_type} onChange={e => setInfo({ ...info, construction_type: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">도급금액(원)</Label>
          <Input type="number" disabled={!canEdit} value={info.construction_amount}
            onChange={e => setInfo({ ...info, construction_amount: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">착공일</Label>
          <Input type="date" disabled={!canEdit} value={info.construction_period_start || ''}
            onChange={e => setInfo({ ...info, construction_period_start: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">준공일</Label>
          <Input type="date" disabled={!canEdit} value={info.construction_period_end || ''}
            onChange={e => setInfo({ ...info, construction_period_end: e.target.value })} />
        </div>
      </div>
      {canEdit && (
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '저장'}
        </Button>
      )}
    </CardContent></Card>
  );
}

/* ----------------------------- Departments ----------------------------- */
function DepartmentsTab({ company, canEdit }: { company: Company; canEdit: boolean }) {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [newName, setNewName] = useState('');

  const reload = async () => {
    const { data } = await supabase.from('company_departments' as any)
      .select('*').eq('company_id', company.id).eq('is_deleted', false)
      .order('sort_order').order('name');
    setItems((data as any[]) || []);
  };
  useEffect(() => { reload(); }, [company.id]);

  const add = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from('company_departments' as any).insert([{
      company_id: company.id, name: newName.trim(), sort_order: items.length,
    }]);
    if (error) { toast({ title: '추가 실패', description: error.message, variant: 'destructive' }); return; }
    setNewName(''); reload();
  };

  const remove = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    const { error } = await supabase.from('company_departments' as any)
      .update({ is_deleted: true }).eq('id', id);
    if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); return; }
    reload();
  };

  return (
    <Card><CardContent className="p-4 space-y-3">
      {canEdit && (
        <div className="flex gap-2">
          <Input placeholder="부서명 (예: 시공팀, 안전팀)" value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()} />
          <Button size="sm" onClick={add} className="gap-1.5"><Plus className="h-3.5 w-3.5" />추가</Button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6">등록된 부서가 없습니다.</div>
      ) : (
        <div className="space-y-1">
          {items.map(d => (
            <div key={d.id} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
              <span>{d.name}</span>
              {canEdit && (
                <Button size="icon" variant="ghost" onClick={() => remove(d.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </CardContent></Card>
  );
}

/* ----------------------------- Managers ----------------------------- */
function ManagersTab({ company, canEdit, currentUserId }: { company: Company; canEdit: boolean; currentUserId?: string }) {
  const { toast } = useToast();
  const [managers, setManagers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);

  const reload = async () => {
    const [m, d, p] = await Promise.all([
      supabase.from('company_managers' as any).select('*').eq('company_id', company.id).eq('is_deleted', false).order('is_primary', { ascending: false }).order('name'),
      supabase.from('company_departments' as any).select('id, name').eq('company_id', company.id).eq('is_deleted', false),
      supabase.from('profiles').select('user_id, display_name, position'),
    ]);
    setManagers((m.data as any[]) || []);
    setDepartments((d.data as any[]) || []);
    setProfiles((p.data as any[]) || []);
  };
  useEffect(() => { reload(); }, [company.id]);

  const save = async () => {
    if (!editing?.name?.trim()) { toast({ title: '이름을 입력해주세요.', variant: 'destructive' }); return; }
    const payload = {
      company_id: company.id,
      department_id: editing.department_id || null,
      name: editing.name.trim(),
      position: editing.position || 'manager',
      phone: editing.phone || '',
      email: editing.email || '',
      user_id: editing.user_id || null,
      is_primary: !!editing.is_primary,
    };
    const { error } = editing.id
      ? await supabase.from('company_managers' as any).update(payload).eq('id', editing.id)
      : await supabase.from('company_managers' as any).insert([payload]);
    if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '저장되었습니다.' });
    setEditing(null); reload();
  };

  const remove = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    const { error } = await supabase.from('company_managers' as any).update({ is_deleted: true }).eq('id', id);
    if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); return; }
    reload();
  };

  const profileById = (uid: string | null) => profiles.find(p => p.user_id === uid);

  return (
    <Card><CardContent className="p-4 space-y-3">
      {canEdit && !editing && (
        <Button size="sm" onClick={() => setEditing({})} className="gap-1.5"><UserPlus className="h-3.5 w-3.5" />관리자 추가</Button>
      )}

      {editing && (
        <Card className="border-primary/40">
          <CardContent className="p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">이름</Label>
                <Input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">직책</Label>
                <Select value={editing.position || 'manager'} onValueChange={v => setEditing({ ...editing, position: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {POSITION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">부서</Label>
                <Select value={editing.department_id || '_none'} onValueChange={v => setEditing({ ...editing, department_id: v === '_none' ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="미지정" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— 미지정 —</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">연락처</Label>
                <Input value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">이메일</Label>
                <Input type="email" value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">시스템 계정 연결 (선택)</Label>
                <Select value={editing.user_id || '_none'} onValueChange={v => setEditing({ ...editing, user_id: v === '_none' ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="계정 미연결" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— 계정 미연결 —</SelectItem>
                    {profiles.map(p => (
                      <SelectItem key={p.user_id} value={p.user_id}>
                        {p.display_name || p.user_id.slice(0, 8)} {p.position ? `(${p.position})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">계정을 연결하면 해당 사용자에게 자동으로 프로젝트 권한이 부여됩니다.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} className="gap-1.5"><Save className="h-3.5 w-3.5" />저장</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>취소</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {managers.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6">등록된 관리자가 없습니다.</div>
      ) : (
        <table className="w-full data-table text-sm">
          <thead>
            <tr>
              <th>이름</th><th>직책</th><th>부서</th><th>연락처</th><th>계정연결</th>
              {canEdit && <th className="w-24">관리</th>}
            </tr>
          </thead>
          <tbody>
            {managers.map(m => {
              const dept = departments.find(d => d.id === m.department_id);
              const prof = profileById(m.user_id);
              return (
                <tr key={m.id}>
                  <td className="font-medium">
                    {m.name}{m.is_primary && <Badge variant="secondary" className="ml-1 text-[10px]">대표</Badge>}
                  </td>
                  <td>{positionLabel(m.position)}</td>
                  <td>{dept?.name || '-'}</td>
                  <td className="text-xs">{m.phone || '-'}<br />{m.email || ''}</td>
                  <td className="text-xs">{prof ? <Badge variant="outline">{prof.display_name}</Badge> : <span className="text-muted-foreground">미연결</span>}</td>
                  {canEdit && (
                    <td>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>수정</Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(m.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </CardContent></Card>
  );
}
