import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList } from 'lucide-react';

type WeeklyReport = {
  id: string;
  week_start: string;
  week_end: string;
  body: string;
  permit_count: number;
};

function reportsTable() {
  return (supabase as unknown as { from: (name: string) => any }).from('owner_weekly_work_reports');
}

function formatDay(value: string) {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${year}.${month}.${day}`;
}

export function WeeklyWorkReports({ projectId }: { projectId?: string | null }) {
  const [rows, setRows] = useState<WeeklyReport[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setRows([]);
      setSelectedId('');
      setLoaded(true);
      return;
    }
    setLoaded(false);
    reportsTable()
      .select('id, week_start, week_end, body, permit_count')
      .eq('project_id', projectId)
      .order('week_start', { ascending: false })
      .limit(12)
      .then(({ data, error }: { data: WeeklyReport[] | null; error: { message: string } | null }) => {
        if (cancelled) return;
        if (error) {
          setRows([]);
        } else {
          setRows(data || []);
          setSelectedId(data?.[0]?.id || '');
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const current = rows.find((row) => row.id === selectedId) || rows[0];

  return (
    <Card>
      <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          주간 작업
        </CardTitle>
        {rows.length > 1 && (
          <Select value={current?.id} onValueChange={setSelectedId}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rows.map((row) => (
                <SelectItem key={row.id} value={row.id} className="text-xs">
                  {formatDay(row.week_start)} – {formatDay(row.week_end)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {!projectId && (
          <p className="text-xs text-muted-foreground">현장을 선택하면 그 현장의 주간 작업이 보입니다.</p>
        )}
        {projectId && !loaded && <p className="text-xs text-muted-foreground">주간 작업을 불러오는 중입니다.</p>}
        {projectId && loaded && !current && (
          <p className="text-xs text-muted-foreground">
            이번 주 발행된 작업이 없습니다. 기록이 있는 현장은 매주 금요일 오후 3시에 여기 올라옵니다.
          </p>
        )}
        {current && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {formatDay(current.week_start)} – {formatDay(current.week_end)} · 발행 허가서 {current.permit_count}건
            </p>
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-800 dark:text-slate-100">
              {current.body}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
