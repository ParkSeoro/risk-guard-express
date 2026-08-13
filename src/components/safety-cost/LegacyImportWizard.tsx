import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  buildCommitPreview,
  normalizeLegacyDraft,
  parseLegacyTextDraft,
  validateLegacyDraft,
  type LegacyImportDraft,
  type LegacyImportMonth,
} from '@/lib/safetyCostLegacyImport';
import { normalizePpeItemKey } from '@/lib/safetyCostPpeStock';
import { formatKRW } from '@/lib/safetyCost';
import { planCreateMonthlyReport } from '@/lib/safetyCostMonthly';
import { softRestorePayload } from '@/lib/dataAccess';
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
  safetyCostTotal?: number;
  existingApprovedTotal?: number;
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

async function upsertSku(params: {
  projectId: string;
  companyId: string;
  constructionId: string;
  item_name: string;
  specification?: string;
  maker?: string;
  unit?: string;
}) {
  const item_key = normalizePpeItemKey(params);
  const { data: existing } = await supabase
    .from('safety_cost_ppe_skus' as any)
    .select('id')
    .eq('construction_id', params.constructionId)
    .eq('item_key', item_key)
    .maybeSingle();
  if (existing) return (existing as any).id as string;
  const { data, error } = await supabase.from('safety_cost_ppe_skus' as any).insert({
    project_id: params.projectId,
    company_id: params.companyId,
    construction_id: params.constructionId,
    item_key,
    item_name: params.item_name,
    specification: params.specification || '',
    maker: params.maker || '',
    unit: params.unit || '개',
  }).select('id').single();
  if (error) throw error;
  return (data as any).id as string;
}

export function LegacyImportWizard({
  projectId, companyId, constructionId, constructionName,
  safetyCostTotal, existingApprovedTotal, userId, onCommitted,
}: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LegacyImportDraft | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');

  const validation = useMemo(
    () => (draft ? validateLegacyDraft(draft, { safetyCostTotal, existingApprovedTotal }) : null),
    [draft, safetyCostTotal, existingApprovedTotal],
  );
  const preview = useMemo(() => (draft ? buildCommitPreview(draft) : null), [draft]);
  const activeMonth = draft?.months.find((m) => m.report_month === selectedMonth) || draft?.months[0];

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
          extracted = normalizeLegacyDraft(data.draft);
          if (!extracted.months.length && text.trim()) {
            extracted = normalizeLegacyDraft({
              ...parseLegacyTextDraft(text),
              construction: extracted.construction,
              summary: { ...extracted.summary, notes: [...(extracted.summary?.notes || []), 'AI 월 추출 실패 → 텍스트 예비 추출 사용'] },
            });
          }
        } else if (text.trim()) {
          extracted = normalizeLegacyDraft(parseLegacyTextDraft(text));
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
    }).eq('id', batchId);
    toast({ title: '초안 저장됨' });
  }

  async function commitImport() {
    if (!draft || !batchId || !validation?.canCommit) return;
    if (!window.confirm('검수된 이관 초안을 승인 완료 월보로 확정합니다. 계속할까요?')) return;
    setCommitting(true);
    try {
      const included = draft.months.filter((m) => m.included !== false);
      for (const month of included) {
        const reportMonth = `${month.report_month}-01`;
        const lineTotal = month.items.reduce((s, it) => s + Number(it.amount || 0), 0);

        const { data: existingRows } = await supabase
          .from('safety_cost_monthly_reports' as any)
          .select('id, status, is_deleted, created_at, approval_version')
          .eq('construction_id', constructionId)
          .eq('report_month', reportMonth);

        const plan = planCreateMonthlyReport((existingRows || []) as any[]);
        let reportId: string | undefined;
        if (plan.action === 'open') {
          reportId = plan.row.id;
          if ((plan.row as any).status === 'approved') {
            throw new Error(`${month.report_month}: 이미 승인된 월보가 있어 이관할 수 없습니다.`);
          }
        } else if (plan.action === 'restore') {
          const { error: restoreError } = await supabase
            .from('safety_cost_monthly_reports' as any)
            .update(softRestorePayload())
            .eq('id', plan.row.id);
          if (restoreError) throw restoreError;
          reportId = plan.row.id;
        }

        if (!reportId) {
          const { data: created, error } = await supabase.from('safety_cost_monthly_reports' as any).insert({
            construction_id: constructionId,
            project_id: projectId,
            company_id: companyId,
            report_month: reportMonth,
            title: month.title || `${month.report_month} 산업안전보건관리비 사용내역서(이관)`,
            status: 'approved',
            report_total: lineTotal,
            source: 'legacy_import',
            import_batch_id: batchId,
            approved_at: new Date().toISOString(),
            approved_by: userId || null,
            created_by: userId || null,
          }).select('id').single();
          if (error) throw error;
          reportId = (created as any).id;
        } else {
          const { error } = await supabase.from('safety_cost_monthly_reports' as any).update({
            title: month.title || `${month.report_month} 산업안전보건관리비 사용내역서(이관)`,
            status: 'approved',
            report_total: lineTotal,
            source: 'legacy_import',
            import_batch_id: batchId,
            approved_at: new Date().toISOString(),
            approved_by: userId || null,
          }).eq('id', reportId);
          if (error) throw error;
          await supabase.from('safety_cost_items' as any).update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('report_id', reportId);
        }

        const itemRows = month.items.map((row, idx) => ({
          report_id: reportId,
          construction_id: constructionId,
          project_id: projectId,
          company_id: companyId,
          transaction_date: row.transaction_date || null,
          usage_date: row.usage_date || row.transaction_date || null,
          category_code: row.category_code || '',
          category_name: row.category_name || '',
          item_name: row.item_name,
          specification: row.specification || '',
          maker: row.maker || '',
          quantity: row.quantity || 1,
          unit: row.unit || '식',
          unit_price: row.unit_price || 0,
          supply_amount: row.supply_amount || row.amount,
          vat_amount: row.vat_amount || 0,
          amount: row.amount,
          supplier_name: row.supplier_name || '',
          classification_status: row.classification_status || 'review',
          ai_confidence: row.ai_confidence ?? null,
          ai_reason: row.ai_reason || '승인본 이관',
          legal_basis: row.legal_basis || '건설업 산업안전보건관리비 계상 및 사용기준',
          sort_order: idx,
          created_by: userId || null,
        }));

        const { data: insertedItems, error: itemErr } = await supabase
          .from('safety_cost_items' as any)
          .insert(itemRows)
          .select('id, category_code, item_name, specification, maker, quantity, unit, transaction_date');
        if (itemErr) throw itemErr;

        // 보호구 입고(수불)
        for (const it of ((insertedItems as any[]) || [])) {
          if (String(it.category_code) !== '3' || Number(it.quantity || 0) <= 0) continue;
          const skuId = await upsertSku({
            projectId, companyId, constructionId,
            item_name: it.item_name,
            specification: it.specification,
            maker: it.maker,
            unit: it.unit,
          });
          await supabase.from('safety_cost_ppe_stock_movements' as any).insert({
            project_id: projectId,
            company_id: companyId,
            construction_id: constructionId,
            sku_id: skuId,
            movement_type: 'in',
            quantity: Number(it.quantity),
            movement_date: it.transaction_date || reportMonth,
            source_type: 'import',
            source_item_id: it.id,
            import_batch_id: batchId,
            report_id: reportId,
            note: '승인본 이관 입고',
            created_by: userId || null,
          });
        }

        // 지급대장(스캔서명 이관) + 출고
        if (month.ppe_issuances?.length) {
          const { data: led, error: ledErr } = await supabase.from('safety_cost_ppe_ledgers' as any).upsert({
            project_id: projectId,
            company_id: companyId,
            construction_id: constructionId,
            report_id: reportId,
            site_label: constructionName || '',
            safety_manager_name: '',
            notes: '승인본 이관(스캔서명)',
            created_by: userId || null,
            is_deleted: false,
          }, { onConflict: 'report_id' }).select('id').single();
          if (ledErr) throw ledErr;
          const ledgerId = (led as any).id;
          for (const [idx, iss] of month.ppe_issuances.entries()) {
            const { data: entry, error: eErr } = await supabase.from('safety_cost_ppe_ledger_entries' as any).insert({
              ledger_id: ledgerId,
              project_id: projectId,
              company_id: companyId,
              issued_at: iss.issued_at || reportMonth,
              worker_name: iss.worker_name,
              item_name: iss.item_name,
              quantity: iss.quantity || 1,
              signature_data: iss.signature_note || 'legacy-scan',
              signed_at: new Date().toISOString(),
              sort_order: idx,
            }).select('id').single();
            if (eErr) throw eErr;
            const skuId = await upsertSku({
              projectId, companyId, constructionId,
              item_name: iss.item_name,
              unit: '개',
            });
            const { data: mov } = await supabase.from('safety_cost_ppe_stock_movements' as any).insert({
              project_id: projectId,
              company_id: companyId,
              construction_id: constructionId,
              sku_id: skuId,
              movement_type: 'out',
              quantity: iss.quantity || 1,
              movement_date: iss.issued_at || reportMonth,
              source_type: 'import',
              source_issuance_id: (entry as any).id,
              import_batch_id: batchId,
              report_id: reportId,
              note: '승인본 이관 지급출고',
              created_by: userId || null,
            }).select('id').single();
            if (mov) {
              await supabase.from('safety_cost_ppe_ledger_entries' as any)
                .update({ stock_movement_id: (mov as any).id })
                .eq('id', (entry as any).id);
            }
          }
        }

        // 원본 파일 증빙 연결
        const { data: batchRow } = await supabase
          .from('safety_cost_import_batches' as any)
          .select('source_file_name, source_file_path, source_file_url, source_mime_type')
          .eq('id', batchId)
          .single();
        if (batchRow) {
          await supabase.from('safety_cost_evidence_files' as any).insert({
            report_id: reportId,
            construction_id: constructionId,
            project_id: projectId,
            company_id: companyId,
            evidence_kind: 'legacy_pack',
            file_name: (batchRow as any).source_file_name,
            file_path: (batchRow as any).source_file_path,
            file_url: (batchRow as any).source_file_url,
            mime_type: (batchRow as any).source_mime_type || 'application/pdf',
            uploaded_by: userId || null,
            category_code: '',
          });
        }
      }

      const v = validateLegacyDraft(draft, { safetyCostTotal, existingApprovedTotal });
      await supabase.from('safety_cost_import_batches' as any).update({
        status: 'committed',
        draft_payload: draft,
        validation: v,
        review_notes: reviewNotes,
        committed_at: new Date().toISOString(),
        committed_by: userId || null,
      }).eq('id', batchId);

      await supabase.from('safety_cost_audit_logs' as any).insert({
        project_id: projectId,
        company_id: companyId,
        construction_id: constructionId,
        action: '승인본 이관 확정',
        target_type: 'safety_cost_import_batch',
        target_id: batchId,
        after_data: { preview, months: included.map((m) => m.report_month) },
        reason: reviewNotes || 'legacy_import',
        user_id: userId || null,
      });

      toast({ title: '이관 확정 완료', description: `${preview?.monthCount}개월 · ${formatKRW(preview?.totalAmount || 0)}` });
      setStep('upload');
      setDraft(null);
      setBatchId(null);
      onCommitted?.();
    } catch (e: any) {
      toast({ title: '이관 확정 실패', description: e.message || String(e), variant: 'destructive' });
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
                <p className="text-xs font-medium">{activeMonth.report_month} 항목 미리보기 (상위 30)</p>
                <div className="overflow-auto rounded-md border max-h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>비목</TableHead>
                        <TableHead>품명</TableHead>
                        <TableHead>수량</TableHead>
                        <TableHead>금액</TableHead>
                        <TableHead>공급자</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeMonth.items.slice(0, 30).map((it, idx) => (
                        <TableRow key={`${it.item_name}-${idx}`}>
                          <TableCell className="text-xs">{it.category_code || '—'}</TableCell>
                          <TableCell className="text-sm">{it.item_name}</TableCell>
                          <TableCell className="text-xs">{it.quantity} {it.unit}</TableCell>
                          <TableCell className="text-xs">{formatKRW(it.amount)}</TableCell>
                          <TableCell className="text-xs">{it.supplier_name || '—'}</TableCell>
                        </TableRow>
                      ))}
                      {activeMonth.items.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">항목 없음</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium">검수 이슈</p>
              {validation.issues.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> 확정 가능</div>
              ) : (
                <ul className="space-y-1">
                  {validation.issues.map((iss, i) => (
                    <li key={i} className="text-xs flex gap-2 items-start">
                      <Badge variant={iss.level === 'error' ? 'destructive' : 'secondary'}>{iss.level}</Badge>
                      <span>{iss.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1">
              <Label>검수 메모</Label>
              <Textarea rows={2} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="실사 예정, OCR 보정 사항 등" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={saveDraft}>초안 저장</Button>
              <Button variant="outline" onClick={() => { setStep('upload'); setDraft(null); setBatchId(null); }}>다시 업로드</Button>
              <Button onClick={commitImport} disabled={!validation.canCommit || committing} className="gap-1">
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
