import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ExternalLink,
  FileSignature,
  GitBranch,
  ClipboardCheck,
  Loader2,
  Building2,
} from 'lucide-react';
import {
  pickPermitDisplayTemplateWithSource,
  type PermitTemplateRow,
} from '@/lib/permitDisplayTemplate';

interface CompanyLike {
  id: string;
  name: string;
  type: string;
  parent_company_id?: string | null;
}

interface Props {
  projectId: string;
  companies: CompanyLike[];
  isMaster: boolean;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  assessment_run: '위험성평가',
  work_permit: '작업허가서',
  work_plan: '작업계획서',
  safety_cost: '안전관리비',
  safety_inspection: '안전점검',
};

export default function ProjectIntegrationsTab({
  projectId,
  companies,
  isMaster,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<PermitTemplateRow[]>([]);
  const [routeCounts, setRouteCounts] = useState<Record<string, { shared: number; total: number }>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [tplRes, routeRes] = await Promise.all([
        supabase
          .from('permit_form_templates')
          .select('id, project_id, company_id, code, name, version, layout_json, is_default, is_active, permit_type')
          .eq('is_deleted', false)
          .eq('is_active', true)
          .or(`project_id.eq.${projectId},project_id.is.null`),
        supabase
          .from('approval_route_templates')
          .select('id, entity_type, owner_user_id')
          .eq('project_id', projectId)
          .eq('is_deleted', false),
      ]);
      if (cancelled) return;

      setTemplates(((tplRes.data || []) as unknown) as PermitTemplateRow[]);

      const counts: Record<string, { shared: number; total: number }> = {};
      for (const r of (routeRes.data || []) as any[]) {
        const key = r.entity_type || 'assessment_run';
        if (!counts[key]) counts[key] = { shared: 0, total: 0 };
        counts[key].total += 1;
        if (!r.owner_user_id) counts[key].shared += 1;
      }
      setRouteCounts(counts);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const projectDefaultPermit = pickPermitDisplayTemplateWithSource({
    templates,
    projectId,
    permitCompanyId: null,
    gcCompanyId: null,
    permitType: 'general',
  });

  const gcCompanies = companies.filter((c) => c.type === 'gc');

  return (
    <div className="space-y-4">
      {/* 1. Permit Display Template Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-sm flex items-center gap-1.5">
              <FileSignature className="h-4 w-4 text-primary" />
              허가서 표시 양식 연동 현황
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              이 프로젝트와 참여 시공사별로 실제 적용 중인 허가서 양식입니다. 다른 프로젝트와 완전히 격리됩니다.
            </p>
          </div>
          {isMaster && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs shrink-0"
              onClick={() => navigate(`/settings/permit-forms?projectId=${projectId}`)}
            >
              허가서 양식 설정 <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2.5">
          {loading ? (
            <div className="py-4 text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
                <span className="font-medium">프로젝트 전체 기본</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">
                    {projectDefaultPermit?.template.name || '내장 기본 표준'}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {projectDefaultPermit?.sourceLabel || '전체 기본 표준'}
                  </Badge>
                </div>
              </div>

              {gcCompanies.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">참여 시공사별 실제 적용 양식</p>
                  {gcCompanies.map((gc) => {
                    const match = pickPermitDisplayTemplateWithSource({
                      templates,
                      projectId,
                      permitCompanyId: gc.id,
                      gcCompanyId: gc.id,
                      permitType: 'general',
                    });
                    return (
                      <div
                        key={gc.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                      >
                        <span className="inline-flex items-center gap-1.5 font-medium truncate">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {gc.name}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                          <span>{match?.template.name || '내장 기본 표준'}</span>
                          <Badge
                            variant={match?.sourceScope === 'project_company' ? 'default' : 'outline'}
                            className="text-[10px]"
                          >
                            {match?.sourceLabel || '전체 기본 표준'}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 2. Approval Routes Summary (SSOT: Settings > 결재선 관리) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-sm flex items-center gap-1.5">
              <GitBranch className="h-4 w-4 text-primary" />
              전자결재선 연동 현황
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              결재선은 <b>설정 &gt; 결재선 관리</b>에서 문서 유형별·업체별·개인별로 통합 관리됩니다.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs shrink-0"
            onClick={() => navigate('/settings/approval-routes')}
          >
            결재선 관리 <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {Object.entries(ENTITY_TYPE_LABELS).map(([key, label]) => {
              const stat = routeCounts[key] || { shared: 0, total: 0 };
              return (
                <div key={key} className="rounded-md border p-2.5 text-xs space-y-1">
                  <p className="font-medium">{label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    등록 <b className="text-foreground">{stat.total}</b>건 (공용 {stat.shared})
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 3. Other Related Settings Shortcuts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            기타 연동 설정 바로가기
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1.5"
            onClick={() => navigate('/settings/companies')}
          >
            전역 업체 마스터 관리 <ExternalLink className="h-3 w-3" />
          </Button>
          {isMaster && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5"
              onClick={() => navigate('/settings/work-plan-attachments')}
            >
              작업계획서 필수 첨부 규칙 <ExternalLink className="h-3 w-3" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1.5"
            onClick={() => navigate('/settings/weather')}
          >
            기상·작업중지 기준 <ExternalLink className="h-3 w-3" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
