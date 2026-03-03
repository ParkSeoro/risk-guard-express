import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft, Users, Building2, KeyRound, Plus, Trash2, Copy, Check, UserPlus, Shield, FileCheck
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

const roleLabels: Record<string, string> = {
  master: '마스터', project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자', contractor: '협력사 담당자', viewer: '열람자',
};

const companyTypes: Record<string, string> = {
  client: '발주사', gc: '시공사(원청)', contractor: '협력사', vendor: '공급사',
};

const ProjectDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const isMaster = hasRole('master');

  const [project, setProject] = useState<any>(null);
  const [projectRole, setProjectRole] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState('viewer');
  const [memberCompanyId, setMemberCompanyId] = useState('');
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: '', type: 'contractor', business_no: '', contact: '', scope: '', period: '' });
  const [copiedCode, setCopiedCode] = useState('');

  // Approval route templates
  const [approvalTemplates, setApprovalTemplates] = useState<any[]>([]);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '기본 결재라인', assessment_type: '정기', is_default: false, reviewers: '' as string, approvers: '' as string });
  const [allProfiles, setAllProfiles] = useState<{ user_id: string; display_name: string; company: string; position: string }[]>([]);

  const canManage = isMaster || projectRole === 'project_admin';

  useEffect(() => {
    if (!projectId || !user) return;
    fetchAll();
  }, [projectId, user]);

  const fetchAll = async () => {
    if (!projectId || !user) return;

    const [projRes, membersRes, profilesRes, companiesRes, invitesRes, requestsRes, templatesRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('project_members').select('*').eq('project_id', projectId),
      supabase.from('profiles').select('user_id, display_name, company, phone, position'),
      supabase.from('companies').select('*').eq('project_id', projectId).order('name'),
      supabase.from('project_invites').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_join_requests').select('*, profiles:user_id(display_name, company)').eq('project_id', projectId).eq('status', 'pending'),
      supabase.from('approval_route_templates' as any).select('*').eq('project_id', projectId).order('created_at'),
    ]);

    setProject(projRes.data);
    setMembers(membersRes.data || []);
    setProfiles(profilesRes.data || []);
    setAllProfiles((profilesRes.data || []) as any);
    setCompanies(companiesRes.data || []);
    setInvites(invitesRes.data || []);
    setJoinRequests(requestsRes.data || []);
    setApprovalTemplates((templatesRes.data || []) as any);

    // Get user's role in this project
    if (isMaster) {
      setProjectRole('master');
    } else {
      const myMembership = (membersRes.data || []).find((m: any) => m.user_id === user!.id);
      setProjectRole(myMembership?.role || null);
    }
  };

  const getProfileName = (userId: string) => {
    const p = profiles.find(pr => pr.user_id === userId);
    return p?.display_name || userId.slice(0, 8);
  };

  const handleAddMember = async () => {
    if (!projectId || !memberUserId) return;
    if (memberRole === 'contractor' && !memberCompanyId) {
      toast({ title: '협력사 담당자는 소속 업체를 선택해야 합니다.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('project_members').insert([{
      project_id: projectId, user_id: memberUserId, role: memberRole as any,
      company_id: memberCompanyId || null,
    }]);
    if (error) {
      toast({ title: '추가 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '멤버가 추가되었습니다.' });
      setShowAddMember(false);
      setMemberUserId('');
      setMemberCompanyId('');
      fetchAll();
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    // Prevent removing last project_admin
    const admins = members.filter(m => m.role === 'project_admin');
    const target = members.find(m => m.id === memberId);
    if (target?.role === 'project_admin' && admins.length <= 1) {
      toast({ title: '프로젝트 관리자가 최소 1명 필요합니다.', variant: 'destructive' });
      return;
    }
    await supabase.from('project_members').delete().eq('id', memberId);
    toast({ title: '멤버가 제거되었습니다.' });
    fetchAll();
  };

  const handleChangeRole = async (memberId: string, newRole: string) => {
    const target = members.find(m => m.id === memberId);
    if (target?.role === 'project_admin' && newRole !== 'project_admin') {
      const admins = members.filter(m => m.role === 'project_admin');
      if (admins.length <= 1) {
        toast({ title: '프로젝트 관리자가 최소 1명 필요합니다.', variant: 'destructive' });
        return;
      }
    }
    await supabase.from('project_members').update({ role: newRole as any }).eq('id', memberId);
    fetchAll();
  };

  const handleCreateInvite = async (role: string) => {
    if (!projectId || !user) return;
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const { error } = await supabase.from('project_invites').insert([{
      project_id: projectId,
      code,
      default_role: role as any,
      created_by: user.id,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      max_uses: 50,
    }]);
    if (error) toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    else {
      toast({ title: '초대코드가 생성되었습니다.', description: `코드: ${code}` });
      fetchAll();
    }
  };

  const handleDeleteInvite = async (id: string) => {
    await supabase.from('project_invites').delete().eq('id', id);
    fetchAll();
  };

  const handleApproveRequest = async (reqId: string, userId: string, role: string) => {
    // Add as member
    await supabase.from('project_members').insert([{
      project_id: projectId!, user_id: userId, role: role as any,
    }]);
    // Update request
    await supabase.from('project_join_requests').update({
      status: 'approved', reviewed_by: user!.id, reviewed_at: new Date().toISOString(),
    }).eq('id', reqId);
    toast({ title: '가입 요청을 승인했습니다.' });
    fetchAll();
  };

  const handleRejectRequest = async (reqId: string) => {
    await supabase.from('project_join_requests').update({
      status: 'rejected', reviewed_by: user!.id, reviewed_at: new Date().toISOString(),
    }).eq('id', reqId);
    toast({ title: '가입 요청을 거절했습니다.' });
    fetchAll();
  };

  const handleAddCompany = async () => {
    if (!projectId) return;
    const { error } = await supabase.from('companies').insert([{
      project_id: projectId, ...companyForm,
    }]);
    if (error) toast({ title: '추가 실패', description: error.message, variant: 'destructive' });
    else {
      toast({ title: '업체가 등록되었습니다.' });
      setShowAddCompany(false);
      setCompanyForm({ name: '', type: 'contractor', business_no: '', contact: '', scope: '', period: '' });
      fetchAll();
    }
  };

  const handleDeleteCompany = async (id: string) => {
    await supabase.from('companies').delete().eq('id', id);
    toast({ title: '업체가 삭제되었습니다.' });
    fetchAll();
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(''), 2000);
  };

  if (!project) return <div className="p-8 text-center text-muted-foreground">로딩 중...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/projects')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{project.name}</h1>
          <p className="text-xs text-muted-foreground">{project.site_name}</p>
        </div>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" /> 멤버/권한</TabsTrigger>
          <TabsTrigger value="companies" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> 업체 관리</TabsTrigger>
          <TabsTrigger value="approval-routes" className="gap-1.5"><FileCheck className="h-3.5 w-3.5" /> 결재라인</TabsTrigger>
          <TabsTrigger value="invites" className="gap-1.5"><KeyRound className="h-3.5 w-3.5" /> 초대</TabsTrigger>
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members" className="space-y-4">
          {/* Join Requests */}
          {canManage && joinRequests.length > 0 && (
            <Card className="border-warning/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-warning">가입 요청 ({joinRequests.length}건)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {joinRequests.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between p-2 rounded bg-warning/5 border border-warning/20">
                    <div className="text-sm">
                      <span className="font-medium">{r.profiles?.display_name || r.user_id.slice(0, 8)}</span>
                      <span className="text-muted-foreground ml-2">{r.company_name}</span>
                      <Badge variant="outline" className="text-[10px] ml-2">{roleLabels[r.requested_role]}</Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleApproveRequest(r.id, r.user_id, r.requested_role)}>
                        승인
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleRejectRequest(r.id)}>
                        거절
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Current Members */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">프로젝트 멤버 ({members.length}명)</CardTitle>
              {canManage && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowAddMember(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> 멤버 추가
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {members.map(m => (
                  <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg border">
                    <div className="text-sm">
                      <span className="font-medium">{getProfileName(m.user_id)}</span>
                      {m.company && <span className="text-muted-foreground ml-2">({m.company})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {canManage ? (
                        <>
                          <Select value={m.role} onValueChange={v => handleChangeRole(m.id, v)}>
                            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveMember(m.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">{roleLabels[m.role]}</Badge>
                      )}
                    </div>
                  </div>
                ))}
                {members.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">멤버가 없습니다.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Companies Tab */}
        <TabsContent value="companies" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">업체 목록</CardTitle>
              {canManage && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowAddCompany(true)}>
                  <Plus className="h-3.5 w-3.5" /> 업체 등록
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {companies.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">등록된 업체가 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {companies.map(c => (
                    <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{c.name}</span>
                          <Badge variant="outline" className="text-[10px]">{companyTypes[c.type] || c.type}</Badge>
                        </div>
                        {(c.scope || c.contact) && (
                          <p className="text-xs text-muted-foreground">
                            {c.scope && `공사범위: ${c.scope}`}
                            {c.contact && ` · 연락처: ${c.contact}`}
                          </p>
                        )}
                      </div>
                      {canManage && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteCompany(c.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approval Routes Tab */}
        <TabsContent value="approval-routes" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">결재라인 템플릿</CardTitle>
              {canManage && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => {
                  setTemplateForm({ name: '기본 결재라인', assessment_type: '정기', is_default: false, reviewers: '', approvers: '' });
                  setShowAddTemplate(true);
                }}>
                  <Plus className="h-3.5 w-3.5" /> 결재라인 추가
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {approvalTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">등록된 결재라인이 없습니다. 결재라인을 추가하면 회차 생성 시 자동으로 결재자가 채워집니다.</p>
              ) : (
                <div className="space-y-2">
                  {approvalTemplates.map((t: any) => {
                    const steps = Array.isArray(t.steps) ? t.steps : [];
                    const reviewers = steps.filter((s: any) => s.role === '검토자');
                    const approvers = steps.filter((s: any) => s.role === '승인자');
                    return (
                      <div key={t.id} className="p-3 rounded-lg border space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{t.name}</span>
                            <Badge variant="outline" className="text-[10px]">{t.assessment_type}</Badge>
                            {t.is_default && <Badge variant="secondary" className="text-[10px]">기본</Badge>}
                          </div>
                          {canManage && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={async () => {
                              await supabase.from('approval_route_templates' as any).delete().eq('id', t.id);
                              fetchAll();
                              toast({ title: '결재라인이 삭제되었습니다.' });
                            }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium">검토자:</span>{' '}
                            {reviewers.length > 0 ? reviewers.map((r: any) => r.name).join(', ') : '미지정'}
                          </div>
                          <div>
                            <span className="font-medium">승인자:</span>{' '}
                            {approvers.length > 0 ? approvers.map((a: any) => a.name).join(', ') : '미지정'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Invites Tab */}
        <TabsContent value="invites" className="space-y-4">
          {canManage && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">초대코드 생성</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                    <Button key={k} size="sm" variant="outline" className="text-xs" onClick={() => handleCreateInvite(k)}>
                      <Plus className="h-3 w-3 mr-1" /> {v} 초대코드
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">발급된 초대코드</CardTitle>
            </CardHeader>
            <CardContent>
              {invites.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">발급된 초대코드가 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {invites.map(inv => (
                    <div key={inv.id} className="flex items-center justify-between p-2.5 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{inv.code}</code>
                        <Badge variant="secondary" className="text-[10px]">{roleLabels[inv.default_role]}</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          사용 {inv.use_count}/{inv.max_uses || '∞'}
                        </span>
                        {inv.expires_at && new Date(inv.expires_at) < new Date() && (
                          <Badge variant="destructive" className="text-[10px]">만료됨</Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(inv.code)}>
                          {copiedCode === inv.code ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        {canManage && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteInvite(inv.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Member Dialog */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>멤버 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">사용자</Label>
              <Select value={memberUserId} onValueChange={setMemberUserId}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="사용자 선택" /></SelectTrigger>
                <SelectContent>
                  {profiles.filter(p => !members.some(m => m.user_id === p.user_id)).map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.display_name} {p.company ? `(${p.company})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">역할</Label>
              <Select value={memberRole} onValueChange={setMemberRole}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">소속 업체 {memberRole === 'contractor' ? '*' : '(선택)'}</Label>
              {companies.length > 0 ? (
                <Select value={memberCompanyId} onValueChange={setMemberCompanyId}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="업체 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">없음</SelectItem>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({companyTypes[c.type] || c.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">등록된 업체가 없습니다.</p>
              )}
            </div>
            <Button onClick={handleAddMember} className="w-full" disabled={!memberUserId || (memberRole === 'contractor' && !memberCompanyId)}>추가</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Company Dialog */}
      <Dialog open={showAddCompany} onOpenChange={setShowAddCompany}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>업체 등록</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">업체명</Label>
                <Input value={companyForm.name} onChange={e => setCompanyForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">유형</Label>
                <Select value={companyForm.type} onValueChange={v => setCompanyForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(companyTypes).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">사업자등록번호</Label>
                <Input value={companyForm.business_no} onChange={e => setCompanyForm(p => ({ ...p, business_no: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">연락처</Label>
                <Input value={companyForm.contact} onChange={e => setCompanyForm(p => ({ ...p, contact: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">공사범위</Label>
              <Input value={companyForm.scope} onChange={e => setCompanyForm(p => ({ ...p, scope: e.target.value }))} />
            </div>
            <Button onClick={handleAddCompany} className="w-full" disabled={!companyForm.name.trim()}>등록</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Approval Route Template Dialog */}
      <Dialog open={showAddTemplate} onOpenChange={setShowAddTemplate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>결재라인 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">템플릿명</Label>
                <Input value={templateForm.name} onChange={e => setTemplateForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">평가 유형</Label>
                <Select value={templateForm.assessment_type} onValueChange={v => setTemplateForm(p => ({ ...p, assessment_type: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['정기', '수시', '최초', '상시'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">검토자 (이름, 콤마로 구분)</Label>
              <Textarea value={templateForm.reviewers} onChange={e => setTemplateForm(p => ({ ...p, reviewers: e.target.value }))} placeholder="홍길동, 김철수" rows={2} className="text-xs" />
              {templateForm.reviewers && (
                <div className="flex gap-1 flex-wrap mt-1">
                  {templateForm.reviewers.split(',').map(n => n.trim()).filter(Boolean).map((n, i) => {
                    const matched = allProfiles.find(p => p.display_name === n);
                    return <Badge key={i} variant={matched ? 'secondary' : 'outline'} className="text-[10px]">{n}{matched ? ` (${matched.company || ''})` : ' ⚠ 미등록'}</Badge>;
                  })}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">승인자 (이름, 콤마로 구분)</Label>
              <Textarea value={templateForm.approvers} onChange={e => setTemplateForm(p => ({ ...p, approvers: e.target.value }))} placeholder="박대리, 이과장" rows={2} className="text-xs" />
              {templateForm.approvers && (
                <div className="flex gap-1 flex-wrap mt-1">
                  {templateForm.approvers.split(',').map(n => n.trim()).filter(Boolean).map((n, i) => {
                    const matched = allProfiles.find(p => p.display_name === n);
                    return <Badge key={i} variant={matched ? 'secondary' : 'outline'} className="text-[10px]">{n}{matched ? ` (${matched.company || ''})` : ' ⚠ 미등록'}</Badge>;
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_default" checked={templateForm.is_default} onChange={e => setTemplateForm(p => ({ ...p, is_default: e.target.checked }))} />
              <Label htmlFor="is_default" className="text-xs">기본 결재라인으로 설정</Label>
            </div>
            <Button onClick={async () => {
              if (!projectId || !user) return;
              const reviewerNames = templateForm.reviewers.split(',').map(n => n.trim()).filter(Boolean);
              const approverNames = templateForm.approvers.split(',').map(n => n.trim()).filter(Boolean);
              if (reviewerNames.length === 0 || approverNames.length === 0) {
                toast({ title: '검토자와 승인자를 각각 1명 이상 지정하세요.', variant: 'destructive' });
                return;
              }
              const steps = [
                ...reviewerNames.map(name => ({ role: '검토자', name, user_id: allProfiles.find(p => p.display_name === name)?.user_id || null })),
                ...approverNames.map(name => ({ role: '승인자', name, user_id: allProfiles.find(p => p.display_name === name)?.user_id || null })),
              ];
              // If setting as default, unset other defaults for same type
              if (templateForm.is_default) {
                await supabase.from('approval_route_templates' as any).update({ is_default: false } as any).eq('project_id', projectId).eq('assessment_type', templateForm.assessment_type);
              }
              const { error } = await supabase.from('approval_route_templates' as any).insert([{
                project_id: projectId,
                name: templateForm.name,
                assessment_type: templateForm.assessment_type,
                is_default: templateForm.is_default,
                steps,
                created_by: user.id,
              }] as any);
              if (error) {
                toast({ title: '추가 실패', description: error.message, variant: 'destructive' });
              } else {
                toast({ title: '결재라인이 추가되었습니다.' });
                setShowAddTemplate(false);
                fetchAll();
              }
            }} className="w-full" disabled={!templateForm.name.trim()}>등록</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectDetail;
