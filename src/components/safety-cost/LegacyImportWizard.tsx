import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { uploadAttachmentFile } from '@/lib/compressUploadFile';
import {
  SAFETY_COST_CATEGORIES,
  SAFETY_COST_CATEGORY_SHORT,
  emptySafetyCostByCategory,
  formatKRW,
} from '@/lib/safetyCost';
import {
  mapLegacyCommitError,
  parseWonInput,
  suggestNextImportMonth,
  validateCategoryGrid,
  type LiveMonthRow,
} from '@/lib/safetyCostLegacyImport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, Loader2, Plus, Trash2, Upload } from 'lucide-react';

type ArchiveFile = {
  id: string;
  file_name?: string;
  file_url?: string;
  file_path?: string;
  created_at?: string;
  evidence_kind?: string;
  construction_id?: string;
};

type FormRow = {
  key: string;
  report_month: string;
  amounts: Record<string, string>;
  declaredTotal: string;
  included: boolean;
};

type Props = {
  projectId: string;
  companyId: string;
  constructionId: string;
  userId?: string;
  files?: ArchiveFile[];
  liveReports?: LiveMonthRow[];
  safetyCostTotal?: number;
  existingApprovedTotal?: number;
  existingApprovedByCategory?: Record<string, number>;
  onChanged?: () => void;
};

const EMPTY_BY_CAT = emptySafetyCostByCategory();

const emptyAmountInputs = () => {
  const amounts: Record<string, string> = {};
  SAFETY_COST_CATEGORIES.forEach((c) => { amounts[c.code] = ''; });
  return amounts;
};

function WonInput({
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <Input
      inputMode="numeric"
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ''))}
      className="h-8 w-[6.5rem] px-1.5 text-right text-xs tabular-nums"
      placeholder="0"
    />
  );
}

export function LegacyImportWizard({
  projectId, companyId, constructionId, userId, files, liveReports, safetyCostTotal,
  existingApprovedTotal, existingApprovedByCategory, onChanged,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [budgetChecked, setBudgetChecked] = useState(false);
  const [declaredCumulative, setDeclaredCumulative] = useState('');
  const seq = useRef(0);
  const [rows, setRows] = useState<FormRow[]>([]);

  const archives = (files || []).filter(
    (f) => f.construction_id === constructionId && f.evidence_kind === 'legacy_pack',
  );
  const liveMonths = (liveReports || [])
    .filter((r) => !r.is_deleted)
    .map((r) => String(r.report_month || '').slice(0, 7));
  const priorByCat = existingApprovedByCategory || EMPTY_BY_CAT;

  useEffect(() => {
    seq.current = 0;
    setRows([]);
    setBudgetChecked(false);
    setDeclaredCumulative('');
  }, [constructionId]);

  const parsedRows = useMemo(() => rows.map((row) => {
    const amounts = emptySafetyCostByCategory();
    SAFETY_COST_CATEGORIES.forEach((c) => { amounts[c.code] = parseWonInput(row.amounts[c.code]); });
    const declaredRaw = row.declaredTotal.trim();
    return {
      report_month: row.report_month,
      amounts,
      declared_total: declaredRaw === '' ? null : parseWonInput(declaredRaw),
      included: row.included,
    };
  }), [rows]);

  const declaredCumRaw = declaredCumulative.trim();
  const validation = useMemo(() => validateCategoryGrid(parsedRows, {
    safetyCostTotal,
    existingApprovedTotal,
    existingApprovedByCategory: priorByCat,
    liveReports,
    declaredCumulative: declaredCumRaw === '' ? null : parseWonInput(declaredCumRaw),
  }), [parsedRows, safetyCostTotal, existingApprovedTotal, priorByCat, liveReports, declaredCumRaw]);

  const afterApproved = Number(existingApprovedTotal || 0) + validation.summary.importTotal;
  const remain = Number(safetyCostTotal || 0) - afterApproved;
  const errors = validation.issues.filter((i) => i.level === 'error');
  const warnings = validation.issues.filter((i) => i.level === 'warning');

  function makeRow(month: string): FormRow {
    seq.current += 1;
    return {
      key: `m${seq.current}-${month}`,
      report_month: month,
      amounts: emptyAmountInputs(),
      declaredTotal: '',
      included: true,
    };
  }

  function addMonth() {
    const next = suggestNextImportMonth(rows.map((r) => r.report_month), liveMonths);
    setRows((prev) => [...prev, makeRow(next)]);
  }

  function updateRow(key: string, patch: Partial<FormRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function updateAmount(key: string, code: string, value: string) {
    setRows((prev) => prev.map((r) => (
      r.key === key ? { ...r, amounts: { ...r.amounts, [code]: value } } : r
    )));
  }

  async function attachFile(file: File) {
    setLoading(true);
    try {
      const extension = file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'}` : '';
      const baseName = file.name.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
      const safeName = `${baseName || 'document'}${extension}`;
      const path = `safety-cost/${projectId}/${constructionId}/legacy-import/${Date.now()}_${safeName}`;
      const uploaded = await uploadAttachmentFile(path, file);
      const { error } = await supabase.from('safety_cost_evidence_files' as any).insert({
        project_id: projectId,
        company_id: companyId,
        construction_id: constructionId,
        report_id: null,
        evidence_kind: 'legacy_pack',
        file_name: uploaded.file.name,
        file_path: uploaded.path,
        file_url: uploaded.publicUrl,
        mime_type: uploaded.file.type || file.type || 'application/octet-stream',
        file_size: uploaded.finalBytes,
        uploaded_by: userId || null,
      });
      if (error) throw error;
      toast({ title: '승인본을 보관했습니다.', description: '아래 총괄표에 비목 금액을 적은 뒤 이관 확정하세요.' });
      onChanged?.();
    } catch (e: any) {
      toast({ title: '승인본 보관 실패', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function removeFile(id: string) {
    if (!window.confirm('이 보관 파일을 삭제할까요?')) return;
    const { error } = await supabase.from('safety_cost_evidence_files' as any).delete().eq('id', id);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '보관 파일을 삭제했습니다.' });
    onChanged?.();
  }

  async function commit() {
    if (!validation.canCommit) {
      toast({ title: '이관할 수 없습니다.', description: errors[0]?.message || '비목 금액과 합계를 확인하세요.', variant: 'destructive' });
      return;
    }
    if (!budgetChecked) {
      toast({ title: '계상총액 대조를 확인하세요.', variant: 'destructive' });
      return;
    }
    const ok = window.confirm(
      `${validation.monthChecks.length}개월 · 이관 합계 ${formatKRW(validation.summary.importTotal)}\n이관 후 승인 누계 ${formatKRW(afterApproved)} / 계상 ${formatKRW(safetyCostTotal || 0)}\n전자결재 없이 승인됩니다. 확정할까요?`,
    );
    if (!ok) return;
    setCommitting(true);
    const pack = archives[0];
    let batchId: string | null = null;
    try {
      const { data: batch, error: insErr } = await supabase.from('safety_cost_import_batches' as any).insert({
        project_id: projectId,
        company_id: companyId,
        construction_id: constructionId,
        status: 'reviewing',
        source_file_name: pack?.file_name || '',
        source_file_path: pack?.file_path || '',
        source_file_url: pack?.file_url || '',
        source_mime_type: '',
        draft_payload: validation.draft,
        validation: {
          issues: validation.issues,
          monthChecks: validation.monthChecks,
          computedCumulative: validation.computedCumulative,
        },
        budget_confirmed: true,
        created_by: userId || null,
      }).select('id').single();
      if (insErr) throw insErr;
      batchId = (batch as any)?.id;
      if (!batchId) throw new Error('이관 배치를 만들지 못했습니다.');
      const { error: rpcErr } = await supabase.rpc('commit_safety_cost_legacy_import', { _batch_id: batchId });
      if (rpcErr) throw rpcErr;
      toast({
        title: '이관이 확정되었습니다.',
        description: `${validation.monthChecks.length}개월 · ${formatKRW(validation.summary.importTotal)}이 승인 누계·비목 누계에 반영되었습니다.`,
      });
      setRows([]);
      setBudgetChecked(false);
      setDeclaredCumulative('');
      onChanged?.();
    } catch (e: any) {
      if (batchId) {
        await supabase.from('safety_cost_import_batches' as any).update({ status: 'cancelled' }).eq('id', batchId);
      }
      toast({
        title: '이관 확정 실패',
        description: mapLegacyCommitError(e.message || String(e), e.hint),
        variant: 'destructive',
      });
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" />
          승인본 이관
          <Badge variant="secondary">총괄 비목 금액</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          발주처 승인본은 보관하고, 1페이지 총괄표의 <b>금월</b> 칸을 비목 1~9에 그대로 적습니다.
          비목 합이 그달 총액과 같아야 다음 달 총괄의 전월·누계가 맞습니다. 거래명세는 적지 않습니다.
          확정하면 전자결재 없이 승인 월보가 됩니다. 보호구(3번)는 금액만 반영하고 재고·지급대장은 맞추지 않습니다.
        </p>

        <div className="space-y-2">
          <Label className="inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {loading ? '올리는 중…' : '승인본 첨부'}
            <Input
              type="file"
              accept=".pdf,.xls,.xlsx,.csv,.txt,image/*"
              className="hidden"
              disabled={loading || committing}
              onChange={(e) => e.target.files?.[0] && attachFile(e.target.files[0])}
            />
          </Label>
          {archives.length > 0 && (
            <ul className="space-y-1">
              {archives.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-xs rounded-md border px-2 py-1.5">
                  <a href={f.file_url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
                    {f.file_name || '승인본'}
                  </a>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => removeFile(f.id)} aria-label="보관 파일 삭제">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">이관 총괄 입력</p>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={addMonth} disabled={committing}>
              <Plus className="h-3.5 w-3.5" /> 월 추가
            </Button>
          </div>
          {Number(existingApprovedTotal || 0) > 0 && (
            <p className="text-[11px] text-muted-foreground">
              기존 승인 누계 {formatKRW(existingApprovedTotal || 0)}
              {SAFETY_COST_CATEGORIES.some((c) => Number(priorByCat[c.code] || 0) > 0) ? ' · 비목 전월은 아래 누계 행에 포함됩니다.' : ''}
            </p>
          )}
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[8.5rem]">작성월</TableHead>
                  {SAFETY_COST_CATEGORIES.map((c) => (
                    <TableHead key={c.code} className="text-right min-w-[7rem]" title={c.name}>
                      {c.code}.{SAFETY_COST_CATEGORY_SHORT[c.code]}
                    </TableHead>
                  ))}
                  <TableHead className="text-right min-w-[6.5rem]">금월 합</TableHead>
                  <TableHead className="text-right min-w-[7rem]">문서 금월계</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Number(existingApprovedTotal || 0) > 0 && (
                  <TableRow className="bg-muted/40">
                    <TableCell className="text-xs text-muted-foreground">기존 승인</TableCell>
                    {SAFETY_COST_CATEGORIES.map((c) => (
                      <TableCell key={c.code} className="text-right text-xs tabular-nums text-muted-foreground">
                        {Number(priorByCat[c.code] || 0) ? Number(priorByCat[c.code]).toLocaleString() : '—'}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-xs tabular-nums">{Number(existingApprovedTotal || 0).toLocaleString()}</TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                )}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-xs text-muted-foreground py-6 text-center">
                      월 추가로 과거 승인월을 만들고, 승인본 총괄표 금월 칸을 적으세요.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row, idx) => {
                  const parsed = parsedRows[idx];
                  const monthTotal = parsed ? SAFETY_COST_CATEGORIES.reduce((s, c) => s + Number(parsed.amounts[c.code] || 0), 0) : 0;
                  const declaredMismatch = parsed?.declared_total != null && Math.abs(monthTotal - parsed.declared_total) > 1;
                  return (
                    <TableRow key={row.key}>
                      <TableCell>
                        <Input
                          type="month"
                          value={row.report_month}
                          disabled={committing}
                          onChange={(e) => updateRow(row.key, { report_month: e.target.value })}
                          className="h-8 w-[9.5rem]"
                          aria-label="이관 작성월"
                        />
                      </TableCell>
                      {SAFETY_COST_CATEGORIES.map((c) => (
                        <TableCell key={c.code} className="p-1">
                          <WonInput
                            value={row.amounts[c.code]}
                            disabled={committing}
                            aria-label={`${row.report_month} ${c.code} ${SAFETY_COST_CATEGORY_SHORT[c.code]}`}
                            onChange={(v) => updateAmount(row.key, c.code, v)}
                          />
                        </TableCell>
                      ))}
                      <TableCell className={`text-right text-xs tabular-nums ${declaredMismatch ? 'text-destructive font-medium' : ''}`}>
                        {monthTotal.toLocaleString()}
                      </TableCell>
                      <TableCell className="p-1">
                        <WonInput
                          value={row.declaredTotal}
                          disabled={committing}
                          aria-label={`${row.report_month} 문서 금월계`}
                          onChange={(v) => updateRow(row.key, { declaredTotal: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={committing} onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))} aria-label="월 삭제">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length > 0 && (
                  <TableRow className="bg-muted/30 font-medium">
                    <TableCell className="text-xs">이관 후 비목 누계</TableCell>
                    {SAFETY_COST_CATEGORIES.map((c) => (
                      <TableCell key={c.code} className="text-right text-xs tabular-nums">
                        {Number(validation.summary.afterCumulatives[c.code] || 0).toLocaleString()}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-xs tabular-nums">{validation.summary.importTotal.toLocaleString()}</TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">이관 합계</p>
            <p className="font-semibold tabular-nums">{formatKRW(validation.summary.importTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">이관 후 승인 누계</p>
            <p className="font-semibold tabular-nums">{formatKRW(afterApproved)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">계상총액</p>
            <p className="font-semibold tabular-nums">{formatKRW(safetyCostTotal || 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">이관 후 잔여</p>
            <p className={`font-semibold tabular-nums ${remain < 0 ? 'text-destructive' : ''}`}>{formatKRW(remain)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">문서 최종 누계 (선택)</Label>
            <WonInput value={declaredCumulative} onChange={setDeclaredCumulative} aria-label="문서 최종 누계" disabled={committing} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={budgetChecked}
              disabled={committing}
              onCheckedChange={(v) => setBudgetChecked(v === true)}
            />
            계상총액·비목 합계를 승인본과 대조했습니다
          </label>
        </div>

        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>확정 전에 고칠 항목</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 space-y-0.5">
                {errors.slice(0, 8).map((i) => <li key={`${i.code}-${i.message}`}>{i.message}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {warnings.length > 0 && errors.length === 0 && (
          <Alert>
            <AlertTitle>확인</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 space-y-0.5">
                {warnings.map((i) => <li key={`${i.code}-${i.message}`}>{i.message}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="button"
          onClick={commit}
          disabled={committing || !validation.canCommit || !budgetChecked}
        >
          {committing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          {committing ? '확정 중…' : '이관 확정 (승인 누계 반영)'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default LegacyImportWizard;
