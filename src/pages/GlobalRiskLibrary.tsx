/**
 * Master-only: system-wide risk library browse / learn / import.
 * Heavy ops are explicit button clicks — never runs on page load beyond a capped list.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  createLibraryImportDraft,
  downloadGlobalRiskLibraryExcelTemplate,
  ingestApprovedRunsToLibrary,
  mapGlobalRiskLibraryExcelRows,
  publishLibraryImport,
} from '@/lib/globalRiskLibrary';
import * as XLSX from 'xlsx';
import { Loader2, Database, FileSpreadsheet, FileText, Download } from 'lucide-react';

type LibRow = {
  id: string;
  process_label: string;
  sub_task: string;
  hazard: string;
  hazard_type: string | null;
  work_phase: string | null;
  use_count: number;
  source: string;
  is_active: boolean;
};

type ImportRow = {
  id: string;
  status: string;
  source_kind: string;
  file_name: string | null;
  row_count: number;
  created_at: string;
};

export default function GlobalRiskLibrary() {
  const { hasRole } = useAuth();
  const isMaster = hasRole('master');
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LibRow[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfNotes, setPdfNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('global_risk_library' as any)
        .select(
          'id, process_label, sub_task, hazard, hazard_type, work_phase, use_count, source, is_active',
        )
        .order('use_count', { ascending: false })
        .limit(80);
      if (q.trim()) {
        query = query.or(
          `process_label.ilike.%${q.trim()}%,sub_task.ilike.%${q.trim()}%,hazard.ilike.%${q.trim()}%`,
        );
      }
      const [libRes, impRes] = await Promise.all([
        query,
        supabase
          .from('global_risk_library_imports' as any)
          .select('id, status, source_kind, file_name, row_count, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (libRes.error) throw libRes.error;
      setRows((libRes.data || []) as any);
      setImports((impRes.data || []) as any);
    } catch (e: any) {
      toast({ title: '불러오기 실패', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [q, toast]);

  useEffect(() => {
    if (isMaster) load();
  }, [isMaster, load]);

  if (!isMaster) return <Navigate to="/app/admin" replace />;

  const onIngestDb = async () => {
    setBusy('ingest');
    try {
      const res = await ingestApprovedRunsToLibrary(40);
      toast({
        title: '승인 위평 학습 완료',
        description: `run ${res.runs}건 · upsert ${res.upserted}건`,
      });
      await load();
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
      await load();
    } catch (e: any) {
      toast({ title: '엑셀 학습 실패', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const onPdf = async (file: File) => {
    setBusy('pdf');
    try {
      // PDF text extract via browser is limited; store as draft for master review + optional AI later.
      // We keep payload as a single note row so publish doesn't pollute library with garbage.
      const id = await createLibraryImportDraft({
        sourceKind: 'pdf',
        fileName: file.name,
        rows: [],
        notes:
          (pdfNotes || '') +
          `\n[PDF 업로드] ${file.name} (${file.size} bytes). ` +
          `표 추출은 엑셀 템플릿 변환 후 재업로드를 권장. 필요 시 AI 추출 파이프라인 연결.`,
      });
      toast({
        title: 'PDF 접수(검수 대기)',
        description: `import ${id.slice(0, 8)}… — 표가 있는 엑셀로 변환 후 업로드하면 바로 반영됩니다.`,
      });
      await load();
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
    else await load();
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">전역 위험성평가 라이브러리</h1>
        <p className="text-sm text-muted-foreground mt-1">
          시스템 공용. 승인된 위평이 자동 승격되며, 마스터가 DB/엑셀로 추가 학습할 수 있습니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={onIngestDb} disabled={!!busy} size="sm">
          {busy === 'ingest' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Database className="h-4 w-4 mr-1" />}
          승인 위평 일괄 학습
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => downloadGlobalRiskLibraryExcelTemplate()}
        >
          <Download className="h-4 w-4 mr-1" />
          양식 다운로드
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!busy}
          onClick={() => document.getElementById('grl-excel')?.click()}
        >
          {busy === 'excel' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
          엑셀 업로드
        </Button>
        <input
          id="grl-excel"
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onExcel(f);
            e.target.value = '';
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => document.getElementById('grl-pdf')?.click()}
        >
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
          PDF 접수
        </Button>
        <input
          id="grl-pdf"
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPdf(f);
            e.target.value = '';
          }}
        />
        <span className="text-xs text-muted-foreground">
          양식을 받아 채운 뒤 업로드하세요. 필수: 공종, 세부작업, 위험요인
        </span>
      </div>

      <Textarea
        placeholder="PDF 접수 시 메모(선택)"
        value={pdfNotes}
        onChange={(e) => setPdfNotes(e.target.value)}
        className="max-w-xl text-sm"
        rows={2}
      />

      <div className="flex gap-2">
        <Input
          placeholder="공종·세부작업·위험요인 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '검색'}
        </Button>
      </div>

      <div className="border rounded-md overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">공종</th>
              <th className="p-2">단계</th>
              <th className="p-2">세부작업</th>
              <th className="p-2">위험요인</th>
              <th className="p-2">유형</th>
              <th className="p-2">사용</th>
              <th className="p-2">출처</th>
              <th className="p-2">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{r.process_label}</td>
                <td className="p-2">{r.work_phase || '-'}</td>
                <td className="p-2">{r.sub_task}</td>
                <td className="p-2">{r.hazard}</td>
                <td className="p-2">{r.hazard_type || '-'}</td>
                <td className="p-2">{r.use_count}</td>
                <td className="p-2">{r.source}</td>
                <td className="p-2">
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(r.id, r.is_active)}>
                    {r.is_active ? '활성' : '비활성'}
                  </Button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  {loading ? '로딩…' : '항목 없음 — 승인 위평 학습 또는 엑셀 업로드'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {imports.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">최근 학습/접수</h2>
          <ul className="text-xs text-muted-foreground space-y-1">
            {imports.map((i) => (
              <li key={i.id}>
                [{i.status}] {i.source_kind} · {i.file_name || '-'} · {i.row_count}행 ·{' '}
                {new Date(i.created_at).toLocaleString('ko-KR')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
