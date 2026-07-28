import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useToast } from "@/hooks/use-toast";
import { useSoftDelete } from "@/hooks/useSoftDelete";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, Building2, Users, Tag, Plus, Pencil, Trash2, Shield, ChevronDown } from "lucide-react";

import { useNavigate } from "react-router-dom";
import type { Database } from "@/integrations/supabase/types";

type ProjectRow = Database['public']['Tables']['projects']['Row'];

const Projects = () => {
  const { user, isAdmin } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editProject, setEditProject] = useState<ProjectRow | null>(null);
  const [loading, setLoading] = useState(true);

  // All companies across projects for selection
  const [allCompanies, setAllCompanies] = useState<{ id: string; name: string; project_id: string; type: string }[]>([]);
  const [companyNameMap, setCompanyNameMap] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: '', site_name: '', site_address: '', period_start: '', period_end: '',
    client: '', gc_company_ids: [] as string[], sub_company_ids: [] as string[],
    tags: '', status: '진행중'
  });

  const fetchProjects = async () => {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });
    setProjects(data || []);
    setLoading(false);
  };

  const fetchCompanies = async () => {
    const { data } = await supabase.from('companies').select('id, name, project_id, type').eq('is_deleted', false).order('name');
    setAllCompanies(data || []);
    const map: Record<string, string> = {};
    (data || []).forEach(c => { map[c.id] = c.name; });
    setCompanyNameMap(map);
  };

  useEffect(() => { fetchProjects(); fetchCompanies(); }, []);

  const gcCompanies = allCompanies.filter(c => c.type === 'gc');
  const subCompanies = allCompanies.filter(c => c.type === 'contractor' || c.type === 'subcontractor');


  const [createLoading, setCreateLoading] = useState(false);

  const handleCreate = async () => {
    if (!user) {
      toast({ title: '로그인이 필요합니다.', variant: 'destructive' });
      return;
    }
    if (!form.name.trim()) {
      toast({ title: '프로젝트명을 입력하세요.', variant: 'destructive' });
      return;
    }
    setCreateLoading(true);
    try {
      const insertData: any = {
        name: form.name.trim(),
        site_name: form.site_name.trim(),
        site_address: form.site_address.trim() || null,
        period_start: form.period_start || null,
        period_end: form.period_end || null,
        client: form.client.trim(),
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
        status: form.status,
        created_by: user.id,
      };

      // Geocode address to coordinates
      if (form.site_address.trim()) {
        try {
          const { data: geoData } = await supabase.functions.invoke("fetch-weather", {
            body: { project_id: '__geocode__', address: form.site_address.trim(), geocode_only: true },
          });
          if (geoData?.lat && geoData?.lng) {
            insertData.site_lat = geoData.lat;
            insertData.site_lng = geoData.lng;
          }
        } catch { /* geocoding is best-effort */ }
      }
      // Multi-select arrays
      insertData.gc_company_ids = form.gc_company_ids;
      insertData.sub_company_ids = form.sub_company_ids;
      // Keep legacy single column in sync with first selected GC for backward compat
      if (form.gc_company_ids[0]) insertData.gc_company_id = form.gc_company_ids[0];


      const { data, error } = await supabase.from('projects').insert([insertData]).select().single();
      if (error) {
        console.error('Project creation error:', error);
        toast({ title: '프로젝트 생성 실패', description: `${error.message} (${error.code || ''})`, variant: 'destructive' });
        setCreateLoading(false);
        return;
      }
      if (data) {
        // Add creator as project_admin
        const { error: memberError } = await supabase.from('project_members').insert([{
          project_id: data.id,
          user_id: user.id,
          role_new: 'project_admin' as any,
          position_new: 'OWNER_HSE' as any,
        }]);
        if (memberError) {
          console.error('Project member insert error:', memberError);
          toast({ title: '프로젝트는 생성되었으나 멤버 등록 실패', description: memberError.message, variant: 'destructive' });
        }
        toast({ title: '프로젝트가 생성되었습니다.' });
        log('생성', 'project', data.id);
        setShowCreate(false);
        resetForm();
        // Navigate to project detail for onboarding
        navigate(`/project/${data.id}`);
      }
    } catch (err) {
      toast({ title: '프로젝트 생성 중 오류', description: String(err), variant: 'destructive' });
    }
    setCreateLoading(false);
  };

  const handleUpdate = async () => {
    if (!editProject) return;
    const updateData: any = {
      name: form.name,
      site_name: form.site_name,
      site_address: form.site_address.trim() || null,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      client: form.client,
      gc_company_id: form.gc_company_ids[0] || null,
      gc_company_ids: form.gc_company_ids,
      sub_company_ids: form.sub_company_ids,
      tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
      status: form.status,
    };


    // Geocode address if changed
    if (form.site_address.trim()) {
      try {
        const { data: geoData } = await supabase.functions.invoke("fetch-weather", {
          body: { project_id: '__geocode__', address: form.site_address.trim(), geocode_only: true },
        });
        if (geoData?.lat && geoData?.lng) {
          updateData.site_lat = geoData.lat;
          updateData.site_lng = geoData.lng;
        }
      } catch { /* best-effort */ }
    }

    const { error } = await supabase.from('projects').update(updateData).eq('id', editProject.id);
    if (!error) {
      toast({ title: '프로젝트가 수정되었습니다.' });
      log('수정', 'project', editProject.id);
      setEditProject(null);
      fetchProjects();
    }
  };

  const { softDelete } = useSoftDelete();
  const handleDelete = async (id: string) => {
    const target = projects.find(p => p.id === id);
    const r = await softDelete('projects', id, { label: `프로젝트 "${target?.name || ''}"`, projectId: id });
    if (r.ok) fetchProjects();
  };

  const resetForm = () => setForm({ name: '', site_name: '', site_address: '', period_start: '', period_end: '', client: '', gc_company_ids: [], sub_company_ids: [], tags: '', status: '진행중' });

  const openEdit = (p: ProjectRow) => {
    setEditProject(p);
    const gcIds = ((p as any).gc_company_ids as string[] | null) || [];
    const subIds = ((p as any).sub_company_ids as string[] | null) || [];
    const legacyGc = (p as any).gc_company_id;
    setForm({
      name: p.name, site_name: p.site_name,
      site_address: (p as any).site_address || '',
      period_start: p.period_start || '',
      period_end: p.period_end || '', client: p.client || '',
      gc_company_ids: gcIds.length ? gcIds : (legacyGc ? [legacyGc] : []),
      sub_company_ids: subIds,
      tags: (p.tags || []).join(', '), status: p.status,
    });
  };

  const getGcName = (project: ProjectRow) => {
    const ids = ((project as any).gc_company_ids as string[] | null) || [];
    const legacy = (project as any).gc_company_id;
    const all = ids.length ? ids : (legacy ? [legacy] : []);
    const names = all.map(id => companyNameMap[id]).filter(Boolean);
    if (names.length) return names.join(', ');
    if (project.contractor) return project.contractor;
    return '—';
  };

  const getSubNames = (project: ProjectRow) => {
    const ids = ((project as any).sub_company_ids as string[] | null) || [];
    return ids.map(id => companyNameMap[id]).filter(Boolean);
  };

  const toggleId = (key: 'gc_company_ids' | 'sub_company_ids', id: string) => {
    setForm(p => ({
      ...p,
      [key]: p[key].includes(id) ? p[key].filter(x => x !== id) : [...p[key], id],
    }));
  };

  const MultiCompanyPicker = ({ label, options, selected, onToggle, emptyHint }: {
    label: string; options: { id: string; name: string }[]; selected: string[];
    onToggle: (id: string) => void; emptyHint: string;
  }) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between text-xs font-normal h-9">
            <span className="truncate">
              {selected.length === 0 ? '미지정' : `${selected.length}개 선택됨`}
            </span>
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2 max-h-72 overflow-y-auto" align="start">
          {options.length === 0 ? (
            <p className="text-[11px] text-muted-foreground p-2">{emptyHint}</p>
          ) : options.map(c => (
            <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded cursor-pointer text-sm">
              <Checkbox checked={selected.includes(c.id)} onCheckedChange={() => onToggle(c.id)} />
              <span className="truncate">{c.name}</span>
            </label>
          ))}
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selected.map(id => (
            <Badge key={id} variant="secondary" className="text-[10px] gap-1">
              {companyNameMap[id] || id}
              <button type="button" onClick={() => onToggle(id)} className="ml-0.5 hover:text-destructive">×</button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );


  const projectFormFields = (onSubmit: () => void, submitLabel: string) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>프로젝트명 *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required /></div>
        <div className="space-y-1"><Label>현장명</Label><Input value={form.site_name} onChange={e => setForm(p => ({ ...p, site_name: e.target.value }))} /></div>
        <div className="col-span-2 space-y-1"><Label>현장주소 (날씨 자동 연동)</Label><Input value={form.site_address} onChange={e => setForm(p => ({ ...p, site_address: e.target.value }))} placeholder="예: 전라남도 여수시 화학단지로 123" /></div>
        <div className="space-y-1"><Label>시작일</Label><Input type="date" value={form.period_start} onChange={e => setForm(p => ({ ...p, period_start: e.target.value }))} /></div>
        <div className="space-y-1"><Label>종료일</Label><Input type="date" value={form.period_end} onChange={e => setForm(p => ({ ...p, period_end: e.target.value }))} /></div>
        <div className="space-y-1"><Label>발주사</Label><Input value={form.client} onChange={e => setForm(p => ({ ...p, client: e.target.value }))} /></div>
        <MultiCompanyPicker
          label="시공사 (다중 선택 가능)"
          options={gcCompanies}
          selected={form.gc_company_ids}
          onToggle={(id) => toggleId('gc_company_ids', id)}
          emptyHint="등록된 시공사가 없습니다."
        />
        <div className="col-span-2">
          <MultiCompanyPicker
            label="협력사 (다중 선택 가능)"
            options={subCompanies}
            selected={form.sub_company_ids}
            onToggle={(id) => toggleId('sub_company_ids', id)}
            emptyHint="등록된 협력사가 없습니다."
          />
        </div>
      </div>

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
      <Button onClick={onSubmit} className="w-full" disabled={!form.name.trim() || createLoading}>
        {createLoading ? '처리 중...' : submitLabel}
      </Button>
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
          <Button size="sm" className="gap-1.5" onClick={() => { setShowCreate(true); resetForm(); }}>
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
                        <Building2 className="h-3.5 w-3.5" /><span>발주사: {project.client || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-3.5 w-3.5" /><span>시공사: {getGcName(project)}</span>
                      </div>
                      {getSubNames(project).length > 0 && (
                        <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                          <Users className="h-3.5 w-3.5" /><span>협력사: {getSubNames(project).join(', ')}</span>
                        </div>
                      )}
                    </div>

                    {(project.tags || []).length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        {(project.tags || []).map(tag => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/project/${project.id}`)}>
                      <Shield className="h-4 w-4" />
                    </Button>
                    {(isAdmin() || project.created_by === user?.id) && (
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>프로젝트 생성</DialogTitle></DialogHeader>
          {projectFormFields(handleCreate, "생성")}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editProject} onOpenChange={() => setEditProject(null)}>
        <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>프로젝트 수정</DialogTitle></DialogHeader>
          {projectFormFields(handleUpdate, "저장")}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Projects;
