import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ClipboardList, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatWeekChoice,
  seoulISODate,
  weekIndexInMonth,
  weekStartMonday,
  weeklyReportText,
  weeklyStatsFooter,
  weeksInMonth,
  type WeeklyReportStats,
} from '@/lib/weeklySafetyReport';

type WeeklyReport = {
  id: string;
  week_start: string;
  week_end: string;
  body: string;
  permit_count: number;
  status: string | null;
  stats: WeeklyReportStats | null;
};

function reportsTable() {
  return (supabase as unknown as { from: (name: string) => any }).from('owner_weekly_work_reports');
}

function emptyPlan(stats: WeeklyReportStats | null | undefined): WeeklyReportStats {
  return {
    inspection: stats?.inspection ?? 0,
    education: stats?.education ?? 0,
    work_stop: stats?.work_stop ?? 0,
    suspension: stats?.suspension ?? 0,
    incident: stats?.incident ?? 0,
    meeting_actual: stats?.meeting_actual ?? null,
    plan: {
      meeting: stats?.plan?.meeting ?? null,
      inspection: stats?.plan?.inspection ?? null,
      education: stats?.plan?.education ?? null,
      work_stop: stats?.plan?.work_stop ?? null,
    },
  };
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function WeeklyWorkReports({ projectId }: { projectId?: string | null }) {
  const today = seoulISODate();
  const currentWeek = weekIndexInMonth(weekStartMonday(today));
  const [year, setYear] = useState(currentWeek.year);
  const [month, setMonth] = useState(currentWeek.month);
  const [weekIndex, setWeekIndex] = useState(currentWeek.index);
  const [rows, setRows] = useState<WeeklyReport[]>([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [draft, setDraft] = useState('');
  const [plan, setPlan] = useState<WeeklyReportStats>(emptyPlan(null));
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const weeks = useMemo(() => weeksInMonth(year, month), [year, month]);
  const selectedWeek = weeks.find((week) => week.index === weekIndex) || weeks[0];
  const monthKey = projectId ? `${projectId}|${year}|${month}` : '';

  useEffect(() => {
    if (!weeks.some((week) => week.index === weekIndex)) {
      setWeekIndex(weeks[weeks.length - 1]?.index || 1);
    }
  }, [weeks, weekIndex]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || !selectedWeek) {
      setRows([]);
      setLoadedKey('');
      return;
    }
    const key = `${projectId}|${year}|${month}`;
    if (loadedKey === key) return;
    reportsTable()
      .select('id, week_start, week_end, body, permit_count, status, stats')
      .eq('project_id', projectId)
      .gte('week_start', weeks[0].start)
      .lte('week_start', weeks[weeks.length - 1].start)
      .order('week_start', { ascending: true })
      .then(({ data, error }: { data: WeeklyReport[] | null; error: { message: string } | null }) => {
        if (cancelled) return;
        if (error) {
          setRows([]);
          toast.error('주간 보고를 불러오지 못했습니다.');
        } else {
          setRows(data || []);
        }
        setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, year, month, weeks, selectedWeek, loadedKey]);

  const current = rows.find((row) => row.week_start === selectedWeek?.start) || null;

  useEffect(() => {
    setDraft(current?.body || '');
    setPlan(emptyPlan(current?.stats));
  }, [current?.id, current?.body, current?.stats]);

  const reloadMonth = () => setLoadedKey('');

  const saveNarrative = async () => {
    if (!current) return;
    setSaving(true);
    const { error } = await reportsTable().update({ body: draft, updated_at: new Date().toISOString() }).eq('id', current.id);
    setSaving(false);
    if (error) {
      toast.error('문안 저장에 실패했습니다.');
      return;
    }
    setRows((prev) => prev.map((row) => (row.id === current.id ? { ...row, body: draft } : row)));
    toast.success('문안을 저장했습니다.');
  };

  const savePlan = async () => {
    if (!current) return;
    setSaving(true);
    const next = emptyPlan(plan);
    const { error } = await reportsTable().update({ stats: next, updated_at: new Date().toISOString() }).eq('id', current.id);
    setSaving(false);
    if (error) {
      toast.error('실적 저장에 실패했습니다.');
      return;
    }
    setRows((prev) => prev.map((row) => (row.id === current.id ? { ...row, stats: next } : row)));
    toast.success('실적을 저장했습니다.');
  };

  const copyReport = async () => {
    const text = weeklyReportText(draft || current?.body || '', plan);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('보고 문안을 복사했습니다.');
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  };

  const rebuild = async () => {
    if (!projectId || !selectedWeek) return;
    setRebuilding(true);
    const { data, error } = await supabase.functions.invoke('write-weekly-safety-report', {
      body: { week_start: selectedWeek.start, project_id: projectId },
    });
    setRebuilding(false);
    if (error) {
      toast.error('다시 만들지 못했습니다.');
      return;
    }
    const payload = data as { error?: string; message?: string; skipped?: boolean };
    if (payload?.error) {
      toast.error(payload.error);
      return;
    }
    toast.success(payload?.message || '이 주의 보고를 다시 만들었습니다.');
    reloadMonth();
  };

  const years = [currentWeek.year - 1, currentWeek.year];

  return (
    <Card>
      <CardHeader className="p-4 pb-2 space-y-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          주간 작업
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger className="h-8 w-[96px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((item) => (
                <SelectItem key={item} value={String(item)} className="text-xs">{item}년</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}>
            <SelectTrigger className="h-8 w-[84px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => (
                <SelectItem key={item} value={String(item)} className="text-xs">{item}월</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(selectedWeek?.index || 1)} onValueChange={(value) => setWeekIndex(Number(value))}>
            <SelectTrigger className="h-8 w-[230px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {weeks.map((week) => (
                <SelectItem key={week.start} value={String(week.index)} className="text-xs">
                  {formatWeekChoice(week)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2 space-y-3">
        {!projectId && (
          <p className="text-xs text-muted-foreground">현장을 선택하면 그 현장의 주간 작업이 보입니다.</p>
        )}
        {projectId && loadedKey !== monthKey && (
          <p className="text-xs text-muted-foreground">주간 작업을 불러오는 중입니다.</p>
        )}
        {projectId && loadedKey === monthKey && !current && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">아직 만들어진 보고가 없습니다.</p>
            <Button type="button" size="sm" variant="outline" className="text-xs" onClick={rebuild} disabled={rebuilding}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              {rebuilding ? '만드는 중...' : '이 주 만들기'}
            </Button>
          </div>
        )}
        {current && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                발행 허가서 {current.permit_count}건
                {current.status !== 'ready' ? ' · 위험과 대책은 아직 없습니다. 작업 목록은 저장되어 있습니다.' : ''}
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" className="text-xs" onClick={copyReport}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> 복사
                </Button>
                <Button type="button" size="sm" variant="outline" className="text-xs" onClick={rebuild} disabled={rebuilding}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  {rebuilding ? '만드는 중...' : '다시 만들기'}
                </Button>
              </div>
            </div>
            <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-[280px] text-xs leading-relaxed font-sans" />
            <Button type="button" size="sm" className="text-xs" onClick={saveNarrative} disabled={saving}>
              문안 저장
            </Button>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <PlanField label="안전회의 계획" value={plan.plan?.meeting} onChange={(value) => setPlan((prev) => ({ ...prev, plan: { ...prev.plan, meeting: value } }))} />
              <PlanField label="안전회의 실적" value={plan.meeting_actual} onChange={(value) => setPlan((prev) => ({ ...prev, meeting_actual: value }))} />
              <PlanField label="안전점검 계획" value={plan.plan?.inspection} onChange={(value) => setPlan((prev) => ({ ...prev, plan: { ...prev.plan, inspection: value } }))} />
              <PlanField label="안전교육 계획" value={plan.plan?.education} onChange={(value) => setPlan((prev) => ({ ...prev, plan: { ...prev.plan, education: value } }))} />
              <PlanField label="작업중지 계획" value={plan.plan?.work_stop} onChange={(value) => setPlan((prev) => ({ ...prev, plan: { ...prev.plan, work_stop: value } }))} />
            </div>
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-800 dark:text-slate-100">
              {weeklyStatsFooter(plan)}
            </pre>
            <Button type="button" size="sm" variant="outline" className="text-xs" onClick={savePlan} disabled={saving}>
              실적 저장
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <Input
        value={value == null ? '' : String(value)}
        onChange={(event) => onChange(numberOrNull(event.target.value))}
        inputMode="numeric"
        className="h-8 text-xs"
        placeholder="—"
      />
    </label>
  );
}
