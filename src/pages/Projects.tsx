import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useToast } from "@/hooks/use-toast";
import { useSoftDelete } from "@/hooks/useSoftDelete";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Building2, Users, Tag, Plus, Trash2, Settings2, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Database } from "@/integrations/supabase/types";
import ProjectCreationWizardDialog from "@/components/project/ProjectCreationWizardDialog";
import { normalizeCompanyType } from "@/lib/companyTypes";

type ProjectRow = Database['public']['Tables']['projects']['Row'];

type ProjectSummaryMeta = {
  clientNames: string[];
  gcNames: string[];
  subNames: string[];
  memberCount: number;
};

const Projects = () => {
  const { user, isAdmin } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { softDelete } = useSoftDelete();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [metaByProject, setMetaByProject] = useState<Record<string, ProjectSummaryMeta>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchProjects = async () => {
    setLoading(true);
    const { data: projData } = await supabase
      .from('projects')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    const list = projData || [];
    setProjects(list);

    if (list.length > 0) {
      const ids = list.map((p) => p.id);
      const [linksRes, membersRes] = await Promise.all([
        (supabase as any)
          .from('project_companies')
          .select('project_id, role_in_project, companies:company_id(name, type, is_deleted)')
          .in('project_id', ids)
          .eq('is_deleted', false),
        supabase
          .from('project_members')
          .select('project_id')
          .in('project_id', ids),
      ]);

      const nextMeta: Record<string, ProjectSummaryMeta> = {};
      for (const id of ids) {
        nextMeta[id] = { clientNames: [], gcNames: [], subNames: [], memberCount: 0 };
      }

      for (const l of (linksRes.data || []) as any[]) {
        if (!l.companies || l.companies.is_deleted === true) continue;
        const m = nextMeta[l.project_id];
        if (!m) continue;
        const role = normalizeCompanyType(l.role_in_project || l.companies.type);
        const name = l.companies.name;
        if (role === 'client' && !m.clientNames.includes(name)) m.clientNames.push(name);
        else if (role === 'gc' && !m.gcNames.includes(name)) m.gcNames.push(name);
        else if ((role === 'contractor' || role === 'vendor') && !m.subNames.includes(name)) m.subNames.push(name);
      }

      for (const mem of (membersRes.data || []) as any[]) {
        const m = nextMeta[mem.project_id];
        if (m) m.memberCount += 1;
      }

      setMetaByProject(nextMeta);
    }

    setLoading(false);
  };

  useEffect(() => {
    void fetchProjects();
  }, []);

  const handleDelete = async (id: string) => {
    const target = projects.find((p) => p.id === id);
    const r = await softDelete('projects', id, { label: `프로젝트 "${target?.name || ''}"`, projectId: id });
    if (r.ok) void fetchProjects();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">프로젝트 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">
            현장/공사 프로젝트 목록 · 클릭하면 기본정보·참여 업체·멤버·연동 설정을 한 곳에서 관리합니다.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> 새 프로젝트 개설
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-12">로딩 중...</p>
      ) : projects.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">등록된 프로젝트가 없습니다.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const meta = metaByProject[project.id];
            const clientLabel = meta?.clientNames.length ? meta.clientNames.join(', ') : (project.client || '미지정');
            const gcLabel = meta?.gcNames.length ? meta.gcNames.join(', ') : (project.contractor || '미지정');
            const subNames = meta?.subNames || [];
            const hasCoords = typeof (project as any).site_lat === 'number' && typeof (project as any).site_lng === 'number';

            return (
              <Card key={project.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-3 flex-1 min-w-0">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2
                            className="text-lg font-bold cursor-pointer hover:text-primary"
                            onClick={() => navigate(`/project/${project.id}`)}
                          >
                            {project.name}
                          </h2>
                          <Badge
                            className={`text-[10px] ${
                              project.status === '진행중'
                                ? 'bg-success text-success-foreground'
                                : project.status === '완료'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {project.status}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            멤버 {meta?.memberCount ?? 0}명
                          </Badge>
                          {hasCoords && (
                            <Badge variant="outline" className="text-[10px] gap-0.5 text-emerald-700 dark:text-emerald-300 border-emerald-500/40">
                              <MapPin className="h-2.5 w-2.5" /> 날씨 연동
                            </Badge>
                          )}
                        </div>
                        {project.site_name && (
                          <p className="text-sm text-muted-foreground mt-0.5">{project.site_name}</p>
                        )}
                      </div>

                      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {project.period_start || project.period_end
                              ? `${project.period_start || '미정'} ~ ${project.period_end || '미정'}`
                              : '공사기간 미정'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">발주처: {clientLabel}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Users className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">시공사: {gcLabel}</span>
                        </div>
                        {subNames.length > 0 && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Users className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">협력사 ({subNames.length}): {subNames.join(', ')}</span>
                          </div>
                        )}
                      </div>

                      {(project.tags || []).length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Tag className="h-3 w-3 text-muted-foreground" />
                          {(project.tags || []).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1"
                        onClick={() => navigate(`/project/${project.id}`)}
                      >
                        <Settings2 className="h-3.5 w-3.5" /> 관리
                      </Button>
                      {(isAdmin || project.created_by === user?.id) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          title="프로젝트 삭제"
                          onClick={() => handleDelete(project.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProjectCreationWizardDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        userId={user?.id}
        onCreated={fetchProjects}
        onLog={(action, entity, entityId) => log(action, entity, entityId)}
        onToast={(opts) => toast(opts)}
      />
    </div>
  );
};

export default Projects;
