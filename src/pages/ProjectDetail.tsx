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
  ArrowLeft, Users, Building2, KeyRound, Plus, Trash2, Copy, Check, UserPlus, Shield, FileCheck, Tag, X, Settings2
} from 'lucide-react';
import { useAuditLog } from '@/hooks/useAuditLog';

const roleLabels: Record<string, string> = {
  master: '마스터', project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자', site_manager: '현장대리인',
  supervisor: '관리감독자', worker: '작업자', viewer: '열람자',
};

const companyTypes: Record<string, string> = {
  client: '발주처', gc: '시공사', contractor: '협력사', vendor: '공급사',
};

const companyTypeOrder: Record<string, number> = {
  client: 0, gc: 1, contractor: 2, vendor: 3,
};

const ProjectDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const isMaster = hasRole('master');
  const { log } = useAuditLog();

  const [project, setProject] = useState<any>(null);
  const [projectRole, setProjectRole] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [showCreateInvite, setShowCreateInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ role: 'contractor' as string, company_id: '' as string, max_uses: 50, expires_days: 7 });
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState('viewer');
  const [memberCompanyId, setMemberCompanyId] = useState('');
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: '', type: 'contractor', business_no: '', contact: '', scope: '', period: '', parent_company_id: '' });
  const [copiedCode, setCopiedCode] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: '', site_name: '', site_address: '', period_start: '', period_end: '',
    client: '', gc_company_id: '', tags: '', status: '진행중',
  });

  // Approval route templates
  const [approvalTemplates, setApprovalTemplates] = useState<any[]>([]);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState<{
    name: string; assessment_type: string; is_default: boolean;
    steps: { step_order: number; step_label: string; position: string; user_id: string; user_name: string; company_name: string }[];
  }>({ name: '기본 결재라인', assessment_type: '정기', is_default: false, steps: [] });
  const [allProfiles, setAllProfiles] = useState<{ user_id: string; display_name: string; company: string; position: string }[]>([]);

  // Environment/Equipment Tags
  const [envTags, setEnvTags] = useState<{ id: string; name: string; category: string }[]>([]);
  const [newTag, setNewTag] = useState('');
  const [tagTab, setTagTab] = useState('environment');

  const canManage = isMaster || projectRole === 'project_admin';

  useEffect(() => {
    if (!projectId || !user) return;
    fetchAll();
  }, [projectId, user]);

  useEffect(() => {
    if (!project) return;
    setProjectForm({
      name: project.name || '',
      site_name: project.site_name || '',
      site_address: project.site_address || '',
      period_start: project.period_start || '',
      period_end: project.period_end || '',
      client: project.client || '',
      gc_company_id: project.gc_company_id || '',
      tags: Array.isArray(project.tags) ? project.tags.join(', ') : '',
      status: project.status || '진행중',
    });
  }, [project]);

  const fetchAll = async () => {
    if (!projectId || !user) return;

    const [projRes, membersRes, profilesRes, companiesRes, invitesRes, requestsRes, templatesRes, tagsRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('project_members').select('*').eq('project_id', projectId),
      supabase.from('profiles').select('user_id, display_name, company, phone, position'),
      supabase.from('companies').select('*').eq('project_id', projectId).order('name'),
      supabase.from('project_invites').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_join_requests').select('*, profiles:user_id(display_name, company)').eq('project_id', projectId).eq('status', 'pending'),
      supabase.from('approval_route_templates' as any).select('*').eq('project_id', projectId).order('created_at'),
      supabase.from('environment_tags' as any).select('*').or(`project_id.eq.${projectId},project_id.is.null`).order('created_at'),
    ]);

    setProject(projRes.data);
    setMembers(membersRes.data || []);
    setProfiles(profilesRes.data || []);
    setAllProfiles((profilesRes.data || []) as any);
    setCompanies(companiesRes.data || []);
    setInvites(invitesRes.data || []);
    setJoinRequests(requestsRes.data || []);
    setApprovalTemplates((templatesRes.data || []) as any);
    setEnvTags((tagsRes.data || []) as any);

    // Get user's role in this project
    if (isMaster) {
      setProjectRole('master');
    } else {
      const myMembership = (membersRes.data || []).find((m: any) => m.user_id === user!.id);
      setProjectRole(myMembership?.role_new || null);
    }
  };

  const getProfileName = (userId: string) => {
    const p = profiles.find(pr => pr.user_id === userId);
    return p?.display_name || userId.slice(0, 8);
  };

  const handleUpdateProjectInfo = async () => {
    if (!projectId || !canManage) return;
    if (!projectForm.name.trim()) {
      toast({ title: '프로젝트명을 입력해주세요.', variant: 'destructive' });
      return;
    }

    setSavingProject(true);
    let geocodeFailed = false;

    try {
      const updateData: any = {
        name: projectForm.name.trim(),
        site_name: projectForm.site_name.trim(),
        site_address: projectForm.site_address.trim() || null,
        period_start: projectForm.period_start || null,
        period_end: projectForm.period_end || null,
        client: projectForm.client.trim() || null,
        gc_company_id: projectForm.gc_company_id || null,
        tags: projectForm.tags.split(',').map(s => s.trim()).filter(Boolean),
        status: projectForm.status,
      };

      if (projectForm.site_address.trim()) {
        try {
          const { data: geoData, error: geoError } = await supabase.functions.invoke('fetch-weather', {
            body: { project_id: '__geocode__', address: projectForm.site_address.trim(), geocode_only: true },
          });

          if (geoError) throw geoError;

          if (geoData?.lat && geoData?.lng) {
            updateData.site_lat = geoData.lat;
            updateData.site_lng = geoData.lng;
          } else {
            geocodeFailed = true;
          }
        } catch {
          geocodeFailed = true;
        }
      } else {
        updateData.site_lat = null;
        updateData.site_lng = null;
      }

      const { error } = await supabase.from('projects').update(updateData).eq('id', projectId);
      if (error) throw error;

      toast({
        title: '프로젝트 기본정보가 저장되었습니다.',
        description: geocodeFailed ? '주소는 저장되었지만 좌표 변환에 실패했습니다. 주소를 다시 확인해주세요.' : undefined,
      });
      fetchAll();
    } catch (error: any) {
      toast({ title: '저장 실패', description: error.message || String(error), variant: 'destructive' });
    } finally {
      setSavingProject(false);
    }
  };

  const handleAddMember = async () => {
    if (!projectId || !memberUserId) return;
    if (['site_manager', 'supervisor', 'worker'].includes(memberRole) && !memberCompanyId) {
      toast({ title: '현장/감독/작업자 역할은 소속 업체를 선택해야 합니다.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('project_members').insert([{
      project_id: projectId, user_id: memberUserId, role_new: memberRole as any,
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
    const admins = members.filter(m => m.role_new === 'project_admin');
    const target = members.find(m => m.id === memberId);
    if (target?.role_new === 'project_admin' && admins.length <= 1) {
      toast({ title: '프로젝트 관리자가 최소 1명 필요합니다.', variant: 'destructive' });
      return;
    }
    const reason = prompt('멤버 제거 사유를 입력하세요. (필수)');
    if (!reason || !reason.trim()) return;
    await supabase.from('project_members').delete().eq('id', memberId);
    await log('멤버 제거', 'project_member', memberId, projectId || undefined, { reason, removed_user_id: target?.user_id, role: target?.role_new });
    toast({ title: '멤버가 제거되었습니다.' });
    fetchAll();
  };

  const handleChangeRole = async (memberId: string, newRole: string) => {
    const target = members.find(m => m.id === memberId);
    if (target?.role_new === 'project_admin' && newRole !== 'project_admin') {
      const admins = members.filter(m => m.role_new === 'project_admin');
      if (admins.length <= 1) {
        toast({ title: '프로젝트 관리자가 최소 1명 필요합니다.', variant: 'destructive' });
        return;
      }
    }
    await supabase.from('project_members').update({ role_new: newRole as any }).eq('id', memberId);
    fetchAll();
  };

  const handleCreateInvite = async () => {
    if (!projectId || !user) return;
    const code = crypto.randomUUID().split('-')[0].toUpperCase();
    const insertData: any = {
      project_id: projectId,
      code,
      default_role: inviteForm.role as any,
      created_by: user.id,
      expires_at: new Date(Date.now() + inviteForm.expires_days * 24 * 60 * 60 * 1000).toISOString(),
      max_uses: inviteForm.max_uses,
    };
    if (inviteForm.company_id) {
      insertData.company_id = inviteForm.company_id;
    }
    const { error } = await supabase.from('project_invites').insert([insertData]);
    if (error) toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    else {
      const link = `${window.location.origin}/auth?invite=${code}`;
      toast({ title: '초대코드가 생성되었습니다.', description: `코드: ${code}` });
      setShowCreateInvite(false);
      fetchAll();
    }
  };

  const handleDeleteInvite = async (id: string) => {
    await supabase.from('project_invites').delete().eq('id', id);
    await log('초대코드 삭제', 'project_invite', id, projectId || undefined);
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
    // Enforce hierarchy: contractor must have a parent GC
    if (companyForm.type === 'contractor' && !companyForm.parent_company_id) {
      const gcCompanies = companies.filter(c => c.type === 'gc');
      if (gcCompanies.length > 0) {
        toast({ title: '협력사는 반드시 상위 시공사를 선택해야 합니다.', variant: 'destructive' });
        return;
      }
    }
    const insertData: any = {
      project_id: projectId,
      name: companyForm.name,
      type: companyForm.type,
      business_no: companyForm.business_no,
      contact: companyForm.contact,
      scope: companyForm.scope,
      period: companyForm.period,
    };
    if (companyForm.parent_company_id) {
      insertData.parent_company_id = companyForm.parent_company_id;
    }
    const { error } = await supabase.from('companies').insert([insertData]);
    if (error) toast({ title: '추가 실패', description: error.message, variant: 'destructive' });
    else {
      toast({ title: '업체가 등록되었습니다.' });
      setShowAddCompany(false);
      setCompanyForm({ name: '', type: 'contractor', business_no: '', contact: '', scope: '', period: '', parent_company_id: '' });
      fetchAll();
    }
  };

  const handleDeleteCompany = async (id: string) => {
    const reason = prompt('업체 삭제 사유를 입력하세요. (필수)');
    if (!reason || !reason.trim()) return;
    const target = companies.find(c => c.id === id);
    const { error } = await supabase.from('companies').delete().eq('id', id);
    if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); return; }
    await log('업체 삭제', 'company', id, projectId || undefined, { reason, name: target?.name, type: target?.type });
    toast({ title: '업체가 삭제되었습니다.' });
    fetchAll();
  };

  const STEP_LABEL_OPTIONS = [
    { label: '작성', position: 'supervisor' },
    { label: '안전관리자 검토', position: 'safety_manager' },
    { label: '현장대리인 확인', position: 'site_manager' },
    { label: '최종승인', position: 'project_admin' },
  ];

  const POSITION_LABELS: Record<string, string> = {
    supervisor: '관리감독자', safety_manager: '안전관리자',
    site_manager: '현장대리인', project_admin: '프로젝트 관리자',
  };

  const openNewTemplate = () => {
    setEditingTemplateId(null);
    const myProfile = allProfiles.find(p => p.user_id === user?.id);
    const myMember = members.find(m => m.user_id === user?.id);
    const authorStep = {
      step_order: 0,
      step_label: '작성',
      position: 'supervisor',
      user_id: user?.id || '',
      user_name: myProfile?.display_name || '',
      company_name: myMember?.company || myProfile?.company || '',
    };
    setTemplateForm({ name: '기본 결재라인', assessment_type: '정기', is_default: false, steps: [authorStep] });
    setShowAddTemplate(true);
  };

  const openEditTemplate = (t: any) => {
    setEditingTemplateId(t.id);
    const steps = (Array.isArray(t.steps) ? t.steps : []).map((s: any, i: number) => ({
      step_order: i, step_label: s.step_label || s.role || '', position: s.position || '',
      user_id: s.user_id || '', user_name: s.user_name || s.name || '', company_name: s.company_name || '',
    }));
    setTemplateForm({ name: t.name, assessment_type: t.assessment_type, is_default: t.is_default, steps });
    setShowAddTemplate(true);
  };

  const addTemplateStep = () => {
    setTemplateForm(prev => ({
      ...prev,
      steps: [...prev.steps, { step_order: prev.steps.length, step_label: '', position: '', user_id: '', user_name: '', company_name: '' }],
    }));
  };

  const removeTemplateStep = (idx: number) => {
    setTemplateForm(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }));
  };

  const updateTemplateStep = (idx: number, field: string, value: string) => {
    setTemplateForm(prev => {
      const steps = [...prev.steps];
      steps[idx] = { ...steps[idx], [field]: value };
      if (field === 'step_label') {
        const opt = STEP_LABEL_OPTIONS.find(o => o.label === value);
        if (opt) steps[idx].position = opt.position;
      }
      if (field === 'user_id' && value) {
        const member = members.find(m => m.user_id === value);
        const profile = allProfiles.find(p => p.user_id === value);
        steps[idx].user_name = profile?.display_name || '';
        steps[idx].company_name = member?.company || profile?.company || '';
      }
      return { ...prev, steps };
    });
  };

  const handleSaveTemplate = async () => {
    if (!projectId || !user) return;
    if (!templateForm.name.trim()) {
      toast({ title: '결재라인 이름을 입력해주세요.', variant: 'destructive' });
      return;
    }
    const payload = {
      project_id: projectId,
      name: templateForm.name,
      assessment_type: templateForm.assessment_type,
      is_default: templateForm.is_default,
      steps: templateForm.steps.map((s, i) => ({ ...s, step_order: i })),
      created_by: user.id,
    };

    if (editingTemplateId) {
      const { error } = await supabase.from('approval_route_templates').update(payload as any).eq('id', editingTemplateId);
      if (error) { toast({ title: '수정 실패', description: error.message, variant: 'destructive' }); return; }
      toast({ title: '결재라인이 수정되었습니다.' });
    } else {
      const { error } = await supabase.from('approval_route_templates').insert([payload] as any);
      if (error) { toast({ title: '추가 실패', description: error.message, variant: 'destructive' }); return; }
      toast({ title: '결재라인이 추가되었습니다.' });
    }
    setShowAddTemplate(false);
    setEditingTemplateId(null);
    fetchAll();
  };

  const handleDeleteTemplate = async (id: string) => {
    await supabase.from('approval_route_templates').delete().eq('id', id);
    await log('결재라인 삭제', 'approval_route_template', id, projectId || undefined);
    toast({ title: '결재라인이 삭제되었습니다.' });
    fetchAll();
  };

  // Tag Management
  const handleAddTag = async () => {
    if (!newTag.trim() || !projectId) return;
    await supabase.from('environment_tags' as any).insert({
      project_id: projectId, name: newTag.trim(), category: tagTab,
    });
    setNewTag('');
    fetchAll();
    toast({ title: '태그가 추가되었습니다.' });
  };

  const handleDeleteTag = async (id: string) => {
    await supabase.from('environment_tags' as any).update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || null,
    }).eq('id', id);
    await log('태그 삭제', 'environment_tag', id, projectId || undefined);
    fetchAll();
    toast({ title: '태그가 삭제되었습니다.' });
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
          <TabsTrigger value="basic-info" className="gap-1.5"><Settings2 className="h-3.5 w-3.5" /> 기본정보</TabsTrigger>
          <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" /> 멤버/권한</TabsTrigger>
          <TabsTrigger value="companies" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> 업체 관리</TabsTrigger>
          <TabsTrigger value="approval-routes" className="gap-1.5"><FileCheck className="h-3.5 w-3.5" /> 결재라인</TabsTrigger>
          <TabsTrigger value="tags" className="gap-1.5"><Tag className="h-3.5 w-3.5" /> 태그 마스터</TabsTrigger>
          <TabsTrigger value="invites" className="gap-1.5"><KeyRound className="h-3.5 w-3.5" /> 초대</TabsTrigger>
        </TabsList>

        {/* Basic Info Tab */}
        <TabsContent value="basic-info" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm">프로젝트 기본정보</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">프로젝트 생성 항목과 동일한 정보를 여기서 수정할 수 있습니다.</p>
              </div>
              {canManage && (
                <Button size="sm" className="text-xs" onClick={handleUpdateProjectInfo} disabled={savingProject || !projectForm.name.trim()}>
                  {savingProject ? '저장 중...' : '저장'}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">현장주소를 저장하면 프로젝트 기준 날씨가 자동으로 연동됩니다.</p>
                {typeof project.site_lat === 'number' && typeof project.site_lng === 'number' && (
                  <p className="text-xs text-muted-foreground mt-1">저장된 좌표: {project.site_lat.toFixed(6)}, {project.site_lng.toFixed(6)}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>프로젝트명 *</Label>
                  <Input value={projectForm.name} onChange={e => setProjectForm(prev => ({ ...prev, name: e.target.value }))} disabled={!canManage} />
                </div>
                <div className="space-y-1.5">
                  <Label>현장명</Label>
                  <Input value={projectForm.site_name} onChange={e => setProjectForm(prev => ({ ...prev, site_name: e.target.value }))} disabled={!canManage} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>현장주소 (날씨 자동 연동)</Label>
                  <Input
                    value={projectForm.site_address}
                    onChange={e => setProjectForm(prev => ({ ...prev, site_address: e.target.value }))}
                    placeholder="예: 전라남도 여수시 화학단지로 123"
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>시작일</Label>
                  <Input type="date" value={projectForm.period_start} onChange={e => setProjectForm(prev => ({ ...prev, period_start: e.target.value }))} disabled={!canManage} />
                </div>
                <div className="space-y-1.5">
                  <Label>종료일</Label>
                  <Input type="date" value={projectForm.period_end} onChange={e => setProjectForm(prev => ({ ...prev, period_end: e.target.value }))} disabled={!canManage} />
                </div>
                <div className="space-y-1.5">
                  <Label>발주사</Label>
                  <Input value={projectForm.client} onChange={e => setProjectForm(prev => ({ ...prev, client: e.target.value }))} disabled={!canManage} />
                </div>
                <div className="space-y-1.5">
                  <Label>시공사 (등록 업체 선택)</Label>
                  <Select value={projectForm.gc_company_id || '__none__'} onValueChange={v => setProjectForm(prev => ({ ...prev, gc_company_id: v === '__none__' ? '' : v }))} disabled={!canManage}>
                    <SelectTrigger><SelectValue placeholder="시공사 선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">미지정</SelectItem>
                      {companies.filter(c => c.type === 'gc').map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>공종 태그 (쉼표 구분)</Label>
                <Input value={projectForm.tags} onChange={e => setProjectForm(prev => ({ ...prev, tags: e.target.value }))} placeholder="6000t Tank, Cooling Tower, 배관" disabled={!canManage} />
              </div>

              <div className="space-y-1.5">
                <Label>상태</Label>
                <Select value={projectForm.status} onValueChange={v => setProjectForm(prev => ({ ...prev, status: v }))} disabled={!canManage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="진행중">진행중</SelectItem>
                    <SelectItem value="완료">완료</SelectItem>
                    <SelectItem value="보류">보류</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

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

        {/* Companies Tab - Tree Structure */}
        <TabsContent value="companies" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">업체 목록 (발주처 → 시공사 → 협력사)</CardTitle>
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
                <div className="space-y-1">
                  {/* Render tree: top-level (no parent) sorted by type */}
                  {(() => {
                    const topLevel = companies
                      .filter(c => !c.parent_company_id)
                      .sort((a, b) => (companyTypeOrder[a.type] || 99) - (companyTypeOrder[b.type] || 99));
                    const getChildren = (parentId: string) =>
                      companies.filter(c => c.parent_company_id === parentId)
                        .sort((a, b) => (companyTypeOrder[a.type] || 99) - (companyTypeOrder[b.type] || 99));

                    const renderCompany = (c: any, depth: number) => (
                      <div key={c.id}>
                        <div className={`flex items-center justify-between p-2.5 rounded-lg border ${depth === 0 ? '' : depth === 1 ? 'ml-6 border-l-2 border-l-primary/30' : 'ml-12 border-l-2 border-l-accent/30'}`}>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              {depth > 0 && <span className="text-muted-foreground text-xs">└</span>}
                              <span className="text-sm font-medium">{c.name}</span>
                              <Badge variant="outline" className={`text-[10px] ${c.type === 'client' ? 'border-primary/50 text-primary' : c.type === 'gc' ? 'border-accent/50 text-accent' : ''}`}>
                                {companyTypes[c.type] || c.type}
                              </Badge>
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
                        {getChildren(c.id).map(child => renderCompany(child, depth + 1))}
                      </div>
                    );

                    return topLevel.map(c => renderCompany(c, 0));
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tags Tab */}
        <TabsContent value="tags" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">환경/장비 태그 마스터</CardTitle>
                <div className="flex gap-2">
                  <Button variant={tagTab === 'environment' ? 'default' : 'outline'} size="sm" onClick={() => setTagTab('environment')}>환경 태그</Button>
                  <Button variant={tagTab === 'equipment' ? 'default' : 'outline'} size="sm" onClick={() => setTagTab('equipment')}>장비 태그</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="태그 이름 입력..." />
                  <Button onClick={handleAddTag} disabled={!newTag.trim()}>추가</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {envTags.filter(t => t.category === tagTab).map(t => (
                    <Badge key={t.id} variant="secondary" className="px-2 py-1 gap-1">
                      {t.name}
                      {!(t as any).project_id ? (
                        <span className="text-[9px] opacity-50 ml-1">(시스템)</span>
                      ) : (
                        <X className="h-3 w-3 cursor-pointer hover:text-destructive" onClick={() => handleDeleteTag(t.id)} />
                      )}
                    </Badge>
                  ))}
                  {envTags.filter(t => t.category === tagTab).length === 0 && (
                    <p className="text-sm text-muted-foreground">등록된 태그가 없습니다.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approval Routes Tab */}
        <TabsContent value="approval-routes" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">결재라인 템플릿</CardTitle>
              {canManage && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={openNewTemplate}>
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
                    return (
                      <div key={t.id} className="p-3 rounded-lg border space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-sm">{t.name} <Badge variant="outline" className="text-[10px] ml-1">{t.assessment_type}</Badge></span>
                          <div className="flex items-center gap-1">
                            {t.is_default && <Badge className="text-[10px]">기본값</Badge>}
                            {canManage && (
                              <>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditTemplate(t)}>
                                  <Shield className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDeleteTemplate(t.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {steps.length === 0 ? '(단계 없음)' : steps.map((s: any, i: number) => (
                            <span key={i}>{i > 0 && ' → '}{s.step_label || s.role}{s.user_name || s.name ? ` (${s.user_name || s.name})` : ''}</span>
                          ))}
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">초대코드 관리</CardTitle>
              {canManage && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowCreateInvite(true)}>
                  <Plus className="h-3.5 w-3.5" /> 초대코드 생성
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {invites.map((inv: any) => {
                  const linkedCompany = companies.find(c => c.id === (inv as any).company_id);
                  const inviteLink = `${window.location.origin}/auth?invite=${inv.code}`;
                  return (
                    <div key={inv.id} className="p-3 rounded-lg border space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-base">{inv.code}</span>
                          <Badge variant="outline" className="text-[10px]">{roleLabels[inv.default_role]}</Badge>
                          {linkedCompany && <Badge variant="secondary" className="text-[10px]">{linkedCompany.name}</Badge>}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                            navigator.clipboard.writeText(inviteLink);
                            setCopiedCode(inv.code);
                            setTimeout(() => setCopiedCode(''), 2000);
                            toast({ title: '초대 링크가 복사되었습니다.' });
                          }}>
                            {copiedCode === inv.code ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleDeleteInvite(inv.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        사용 {inv.use_count}/{inv.max_uses} · 만료: {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('ko-KR') : '없음'}
                      </div>
                    </div>
                  );
                })}
                {invites.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">생성된 초대코드가 없습니다.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Member Dialog */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader><DialogTitle>멤버 추가</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>사용자 선택</Label>
              <Select onValueChange={setMemberUserId}>
                <SelectTrigger><SelectValue placeholder="사용자 선택" /></SelectTrigger>
                <SelectContent>
                  {allProfiles.filter(p => !members.some(m => m.user_id === p.user_id)).map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.display_name} ({p.company})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>권한</Label>
              <Select value={memberRole} onValueChange={setMemberRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {memberRole === 'contractor' && (
              <div className="space-y-2">
                <Label>소속 업체</Label>
                <Select onValueChange={setMemberCompanyId}>
                  <SelectTrigger><SelectValue placeholder="업체 선택" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={handleAddMember} className="w-full">추가</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Company Dialog */}
      <Dialog open={showAddCompany} onOpenChange={setShowAddCompany}>
        <DialogContent>
          <DialogHeader><DialogTitle>업체 등록</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="업체명" value={companyForm.name} onChange={e => setCompanyForm({ ...companyForm, name: e.target.value })} />
            <div className="space-y-1.5">
              <Label className="text-xs">업체 구분</Label>
              <Select value={companyForm.type} onValueChange={v => setCompanyForm({ ...companyForm, type: v, parent_company_id: '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(companyTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* Parent company selection - required for contractor */}
            {(companyForm.type === 'contractor') && (
              <div className="space-y-1.5">
                <Label className="text-xs">상위 시공사 {companyForm.type === 'contractor' && <span className="text-destructive">*필수</span>}</Label>
                <Select value={companyForm.parent_company_id || '__none__'} onValueChange={v => setCompanyForm({ ...companyForm, parent_company_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="상위 업체 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(선택 안 함)</SelectItem>
                    {companies.filter(c => c.type === 'gc').map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name} (시공사)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {companies.filter(c => c.type === 'gc').length === 0 && (
                  <p className="text-[10px] text-warning">시공사가 없습니다. 먼저 시공사를 등록하세요.</p>
                )}
              </div>
            )}
            {companyForm.type === 'gc' && (
              <div className="space-y-1.5">
                <Label className="text-xs">상위 발주처 (선택)</Label>
                <Select value={companyForm.parent_company_id || '__none__'} onValueChange={v => setCompanyForm({ ...companyForm, parent_company_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="상위 업체 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(선택 안 함)</SelectItem>
                    {companies.filter(c => c.type === 'client').map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name} (발주처)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Input placeholder="사업자등록번호 (선택)" value={companyForm.business_no} onChange={e => setCompanyForm({ ...companyForm, business_no: e.target.value })} />
            <Input placeholder="연락처 (선택)" value={companyForm.contact} onChange={e => setCompanyForm({ ...companyForm, contact: e.target.value })} />
            <Input placeholder="공사범위 (선택)" value={companyForm.scope} onChange={e => setCompanyForm({ ...companyForm, scope: e.target.value })} />
            <Button onClick={handleAddCompany} className="w-full">등록</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Invite Dialog */}
      <Dialog open={showCreateInvite} onOpenChange={setShowCreateInvite}>
        <DialogContent>
          <DialogHeader><DialogTitle>초대코드 생성</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>권한</Label>
              <Select value={inviteForm.role} onValueChange={v => setInviteForm({ ...inviteForm, role: v, company_id: '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>연결 업체 <span className="text-muted-foreground font-normal text-xs">(선택)</span></Label>
              <Select value={inviteForm.company_id || '__none__'} onValueChange={v => setInviteForm({ ...inviteForm, company_id: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="업체 선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(업체 연결 안 함)</SelectItem>
                  {companies
                    .filter(c => {
                      if (inviteForm.role === 'contractor') return c.type === 'contractor';
                      if (inviteForm.role === 'safety_manager' || inviteForm.role === 'project_admin') return c.type === 'gc';
                      return true;
                    })
                    .map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({companyTypes[c.type] || c.type})</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">가입 시 자동으로 해당 업체 소속으로 설정됩니다.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>최대 사용 횟수</Label>
                <Input type="number" min={1} value={inviteForm.max_uses} onChange={e => setInviteForm({ ...inviteForm, max_uses: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="space-y-1.5">
                <Label>유효기간 (일)</Label>
                <Input type="number" min={1} value={inviteForm.expires_days} onChange={e => setInviteForm({ ...inviteForm, expires_days: parseInt(e.target.value) || 7 })} />
              </div>
            </div>
            <Button onClick={handleCreateInvite} className="w-full">초대코드 생성</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Approval Template Dialog */}
      <Dialog open={showAddTemplate} onOpenChange={(open) => { setShowAddTemplate(open); if (!open) setEditingTemplateId(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingTemplateId ? '결재라인 수정' : '결재라인 추가'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>결재라인 이름</Label>
              <Input value={templateForm.name} onChange={e => setTemplateForm(prev => ({ ...prev, name: e.target.value }))} placeholder="예: 기본 결재라인" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>평가 유형</Label>
                <Select value={templateForm.assessment_type} onValueChange={v => setTemplateForm(prev => ({ ...prev, assessment_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="최초">최초평가</SelectItem>
                    <SelectItem value="정기">정기평가</SelectItem>
                    <SelectItem value="수시">수시평가</SelectItem>
                    <SelectItem value="상시">상시평가</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-0.5">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={templateForm.is_default} onChange={e => setTemplateForm(prev => ({ ...prev, is_default: e.target.checked }))} className="rounded" />
                  기본값으로 설정
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>결재 단계</Label>
                <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={addTemplateStep}>
                  <Plus className="h-3 w-3" /> 단계 추가
                </Button>
              </div>
              {templateForm.steps.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">단계를 추가해주세요.</p>
              )}
              {templateForm.steps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                  <span className="text-xs font-medium w-6 text-center">{idx + 1}</span>
                  <Select value={step.step_label} onValueChange={v => updateTemplateStep(idx, 'step_label', v)}>
                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="구분 선택" /></SelectTrigger>
                    <SelectContent>
                      {STEP_LABEL_OPTIONS.map(o => (
                        <SelectItem key={o.label} value={o.label}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={step.user_id || '__none__'} onValueChange={v => updateTemplateStep(idx, 'user_id', v === '__none__' ? '' : v)}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="결재자 선택">{step.user_name || '(미지정)'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(미지정)</SelectItem>
                      {members.map(m => {
                        const profile = allProfiles.find(p => p.user_id === m.user_id);
                        const name = profile?.display_name || m.user_id.slice(0, 8);
                        return (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {name} {m.company ? `(${m.company})` : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                    {POSITION_LABELS[step.position] || step.position || '미지정'}
                  </Badge>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeTemplateStep(idx)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            <Button onClick={handleSaveTemplate} className="w-full">
              {editingTemplateId ? '수정' : '추가'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectDetail;
