import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ExternalLink,
  FileSignature,
  GitBranch,
  ClipboardCheck,
  Loader2,
  Building2,
  CloudSun,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  pickPermitDisplayTemplateWithSource,
  type PermitTemplateRow,
} from '@/lib/permitDisplayTemplate';
import {
  DEFAULT_WEATHER_STOP_RULES,
  normalizeWeatherStopRules,
  type WeatherStopRules,
} from '@/lib/weatherStopRules';

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
  canManage: boolean;
  canEditSafetyRules: boolean;
  initialWeatherStopRules?: unknown;
  onWeatherRulesSaved?: () => void;
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
  canManage,
  canEditSafetyRules,
  initialWeatherStopRules,
  onWeatherRulesSaved,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<PermitTemplateRow[]>([]);
  const [routeCounts, setRouteCounts] = useState<Record<string, { shared: number; total: number }>>({});
  const [weatherRules, setWeatherRules] = useState<WeatherStopRules>(() =>
    normalizeWeatherStopRules(initialWeatherStopRules),
  );
  const [savingWeather, setSavingWeather] = useState(false);

  useEffect(() => {
    setWeatherRules(normalizeWeatherStopRules(initialWeatherStopRules));
  }, [initialWeatherStopRules]);

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

  const handleSaveWeatherRules = async () => {
    if (!canEditSafetyRules) return;
    setSavingWeather(true);
    const normalized = normalizeWeatherStopRules(weatherRules);
    const { error } = await supabase
      .from('projects')
      .update({ weather_stop_rules: normalized } as any)
      .eq('id', projectId);
    setSavingWeather(false);
    if (error) {
      toast({ title: '기상 기준 저장 실패', description: error.message, variant: 'destructive' });
      return;
    }
    setWeatherRules(normalized);
    toast({
      title: '기상 · 작업중지 기준이 저장되었습니다.',
      description: '현장 모바일 날씨 카드에서 실시간 기준 초과 경고가 자동 연동됩니다.',
    });
    onWeatherRulesSaved?.();
  };

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

      {/* 2. Project Weather Stop-Work Rules (Live linked to MobileWeatherCard) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 flex-wrap">
          <div>
            <CardTitle className="text-sm flex items-center gap-1.5">
              <CloudSun className="h-4 w-4 text-primary" />
              프로젝트 기상 · 작업중지 기준
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              이 현장의 실시간 날씨(모바일 현장 날씨 카드)가 아래 기준을 초과하면 자동으로 작업중지 경고가 표시됩니다.
            </p>
          </div>
          {canEditSafetyRules && (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1"
                onClick={() => setWeatherRules({ ...DEFAULT_WEATHER_STOP_RULES })}
              >
                <RotateCcw className="h-3 w-3" /> 법정 기본값
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={savingWeather}
                onClick={() => void handleSaveWeatherRules()}
              >
                <Save className="h-3 w-3" /> {savingWeather ? '저장 중…' : '저장'}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">양중·크레인 중지 (m/s)</Label>
              <Input
                type="number"
                step="0.5"
                min={1}
                disabled={!canEditSafetyRules}
                className="h-8 text-xs"
                value={weatherRules.craneWindMs}
                onChange={(e) => setWeatherRules((p) => ({ ...p, craneWindMs: Number(e.target.value) || 10 }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">고소·비계 중지 (m/s)</Label>
              <Input
                type="number"
                step="0.5"
                min={1}
                disabled={!canEditSafetyRules}
                className="h-8 text-xs"
                value={weatherRules.highWorkWindMs}
                onChange={(e) => setWeatherRules((p) => ({ ...p, highWorkWindMs: Number(e.target.value) || 10 }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">강우 중지 (mm/h)</Label>
              <Input
                type="number"
                step="1"
                min={1}
                disabled={!canEditSafetyRules}
                className="h-8 text-xs"
                value={weatherRules.rainMmPerHour}
                onChange={(e) => setWeatherRules((p) => ({ ...p, rainMmPerHour: Number(e.target.value) || 10 }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">폭염 주의 (℃)</Label>
              <Input
                type="number"
                step="0.5"
                disabled={!canEditSafetyRules}
                className="h-8 text-xs"
                value={weatherRules.heatCautionC}
                onChange={(e) => setWeatherRules((p) => ({ ...p, heatCautionC: Number(e.target.value) || 33 }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">폭염 작업중지 (℃)</Label>
              <Input
                type="number"
                step="0.5"
                disabled={!canEditSafetyRules}
                className="h-8 text-xs"
                value={weatherRules.heatStopC}
                onChange={(e) => setWeatherRules((p) => ({ ...p, heatStopC: Number(e.target.value) || 35 }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">한파 주의 (℃)</Label>
              <Input
                type="number"
                step="1"
                disabled={!canEditSafetyRules}
                className="h-8 text-xs"
                value={weatherRules.coldCautionC}
                onChange={(e) => setWeatherRules((p) => ({ ...p, coldCautionC: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">한파 작업중지 (℃)</Label>
              <Input
                type="number"
                step="1"
                disabled={!canEditSafetyRules}
                className="h-8 text-xs"
                value={weatherRules.coldStopC}
                onChange={(e) => setWeatherRules((p) => ({ ...p, coldStopC: Number(e.target.value) }))}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2.5">
            ※ 법정 기본값: 양중·고소 풍속 10m/s (산안법 규칙 제383조), 강우 10mm/h, 폭염 주의 33℃ / 중지 35℃ (제566조), 한파 주의 -12℃ / 중지 -15℃
          </p>
        </CardContent>
      </Card>

      {/* 3. Approval Routes Summary (SSOT: Settings > 결재선 관리) */}
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

      {/* 4. Project Safety & Attachment Rules (Managers & Safety Managers) */}
      {canEditSafetyRules && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              현장 규칙 설정
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5"
              onClick={() => navigate('/settings/work-plan-attachments')}
            >
              작업계획서 필수 첨부 규칙 <ExternalLink className="h-3 w-3" />
            </Button>
            {canManage && !isMaster && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5"
                onClick={() => navigate('/settings/companies')}
              >
                업체 마스터 조회 <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 5. Master-Only System Administration */}
      {isMaster && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              시스템 마스터 전용 설정
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              마스터 계정에게만 표시되는 전역 시스템 설정입니다.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 bg-background"
              onClick={() => navigate('/settings/companies')}
            >
              전역 업체 마스터 관리 <ExternalLink className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 bg-background"
              onClick={() => navigate('/settings/weather')}
            >
              기상 API 키 설정 (KMA/OpenWeather) <ExternalLink className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
