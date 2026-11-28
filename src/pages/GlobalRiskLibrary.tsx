/**
 * Master-only: system-wide risk library browse / learn / import.
 * Heavy ops are explicit button clicks — never runs on page load beyond a capped page.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  createLibraryImportDraft,
  ingestApprovedRunsToLibrary,
  publishLibraryImport,
} from '@/lib/globalRiskLibrary';
import {
  downloadGlobalRiskLibraryExcelTemplate,
  mapGlobalRiskLibraryExcelRows,
} from '@/lib/globalRiskLibraryExcel';
import { getGradeClassName } from '@/lib/riskGrade';
import * as XLSX from 'xlsx';
import {
  Loader2,
  Database,
  FileSpreadsheet,
  FileText,
  Download,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

type LibRow = {
  id: string;
  process_label: string;
  sub_task: string;
  hazard: string;
  hazard_type: string | null;
  work_phase: string | null;
  hazard_situation: string | null;
  existing_measure: string | null;
  improvement_measure: string | null;
  risk_grade: string | null;
  improved_risk_grade: string | null;
  ppe: string[] | null;
  legal_basis: string[] | null;
  use_count: number;
  quality_score: number | null;
  source: string;
  is_active: boolean;
  updated_at: string | null;
};

type ImportRow = {
  id: string;
  status: string;
  source_kind: string;
  file_name: string | null;
  row_count: number;
  created_at: string;
};

const PAGE_SIZE = 30;

const SOURCE_LABELS: Record<string, string> = {
  approved_run: '승인 위평',
  master_import: '엑셀 학습',
  seed: '기본 시드',
};

export default function GlobalRiskLibrary() {
  const { hasRole } = useAuth();
  const isMaster = hasRole('master');
  const { toast } = useToast();

  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [selectedProcess, setSelectedProcess] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<LibRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [totalAll, setTotalAll] = useState(0);
  const [totalActive, setTotalActive] = useState(0);
  const [topProcesses, setTopProcesses] = useState<Array<{ label: string; count: number }>>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const [allRes, actRes, procRes, impRes] = await Promise.all([
        supabase.from('global_risk_library' as any).select('id', { count: 'exact', head: true }),
        supabase
          .from('global_risk_library' as any)
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase
          .from('global_risk_library' as any)
          .select('process_label')
          .eq('is_active', true)
          .limit(2000),
        supabase
          .from('global_risk_library_imports' as any)
          .select('id, status, source_kind, file_name, row_count, created_at')
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      setTotalAll(allRes.count ?? 0);
      setTotalActive(actRes.count ?? 0);
      setImports((impRes.data || []) as any);

      const counts = new Map<string, number>();
      for (const r of (procRes.data || []) as Array<{ process_label?: string }>) {
        const key = (r.process_label || '').trim();
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const sorted = [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);
      setTopProcesses(sorted);
    } catch {
      // summary is best-effort
    }
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('global_risk_library' as any)
        .select(
          'id, process_label, sub_task, hazard, hazard_type, work_phase, hazard_situation, existing_measure, improvement_measure, risk_grade, improved_risk_grade, ppe, legal_basis, use_count, quality_score, source, is_active, updated_at',
          { count: 'exact' },
        )
        .order('use_count', { ascending: false })
        .order('updated_at', { ascending: false })
        .range(from, to);

      if (activeOnly) query = query.eq('is_active', true);
      if (selectedProcess !== 'all') query = query.eq('process_label', selectedProcess);
      if (appliedQ.trim()) {
        const term = appliedQ.trim();
        query = query.or(
          `process_label.ilike.%${term}%,sub_task.ilike.%${term}%,hazard.ilike.%${term}%,improvement_measure.ilike.%${term}%`,
        );
      }

      const { data, count, error } = await query;
      if (error) throw error;
      const list = (data || []) as LibRow[];
      setRows(list);
      setFilteredTotal(count ?? list.length);
      setSelectedId((prev) => (prev && list.some((r) => r.id === prev) ? prev : list[0]?.id || null));
    } catch (e: any) {
      toast({ title: '불러오기 실패', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, activeOnly, selectedProcess, appliedQ, toast]);

  useEffect(() => {
    if (isMaster) void loadSummary();
  }, [isMaster, loadSummary]);

  useEffect(() => {
    if (isMaster) void loadRows();
  }, [isMaster, loadRows]);

  if (!isMaster) return <Navigate to="/app/admin" replace />;

  const onIngestDb = async () => {
    setBusy('ingest');
    try {
      const res = await ingestApprovedRunsToLibrary(60);
      toast({
        title: '승인 위평 학습 완료',
        description: `승인 회차 ${res.runs}건 스캔 · ${res.upserted}개 항목 반영`,
      });
      await Promise.all([loadSummary(), loadRows()]);
    } catch (e: any) {
      toast({ title: '학습 실패', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const onExcel = async (file: File) => {
    setBusy('excel');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const mapped = mapGlobalRiskLibraryExcelRows(json);
      if (!mapped.length) throw new Error('유효한 행이 없습니다. 「양식 다운로드」로 헤더를 맞춘 뒤 다시 올려 주세요.');

      const id = await createLibraryImportDraft({
        sourceKind: 'excel',
        fileName: file.name,
        rows: mapped,
      });
      const pub = await publishLibraryImport(id);
      toast({ title: '엑셀 학습 완료', description: `${pub.upserted}건 반영` });
      await Promise.all([loadSummary(), loadRows()]);
    } catch (e: any) {
      toast({ title: '엑셀 학습 실패', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const onPdf = async (file: File) => {
    setBusy('pdf');
    try {
      const id = await createLibraryImportDraft({
        sourceKind: 'pdf',
        fileName: file.name,
        rows: [],
        notes: `[PDF 업로드] ${file.name} (${file.size} bytes). 표 추출은 엑셀 템플릿 변환 후 재업로드를 권장합니다.`,
      });
      toast({
        title: 'PDF 접수(검수 대기)',
        description: `import ${id.slice(0, 8)}… — 표가 있는 엑셀로 변환 후 업로드하면 바로 반영됩니다.`,
      });
      await loadSummary();
    } catch (e: any) {
      toast({ title: 'PDF 접수 실패', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    const { error } = await supabase
      .from('global_risk_library' as any)
      .update({ is_active: !active, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) toast({ title: '변경 실패', description: error.message, variant: 'destructive' });
    else await Promise.all([loadSummary(), loadRows()]);
  };

  const selectedRow = rows.find((r) => r.id === selectedId) || rows[0] || null;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header + Actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            전역 위험성평가 라이브러리
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            최종 승인된 위험성평가 항목이 자동 축적되며, 신규 작성 시 [AI 공종 채우기]에서 라이브러리 + AI 복합 추천에 활용됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <Button onClick={onIngestDb} disabled={!!busy} size="sm" className="h-8 text-xs">
            {busy === 'ingest' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            승인 위평 학습
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!!busy} onClick={() => document.getElementById('grl-excel')?.click()}>
            {busy === 'excel' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />}
            엑셀 업로드
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!!busy} onClick={() => downloadGlobalRiskLibraryExcelTemplate()}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> 양식
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={!!busy} onClick={() => document.getElementById('grl-pdf')?.click()}>
            {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
            PDF 접수
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={loading} onClick={() => { void loadSummary(); void loadRows(); }} title="새로고침">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <input id="grl-excel" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onExcel(f); e.target.value = ''; }} />
          <input id="grl-pdf" type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPdf(f); e.target.value = ''; }} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3.5">
            <div className="text-[11px] text-muted-foreground">전체 축적 항목</div>
            <div className="text-2xl font-bold mt-0.5">{totalAll.toLocaleString()}<span className="text-xs font-normal text-muted-foreground ml-1">건</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <div className="text-[11px] text-muted-foreground">AI 추천 활성 항목</div>
            <div className="text-2xl font-bold text-primary mt-0.5">{totalActive.toLocaleString()}<span className="text-xs font-normal text-muted-foreground ml-1">건</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <div className="text-[11px] text-muted-foreground">주요 등록 공종</div>
            <div className="text-2xl font-bold mt-0.5">{topProcesses.length}<span className="text-xs font-normal text-muted-foreground ml-1">개+</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <div className="text-[11px] text-muted-foreground">현재 필터 결과</div>
            <div className="text-2xl font-bold mt-0.5">{filteredTotal.toLocaleString()}<span className="text-xs font-normal text-muted-foreground ml-1">건</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar + Top Process Chips */}
      <Card>
        <CardContent className="p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="공종, 세부작업, 위험요인, 개선대책 검색..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { setPage(0); setAppliedQ(q); }
                }}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={() => { setPage(0); setAppliedQ(q); }} disabled={loading}>
              검색
            </Button>
            {(appliedQ || selectedProcess !== 'all') && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setQ(''); setAppliedQ(''); setSelectedProcess('all'); setPage(0); }}>
                초기화
              </Button>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant={activeOnly ? 'default' : 'outline'} className="h-7 text-[11px]" onClick={() => { setActiveOnly(true); setPage(0); }}>
                활성만
              </Button>
              <Button size="sm" variant={!activeOnly ? 'default' : 'outline'} className="h-7 text-[11px]" onClick={() => { setActiveOnly(false); setPage(0); }}>
                전체
              </Button>
            </div>
          </div>

          {topProcesses.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t">
              <button
                type="button"
                onClick={() => { setSelectedProcess('all'); setPage(0); }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                  selectedProcess === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                전체 공종
              </button>
              {topProcesses.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { setSelectedProcess(p.label); setPage(0); }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                    selectedProcess === p.label ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {p.label} <span className="opacity-70">({p.count})</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Split View: Left Paginated List + Right Full Detail Preview */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-7 border-b lg:border-b-0 lg:border-r">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-muted/60 border-b text-muted-foreground">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">공종 · 세부작업</th>
                    <th className="py-2.5 px-3 font-medium">위험요인 &amp; 개선대책</th>
                    <th className="py-2.5 px-2 font-medium text-center w-20">전 → 후</th>
                    <th className="py-2.5 px-2 font-medium text-right w-14">빈도</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isSel = selectedRow?.id === r.id;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedId(r.id)}
                        className={`border-b cursor-pointer transition-colors ${isSel ? 'bg-primary/10' : 'hover:bg-muted/40'} ${!r.is_active ? 'opacity-50' : ''}`}
                      >
                        <td className="py-2.5 px-3 align-top">
                          <div className="font-semibold text-foreground">{r.process_label}</div>
                          <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{r.sub_task}</div>
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <div className="font-medium text-foreground line-clamp-1">{r.hazard}</div>
                          <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {r.improvement_measure || '개선대책 미등록'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-center whitespace-nowrap align-top">
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${getGradeClassName(r.risk_grade || '중')}`}>
                            {r.risk_grade || '중'}
                          </span>
                          <span className="mx-0.5 text-muted-foreground">→</span>
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${getGradeClassName(r.improved_risk_grade || '하')}`}>
                            {r.improved_risk_grade || '하'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-[11px] text-muted-foreground align-top">
                          {r.use_count}회
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td colSpan={4} className="p-10 text-center text-muted-foreground">
                        {loading ? '라이브러리 불러오는 중…' : '조건에 맞는 라이브러리 항목이 없습니다.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="px-3 py-2 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {filteredTotal > 0
                  ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filteredTotal)} / 총 ${filteredTotal.toLocaleString()}건`
                  : '0건'}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page <= 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="h-3.5 w-3.5" /> 이전
                </Button>
                <span className="px-2 font-mono text-[11px]">{page + 1} / {totalPages}</span>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                  다음 <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Right Detail Preview */}
          <div className="lg:col-span-5 p-4 bg-muted/15 max-h-[66vh] overflow-y-auto space-y-3.5">
            {selectedRow ? (
              <>
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-[10px]">{selectedRow.process_label}</Badge>
                      <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[selectedRow.source] || selectedRow.source}</Badge>
                      <span className="text-[11px] text-muted-foreground">사용 {selectedRow.use_count}회</span>
                    </div>
                    <h3 className="text-sm font-bold mt-1.5">{selectedRow.sub_task}</h3>
                  </div>
                  <Button size="sm" variant={selectedRow.is_active ? 'outline' : 'default'} className="h-7 text-xs shrink-0" onClick={() => toggleActive(selectedRow.id, selectedRow.is_active)}>
                    {selectedRow.is_active ? '비활성화' : '다시 활성'}
                  </Button>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="rounded-lg border bg-background p-3 space-y-1">
                    <div className="text-[11px] font-semibold text-muted-foreground">위험요인</div>
                    <div className="font-medium">{selectedRow.hazard}</div>
                    {selectedRow.hazard_situation && (
                      <p className="text-muted-foreground pt-1 border-t mt-1.5 leading-relaxed">{selectedRow.hazard_situation}</p>
                    )}
                  </div>

                  <div className="rounded-lg border bg-background p-3 space-y-1">
                    <div className="text-[11px] font-semibold text-muted-foreground">기존 대책</div>
                    <p className="leading-relaxed">{selectedRow.existing_measure || '—'}</p>
                  </div>

                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1">
                    <div className="text-[11px] font-semibold text-primary">개선 대책 (핵심)</div>
                    <p className="leading-relaxed font-medium">{selectedRow.improvement_measure || '—'}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-lg border bg-background p-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">개선 전</span>
                      <span className={`px-2 py-0.5 rounded font-bold text-xs ${getGradeClassName(selectedRow.risk_grade || '중')}`}>{selectedRow.risk_grade || '중'}</span>
                    </div>
                    <div className="rounded-lg border bg-background p-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">개선 후</span>
                      <span className={`px-2 py-0.5 rounded font-bold text-xs ${getGradeClassName(selectedRow.improved_risk_grade || '하')}`}>{selectedRow.improved_risk_grade || '하'}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-muted-foreground">보호구 · 법적근거</div>
                    <div className="flex flex-wrap gap-1">
                      {(selectedRow.ppe || []).map((p, i) => (
                        <Badge key={`ppe-${i}`} variant="secondary" className="text-[10px] font-normal">{p}</Badge>
                      ))}
                      {(selectedRow.legal_basis || []).map((l, i) => (
                        <Badge key={`leg-${i}`} variant="outline" className="text-[10px] font-normal">{l}</Badge>
                      ))}
                      {(!selectedRow.ppe || selectedRow.ppe.length === 0) && (!selectedRow.legal_basis || selectedRow.legal_basis.length === 0) && (
                        <span className="text-muted-foreground">미등록</span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full min-h-[280px] flex items-center justify-center text-xs text-muted-foreground">
                좌측 목록에서 항목을 선택하면 대책·보호구·법적근거 상세를 볼 수 있습니다.
              </div>
            )}
          </div>
        </div>
      </Card>

      {imports.length > 0 && (
        <div className="rounded-lg border bg-card px-4 py-3 space-y-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground">최근 엑셀·PDF 학습 이력</h2>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {imports.map((i) => (
              <span key={i.id} className="px-2 py-1 rounded bg-muted/50 border">
                [{i.status}] {i.source_kind} · {i.file_name || '-'} · {i.row_count}행 · {new Date(i.created_at).toLocaleDateString('ko-KR')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
