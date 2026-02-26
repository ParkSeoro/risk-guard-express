import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, Building2, Users, Tag, Plus, Pencil, Trash2, UserPlus, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Database } from "@/integrations/supabase/types";

type ProjectRow = Database['public']['Tables']['projects']['Row'];
type MemberRow = Database['public']['Tables']['project_members']['Row'];

const roleLabels: Record<string, string> = {
  master: '마스터',
  project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자',
  contractor: '협력사 담당자',
  viewer: '열람자',
};

const Projects = () => {
  const { user, isAdmin } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showMembers, setShowMembers] = useState<string | null>(null);
  const [members, setMembers] = useState<(MemberRow & { profile?: { display_name: string; company: string } })[]>([]);
  const [profiles, setProfiles] = useState<{ user_id: string; display_name: string; company: string }[]>([]);
  const [editProject, setEditProject] = useState<ProjectRow | null>(null);
  const [form, setForm] = useState({
    name: '', site_name: '', period_start: '', period_end: '',
    client: '', contractor: '', subcontractors: '', tags: '', status: '진행중'
  });
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<string>('viewer');
  const [loading, setLoading] = useState(true);

  const fetchProjects = async () => {
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
    setProjects(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('projects').insert([{
      name: form.name,
      site_name: form.site_name,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      client: form.client,
      contractor: form.contractor,
      subcontractors: form.subcontractors.split(',').map(s => s.trim()).filter(Boolean),
      tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
      status: form.status,
      created_by: user.id,
    }]).select().single();
    if (error) {
      toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
      return;
    }
    if (data) {
      // Auto-add creator as project_admin
      await supabase.from('project_members').insert([{
        project_id: data.id,
        user_id: user.id,
        role: 'project_admin' as any,
      }]);
      toast({ title: '프로젝트가 생성되었습니다.' });
      log('생성', 'project', data.id);
      setShowCreate(false);
      setForm({ name: '', site_name: '', period_start: '', period_end: '', client: '', contractor: '', subcontractors: '', tags: '', status: '진행중' });
      fetchProjects();
    }
  };

  const handleUpdate = async () => {
    if (!editProject) return;
    const { error } = await supabase.from('projects').update({
      name: form.name,
      site_name: form.site_name,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      client: form.client,
      contractor: form.contractor,
      subcontractors: form.subcontractors.split(',').map(s => s.trim()).filter(Boolean),
      tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
      status: form.status,
    }).eq('id', editProject.id);
    if (!error) {
      toast({ title: '프로젝트가 수정되었습니다.' });
      log('수정', 'project', editProject.id);
      setEditProject(null);
      fetchProjects();
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('projects').delete().eq('id', id);
    toast({ title: '프로젝트가 삭제되었습니다.' });
    log('삭제', 'project', id);
    fetchProjects();
  };

  const openEdit = (p: ProjectRow) => {
    setEditProject(p);
    setForm({
      name: p.name, site_name: p.site_name, period_start: p.period_start || '',
      period_end: p.period_end || '', client: p.client || '', contractor: p.contractor || '',
      subcontractors: (p.subcontractors || []).join(', '), tags: (p.tags || []).join(', '), status: p.status,
    });
  };

  const openMembers = async (projectId: string) => {
    setShowMembers(projectId);
    const { data: memberData } = await supabase.from('project_members').select('*').eq('project_id', projectId);
    if (memberData) {
      // Fetch profiles for member user_ids
      const userIds = memberData.map(m => m.user_id);
      const { data: profileData } = await supabase.from('profiles').select('user_id, display_name, company').in('user_id', userIds);
      const enriched = memberData.map(m => ({
        ...m,
        profile: (profileData || []).find(p => p.user_id === m.user_id) as any,
      }));
      setMembers(enriched);
    }
    // Fetch all profiles for invite dropdown
    const { data: allProfiles } = await supabase.from('profiles').select('user_id, display_name, company');
    setProfiles(allProfiles || []);
  };

  const handleAddMember = async () => {
    if (!showMembers) return;
    // Find user by email or display_name
    const target = profiles.find(p => p.display_name === memberEmail || p.user_id === memberEmail);
    if (!target) {
      toast({ title: '사용자를 찾을 수 없습니다.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('project_members').insert([{
      project_id: showMembers,
      user_id: target.user_id,
      role: memberRole as any,
    }]);
    if (error) {
      toast({ title: error.message, variant: 'destructive' });
    } else {
      toast({ title: '멤버가 추가되었습니다.' });
      openMembers(showMembers);
      setMemberEmail('');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    await supabase.from('project_members').delete().eq('id', memberId);
    if (showMembers) openMembers(showMembers);
    toast({ title: '멤버가 제거되었습니다.' });
  };

  const handleChangeMemberRole = async (memberId: string, newRole: string) => {
    await supabase.from('project_members').update({ role: newRole as any }).eq('id', memberId);
    if (showMembers) openMembers(showMembers);
  };

  const ProjectForm = ({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel: string }) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>프로젝트명</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required /></div>
        <div className="space-y-1"><Label>현장명</Label><Input value={form.site_name} onChange={e => setForm(p => ({ ...p, site_name: e.target.value }))} /></div>
        <div className="space-y-1"><Label>시작일</Label><Input type="date" value={form.period_start} onChange={e => setForm(p => ({ ...p, period_start: e.target.value }))} /></div>
        <div className="space-y-1"><Label>종료일</Label><Input type="date" value={form.period_end} onChange={e => setForm(p => ({ ...p, period_end: e.target.value }))} /></div>
        <div className="space-y-1"><Label>발주사</Label><Input value={form.client} onChange={e => setForm(p => ({ ...p, client: e.target.value }))} /></div>
        <div className="space-y-1"><Label>시공사</Label><Input value={form.contractor} onChange={e => setForm(p => ({ ...p, contractor: e.target.value }))} /></div>
      </div>
      <div className="space-y-1"><Label>협력사 (쉼표 구분)</Label><Input value={form.subcontractors} onChange={e => setForm(p => ({ ...p, subcontractors: e.target.value }))} placeholder="(주)대한배관, (주)우리용접" /></div>
      <div className="space-y-1"><Label>공종 태그 (쉼표 구분)</Label><Input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} placeholder="6000t Tank, Cooling Tower, 배관" /></div>
      <div className="space-y-1">
        <Label>상태</Label>
        <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="진행중">진행중</SelectItem>
            <SelectItem value="완료">완료</SelectItem>
            <SelectItem value="보류">보류</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={onSubmit} className="w-full">{submitLabel}</Button>
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">프로젝트 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">현장/공사 프로젝트 목록</p>
        </div>
        {isAdmin() && (
          <Button size="sm" className="gap-1.5" onClick={() => { setShowCreate(true); setForm({ name: '', site_name: '', period_start: '', period_end: '', client: '', contractor: '', subcontractors: '', tags: '', status: '진행중' }); }}>
            <Plus className="h-3.5 w-3.5" /> 프로젝트 생성
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-12">로딩 중...</p>
      ) : projects.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">등록된 프로젝트가 없습니다.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {projects.map(project => (
            <Card key={project.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-3 flex-1">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold cursor-pointer hover:text-accent" onClick={() => navigate(`/risk-assessment/${project.id}`)}>
                          {project.name}
                        </h2>
                        <Badge className={`text-[10px] ${project.status === '진행중' ? 'bg-success text-success-foreground' : project.status === '완료' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                          {project.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{project.site_name}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" /><span>{project.period_start} ~ {project.period_end}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" /><span>발주사: {project.client}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-3.5 w-3.5" /><span>시공사: {project.contractor}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-3.5 w-3.5" /><span>협력사: {(project.subcontractors || []).join(', ')}</span>
                      </div>
                    </div>
                    {(project.tags || []).length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        {(project.tags || []).map(tag => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openMembers(project.id)}>
                      <Shield className="h-4 w-4" />
                    </Button>
                    {isAdmin() && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(project)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(project.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>프로젝트 생성</DialogTitle></DialogHeader>
          <ProjectForm onSubmit={handleCreate} submitLabel="생성" />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editProject} onOpenChange={() => setEditProject(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>프로젝트 수정</DialogTitle></DialogHeader>
          <ProjectForm onSubmit={handleUpdate} submitLabel="저장" />
        </DialogContent>
      </Dialog>

      {/* Members Dialog */}
      <Dialog open={!!showMembers} onOpenChange={() => setShowMembers(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>프로젝트 멤버 관리</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Current members */}
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <div className="text-sm">
                    <span className="font-medium">{m.profile?.display_name || m.user_id}</span>
                    {m.profile?.company && <span className="text-muted-foreground ml-2">({m.profile.company})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={m.role} onValueChange={v => handleChangeMemberRole(m.id, v)}>
                      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(roleLabels).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveMember(m.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {members.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">등록된 멤버가 없습니다.</p>}
            </div>
            {/* Add member */}
            <div className="border-t pt-3 space-y-2">
              <Label className="flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" /> 멤버 초대</Label>
              <div className="flex gap-2">
                <Select value={memberEmail} onValueChange={setMemberEmail}>
                  <SelectTrigger className="flex-1 text-xs"><SelectValue placeholder="사용자 선택" /></SelectTrigger>
                  <SelectContent>
                    {profiles.filter(p => !members.some(m => m.user_id === p.user_id)).map(p => (
                      <SelectItem key={p.user_id} value={p.user_id}>{p.display_name} {p.company ? `(${p.company})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={memberRole} onValueChange={setMemberRole}>
                  <SelectTrigger className="w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(roleLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleAddMember}>추가</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Projects;
