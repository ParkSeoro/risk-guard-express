/**
 * 휴지통(Trash) — 소프트 삭제된 항목을 한 곳에서 보고, 복구하거나 영구 삭제한다.
 *
 * 권한: master / project_admin 만 접근. (RLS도 동일하게 보호)
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { SOFT_DELETE_TABLES, TABLE_LABELS, type SoftDeleteTable } from '@/lib/dataAccess';
import { RotateCcw, Trash2, RefreshCw } from 'lucide-react';

interface DeletedRow {
  id: string;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_reason: string | null;
  project_id?: string | null;
  [k: string]: any;
}

// 각 테이블에서 사용자에게 의미있는 라벨로 쓸 컬럼 후보
const NAME_COLUMNS: Record<string, string[]> = {
  assessment_runs: ['period_label', 'title'],
  work_plans: ['title'],
  work_permits: ['title', 'work_type'],
  safety_inspections: ['title'],
  tbm_sessions: ['title'],
  incident_reports: ['title', 'incident_type'],
  safety_cost_items: ['item_name'],
  safety_education_materials: ['title'],
  legal_duties: ['title'],
  todo_items: ['title'],
  equipment_master: ['name'],
  environment_tags: ['name'],
  master_processes: ['name'],
  master_assignees: ['name'],
  master_departments: ['name'],
  master_ppe: ['name'],
  projects: ['name', 'site_name'],
  companies: ['name'],
  site_maps: ['name'],
  site_zones: ['name'],
  restricted_zones: ['name'],
};

/** Tables that are soft-deleted but have no project_id column (or are not project-scoped). */
const TABLES_WITHOUT_PROJECT_ID = new Set<SoftDeleteTable>([
  'projects',
  'master_processes',
  'master_assignees',
  'master_departments',
  'master_ppe',
]);

function tableHasProjectId(table: SoftDeleteTable): boolean {
  if (TABLES_WITHOUT_PROJECT_ID.has(table)) return false;
  if (table.startsWith('master_')) return false;
  return true;
}

function getLabel(table: SoftDeleteTable, row: DeletedRow): string {
  const cols = NAME_COLUMNS[table] || [];
  for (const c of cols) {
    if (row[c]) return String(row[c]);
  }
  return row.id.slice(0, 8);
}

export default function Trash() {
  const { user } = useAuth();
  const { isMaster, isProjectAdmin, selectedProject, userRole, userCompanyId, loading } = useGlobalProjectAccess();
  const { restore } = useSoftDelete();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const [activeTable, setActiveTable] = useState<SoftDeleteTable>('work_plans');
  const [rows, setRows] = useState<DeletedRow[]>([]);
  const [busy, setBusy] = useState(false);

  const canAccess = isMaster || isProjectAdmin;

  const fetchDeleted = async (table: SoftDeleteTable) => {
    const scoped = tableHasProjectId(table);
    if (scoped && !selectedProject) {
      setRows([]);
      return;
    }
    setBusy(true);
    let q: any = supabase.from(table).select('*').eq('is_deleted', true);
    if (scoped) {
      q = q.eq('project_id', selectedProject);
    }
    q = q.order('deleted_at', { ascending: false }).limit(200);
    const { data, error } = await q;
    if (error) {
      toast({ title: `불러오기 실패: ${error.message}`, variant: 'destructive' });
      setRows([]);
    } else {
      setRows((data as DeletedRow[]) || []);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (canAccess) fetchDeleted(activeTable);
  }, [activeTable, selectedProject, canAccess]);

  const handleRestore = async (row: DeletedRow) => {
    const r = await restore(activeTable, row.id, {
      projectId: row.project_id ?? (activeTable === 'projects' ? row.id : selectedProject),
      label: getLabel(activeTable, row),
    });
    if (r.ok) fetchDeleted(activeTable);
  };

  const handlePermanentDelete = async (row: DeletedRow) => {
    const label = getLabel(activeTable, row);
    const ok = window.confirm(
      `[${label}] 항목을 영구 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속할까요?`,
    );
    if (!ok) return;
    const { error } = await supabase.from(activeTable).delete().eq('id', row.id);
    if (error) {
      toast({ title: `영구 삭제 실패: ${error.message}`, variant: 'destructive' });
      return;
    }
    await log(
      'hard_delete',
      activeTable,
      row.id,
      row.project_id ?? (activeTable === 'projects' ? row.id : selectedProject) ?? undefined,
      {
        label,
        original_reason: row.deleted_reason,
      },
    );
    toast({ title: `${label} 영구 삭제됨` });
    fetchDeleted(activeTable);
  };

  if (loading) return <div className="p-6">로딩 중...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!canAccess) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            휴지통은 마스터 / 프로젝트 관리자만 접근할 수 있습니다.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">휴지통</h1>
          <p className="text-sm text-muted-foreground">
            소프트 삭제된 항목을 복구하거나 영구 삭제합니다.
            모든 작업은 감사 로그에 기록됩니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchDeleted(activeTable)} disabled={busy}>
          <RefreshCw className={`h-4 w-4 mr-1 ${busy ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      <Tabs value={activeTable} onValueChange={(v) => setActiveTable(v as SoftDeleteTable)}>
        <TabsList className="flex flex-wrap h-auto">
          {SOFT_DELETE_TABLES.map((t) => (
            <TabsTrigger key={t} value={t} className="text-xs">
              {TABLE_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        {SOFT_DELETE_TABLES.map((t) => (
          <TabsContent key={t} value={t}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {TABLE_LABELS[t]} 삭제 항목 <Badge variant="secondary">{rows.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    삭제된 항목이 없습니다.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>항목</TableHead>
                        <TableHead>삭제 일시</TableHead>
                        <TableHead>사유</TableHead>
                        <TableHead className="w-[200px] text-right">작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{getLabel(t, row)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.deleted_at ? new Date(row.deleted_at).toLocaleString('ko-KR') : '-'}
                          </TableCell>
                          <TableCell className="text-xs">{row.deleted_reason || '-'}</TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="sm" variant="outline" onClick={() => handleRestore(row)}>
                              <RotateCcw className="h-3 w-3 mr-1" />복구
                            </Button>
                            {isMaster && (
                              <Button size="sm" variant="destructive" onClick={() => handlePermanentDelete(row)}>
                                <Trash2 className="h-3 w-3 mr-1" />영구 삭제
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
