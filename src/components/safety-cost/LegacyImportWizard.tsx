import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  buildCommitPreview,
  normalizeLegacyDraft,
  parseLegacyTextDraft,
  planLegacyCommitMonths,
  validateLegacyDraft,
  type LegacyImportDraft,
  type LegacyImportItem,
  type LegacyImportMonth,
} from '@/lib/safetyCostLegacyImport';
import { formatKRW, SAFETY_COST_CATEGORIES } from '@/lib/safetyCost';
import {
  ocrStatusBadge,
  ocrStatusBadgeVariant,
  ocrStatusLabel,
  summarizeOcrItems,
} from '@/lib/safetyCostOcr';
import { uploadAttachmentFile } from '@/lib/compressUploadFile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';

type Props = {
  projectId: string;
  companyId: string;
  constructionId: string;
  constructionName?: string;
  constructionAmount?: number;
  safetyCostTotal?: number;
  existingApprovedTotal?: number;
  liveReports?: Array<{ report_month?: string | null; status?: string | null; is_deleted?: boolean | null }>;
  userId?: string;
  onCommitted?: () => void;
};

const sanitizeStorageFileName = (fileName: string) => {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'}` : '';
  const baseName = fileName.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return `${baseName || 'document'}${extension}`;
};

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.onerror = () => reject(reader.error || new Error('파일을 읽을 수 없습니다.'));
  reader.readAsDataURL(file);
});

export function LegacyImportWizard({
  projectId, companyId, constructionId, constructionName,
  constructionAmount, safetyCostTotal, existingApprovedTotal, liveReports, userId, onCommitted,
}: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LegacyImportDraft | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [budgetConfirmed, setBudgetConfirmed] = useState(false);

  const validation = useMemo(
    () => (draft ? validateLegacyDraft(draft, { safetyCostTotal, existingApprovedTotal }) : null),
    [draft, safetyCostTotal, existingApprovedTotal],
  );
  const commitPlan = useMemo(
    () => (draft ? planLegacyCommitMonths(draft, liveReports || []) : null),
    [draft, liveReports],
  );
  const extractedBudget = Number(draft?.construction?.safety_cost_total || 0);
  const extractedContract = Number(draft?.construction?.construction_amount || 0);
  const canCommit = Boolean(validation?.canCommit && commitPlan?.ok && budgetConfirmed);
  const preview = useMemo(() => (draft ? buildCommitPreview(draft) : null), [draft]);
  const activeMonth = draft?.months.find((m) => m.report_month === selectedMonth) || draft?.months[0];
  const ocrSummary = useMemo(
    () => summarizeOcrItems((draft?.months || []).flatMap((m) => m.items)),
    [draft],
  );

  function patchItem(reportMonth: string, index: number, patch: Partial<LegacyImportItem>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const touchesValue = patch.item_name != null || patch.amount != null || patch.supplier_name != null;
      return {
        ...prev,
        months: prev.months.map((m) => {
          if (m.report_month !== reportMonth) return m;
          const items = m.items.map((it, i) => (
            i === index
              ? { ...it, ...patch, ...(touchesValue ? { ocr_status: 'user_edited' as const } : {}) }
              : it
          ));
          return { ...m, items };
        }),
      };
    });
  }

  function patchMonth(reportMonth: string, patch: Partial<LegacyImportMonth>) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        months: prev.months.map((m) => (m.report_month === reportMonth ? { ...m, ...patch } : m)),
      };
    });
  }

  async function extractFile(file: File) {
    setLoading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let text = '';
      if (ext === 'xlsx' || ext === 'xls') {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        text = wb.SheetNames.map((name) => XLSX.utils.sheet_to_csv(wb.Sheets[name])).join('\n');
      } else if (ext === 'csv' || ext === 'txt') {
        text = await file.text();
      }

      const safeName = sanitizeStorageFileName(file.name);
      // storage RLS: path must contain project UUID
      const path = `safety-cost/${projectId}/${constructionId}/legacy-import/${Date.now()}_${safeName}`;
      const uploaded = await uploadAttachmentFile(path, file);
      const urlData = { publicUrl: uploaded.publicUrl };

      const canAnalyzeFile = ext === 'pdf' || (file.type || '').startsWith('image/');
      let extracted: LegacyImportDraft = parseLegacyTextDraft(text);
      try {
        const { data, error } = await supabase.functions.invoke('analyze-safety-cost-document', {
          body: {
            mode: 'legacy_pack',
            text,
            fileName: file.name,
            fileBase64: canAnalyzeFile ? await fileToBase64(file) : undefined,
            mimeType: file.type || (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
          },
        });
        if (!error && data?.draft) {
          extracted = normalizeLegacyDraft({
            ...data.draft,
            extraction_warning: [data.draft.extraction_warning, data.warning].filter(Boolean).join(' · ') || undefined,
          });
          if (!extracted.months.length && text.trim()) {
            extracted = normalizeLegacyDraft({
              ...parseLegacyTextDraft(text),
              construction: extracted.construction,
              summary: { ...extracted.summary, notes: [...(extracted.summary?.notes || []), 'AI 월 추출 실패 → 텍스트 예비 추출 사용'] },
              extraction_warning: [extracted.extraction_warning, data.warning].filter(Boolean).join(' · ') || undefined,
            });
          }
        } else if (text.trim()) {
          extracted = normalizeLegacyDraft({
            ...parseLegacyTextDraft(text),
            extraction_warning: [parseLegacyTextDraft(text).extraction_warning, data?.warning].filter(Boolean).join(' · ') || undefined,
          });
        }
      } catch {
        if (text.trim()) extracted = normalizeLegacyDraft(parseLegacyTextDraft(text));
      }

      extracted = normalizeLegacyDraft(extracted);
      const validationNow = validateLegacyDraft(extracted, { safetyCostTotal, existingApprovedTotal });

      const { data: batch, error: batchErr } = await supabase.from('safety_cost_import_batches' as any).insert({
        project_id: projectId,
        company_id: companyId,
        construction_id: constructionId,
        status: 'reviewing',
        source_file_name: file.name,
        source_file_path: path,
        source_file_url: urlData.publicUrl,
        source_mime_type: file.type || '',
        draft_payload: extracted,
        validation: validationNow,
        created_by: userId || null,
      }).select('id').single();
      if (batchErr) throw batchErr;

      setBatchId((batch as any).id);
      setDraft(extracted);
      setSelectedMonth(extracted.months[0]?.report_month || '');
      setBudgetConfirmed(false);
      setStep('review');
      toast({
        title: '이관 초안 생성',
        description: `${extracted.months.length}개월 · 항목 ${buildCommitPreview(extracted).itemCount}건 — 검수 후 확정하세요.`,
      });
    } catch (e: any) {
      toast({ title: '이관 추출 실패', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    if (!batchId || !draft) return;
    const v = validateLegacyDraft(draft, { safetyCostTotal, existingApprovedTotal });
    await supabase.from('safety_cost_import_batches' as any).update({
      draft_payload: draft,
      validation: v,
      review_notes: reviewNotes,
      status: 'reviewing',
      budget_confirmed: budgetConfirmed,
    }).eq('id', batchId);
    toast({ title: '초안 저장됨' });
  }

  async function commitImport() {
    if (!draft || !batchId || !canCommit) return;
    if (!window.confirm('검수된 이관 초안을 승인 완료 월보로 확정합니다. 계속할까요?')) return;
    setCommitting(true);
    try {
      const v = validateLegacyDraft(draft, { safetyCostTotal, existingApprovedTotal });
      const { error: saveErr } = await supabase.from('safety_cost_import_batches' as any).update({
        draft_payload: draft,
        validation: v,
        review_notes: reviewNotes,
        status: 'reviewing',
        budget_confirmed: true,
      }).eq('id', batchId);
      if (saveErr) throw saveErr;

      const { data, error } = await supabase.rpc('commit_safety_cost_legacy_import', { _batch_id: batchId });
      if (error) throw error;
      const result = data as { ok?: boolean; month_count?: number; total?: number };

      toast({
        title: '이관 확정 완료',
        description: `${result?.month_count ?? preview?.monthCount}개월 · ${formatKRW(result?.total ?? preview?.totalAmount ?? 0)}`,
      });
      setStep('upload');
      setDraft(null);
      setBatchId(null);
      setBudgetConfirmed(false);
      onCommitted?.();
    } catch (e: any) {
      const msg = e.message || String(e);
      const hint = /already_committed/i.test(msg) ? '이미 확정된 배치입니다.'
        : /live_month_exists/i.test(msg) ? '이미 해당 월 내역서가 있습니다.'
        : /over_budget/i.test(msg) ? '승인누계+이관금액이 계상액을 초과합니다.'
        : /budget_not_confirmed/i.test(msg) ? '계상액 확인 후 확정하세요.'
        : /insufficient_ppe_stock/i.test(msg) ? '보호구 재고가 부족합니다.'
        : msg;
      toast({ title: '이관 확정 실패', description: hint, variant: 'destructive' });
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileUp className="h-4 w-4" />
          승인본 일괄 이관
          <Badge variant="secondary">추출 → 검수 → 확정</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          시스템 사용 전 발주처 승인된 사용내역서(PDF/엑셀)를 올리면 월보·금액·비목·거래라인·보호구 수불/지급 초안을 만듭니다.
          자동 확정하지 않으며, 숫자 대조 후 확정해야 승인누계에 반영됩니다.
        </p>

        {step === 'upload' && (
          <div className="space-y-3">
            <Label className="inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
              <Upload className="h-4 w-4" />
              {loading ? '추출 중…' : '승인본 업로드'}
              <Input
                type="file"
                accept=".pdf,.xls,.xlsx,.csv,.txt,image/*"
                className="hidden"
                disabled={loading}
                onChange={(e) => e.target.files?.[0] && extractFile(e.target.files[0])}
              />
            </Label>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> OCR/구조 추출 중…
              </div>
            )}
          </div>
        )}

        {step === 'review' && draft && validation && (
          <div className="space-y-4">
            {draft.extraction_warning && (
              <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 p-2 text-xs flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                {draft.extraction_warning}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              OCR 원문 {ocrSummary.rawChars}자 · 신뢰도 낮음 {ocrSummary.lowCount}건 · AI 보정 {ocrSummary.correctedCount}건
              {ocrSummary.fallbackCount ? ` · 예비 추출 ${ocrSummary.fallbackCount}건` : ''}
            </p>

            <div className="grid gap-2 md:grid-cols-4 text-sm">
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">포함 월</p><p className="font-semibold">{preview?.monthCount}개월</p></div>
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">항목</p><p className="font-semibold">{preview?.itemCount}건</p></div>
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">이관 금액</p><p className="font-semibold">{formatKRW(preview?.totalAmount || 0)}</p></div>
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">보호구 입고/지급</p><p className="font-semibold">{preview?.ppeInboundCount}/{preview?.ppeIssuanceCount}</p></div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium">월별 포함·총액 대조</p>
              <div className="overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">포함</TableHead>
                      <TableHead>월</TableHead>
                      <TableHead>항목</TableHead>
                      <TableHead>라인합</TableHead>
                      <TableHead>신고총액</TableHead>
                      <TableHead>차이</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.months.map((m) => {
                      const check = validation.monthChecks.find((c) => c.report_month === m.report_month);
                      const line = check?.lineTotal ?? m.items.reduce((s, it) => s + Number(it.amount || 0), 0);
                      const declared = m.declared_total ?? line;
                      return (
                        <TableRow
                          key={m.report_month}
                          className={selectedMonth === m.report_month ? 'bg-muted/40' : undefined}
                          onClick={() => setSelectedMonth(m.report_month)}
                        >
                          <TableCell>
                            <Checkbox
                              checked={m.included !== false}
                              onCheckedChange={(v) => patchMonth(m.report_month, { included: Boolean(v) })}
                            />
                          </TableCell>
                          <TableCell className="text-sm font-medium">{m.report_month}</TableCell>
                          <TableCell>{m.items.length}</TableCell>
                          <TableCell>{formatKRW(line)}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-8 w-32"
                              value={declared}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => patchMonth(m.report_month, { declared_total: Number(e.target.value || 0) })}
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant={Math.abs(line - Number(declared)) <= 1 ? 'default' : 'destructive'}>
                              {formatKRW(line - Number(declared))}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {activeMonth && (
              <div className="space-y-2">
                <p className="text-xs font-medium">{activeMonth.report_month} 항목 (금액·비목 수정)</p>
                <div className="overflow-auto rounded-md border max-h-80">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>비목</TableHead>
                        <TableHead>품명</TableHead>
                        <TableHead>수량</TableHead>
                        <TableHead>금액</TableHead>
                        <TableHead>공급자</TableHead>
                        <TableHead>판독</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeMonth.items.map((it, idx) => (
                        <TableRow
                          key={`${it.item_name}-${idx}`}
                          className={it.ocr_status === 'ocr_low' || it.ocr_status === 'no_vision' || it.ocr_status === 'rule_fallback' ? 'bg-amber-50/70 dark:bg-amber-950/20' : undefined}
                        >
                          <TableCell>
                            <Input
                              className="h-8 w-16"
                              value={it.category_code || ''}
                              onChange={(e) => patchItem(activeMonth.report_month, idx, { category_code: e.target.value })}
                              placeholder="1-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-8 min-w-[140px]"
                              value={it.item_name}
                              onChange={(e) => patchItem(activeMonth.report_month, idx, { item_name: e.target.value })}
                            />
                          </TableCell>
                          <TableCell className="text-xs">{it.quantity} {it.unit}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-8 w-28"
                              value={it.amount}
                              onChange={(e) => patchItem(activeMonth.report_month, idx, { amount: Number(e.target.value || 0) })}
                            />
                          </TableCell>
                          <TableCell className="text-xs">{it.supplier_name || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={ocrStatusBadgeVariant(it.ocr_status)} title={ocrStatusLabel(it.ocr_status)}>
                              {ocrStatusBadge(it.ocr_status) || '—'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {activeMonth.items.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">항목 없음</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-[11px] text-muted-foreground">비목 코드 {SAFETY_COST_CATEGORIES.map((c) => c.code).join(', ')}</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium">검수 이슈</p>
              {validation.issues.length === 0 && commitPlan?.ok ? (
                <div className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> 확정 가능</div>
              ) : (
                <ul className="space-y-1">
                  {validation.issues.map((iss, i) => (
                    <li key={i} className="text-xs flex gap-2 items-start">
                      <Badge variant={iss.level === 'error' ? 'destructive' : 'secondary'}>{iss.level}</Badge>
                      <span>{iss.message}</span>
                    </li>
                  ))}
                  {commitPlan?.blockers.map((b, i) => (
                    <li key={`live-${i}`} className="text-xs flex gap-2 items-start">
                      <Badge variant="destructive">error</Badge>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-medium">계상액 확인</p>
              <div className="grid gap-2 md:grid-cols-2 text-xs">
                <div>공사 등록 계상액: <b>{formatKRW(safetyCostTotal || 0)}</b></div>
                <div>추출 계상액: <b>{extractedBudget ? formatKRW(extractedBudget) : '없음'}</b></div>
                <div>공사금액(등록): {formatKRW(constructionAmount || 0)}</div>
                <div>공사금액(추출): {extractedContract ? formatKRW(extractedContract) : '없음'}</div>
              </div>
              {extractedBudget > 0 && Math.abs(extractedBudget - Number(safetyCostTotal || 0)) > 1 && (
                <p className="text-xs text-amber-700">추출 계상액과 등록 계상액이 다릅니다. 등록값을 기준으로 검사합니다.</p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={budgetConfirmed} onCheckedChange={(v) => setBudgetConfirmed(Boolean(v))} />
                이 공사의 계상액이 맞음을 확인합니다.
              </label>
            </div>

            <div className="space-y-1">
              <Label>검수 메모</Label>
              <Textarea rows={2} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="실사 예정, OCR 보정 사항 등" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={saveDraft}>초안 저장</Button>
              <Button variant="outline" onClick={() => { setStep('upload'); setDraft(null); setBatchId(null); }}>다시 업로드</Button>
              <Button onClick={commitImport} disabled={!canCommit || committing} className="gap-1">
                {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                이관 확정
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default LegacyImportWizard;
