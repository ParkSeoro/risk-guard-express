import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { accountStatusSchema, roleChangeSchema } from '@/lib/inputValidation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Search, UserCheck, UserX, Shield, Plus, Building2, AlertCircle, Trash2, Crown, KeyRound } from 'lucide-react';

import {
  POSITION_LABELS as SSOT_POSITION_LABELS,
  POSITIONS_BY_COMPANY_TYPE as SSOT_POSITIONS_BY_TYPE,
  defaultRoleForPosition,
} from '@/lib/projectPositions';
import { companyTypeLabel, normalizeCompanyType } from '@/lib/companyTypes';

// === New permission model ===
// Global role: only `master` is meaningful (system-wide admin).
// Project role: 6-tier project-scoped role.
// Position: formal job titles by company type (발주처 PM/CM/SM, 시공사 감리≠관리감독자).
const globalRoleLabels: Record<string, string> = {
  master: '마스터 (시스템 관리자)',
  none: '일반 사용자',
};
const projectRoleLabels: Record<string, string> = {
  project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자',
  site_manager: '현장소장',
  supervisor: '감리',
  site_supervisor: '관리감독자',
  worker: '작업자',
  viewer: '열람자',
};
const positionLabels: Record<string, string> = { ...SSOT_POSITION_LABELS };
const POSITIONS_BY_COMPANY_TYPE: Record<string, string[]> = SSOT_POSITIONS_BY_TYPE as any;

/** Map new project_role -> legacy app_role enum (for the role column).
 *  Unknown new values fall back to 'viewer'. */
const projectRoleToLegacy = (r: string): string => {
  if (r === 'site_manager' || r === 'supervisor' || r === 'site_supervisor' || r === 'worker') return 'contractor';
  if (['project_admin', 'safety_manager', 'viewer'].includes(r)) return r;
  return 'viewer';
};

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '승인대기', color: 'bg-warning/10 text-warning border-warning/30' },
  active: { label: '활성', color: 'bg-success/10 text-success border-success/30' },
  inactive: { label: '비활성', color: 'bg-muted text-muted-foreground' },
};

interface UserWithRole {
  id: string;
  user_id: string;
  display_name: string;
  company: string;
  phone: string;
  position: string;
  account_status: string;
  created_at: string;
  roles: string[];
}

const UserManagement = () => {
  const { hasRole, user: currentUser } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Membership assignment state
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignProjectId, setAssignProjectId] = useState('');
  const [assignRole, setAssignRole] = useState('viewer');
  const [assignCompanyId, setAssignCompanyId] = useState('');
  const [assignPosition, setAssignPosition] = useState('');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectCompanies, setProjectCompanies] = useState<{ id: string; name: string; type: string }[]>([]);
  const [assignError, setAssignError] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  // Existing memberships for inline editing
  const [userMemberships, setUserMemberships] = useState<Record<string, any[]>>({});
  // Master-only temporary password override
  const [pwdResetUser, setPwdResetUser] = useState<UserWithRole | null>(null);
  const [pwdNew, setPwdNew] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  const isMaster = hasRole('master');
  const canManagePermissions = isMaster || hasRole('project_admin');

  const fetchUsers = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: allRoles }, { data: allMembers }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('user_roles').select('user_id, role'),
      supabase.from('project_members').select('id, user_id, project_id, role_new, company_id, company, position_new'),
    ]);
    const enriched: UserWithRole[] = (profiles || []).map((p: any) => ({
      ...p,
      account_status: p.account_status || 'active',
      roles: (allRoles || []).filter((r: any) => r.user_id === p.user_id).map((r: any) => r.role),
    }));
    setUsers(enriched);
    // Build memberships lookup
    const memberships: Record<string, any[]> = {};
    (allMembers || []).forEach((m: any) => {
      if (!memberships[m.user_id]) memberships[m.user_id] = [];
      memberships[m.user_id].push(m);
    });
    setUserMemberships(memberships);
    setLoading(false);
  };

  const fetchProjects = async () => {
    const { data } = await supabase.from('projects').select('id, name').eq('is_deleted', false).order('name');
    setProjects(data || []);
  };

  const loadProjectCompanies = async (projectId: string) => {
    if (!projectId) { setProjectCompanies([]); return; }
    try {
      const { fetchProjectCompanies } = await import('@/lib/projectCompanies');
      const rows = await fetchProjectCompanies(projectId);
      setProjectCompanies(rows.map(c => ({ id: c.id, name: c.name, type: c.type })));
    } catch (err) {
      console.warn('Companies fetch error:', err);
      setProjectCompanies([]);
    }
  };

  useEffect(() => { fetchUsers(); fetchProjects(); }, []);

  // Realtime: refresh on profile / membership changes
  useEffect(() => {
    const ch = supabase
      .channel('user-mgmt-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchUsers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, () => fetchUsers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => fetchUsers())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (assignProjectId) loadProjectCompanies(assignProjectId);
    else setProjectCompanies([]);
  }, [assignProjectId]);

  const handleRemoveMembership = async (membershipId: string, projectName: string) => {
    if (!confirm(`'${projectName}' 프로젝트 소속을 제거하시겠습니까?`)) return;
    const { error } = await supabase.from('project_members').delete().eq('id', membershipId);
    if (error) {
      toast({ title: '소속 제거 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '프로젝트 소속이 제거되었습니다.' });
      log('멤버십삭제', 'project_member', membershipId);
      fetchUsers();
    }
  };

  const openPasswordReset = (u: UserWithRole) => {
    setPwdResetUser(u);
    setPwdNew('');
    setPwdConfirm('');
  };

  const extractInvokeError = async (error: any, data: any): Promise<string> => {
    if (data?.message) return String(data.message);
    if (data?.detail) return String(data.detail);
    if (data?.error) return String(data.error);
    // supabase-js hides non-2xx bodies behind FunctionsHttpError.context
    try {
      if (error?.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body?.message) return String(body.message);
        if (body?.detail) return String(body.detail);
        if (body?.error) return String(body.error);
      }
    } catch {
      /* ignore parse errors */
    }
    const msg = error?.message || '알 수 없는 오류';
    if (/non-2xx/i.test(msg)) {
      return '서버에서 요청을 거부했습니다. 비밀번호 강도(8자 이상·유추 불가)를 확인하고 다시 시도하세요.';
    }
    return msg;
  };

  const handleAdminPasswordReset = async () => {
    if (!isMaster || !pwdResetUser) return;
    if (pwdNew.length < 8) {
      toast({ title: '비밀번호는 8자 이상이어야 합니다.', variant: 'destructive' });
      return;
    }
    if (pwdNew !== pwdConfirm) {
      toast({ title: '비밀번호 확인이 일치하지 않습니다.', variant: 'destructive' });
      return;
    }
    setPwdSaving(true);
    try {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) console.warn('refreshSession', refreshErr.message);
      const accessToken =
        refreshed.session?.access_token ||
        (await supabase.auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');

      const { data, error } = await supabase.functions.invoke('admin-reset-password', {
        body: { user_id: pwdResetUser.user_id, new_password: pwdNew },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (data && (data as any).ok === false) {
        throw new Error(await extractInvokeError(null, data));
      }
      if (error) throw new Error(await extractInvokeError(error, data));
      if ((data as any)?.error) throw new Error(await extractInvokeError(null, data));

      toast({
        title: '임시 비밀번호가 설정되었습니다.',
        description: `${pwdResetUser.display_name || '사용자'}의 비밀번호를 강제 변경했습니다.`,
      });
      await log('비밀번호강제초기화', 'auth_user', pwdResetUser.user_id, undefined, {
        display_name: pwdResetUser.display_name,
      });
      setPwdResetUser(null);
      setPwdNew('');
      setPwdConfirm('');
    } catch (e: any) {
      toast({
        title: '비밀번호 변경 실패',
        description: e?.message ?? '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setPwdSaving(false);
    }
  };

  const handleStatusChange = async (userId: string, status: string) => {
    const parsed = accountStatusSchema.safeParse(status);
    if (!parsed.success) {
      toast({ title: '유효하지 않은 상태값입니다.', variant: 'destructive' });
      return;
    }
    setSaving(userId);
    // Pending → Active: use RPC that auto-onboards (fills role from signup position, audits)
    const target = users.find(u => u.user_id === userId);
    if (target?.account_status === 'pending' && parsed.data === 'active') {
      const { data, error } = await (supabase as any).rpc('approve_pending_user', { _user_id: userId });
      if (error) {
        toast({ title: '승인 실패', description: error.message, variant: 'destructive' });
      } else {
        toast({
          title: '가입 승인 완료',
          description: `프로젝트 멤버 ${data?.memberships_updated ?? 0}건이 자동 연결/권한 부여되었습니다.`,
        });
      }
    } else if (parsed.data === 'inactive' && target?.account_status === 'pending') {
      const reason = prompt('반려 사유를 입력하세요. (필수)');
      if (!reason || !reason.trim()) { setSaving(null); return; }
      const { error } = await (supabase as any).rpc('reject_pending_user', { _user_id: userId, _reason: reason.trim() });
      if (error) toast({ title: '반려 실패', description: error.message, variant: 'destructive' });
      else toast({ title: '가입이 반려되었습니다.' });
    } else {
      const { error } = await supabase.from('profiles').update({ account_status: parsed.data }).eq('user_id', userId);
      if (error) {
        toast({ title: '상태 변경 실패', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: `사용자 상태가 '${statusLabels[status]?.label}'(으)로 변경되었습니다.` });
        log('사용자상태변경', 'profile', userId, undefined, { status });
      }
    }
    setSaving(null);
    fetchUsers();
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!isMaster) {
      toast({ title: '전역 역할은 마스터만 변경할 수 있습니다.', variant: 'destructive' });
      return;
    }
    setSaving(userId);
    const user = users.find(u => u.user_id === userId);
    if (user?.roles.includes('master') && newRole !== 'master') {
      const masterCount = users.filter(u => u.roles.includes('master')).length;
      if (masterCount <= 1) {
        toast({ title: '마지막 마스터는 변경할 수 없습니다.', description: '최소 1명의 마스터가 필요합니다.', variant: 'destructive' });
        setSaving(null);
        return;
      }
    }
    // New global role dropdown only has two values: 'master' and '' (none).
    // Empty / 'none' means: remove all global roles (user becomes project-only).
    const wantsMaster = newRole === 'master';
    if (wantsMaster) {
      const parsedRole = roleChangeSchema.safeParse('master');
      if (!parsedRole.success) {
        toast({ title: '유효하지 않은 역할입니다.', variant: 'destructive' });
        setSaving(null);
        return;
      }
    }
    const { error: delError } = await supabase.from('user_roles').delete().eq('user_id', userId);
    if (delError) {
      const msg = delError.message.includes('last master') ? '마지막 마스터 역할은 삭제할 수 없습니다.' : delError.message;
      toast({ title: '역할 삭제 실패', description: msg, variant: 'destructive' });
      setSaving(null);
      return;
    }
    if (wantsMaster) {
      const { error: insError } = await supabase.from('user_roles').insert([{ user_id: userId, role: 'master' as any }]);
      if (insError) {
        toast({ title: '역할 변경 실패', description: insError.message, variant: 'destructive' });
        setSaving(null);
        return;
      }
    }
    toast({ title: `전역 역할이 '${globalRoleLabels[newRole] || newRole}'(으)로 변경되었습니다.` });
    log('역할변경', 'user_role', userId, undefined, { role: newRole });
    setSaving(null);
    fetchUsers();
  };

  const resetAssignForm = () => {
    setAssignUserId('');
    setAssignProjectId('');
    setAssignRole('viewer');
    setAssignCompanyId('');
    setAssignPosition('');
    setAssignError('');
  };

  // Update existing project membership inline.
  // When changing role_new / position_new we also mirror to the legacy
  // `role` / `position` columns until Phase 4 cleanup.
  const handleUpdateMembership = async (membershipId: string, field: string, value: string | null) => {
    const updateData: Record<string, any> = { [field]: value };
    if (field === 'company_id') {
      const company = projectCompanies.find(c => c.id === value);
      updateData.company = company?.name || '';
    }
    const { error } = await supabase.from('project_members').update(updateData).eq('id', membershipId);
    if (error) {
      toast({ title: '멤버십 수정 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '프로젝트 멤버십이 업데이트되었습니다.' });
      log('멤버십수정', 'project_member', membershipId, undefined, { field, value });
      fetchUsers();
    }
  };

  const COMPANY_REQUIRED_ROLES = ['worker', 'site_manager', 'supervisor', 'site_supervisor'];

  const handleAssignMembership = async () => {
    setAssignError('');
    if (!assignUserId || !assignProjectId || !assignRole) {
      setAssignError('사용자, 프로젝트, 역할을 모두 선택해주세요.');
      return;
    }
    if (COMPANY_REQUIRED_ROLES.includes(assignRole) && !assignCompanyId) {
      setAssignError('작업자/현장소장/감리/관리감독자는 소속 업체를 반드시 선택해야 합니다.');
      return;
    }
    setAssignSaving(true);
    try {
      const companyName = assignCompanyId ? projectCompanies.find(c => c.id === assignCompanyId)?.name || '' : '';
      const roleToSave = assignPosition
        ? defaultRoleForPosition(assignPosition)
        : assignRole;
      const { error } = await supabase.from('project_members').insert([{
        project_id: assignProjectId,
        user_id: assignUserId,
        role_new: roleToSave as any,
        company_id: assignCompanyId || null,
        company: companyName,
        position_new: (assignPosition || null) as any,
      }]);
      if (error) {
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
          setAssignError('이미 해당 프로젝트에 소속된 사용자입니다.');
        } else {
          setAssignError(`소속 부여 실패: ${error.message}`);
        }
        setAssignSaving(false);
        return;
      }
      toast({ title: '프로젝트 소속이 부여되었습니다.' });
      log('프로젝트소속부여', 'project_member', assignUserId, assignProjectId, { role: assignRole, position: assignPosition });
      setShowAssignDialog(false);
      resetAssignForm();
    } catch (err) {
      setAssignError(`오류가 발생했습니다: ${String(err)}`);
    }
    setAssignSaving(false);
  };

  const filtered = users.filter(u => {
    if (filterStatus !== 'all' && u.account_status !== filterStatus) return false;
    if (filterProject !== 'all') {
      const mems = userMemberships[u.user_id] || [];
      if (!mems.some(m => m.project_id === filterProject)) return false;
    }
    if (search) {
      const term = search.toLowerCase();
      return (
        u.display_name?.toLowerCase().includes(term) ||
        u.company?.toLowerCase().includes(term) ||
        u.phone?.toLowerCase().includes(term)
      );
    }
    return true;
  });

  const kpis = {
    total: users.length,
    pending: users.filter(u => u.account_status === 'pending').length,
    active: users.filter(u => u.account_status === 'active').length,
    master: users.filter(u => u.roles.includes('master')).length,
  };

  if (!canManagePermissions) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold">사용자 관리</h1>
        <Card><CardContent className="py-12 text-center text-muted-foreground">마스터 또는 프로젝트 관리자 권한이 필요합니다.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" /> 사용자 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">신규가입 승인, 역할 부여, 프로젝트 소속 지정</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { resetAssignForm(); setShowAssignDialog(true); }}>
            <Plus className="h-3.5 w-3.5" /> 프로젝트 소속 부여
          </Button>
          <Badge variant="outline" className="gap-1">
            <Shield className="h-3 w-3" /> 승인대기 {users.filter(u => u.account_status === 'pending').length}명
          </Badge>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '전체 사용자', value: kpis.total, icon: Users, color: 'text-foreground' },
          { label: '승인대기', value: kpis.pending, icon: Shield, color: 'text-warning' },
          { label: '활성', value: kpis.active, icon: UserCheck, color: 'text-success' },
          { label: '마스터', value: kpis.master, icon: Crown, color: 'text-primary' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="py-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground">{k.label}</div>
                <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              </div>
              <k.icon className={`h-6 w-6 ${k.color} opacity-60`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status tabs */}
      <Tabs value={filterStatus} onValueChange={setFilterStatus}>
        <TabsList>
          <TabsTrigger value="all" className="text-xs">전체 ({kpis.total})</TabsTrigger>
          <TabsTrigger value="pending" className="text-xs">승인대기 ({kpis.pending})</TabsTrigger>
          <TabsTrigger value="active" className="text-xs">활성 ({kpis.active})</TabsTrigger>
          <TabsTrigger value="inactive" className="text-xs">비활성 ({users.filter(u => u.account_status === 'inactive').length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="프로젝트" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 프로젝트</SelectItem>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex-1 relative min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="이름, 회사, 연락처 검색..." className="h-8 pl-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length}명</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full data-table text-sm">
            <thead>
              <tr>
                <th>이름</th>
                <th>회사/소속</th>
                <th>직위</th>
                <th>연락처</th>
                <th className="text-center">상태</th>
                <th className="text-center">전역 역할</th>
                <th>프로젝트 소속</th>
                <th className="text-center w-52">작업</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="py-2"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">
                  {users.length === 0 ? '등록된 사용자가 없습니다.' : '검색/필터 조건에 맞는 사용자가 없습니다.'}
                </td></tr>
              ) : filtered.map(u => {
                const memberships = userMemberships[u.user_id] || [];
                return (
                <tr key={u.id}>
                  <td className="font-medium">{u.display_name}</td>
                  <td className="text-muted-foreground">{u.company || '—'}</td>
                  <td>{u.position || '—'}</td>
                  <td className="text-muted-foreground">{u.phone || '—'}</td>
                  <td className="text-center">
                    <Badge variant="outline" className={`text-[10px] ${statusLabels[u.account_status]?.color || ''}`}>
                      {statusLabels[u.account_status]?.label || u.account_status}
                    </Badge>
                  </td>
                  <td className="text-center">
                    {isMaster ? (
                      <Select value={u.roles[0] || 'none'} onValueChange={v => handleRoleChange(u.user_id, v === 'none' ? '' : v)}>
                        <SelectTrigger className="h-7 w-32 text-xs mx-auto"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(globalRoleLabels).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{u.roles.includes('master') ? '마스터' : '일반 사용자'}</Badge>
                    )}
                  </td>
                  <td>
                    {memberships.length === 0 ? (
                      <span className="text-xs text-muted-foreground">소속 없음</span>
                    ) : (
                      <div className="space-y-1">
                        {memberships.map((m: any) => {
                          const proj = projects.find(p => p.id === m.project_id);
                          const posLabel = positionLabels[m.position_new] || m.position_new;
                          return (
                            <div key={m.id} className="flex items-center gap-1 text-[10px] flex-wrap">
                              <Badge variant="secondary" className="text-[10px] shrink-0">{proj?.name || '프로젝트'}</Badge>
                              <Select value={m.role_new || 'viewer'} onValueChange={(v) => handleUpdateMembership(m.id, 'role_new', v)}>
                                <SelectTrigger className="h-5 w-24 text-[10px] border-dashed"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {Object.entries(projectRoleLabels).map(([k, v]) => (
                                    <SelectItem key={k} value={k} className="text-[10px]">{v}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select value={m.position_new || '_none'} onValueChange={(v) => handleUpdateMembership(m.id, 'position_new', v === '_none' ? null : v)}>
                                <SelectTrigger className="h-5 w-28 text-[10px] border-dashed"><SelectValue placeholder="직책" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none" className="text-[10px]">직책 없음</SelectItem>
                                  {(() => {
                                    const co = projectCompanies.find((c) => c.id === m.company_id);
                                    const companyType = normalizeCompanyType(co?.type) || co?.type;
                                    const allowed = companyType
                                      ? (POSITIONS_BY_COMPANY_TYPE[companyType] || Object.keys(positionLabels).filter((k) => k !== 'OWNER_HSE'))
                                      : Object.keys(positionLabels).filter((k) => k !== 'OWNER_HSE');
                                    // Always include current value so legacy codes remain visible
                                    const keys = [...allowed];
                                    if (m.position_new && !keys.includes(m.position_new)) keys.unshift(m.position_new);
                                    return keys.map((k) => (
                                      <SelectItem key={k} value={k} className="text-[10px]">{positionLabels[k] || k}</SelectItem>
                                    ));
                                  })()}
                                </SelectContent>
                              </Select>
                              {m.company && <span className="text-muted-foreground">({m.company})</span>}
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                                onClick={() => handleRemoveMembership(m.id, proj?.name || '프로젝트')}
                                title="이 프로젝트 소속 제거">
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="text-center">
                    <div className="flex items-center gap-1 justify-center flex-wrap">
                      {u.account_status === 'pending' && (
                        <>
                          <Button size="sm" variant="outline" className="h-6 text-xs gap-1 text-success" disabled={saving === u.user_id}
                            onClick={() => handleStatusChange(u.user_id, 'active')}
                            title="가입 시 선택한 프로젝트·업체·직종을 기반으로 권한을 자동 부여합니다.">
                            <UserCheck className="h-3 w-3" /> 승인
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-xs gap-1 text-destructive" disabled={saving === u.user_id}
                            onClick={() => handleStatusChange(u.user_id, 'inactive')}>
                            반려
                          </Button>
                        </>
                      )}
                      {u.account_status === 'active' && (
                        <Button size="sm" variant="outline" className="h-6 text-xs gap-1 text-destructive" disabled={saving === u.user_id}
                          onClick={() => handleStatusChange(u.user_id, 'inactive')}>
                          <UserX className="h-3 w-3" /> 비활성화
                        </Button>
                      )}
                      {u.account_status === 'inactive' && (
                        <Button size="sm" variant="outline" className="h-6 text-xs gap-1" disabled={saving === u.user_id}
                          onClick={() => handleStatusChange(u.user_id, 'active')}>
                          <UserCheck className="h-3 w-3" /> 활성화
                        </Button>
                      )}
                      {isMaster && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs gap-1"
                          onClick={() => openPasswordReset(u)}
                          title="마스터 전용: 임시 비밀번호 강제 설정"
                        >
                          <KeyRound className="h-3 w-3" /> 비밀번호 변경
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Assign Membership Dialog - Modal-based, no page navigation */}
      <Dialog open={showAssignDialog} onOpenChange={(open) => { if (!open) resetAssignForm(); setShowAssignDialog(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> 프로젝트 소속 부여</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {assignError && (
              <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{assignError}</span>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">사용자 *</Label>
              <Select value={assignUserId} onValueChange={(v) => { setAssignUserId(v); setAssignError(''); }}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="사용자 선택" /></SelectTrigger>
                <SelectContent>
                  {users.filter(u => u.account_status === 'active').map(u => (
                    <SelectItem key={u.user_id} value={u.user_id}>{u.display_name} {u.company ? `(${u.company})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">프로젝트 *</Label>
              <Select value={assignProjectId} onValueChange={(v) => { setAssignProjectId(v); setAssignCompanyId(''); setAssignError(''); }}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">프로젝트 역할 *</Label>
              <Select value={assignRole} onValueChange={(v) => { setAssignRole(v); setAssignError(''); }}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(projectRoleLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">소속 업체 {COMPANY_REQUIRED_ROLES.includes(assignRole) ? '*' : '(선택)'}</Label>
              {assignProjectId ? (
                projectCompanies.length > 0 ? (
                  <Select value={assignCompanyId || '_none'} onValueChange={(v) => { setAssignCompanyId(v === '_none' ? '' : v); setAssignPosition(''); setAssignError(''); }}>
                    <SelectTrigger className="text-xs"><SelectValue placeholder="업체 선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">없음</SelectItem>
                      {projectCompanies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({companyTypeLabel(c.type)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">등록된 업체가 없습니다. 프로젝트 설정 &gt; 업체관리에서 먼저 등록하세요.</p>
                )
              ) : (
                <p className="text-xs text-muted-foreground py-2">프로젝트를 먼저 선택하세요.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">직책 (선택)</Label>
              {(() => {
                const selectedCompany = projectCompanies.find(c => c.id === assignCompanyId);
                const companyType = normalizeCompanyType(selectedCompany?.type) || selectedCompany?.type;
                const allowed = companyType
                  ? (POSITIONS_BY_COMPANY_TYPE[companyType] || Object.keys(positionLabels).filter((k) => k !== 'OWNER_HSE'))
                  : Object.keys(positionLabels).filter((k) => k !== 'OWNER_HSE');
                // 현재 선택값이 허용되지 않으면 표시는 하되 안내
                return (
                  <>
                    <Select
                      value={assignPosition || '_none'}
                      onValueChange={(v) => {
                        const pos = v === '_none' ? '' : v;
                        setAssignPosition(pos);
                        if (pos) setAssignRole(defaultRoleForPosition(pos));
                      }}
                    >
                      <SelectTrigger className="text-xs"><SelectValue placeholder="직책 선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">없음</SelectItem>
                        {allowed.map(k => (
                          <SelectItem key={k} value={k}>{positionLabels[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {companyType === 'client' && (
                      <p className="text-[11px] text-muted-foreground">발주처 직책: PM / CM / SM</p>
                    )}
                    {companyType === 'gc' && (
                      <p className="text-[11px] text-muted-foreground">시공사: 감리와 관리감독자를 구분해 선택하세요.</p>
                    )}
                    {(companyType === 'contractor' || companyType === 'vendor') && (
                      <p className="text-[11px] text-muted-foreground">협력사: 관리감독자·현장소장·안전관리자 등</p>
                    )}
                  </>
                );
              })()}
            </div>

            <Button onClick={handleAssignMembership} className="w-full" disabled={!assignUserId || !assignProjectId || !assignRole || assignSaving}>
              {assignSaving ? '처리 중...' : '소속 부여'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Master-only temporary password override */}
      <Dialog
        open={!!pwdResetUser}
        onOpenChange={(open) => {
          if (!open) {
            setPwdResetUser(null);
            setPwdNew('');
            setPwdConfirm('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              임시 비밀번호 설정
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{pwdResetUser?.display_name || '사용자'}</span>
              의 비밀번호를 마스터 권한으로 즉시 덮어씁니다. 기존 비밀번호 확인 없이 Admin API로 적용됩니다.
            </p>
            <p className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
              8자 이상, 유추가 어려운 조합을 사용하세요. (단순 숫자·흔한 비밀번호는 Auth 보안 정책으로 거부될 수 있습니다.)
            </p>
            <div className="space-y-1">
              <Label className="text-xs">새 임시 비밀번호</Label>
              <Input
                type="password"
                value={pwdNew}
                onChange={(e) => setPwdNew(e.target.value)}
                minLength={8}
                placeholder="8자 이상"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">비밀번호 확인</Label>
              <Input
                type="password"
                value={pwdConfirm}
                onChange={(e) => setPwdConfirm(e.target.value)}
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <Button
              className="w-full"
              disabled={pwdSaving || !pwdNew || !pwdConfirm}
              onClick={handleAdminPasswordReset}
            >
              {pwdSaving ? '저장 중...' : '임시 비밀번호 저장'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
