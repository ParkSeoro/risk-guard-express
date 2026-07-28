import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, CheckCircle2, XCircle, Users } from 'lucide-react';

interface UserInfo {
  user_id: string;
  display_name: string;
  company: string;
  account_status: string;
  systemRoles: string[];
  effectiveRoles: string[];
  projectMemberships: { project_id: string; project_name: string; role: string }[];
}

const roleLabels: Record<string, string> = {
  master: '마스터', project_admin: '프로젝트 관리자', safety_manager: '안전관리자',
  site_manager: '현장소장', supervisor: '감리/감독', contractor: '협력사 담당자', worker: '작업자', viewer: '열람자',
};

// SSOT: useProjectAccess.PERMISSION_MATRIX 와 일치
const ALL_PROJECT_ROLES = ['master', 'project_admin', 'safety_manager', 'site_manager', 'supervisor', 'worker', 'contractor', 'viewer'];
const OPERATOR_ROLES = ['master', 'project_admin', 'safety_manager', 'site_manager', 'supervisor', 'worker', 'contractor'];
const ADMIN_ROLES = ['master', 'project_admin', 'safety_manager'];

const menuPermissions: { menu: string; roles: string[]; description: string }[] = [
  { menu: '대시보드', roles: ALL_PROJECT_ROLES, description: '모든 역할 접근 가능' },
  { menu: '프로젝트', roles: ALL_PROJECT_ROLES, description: '프로젝트 멤버만 조회' },
  { menu: '위험성평가', roles: OPERATOR_ROLES.concat(['viewer']), description: '열람자는 조회만' },
  { menu: '검증센터', roles: ADMIN_ROLES, description: '안전관리자 이상만 검증 실행' },
  { menu: '전자결재', roles: ALL_PROJECT_ROLES, description: '열람 가능, 결재는 권한별' },
  { menu: 'TBM 기록', roles: OPERATOR_ROLES.concat(['viewer']), description: '전 멤버 조회 · 협력사 이상 작성' },
  { menu: '사용자 관리', roles: ['master', 'project_admin'], description: '마스터/프로젝트 관리자' },
  { menu: '기준정보', roles: ADMIN_ROLES, description: '안전관리자 이상' },
  { menu: '감사 로그', roles: ADMIN_ROLES, description: '안전관리자 이상' },
  { menu: '권한 점검', roles: ['master'], description: '마스터 전용' },
];

const actionPermissions: { action: string; roles: string[] }[] = [
  { action: '위험성평가 항목 수정', roles: OPERATOR_ROLES },
  { action: '위험성평가 제출', roles: OPERATOR_ROLES },
  { action: '검증 실행', roles: ADMIN_ROLES },
  { action: '결재 상신', roles: OPERATOR_ROLES },
  { action: '결재 승인/반려', roles: ['master', 'project_admin', 'safety_manager', 'site_manager', 'supervisor'] },
  { action: '사용자 승인/역할 변경', roles: ['master', 'project_admin'] },
  { action: '프로젝트 생성/삭제', roles: ['master', 'project_admin'] },
  { action: '기준정보 수정', roles: ADMIN_ROLES },
  { action: 'PDF/XLSX 다운로드', roles: ALL_PROJECT_ROLES },
];

const normalizeRole = (role: string | null | undefined) => {
  if (!role) return '';
  if (role === 'worker') return 'contractor';
  return role;
};

const PermissionTest = () => {
  const { hasRole } = useAuth();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(true);

  const isMaster = hasRole('master');

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const { data: profiles } = await supabase.from('profiles').select('*');
      const { data: allRoles } = await supabase.from('user_roles').select('user_id, role');
      const { data: members } = await supabase
        .from('project_members')
        .select('user_id, project_id, role_new' as any);
      const { data: projects } = await supabase.from('projects').select('id, name').eq('is_deleted', false);

      const projectMap = new Map((projects || []).map(p => [p.id, p.name]));

      const enriched: UserInfo[] = (profiles || []).map((p: any) => {
        const systemRoles = (allRoles || [])
          .filter((r: any) => r.user_id === p.user_id)
          .map((r: any) => normalizeRole(r.role))
          .filter(Boolean);
        const memberships = (members || [])
          .filter((m: any) => m.user_id === p.user_id)
          .map((m: any) => ({
            project_id: m.project_id,
            project_name: projectMap.get(m.project_id) || m.project_id,
            role: normalizeRole(m.role_new) || 'viewer',
          }));
        // 전역 역할 + 프로젝트 역할을 합쳐 실제 메뉴 접근 권한을 판정
        const combined = Array.from(new Set([
          ...systemRoles,
          ...memberships.map(m => m.role),
        ])).filter(Boolean);
        return {
          user_id: p.user_id,
          display_name: p.display_name,
          company: p.company || '',
          account_status: p.account_status || 'active',
          systemRoles,
          effectiveRoles: combined,
          projectMemberships: memberships,
        };
      });
      setUsers(enriched);
      if (enriched.length > 0) setSelectedUserId(enriched[0].user_id);
      setLoading(false);
    };
    fetch();
  }, []);

  const selectedUser = users.find(u => u.user_id === selectedUserId);

  if (!isMaster) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold">권한 점검</h1>
        <Card><CardContent className="py-12 text-center text-muted-foreground">마스터 권한이 필요합니다.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6" /> 권한 점검 (마스터 전용)</h1>
        <p className="text-sm text-muted-foreground mt-1">사용자별 접근 가능 메뉴/기능 확인 · RLS 기반 서버측 강제</p>
      </div>

      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="h-8 w-80 text-xs"><SelectValue placeholder="사용자 선택" /></SelectTrigger>
              <SelectContent>
                {users.map(u => (
                  <SelectItem key={u.user_id} value={u.user_id}>
                    {u.display_name} ({u.company || '소속 없음'}) — {u.effectiveRoles.map(r => roleLabels[r] || r).join(', ') || '역할 없음'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedUser && (
        <>
          {/* User Info */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">사용자 정보</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-4 text-sm">
                <div><span className="text-muted-foreground text-xs">이름</span><p className="font-medium">{selectedUser.display_name}</p></div>
                <div><span className="text-muted-foreground text-xs">소속</span><p>{selectedUser.company || '—'}</p></div>
                <div><span className="text-muted-foreground text-xs">계정 상태</span><p><Badge variant="outline" className="text-[10px]">{selectedUser.account_status}</Badge></p></div>
                <div><span className="text-muted-foreground text-xs">전역 역할</span><p>{selectedUser.systemRoles.map(r => <Badge key={r} variant="outline" className="text-[10px] mr-1">{roleLabels[r] || r}</Badge>)}{selectedUser.systemRoles.length === 0 && <span className="text-muted-foreground">없음</span>}</p></div>
                <div><span className="text-muted-foreground text-xs">적용 역할</span><p>{selectedUser.effectiveRoles.map(r => <Badge key={r} variant="outline" className="text-[10px] mr-1">{roleLabels[r] || r}</Badge>)}{selectedUser.effectiveRoles.length === 0 && <span className="text-muted-foreground">없음</span>}</p></div>
              </div>
              {selectedUser.projectMemberships.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <span className="text-muted-foreground text-xs">프로젝트 멤버십</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedUser.projectMemberships.map((m, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{m.project_name}: {roleLabels[m.role] || m.role}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Menu Access */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">메뉴 접근 권한</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1">
                {menuPermissions.map(mp => {
                  const hasAccess = selectedUser.effectiveRoles.some(r => mp.roles.includes(r));
                  return (
                    <div key={mp.menu} className={`flex items-center justify-between p-2 rounded text-sm ${hasAccess ? 'bg-success/5' : 'bg-destructive/5'}`}>
                      <div className="flex items-center gap-2">
                        {hasAccess ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                        <span className="font-medium">{mp.menu}</span>
                        <span className="text-xs text-muted-foreground">({mp.description})</span>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${hasAccess ? 'text-success' : 'text-destructive'}`}>
                        {hasAccess ? '접근 가능' : '접근 불가'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Action Permissions */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">기능별 권한</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1">
                {actionPermissions.map(ap => {
                  const hasAccess = selectedUser.effectiveRoles.some(r => ap.roles.includes(r));
                  return (
                    <div key={ap.action} className={`flex items-center justify-between p-2 rounded text-sm ${hasAccess ? 'bg-success/5' : 'bg-destructive/5'}`}>
                      <div className="flex items-center gap-2">
                        {hasAccess ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                        <span>{ap.action}</span>
                      </div>
                      <div className="flex gap-1">
                        {ap.roles.map(r => (
                          <Badge key={r} variant="outline" className={`text-[9px] ${selectedUser.effectiveRoles.includes(r) ? 'bg-success/10 text-success' : ''}`}>
                            {roleLabels[r] || r}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* RLS Note */}
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">
                ※ 위 체크리스트는 <strong>서버측 RLS 정책</strong>에 의해 강제됩니다. UI에서 메뉴를 숨기는 것만이 아니라,
                데이터베이스 레벨에서 <code>has_role()</code>, <code>is_project_member()</code>, <code>is_admin()</code> 함수를 통해
                모든 SELECT/INSERT/UPDATE/DELETE 쿼리에 역할 기반 접근 제어가 적용됩니다.
                협력사 사용자는 자기 회사 데이터만 조회/수정 가능하며, 열람자는 수정/제출/결재/검증이 불가합니다.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default PermissionTest;
