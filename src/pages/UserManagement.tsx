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
import { Users, Search, UserCheck, UserX, Shield, Plus, Building2, AlertCircle } from 'lucide-react';

const roleLabels: Record<string, string> = {
  master: '마스터', project_admin: '프로젝트 관리자', user: '사용자',
  safety_manager: '안전관리자 (레거시)', contractor: '협력사 (레거시)', viewer: '열람자',
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

  const positionLabels: Record<string, string> = {
    site_manager: '현장대리인',
    supervisor: '관리감독자',
    safety_manager: '안전관리자',
  };

  const isMaster = hasRole('master');

  const fetchUsers = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: allRoles }, { data: allMembers }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('user_roles').select('user_id, role'),
      supabase.from('project_members').select('id, user_id, project_id, role, company_id, company, position'),
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
    const { data } = await supabase.from('projects').select('id, name').order('name');
    setProjects(data || []);
  };

  const fetchProjectCompanies = async (projectId: string) => {
    if (!projectId) { setProjectCompanies([]); return; }
    try {
      const { data, error } = await supabase.from('companies').select('id, name, type').eq('project_id', projectId).order('name');
      if (error) {
        console.warn('Failed to fetch companies:', error.message);
        setProjectCompanies([]);
      } else {
        setProjectCompanies(data || []);
      }
    } catch (err) {
      console.warn('Companies fetch error:', err);
      setProjectCompanies([]);
    }
  };

  useEffect(() => { fetchUsers(); fetchProjects(); }, []);

  useEffect(() => {
    if (assignProjectId) fetchProjectCompanies(assignProjectId);
    else setProjectCompanies([]);
  }, [assignProjectId]);

  const handleStatusChange = async (userId: string, status: string) => {
    const parsed = accountStatusSchema.safeParse(status);
    if (!parsed.success) {
      toast({ title: '유효하지 않은 상태값입니다.', variant: 'destructive' });
      return;
    }
    setSaving(userId);
    const { error } = await supabase.from('profiles').update({ account_status: parsed.data }).eq('user_id', userId);
    if (error) {
      toast({ title: '상태 변경 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `사용자 상태가 '${statusLabels[status]?.label}'(으)로 변경되었습니다.` });
      log('사용자상태변경', 'profile', userId, undefined, { status });
    }
    setSaving(null);
    fetchUsers();
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
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
    const parsedRole = roleChangeSchema.safeParse(newRole);
    if (!parsedRole.success) {
      toast({ title: '유효하지 않은 역할입니다.', variant: 'destructive' });
      setSaving(null);
      return;
    }
    const { error: delError } = await supabase.from('user_roles').delete().eq('user_id', userId);
    if (delError) {
      const msg = delError.message.includes('last master') ? '마지막 마스터 역할은 삭제할 수 없습니다.' : delError.message;
      toast({ title: '역할 삭제 실패', description: msg, variant: 'destructive' });
      setSaving(null);
      return;
    }
    if (parsedRole.data) {
      const { error: insError } = await supabase.from('user_roles').insert([{ user_id: userId, role: parsedRole.data }]);
      if (insError) {
        toast({ title: '역할 변경 실패', description: insError.message, variant: 'destructive' });
        setSaving(null);
        return;
      }
    }
    toast({ title: `역할이 '${roleLabels[newRole] || newRole}'(으)로 변경되었습니다.` });
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

  // Update existing project membership inline
  const handleUpdateMembership = async (membershipId: string, field: string, value: string) => {
    const updateData: Record<string, any> = { [field]: value };
    // If changing company_id, also update company name
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

  const handleAssignMembership = async () => {
    setAssignError('');
    if (!assignUserId || !assignProjectId || !assignRole) {
      setAssignError('사용자, 프로젝트, 역할을 모두 선택해주세요.');
      return;
    }
    if (assignRole === 'contractor' && !assignCompanyId) {
      setAssignError('협력사 담당자는 소속 업체를 반드시 선택해야 합니다.');
      return;
    }
    setAssignSaving(true);
    try {
      const companyName = assignCompanyId ? projectCompanies.find(c => c.id === assignCompanyId)?.name || '' : '';
      const { error } = await supabase.from('project_members').insert([{
        project_id: assignProjectId,
        user_id: assignUserId,
        role: assignRole as any,
        company_id: assignCompanyId || null,
        company: companyName,
        position: assignPosition || '',
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
    if (search) {
      const term = search.toLowerCase();
      return u.display_name.toLowerCase().includes(term) || u.company?.toLowerCase().includes(term);
    }
    return true;
  });

  if (!isMaster) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold">사용자 관리</h1>
        <Card><CardContent className="py-12 text-center text-muted-foreground">마스터 권한이 필요합니다.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" /> 사용자 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">신규가입 승인, 역할 부여, 프로젝트 소속 지정 (마스터 전용)</p>
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

      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="pending">승인대기</SelectItem>
                <SelectItem value="active">활성</SelectItem>
                <SelectItem value="inactive">비활성</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="이름, 회사 검색..." className="h-8 pl-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
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
                <th className="text-center w-40">작업</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">로딩 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">사용자가 없습니다.</td></tr>
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
                    <Select value={u.roles[0] || 'viewer'} onValueChange={v => handleRoleChange(u.user_id, v)}>
                      <SelectTrigger className="h-7 w-28 text-xs mx-auto"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(roleLabels).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td>
                    {memberships.length === 0 ? (
                      <span className="text-xs text-muted-foreground">소속 없음</span>
                    ) : (
                      <div className="space-y-1">
                        {memberships.map((m: any) => {
                          const proj = projects.find(p => p.id === m.project_id);
                          const posLabel = positionLabels[m.position] || m.position;
                          return (
                            <div key={m.id} className="flex items-center gap-1 text-[10px] flex-wrap">
                              <Badge variant="secondary" className="text-[10px] shrink-0">{proj?.name || '프로젝트'}</Badge>
                              <Select value={m.role} onValueChange={(v) => handleUpdateMembership(m.id, 'role', v)}>
                                <SelectTrigger className="h-5 w-20 text-[10px] border-dashed"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                                    <SelectItem key={k} value={k} className="text-[10px]">{v}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select value={m.position || '_none'} onValueChange={(v) => handleUpdateMembership(m.id, 'position', v === '_none' ? '' : v)}>
                                <SelectTrigger className="h-5 w-24 text-[10px] border-dashed"><SelectValue placeholder="직책" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none" className="text-[10px]">직책 없음</SelectItem>
                                  {Object.entries(positionLabels).map(([k, v]) => (
                                    <SelectItem key={k} value={k} className="text-[10px]">{v}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {m.company && <span className="text-muted-foreground">({m.company})</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="text-center">
                    <div className="flex items-center gap-1 justify-center">
                      {u.account_status === 'pending' && (
                        <Button size="sm" variant="outline" className="h-6 text-xs gap-1 text-success" disabled={saving === u.user_id}
                          onClick={() => handleStatusChange(u.user_id, 'active')}>
                          <UserCheck className="h-3 w-3" /> 승인
                        </Button>
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
                  {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">소속 업체 {assignRole === 'contractor' ? '*' : '(선택)'}</Label>
              {assignProjectId ? (
                projectCompanies.length > 0 ? (
                  <Select value={assignCompanyId || '_none'} onValueChange={(v) => { setAssignCompanyId(v === '_none' ? '' : v); setAssignError(''); }}>
                    <SelectTrigger className="text-xs"><SelectValue placeholder="업체 선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">없음</SelectItem>
                      {projectCompanies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({c.type})</SelectItem>
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
              <Select value={assignPosition || '_none'} onValueChange={(v) => setAssignPosition(v === '_none' ? '' : v)}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="직책 선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">없음</SelectItem>
                  {Object.entries(positionLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAssignMembership} className="w-full" disabled={!assignUserId || !assignProjectId || !assignRole || assignSaving}>
              {assignSaving ? '처리 중...' : '소속 부여'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
