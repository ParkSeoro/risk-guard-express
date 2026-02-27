import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { companyUpdateSchema, roleChangeSchema, accountStatusSchema } from '@/lib/inputValidation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Users, Search, UserCheck, UserX, Shield } from 'lucide-react';
import IMESafeInput from '@/components/IMESafeInput';

const roleLabels: Record<string, string> = {
  master: '마스터', project_admin: '프로젝트 관리자', safety_manager: '안전관리자',
  contractor: '협력사 담당자', viewer: '열람자',
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
  const { hasRole } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const isMaster = hasRole('master');

  const fetchUsers = async () => {
    setLoading(true);
    const { data: profiles } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    const { data: allRoles } = await supabase.from('user_roles').select('user_id, role');
    const enriched: UserWithRole[] = (profiles || []).map((p: any) => ({
      ...p,
      account_status: p.account_status || 'active',
      roles: (allRoles || []).filter((r: any) => r.user_id === p.user_id).map((r: any) => r.role),
    }));
    setUsers(enriched);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

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
    // Prevent removing last master (client-side guard)
    if (user?.roles.includes('master') && newRole !== 'master') {
      const masterCount = users.filter(u => u.roles.includes('master')).length;
      if (masterCount <= 1) {
        toast({ title: '마지막 마스터는 변경할 수 없습니다.', description: '최소 1명의 마스터가 필요합니다.', variant: 'destructive' });
        setSaving(null);
        return;
      }
    }
    // Validate role
    const parsedRole = roleChangeSchema.safeParse(newRole);
    if (!parsedRole.success) {
      toast({ title: '유효하지 않은 역할입니다.', variant: 'destructive' });
      setSaving(null);
      return;
    }
    // Delete existing roles for this user
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

  const handleCompanyChange = async (userId: string, company: string) => {
    const parsed = companyUpdateSchema.safeParse(company);
    if (!parsed.success) {
      toast({ title: parsed.error.errors[0]?.message || '유효하지 않은 소속입니다.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('profiles').update({ company: parsed.data }).eq('user_id', userId);
    if (error) {
      toast({ title: '소속 변경 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '소속이 변경되었습니다.' });
      log('소속변경', 'profile', userId, undefined, { company });
      fetchUsers();
    }
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
          <p className="text-sm text-muted-foreground mt-1">신규가입 승인, 역할 부여, 계정 활성화/비활성화 (마스터 전용)</p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Shield className="h-3 w-3" /> 승인대기 {users.filter(u => u.account_status === 'pending').length}명
        </Badge>
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
                <th className="text-center">역할</th>
                <th className="text-center w-40">작업</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">로딩 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">사용자가 없습니다.</td></tr>
              ) : filtered.map(u => (
                <tr key={u.id}>
                  <td className="font-medium">{u.display_name}</td>
                  <td>
                    <IMESafeInput
                      defaultValue={u.company || ''}
                      className="h-7 text-xs w-32"
                      onCommit={(val) => handleCompanyChange(u.user_id, val)}
                      placeholder="소속 입력"
                    />
                  </td>
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
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

export default UserManagement;
