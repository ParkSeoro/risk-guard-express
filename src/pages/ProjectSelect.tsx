import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FolderKanban, KeyRound, Send, LogOut, Clock, Plus, Building2 } from 'lucide-react';

const roleLabels: Record<string, string> = {
  project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자',
  contractor: '협력사 담당자',
  viewer: '열람자',
};

const ProjectSelect = () => {
  const { user, signOut, profile, hasRole } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<any[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [joiningCode, setJoiningCode] = useState(false);
  const [requestRole, setRequestRole] = useState('viewer');
  const [requestCompany, setRequestCompany] = useState('');
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Project creation state
  const canCreateProject = hasRole('master') || hasRole('project_admin');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '', site_name: '', period_start: '', period_end: '',
    client: '', status: '진행중',
  });

  const fetchData = async () => {
    if (!user) return;
    const { data: projectData } = await supabase.rpc('list_joinable_projects');
    setProjects(projectData || []);

    const { data: requests } = await supabase
      .from('project_join_requests')
      .select('*, projects(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setMyRequests(requests || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const handleInviteCode = async () => {
    if (!inviteCode.trim() || !user) return;
    setJoiningCode(true);
    try {
      const { data: invite, error: lookupErr } = await supabase
        .from('project_invites')
        .select('*')
        .eq('code', inviteCode.trim())
        .maybeSingle();

      if (!invite || lookupErr) {
        toast({ title: '유효하지 않은 초대코드입니다.', variant: 'destructive' });
        return;
      }
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        toast({ title: '만료된 초대코드입니다.', variant: 'destructive' });
        return;
      }
      if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
        toast({ title: '사용 횟수가 초과된 초대코드입니다.', variant: 'destructive' });
        return;
      }

      const { data: inviteResult, error: inviteRpcErr } = await supabase.rpc('process_invite_code', {
        _user_id: user.id,
        _invite_code: inviteCode.trim(),
      });
      if (inviteRpcErr) {
        toast({ title: '가입 실패', description: inviteRpcErr.message, variant: 'destructive' });
        return;
      }
      const inviteErr = (inviteResult as any)?.error;
      if (inviteErr) {
        const errMap: Record<string, string> = {
          INVALID_CODE: '유효하지 않은 초대코드입니다.',
          EXPIRED: '만료된 초대코드입니다.',
          MAX_USES_EXCEEDED: '사용 횟수가 초과되었습니다.',
        };
        toast({ title: errMap[inviteErr] || '가입 실패', variant: 'destructive' });
        return;
      }

      toast({ title: '프로젝트에 가입되었습니다!' });
      window.location.reload();
    } finally {
      setJoiningCode(false);
    }
  };

  const handleJoinRequest = async (projectId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('project_join_requests')
      .insert([{
        project_id: projectId,
        user_id: user.id,
        requested_role: requestRole as any,
        company_name: requestCompany || profile?.company || '',
      }]);

    if (error) {
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        toast({ title: '이미 가입 요청을 보냈습니다.', variant: 'destructive' });
      } else {
        toast({ title: '요청 실패', description: error.message, variant: 'destructive' });
      }
      return;
    }

    toast({ title: '가입 요청을 보냈습니다. 프로젝트 관리자의 승인을 기다려주세요.' });
    fetchData();
  };

  const handleCreateProject = async () => {
    if (!user || !createForm.name.trim()) {
      toast({ title: '프로젝트명을 입력하세요.', variant: 'destructive' });
      return;
    }
    setCreateLoading(true);
    try {
      const { data, error } = await supabase.from('projects').insert([{
        name: createForm.name.trim(),
        site_name: createForm.site_name.trim(),
        period_start: createForm.period_start || null,
        period_end: createForm.period_end || null,
        client: createForm.client.trim(),
        status: createForm.status,
        created_by: user.id,
      }]).select().single();

      if (error) {
        toast({ title: '프로젝트 생성 실패', description: error.message, variant: 'destructive' });
        return;
      }

      if (data) {
        // Auto-assign creator as project_admin
        const { error: memberError } = await supabase.from('project_members').insert([{
          project_id: data.id,
          user_id: user.id,
          role_new: 'project_admin' as any,
          position_new: 'OWNER_SM' as any,
          company: profile?.company || '',
        }]);

        if (memberError) {
          toast({ title: '프로젝트 생성 완료, 멤버 등록 실패', description: memberError.message, variant: 'destructive' });
        }

        toast({ title: '프로젝트가 생성되었습니다. 시스템에 진입합니다.' });
        // Reload to trigger gate re-check → will now pass and enter dashboard
        window.location.reload();
      }
    } catch (err) {
      toast({ title: '프로젝트 생성 중 오류', description: String(err), variant: 'destructive' });
    } finally {
      setCreateLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <FolderKanban className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">프로젝트 선택</h1>
          <p className="text-sm text-muted-foreground">
            {profile?.display_name}님, 프로젝트에 소속되어야 시스템을 이용할 수 있습니다.
          </p>
        </div>

        {/* Project Creation - only for project_admin / master */}
        {canCreateProject && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" /> 신규 프로젝트 생성
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                프로젝트가 없습니다. 먼저 프로젝트를 생성하세요.
              </p>
            </CardHeader>
            <CardContent>
              {!showCreateForm ? (
                <Button onClick={() => setShowCreateForm(true)} className="w-full gap-2">
                  <Building2 className="h-4 w-4" /> 프로젝트 생성
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">프로젝트명 *</Label>
                      <Input
                        value={createForm.name}
                        onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                        placeholder="예: OO 건설 현장"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">현장명</Label>
                      <Input
                        value={createForm.site_name}
                        onChange={e => setCreateForm(p => ({ ...p, site_name: e.target.value }))}
                        placeholder="현장 위치"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">발주처 *</Label>
                      <Input
                        value={createForm.client}
                        onChange={e => setCreateForm(p => ({ ...p, client: e.target.value }))}
                        placeholder="발주사명"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">상태</Label>
                      <Select value={createForm.status} onValueChange={v => setCreateForm(p => ({ ...p, status: v }))}>
                        <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="진행중">진행중</SelectItem>
                          <SelectItem value="완료">완료</SelectItem>
                          <SelectItem value="보류">보류</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">공사 시작일 *</Label>
                      <Input
                        type="date"
                        value={createForm.period_start}
                        onChange={e => setCreateForm(p => ({ ...p, period_start: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">공사 종료일 *</Label>
                      <Input
                        type="date"
                        value={createForm.period_end}
                        onChange={e => setCreateForm(p => ({ ...p, period_end: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCreateProject}
                      disabled={!createForm.name.trim() || createLoading}
                      className="flex-1"
                    >
                      {createLoading ? '생성 중...' : '프로젝트 생성'}
                    </Button>
                    <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                      취소
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Invite Code */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> 초대코드로 가입
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="초대코드 입력"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleInviteCode} disabled={joiningCode || !inviteCode.trim()}>
                {joiningCode ? '가입 중...' : '가입'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Join Request Config */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">가입 정보 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">희망 역할</Label>
                <Select value={requestRole} onValueChange={setRequestRole}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(roleLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">소속 회사</Label>
                <Input
                  value={requestCompany}
                  onChange={e => setRequestCompany(e.target.value)}
                  placeholder={profile?.company || '회사명'}
                  className="text-xs"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Project List - Request to Join */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Send className="h-4 w-4" /> 프로젝트 가입 요청
            </CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">진행 중인 프로젝트가 없습니다.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {projects.map(p => {
                  const hasRequest = myRequests.some(r => r.project_id === p.id);
                  return (
                    <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div>
                        <span className="text-sm font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{p.site_name}</span>
                      </div>
                      {hasRequest ? (
                        <Badge variant="outline" className="text-[10px] gap-1"><Clock className="h-3 w-3" /> 요청됨</Badge>
                      ) : (
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleJoinRequest(p.id)}>
                          가입 요청
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* My Requests */}
        {myRequests.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">내 가입 요청 현황</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {myRequests.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
                    <span>{(r as any).projects?.name || r.project_id}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        r.status === 'approved' ? 'bg-success/10 text-success' :
                        r.status === 'rejected' ? 'bg-destructive/10 text-destructive' :
                        'bg-warning/10 text-warning'
                      }`}
                    >
                      {r.status === 'pending' ? '대기중' : r.status === 'approved' ? '승인됨' : '거절됨'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Logout */}
        <div className="text-center">
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5" onClick={signOut}>
            <LogOut className="h-3.5 w-3.5" /> 로그아웃
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProjectSelect;
