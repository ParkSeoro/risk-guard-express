import { useState, useEffect, useCallback, useRef } from 'react';
import { generateAttachments, withKind, type AttachmentItem } from '@/lib/attachmentTemplates';
import {
  syncTemplateRows,
  computeAttachmentProgress,
  CUSTOM_ATTACHMENT_KEY_PREFIX,
  isCustomAttachmentKey,
  type AttachmentProgress,
} from '@/lib/workPlanAttachments';
import { supabase } from '@/integrations/supabase/client';
import { resolveArchivedUrl } from '@/lib/archiveUrlResolver';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Paperclip, Upload, CheckCircle2, Lock, Bot, FileWarning, Loader2, Printer,
  ClipboardPaste, Inbox, Trash2, MousePointerClick, Plus, Sparkles, AlertTriangle,
  Archive, BookmarkPlus, Scissors,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { uploadAttachmentFile, formatBytes } from '@/lib/compressUploadFile';
import {
  analyzeWorkPlanAttachmentFile,
} from '@/lib/workPlanOcrClient';
import {
  buildAttachmentOcrDbPatch,
  calcExpiryDaysRemaining,
  classifyOcrFileSupport,
  evaluateExpiryStatus,
  type WorkPlanAttachmentOcrMeta,
  type WorkPlanOcrResult,
} from '@/lib/workPlanOcrHelpers';
import {
  isEligibleForSmartSplit,
  MAX_SMART_SPLIT_PAGES,
  smartSplitWorkPlanPdf,
} from '@/lib/workPlanPdfSplit';
import {
  applyVaultSuggestions,
  classifyVaultSuggestions,
  fetchCompanyVaultDocs,
  isReusableAttachmentKey,
  saveCompanyVaultDoc,
  type CompanyVaultDoc,
  type VaultSuggestion,
} from '@/lib/workPlanVault';
import {
  createStagedAttachments,
  filesFromClipboardEvent,
  filesFromDataTransfer,
  revokeAllStaged,
  revokeStagedPreview,
  type StagedAttachment,
} from '@/lib/attachmentPasteInbox';

interface Row {
  id: string;
  attachment_key: string;
  name: string;
  description: string | null;
  category: 'legal' | 'calc_evidence' | 'site_proof';
  is_mandatory: boolean;
  file_url: string | null;
  file_path?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  source_type: string | null;
  locked: boolean | null;
  ocr_meta?: WorkPlanAttachmentOcrMeta | null;
  doc_issue_date?: string | null;
  doc_expiry_date?: string | null;
  ocr_checked_at?: string | null;
}

interface Props {
  workPlanId: string;
  projectId: string;
  companyId?: string | null;
  workType: string;
  readOnly?: boolean;
  initialConditions?: Record<string, string> | null;
  onConditionsChange?: (next: Record<string, string>) => void;
  onChange?: () => void;
  onProgress?: (p: AttachmentProgress) => void;
}

const KIND_LABEL: Record<Row['category'], { label: string; cls: string }> = {
  legal:         { label: '법정필수',  cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  calc_evidence: { label: '계산근거',  cls: 'bg-warning/10 text-warning-foreground border-warning/30' },
  site_proof:    { label: '현장증빙',  cls: 'bg-muted text-muted-foreground' },
};

export default function AttachmentChecklist({
  workPlanId,
  projectId,
  companyId,
  workType,
  readOnly,
  initialConditions,
  onConditionsChange,
  onChange,
  onProgress,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [conditions, setConditions] = useState<Record<string, string>>(() =>
    initialConditions && typeof initialConditions === 'object' ? { ...initialConditions } : {},
  );
  const [template, setTemplate] = useState<AttachmentItem[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [armedStageId, setArmedStageId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<'inbox' | string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [addingCustom, setAddingCustom] = useState(false);
  const [ocrByStageId, setOcrByStageId] = useState<Record<string, WorkPlanOcrResult>>({});
  const [ocrBusyIds, setOcrBusyIds] = useState<Record<string, boolean>>({});
  const [rowOcrBusyIds, setRowOcrBusyIds] = useState<Record<string, boolean>>({});
  const [ocrBatchBusy, setOcrBatchBusy] = useState(false);
  const [splitBusyMap, setSplitBusyMap] = useState<Record<string, { done: number; total: number }>>({});
  const [vaultDocs, setVaultDocs] = useState<CompanyVaultDoc[]>([]);
  const [saveToVaultOptIn, setSaveToVaultOptIn] = useState(false);
  const [applyingVault, setApplyingVault] = useState(false);
  const [savingVaultRowId, setSavingVaultRowId] = useState<string | null>(null);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  const reloadVault = useCallback(async () => {
    if (readOnly || !companyId) {
      setVaultDocs([]);
      return;
    }
    const docs = await fetchCompanyVaultDocs(projectId, companyId);
    setVaultDocs(docs);
  }, [projectId, companyId, readOnly]);

  useEffect(() => {
    void reloadVault();
  }, [reloadVault]);

  useEffect(() => {
    setConditions(
      initialConditions && typeof initialConditions === 'object' ? { ...initialConditions } : {},
    );
  }, [workPlanId, JSON.stringify(initialConditions ?? {})]);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('work_plan_attachments')
      .select('id, attachment_key, name, description, category, is_mandatory, file_url, file_path, file_size, mime_type, source_type, locked, ocr_meta, doc_issue_date, doc_expiry_date, ocr_checked_at')
      .eq('work_plan_id', workPlanId)
      .eq('is_deleted', false)
      .order('is_mandatory', { ascending: false });
    if (error) {
      toast({ title: '첨부 불러오기 실패', description: error.message, variant: 'destructive' });
      return;
    }
    const next = (data ?? []) as unknown as Row[];
    setRows(next);
    onProgress?.(computeAttachmentProgress(next));
  }, [workPlanId, onProgress]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const tpl = generateAttachments(workType, conditions).map(withKind);
      if (!cancelled) setTemplate(tpl);
      // Phase 0 invariant: NEVER mutate or re-sync attachment rows on locked/readOnly plans (preserves historical snapshots).
      if (!readOnly) {
        try {
          await syncTemplateRows({ workPlanId, projectId, companyId, workType, conditions });
        } catch (e: any) {
          toast({ title: '템플릿 동기화 실패', description: e?.message, variant: 'destructive' });
        }
      }
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [workPlanId, projectId, companyId, workType, readOnly, JSON.stringify(conditions), reload]);

  useEffect(() => () => { revokeAllStaged(stagedRef.current); }, []);

  const toggleCondition = (field: string) => {
    if (readOnly) return;
    setConditions((prev) => {
      const next = { ...prev, [field]: prev[field] === 'true' ? 'false' : 'true' };
      onConditionsChange?.(next);
      void supabase
        .from('work_plans')
        .update({ work_conditions: next } as any)
        .eq('id', workPlanId)
        .then(({ error }) => {
          if (error) {
            toast({ title: '작업 조건 저장 실패', description: error.message, variant: 'destructive' });
          }
        });
      return next;
    });
  };

  const handleAddCustomAttachment = async () => {
    if (readOnly) return;
    const trimmedName = customName.trim();
    if (!trimmedName) {
      toast({ title: '증빙 서류 이름을 입력하세요.', variant: 'destructive' });
      return;
    }
    if (!customFile) {
      toast({ title: '첨부할 파일을 선택하세요.', variant: 'destructive' });
      return;
    }
    setAddingCustom(true);
    try {
      const attachmentKey = `${CUSTOM_ATTACHMENT_KEY_PREFIX}${Date.now()}`;
      const safeName = customFile.name.replace(/[^\w.\-]+/g, '_');
      const path = `${projectId}/work-plans/${workPlanId}/${attachmentKey}_${safeName}`;
      const uploaded = await uploadAttachmentFile(path, customFile);
      const { error } = await supabase.from('work_plan_attachments').insert({
        work_plan_id: workPlanId,
        project_id: projectId,
        company_id: companyId ?? null,
        category: 'site_proof',
        attachment_key: attachmentKey,
        name: trimmedName,
        description: customDesc.trim() || '사용자 추가 증빙',
        is_mandatory: false,
        source_type: 'manual',
        file_url: uploaded.publicUrl,
        file_path: uploaded.path,
        file_size: uploaded.finalBytes,
        mime_type: uploaded.file.type,
      });
      if (error) throw error;
      toast({ title: `'${trimmedName}' 기타 증빙을 추가했습니다.` });
      setCustomName('');
      setCustomDesc('');
      setCustomFile(null);
      setCustomOpen(false);
      onChange?.();
      await reload();
    } catch (e: any) {
      toast({ title: '기타 증빙 추가 실패', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setAddingCustom(false);
    }
  };

  const addToInbox = useCallback((files: File[]) => {
    if (!files.length) {
      toast({ title: '붙여넣을 이미지나 PDF가 없습니다.', variant: 'destructive' });
      return;
    }
    const next = createStagedAttachments(files);
    if (!next.length) {
      toast({ title: '지원 형식만 가능합니다', description: '이미지(JPG/PNG/WebP) 또는 PDF', variant: 'destructive' });
      return;
    }
    setStaged((prev) => [...prev, ...next]);
    toast({ title: `임시함에 ${next.length}개 담았습니다`, description: '항목을 고르거나 아래로 할당하세요.' });
  }, []);

  const removeStaged = (id: string) => {
    setStaged((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) revokeStagedPreview(target);
      return prev.filter((s) => s.id !== id);
    });
    setOcrByStageId((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOcrBusyIds((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (armedStageId === id) setArmedStageId(null);
  };

  const clearInbox = () => {
    revokeAllStaged(staged);
    setStaged([]);
    setOcrByStageId({});
    setOcrBusyIds({});
    setArmedStageId(null);
  };

  const runOcrForStaged = async (stageItem: StagedAttachment, pageNumber?: number) => {
    if (readOnly) return;
    const slots = rows
      .filter((r) => !r.locked)
      .map((r) => ({ key: r.attachment_key, name: r.name }));
    setOcrBusyIds((prev) => ({ ...prev, [stageItem.id]: true }));
    try {
      const res = await analyzeWorkPlanAttachmentFile(stageItem.file, slots, { pageNumber });
      setOcrByStageId((prev) => ({ ...prev, [stageItem.id]: res }));
    } finally {
      setOcrBusyIds((prev) => ({ ...prev, [stageItem.id]: false }));
    }
  };

  const runSmartSplitForStaged = async (stageItem: StagedAttachment) => {
    if (readOnly || splitBusyMap[stageItem.id]) return;
    const slots = rows
      .filter((r) => !r.locked)
      .map((r) => ({ key: r.attachment_key, name: r.name }));
    setSplitBusyMap((prev) => ({ ...prev, [stageItem.id]: { done: 0, total: 1 } }));
    try {
      const outcome = await smartSplitWorkPlanPdf(stageItem.file, slots, (done, total) => {
        setSplitBusyMap((prev) => ({ ...prev, [stageItem.id]: { done, total } }));
      });
      if (!outcome.ok) {
        toast({ title: 'PDF 분리 불가', description: outcome.message, variant: 'destructive' });
        return;
      }
      if (!outcome.split || outcome.items.length === 0) {
        toast({ title: '분리 불필요', description: outcome.message });
        return;
      }
      const nextStaged = createStagedAttachments(outcome.items.map((it) => it.file));
      revokeStagedPreview(stageItem);
      setStaged((prev) => {
        const idx = prev.findIndex((p) => p.id === stageItem.id);
        if (idx < 0) return [...prev, ...nextStaged];
        return [...prev.slice(0, idx), ...nextStaged, ...prev.slice(idx + 1)];
      });
      setOcrByStageId((prev) => {
        const next = { ...prev };
        delete next[stageItem.id];
        nextStaged.forEach((st, i) => {
          if (outcome.items[i]?.ocr) next[st.id] = outcome.items[i].ocr;
        });
        return next;
      });
      if (armedStageId === stageItem.id) setArmedStageId(null);
      toast({ title: '합본 PDF 자동 분리 완료', description: outcome.message });
    } finally {
      setSplitBusyMap((prev) => {
        const next = { ...prev };
        delete next[stageItem.id];
        return next;
      });
    }
  };

  const runOcrForAllStaged = async () => {
    if (readOnly || staged.length === 0 || ocrBatchBusy) return;
    setOcrBatchBusy(true);
    try {
      for (const item of staged) {
        if (ocrByStageId[item.id]?.ok) continue;
        await runOcrForStaged(item);
      }
      toast({
        title: 'AI 서류 판독 완료',
        description: '각 파일의 추천 항목을 확인한 뒤 버튼으로 넣어 주세요.',
      });
    } finally {
      setOcrBatchBusy(false);
    }
  };

  const runBackgroundRowOcr = async (
    row: Row,
    file: File,
    uploaded: { publicUrl: string; path: string; finalBytes: number; file: File },
    shouldAlsoUpdateVault: boolean,
  ) => {
    const support = classifyOcrFileSupport({ name: file.name, type: file.type });
    if (support !== 'image' && support !== 'pdf') return;
    setRowOcrBusyIds((prev) => ({ ...prev, [row.id]: true }));
    try {
      const slots = [{ key: row.attachment_key, name: row.name }];
      const ocr = await analyzeWorkPlanAttachmentFile(file, slots);
      const patch = buildAttachmentOcrDbPatch(ocr);
      if (!patch) return;

      await supabase
        .from('work_plan_attachments')
        .update(patch as any)
        .eq('id', row.id);

      if (shouldAlsoUpdateVault && companyId && isReusableAttachmentKey(row.attachment_key)) {
        await saveCompanyVaultDoc({
          projectId,
          companyId,
          attachmentKey: row.attachment_key,
          docName: row.name,
          fileUrl: uploaded.publicUrl,
          filePath: uploaded.path,
          fileSize: uploaded.finalBytes,
          mimeType: uploaded.file.type,
          holderName: ocr.companyOrHolder ?? null,
          regOrCertNo: ocr.regOrCertNo ?? null,
          expiryDate: ocr.expiryDate ?? null,
          sourceWorkPlanId: workPlanId,
        });
        void reloadVault();
      }

      if (ocr.expiryStatus === 'expired' && ocr.expiryDate) {
        toast({
          title: `⚠️ '${row.name}' 유효기간 만료 감지`,
          description: `만료일 ${ocr.expiryDate} — 결재 전 최신 서류로 교체해 주세요.`,
          variant: 'destructive',
        });
      } else if (ocr.expiryStatus === 'expiring_soon' && ocr.expiryDate) {
        toast({
          title: `'${row.name}' 유효기간 임박 (${ocr.expiryDate})`,
          description: '30일 이내 만료 예정입니다. 작업 일정을 확인해 주세요.',
        });
      }

      onChange?.();
      await reload();
    } catch {
      // Background OCR is best-effort and must never block or fail an upload.
    } finally {
      setRowOcrBusyIds((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    }
  };

  const handleUpload = async (
    row: Row,
    file: File,
    opts?: { quiet?: boolean; ocrMeta?: WorkPlanOcrResult | null },
  ) => {
    if (row.locked) {
      toast({ title: '잠금된 첨부입니다.', variant: 'destructive' });
      return false;
    }
    setUploadingId(row.id);
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${projectId}/work-plans/${workPlanId}/${row.attachment_key}_${Date.now()}_${safeName}`;
      let uploaded;
      try {
        uploaded = await uploadAttachmentFile(path, file);
      } catch (e: any) {
        toast({ title: '업로드 실패', description: e?.message || String(e), variant: 'destructive' });
        return false;
      }
      const existingOcrPatch = buildAttachmentOcrDbPatch(opts?.ocrMeta);
      const { error } = await supabase
        .from('work_plan_attachments')
        .update({
          file_url: uploaded.publicUrl,
          file_path: uploaded.path,
          file_size: uploaded.finalBytes,
          mime_type: uploaded.file.type,
          source_type: 'manual',
          ...(existingOcrPatch ?? {
            ocr_meta: null,
            doc_issue_date: null,
            doc_expiry_date: null,
            ocr_checked_at: null,
          }),
        } as any)
        .eq('id', row.id);
      if (error) {
        toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
        return false;
      }

      // Phase 2: Opt-in save to company document vault (explicit user consent only)
      let vaultSaved = false;
      if (saveToVaultOptIn && companyId && isReusableAttachmentKey(row.attachment_key)) {
        const res = await saveCompanyVaultDoc({
          projectId,
          companyId,
          attachmentKey: row.attachment_key,
          docName: row.name,
          fileUrl: uploaded.publicUrl,
          filePath: uploaded.path,
          fileSize: uploaded.finalBytes,
          mimeType: uploaded.file.type,
          holderName: opts?.ocrMeta?.companyOrHolder ?? null,
          regOrCertNo: opts?.ocrMeta?.regOrCertNo ?? null,
          expiryDate: opts?.ocrMeta?.expiryDate ?? null,
          sourceWorkPlanId: workPlanId,
        });
        if (res.ok) {
          vaultSaved = true;
          void reloadVault();
        }
      }

      if (!opts?.quiet) {
        const parts: string[] = [];
        if (uploaded.compressed) {
          parts.push(`이미지 압축 ${formatBytes(uploaded.originalBytes)} → ${formatBytes(uploaded.finalBytes)}`);
        }
        if (vaultSaved) {
          parts.push('업체 서류 보관함에도 저장됨');
        }
        toast({
          title: `${row.name}에 첨부됨`,
          description: parts.length ? parts.join(' · ') : undefined,
        });
      }
      onChange?.();
      await reload();

      // Auto-verify inspection/insurance expiry in background when not already OCR'd
      if (!existingOcrPatch) {
        void runBackgroundRowOcr(row, file, uploaded, saveToVaultOptIn);
      }
      return true;
    } finally {
      setUploadingId(null);
    }
  };

  const assignStagedToRow = async (stageId: string, row: Row) => {
    const item = staged.find((s) => s.id === stageId);
    if (!item) return;
    const ocrMeta = ocrByStageId[stageId] ?? null;
    const ok = await handleUpload(row, item.file, { quiet: false, ocrMeta });
    if (ok) removeStaged(stageId);
  };

  const handleApplyVault = async (suggestions: VaultSuggestion[]) => {
    if (readOnly || applyingVault || suggestions.length === 0) return;
    setApplyingVault(true);
    try {
      const res = await applyVaultSuggestions(suggestions);
      if (res.error) {
        toast({ title: '보관함 불러오기 실패', description: res.error, variant: 'destructive' });
      } else if (res.applied > 0) {
        toast({
          title: `업체 보관함 서류 ${res.applied}건을 반영했습니다.`,
          description: res.skippedExpired > 0
            ? `만료된 ${res.skippedExpired}건은 제외되었습니다.`
            : '첨부 내역을 최종 확인해 주세요.',
        });
        onChange?.();
        await reload();
      }
    } finally {
      setApplyingVault(false);
    }
  };

  const handleSaveRowToVault = async (row: Row) => {
    if (readOnly || !companyId || !row.file_url || !isReusableAttachmentKey(row.attachment_key)) return;
    setSavingVaultRowId(row.id);
    try {
      const res = await saveCompanyVaultDoc({
        projectId,
        companyId,
        attachmentKey: row.attachment_key,
        docName: row.name,
        fileUrl: row.file_url,
        filePath: row.file_path ?? null,
        fileSize: row.file_size ?? null,
        mimeType: row.mime_type ?? null,
        sourceWorkPlanId: workPlanId,
      });
      if (!res.ok) {
        toast({ title: '보관함 저장 실패', description: res.error, variant: 'destructive' });
      } else {
        toast({
          title: `'${row.name}' 보관함 저장 완료`,
          description: '다음 작업계획서 작성 시 1클릭으로 불러올 수 있습니다.',
        });
        await reloadVault();
      }
    } finally {
      setSavingVaultRowId(null);
    }
  };

  const handleRowClick = async (row: Row) => {
    if (readOnly || row.locked) return;
    if (armedStageId) {
      await assignStagedToRow(armedStageId, row);
      setArmedStageId(null);
      return;
    }
    setSelectedRowId((prev) => (prev === row.id ? null : row.id));
  };

  const ingestFiles = useCallback(async (files: File[], preferRowId?: string | null) => {
    if (readOnly || !files.length) return;
    const rowId = preferRowId ?? selectedRowId;
    const target = rowId ? rows.find((r) => r.id === rowId) : null;
    if (target && !target.locked && files.length === 1) {
      await handleUpload(target, files[0]);
      return;
    }
    if (target && !target.locked && files.length > 1) {
      // 첫 장만 선택 행에, 나머지는 임시함
      await handleUpload(target, files[0]);
      addToInbox(files.slice(1));
      return;
    }
    addToInbox(files);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleUpload/rows intentional latest via closure on paste
  }, [readOnly, selectedRowId, rows, addToInbox]);

  // 첨부 탭이 마운트된 동안 Ctrl/Cmd+V — 선택 행이 있으면 그 행, 없으면 임시함
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e: ClipboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const files = filesFromClipboardEvent(e);
      if (!files.length) return;
      e.preventDefault();
      void ingestFiles(files, selectedRowId);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [readOnly, ingestFiles, selectedRowId]);

  const handleRemove = async (row: Row) => {
    if (row.locked) {
      toast({ title: '잠금된 첨부입니다.', description: '결재 승인된 문서는 수정할 수 없습니다.', variant: 'destructive' });
      return;
    }
    const patch = isCustomAttachmentKey(row.attachment_key)
      ? { is_deleted: true, deleted_at: new Date().toISOString() }
      : {
          file_url: null,
          file_path: null,
          file_size: null,
          mime_type: null,
          ocr_meta: null,
          doc_issue_date: null,
          doc_expiry_date: null,
          ocr_checked_at: null,
        };
    const { error } = await supabase
      .from('work_plan_attachments')
      .update(patch)
      .eq('id', row.id);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    onChange?.();
    reload();
  };

  const assignableRows = rows.filter((r) => !r.locked);
  const groups: Row['category'][] = ['legal', 'calc_evidence', 'site_proof'];
  const uploadedCount = rows.filter(r => !!r.file_url).length;
  const mandatoryMissing = rows.filter(r => r.is_mandatory && !r.file_url).length;
  const selectedRow = selectedRowId ? rows.find((r) => r.id === selectedRowId) : null;
  const vaultClassification = classifyVaultSuggestions(vaultDocs, rows, companyId);
  const vaultSuggestable = vaultClassification.suggestable;
  const vaultExpired = vaultClassification.expired;

  return (
    <div ref={rootRef}>
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Paperclip className="h-4 w-4" /> 첨부파일
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {mandatoryMissing > 0 && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <FileWarning className="h-3 w-3" /> 필수 미첨부 {mandatoryMissing}
              </Badge>
            )}
            <Badge variant={uploadedCount === rows.length && rows.length > 0 ? 'default' : 'outline'} className="text-[10px]">
              {uploadedCount}/{rows.length} 업로드
            </Badge>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground pt-1">
          캡처 이미지를 <b>붙여넣기(Ctrl+V)</b>하거나 임시함에 모은 뒤 항목에 할당하세요.
          여러 장 PDF는 업로드 버튼을 사용하세요. 사진은 자동 압축됩니다.
        </p>
        {!readOnly && companyId && (
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t mt-2">
            <label
              htmlFor={`vault-optin-${workPlanId}`}
              className="text-[11px] text-muted-foreground flex items-center gap-1.5 cursor-pointer select-none"
            >
              <Archive className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>업로드 시 다음 작업계획서에도 재사용 저장 (우리 업체 전용 보관함)</span>
            </label>
            <Switch
              id={`vault-optin-${workPlanId}`}
              checked={saveToVaultOptIn}
              onCheckedChange={setSaveToVaultOptIn}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!readOnly && companyId && (vaultSuggestable.length > 0 || vaultExpired.length > 0) && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Archive className="h-4 w-4 text-primary shrink-0" />
                <p className="text-xs font-semibold">
                  업체 보관함 재사용 서류
                  {vaultSuggestable.length > 0 && (
                    <span className="ml-1 text-primary">({vaultSuggestable.length}건 불러오기 가능)</span>
                  )}
                </p>
              </div>
              {vaultSuggestable.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[11px] gap-1"
                  disabled={applyingVault}
                  onClick={() => void handleApplyVault(vaultSuggestable)}
                >
                  {applyingVault ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  이전 등록 서류 {vaultSuggestable.length}건 한 번에 불러오기
                </Button>
              )}
            </div>
            {vaultSuggestable.length > 0 && (
              <div className="space-y-1">
                {vaultSuggestable.map((s) => (
                  <div
                    key={s.doc.id}
                    className="flex items-center justify-between gap-2 text-[11px] bg-background/80 rounded border px-2 py-1"
                  >
                    <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium truncate">{s.row.name}</span>
                      {s.doc.holder_name && (
                        <span className="text-[10px] text-muted-foreground truncate">· {s.doc.holder_name}</span>
                      )}
                      {s.doc.expiry_date && (
                        <Badge
                          variant={s.expiry === 'expiring_soon' ? 'secondary' : 'outline'}
                          className="text-[9px] h-4 px-1"
                        >
                          유효기간 {s.doc.expiry_date}
                          {s.expiry === 'expiring_soon' && s.daysRemaining != null
                            ? ` (D-${s.daysRemaining})`
                            : ''}
                        </Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 shrink-0"
                      disabled={applyingVault}
                      onClick={() => void handleApplyVault([s])}
                    >
                      불러오기
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {vaultExpired.length > 0 && (
              <div className="rounded border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>
                  <b>유효기간 만료 {vaultExpired.length}건은 자동 추천에서 제외됨</b>:{' '}
                  {vaultExpired.map((e) => `${e.row.name}(만료 ${e.doc.expiry_date})`).join(', ')} — 최신 서류를 새로 업로드해 주세요.
                </div>
              </div>
            )}
          </div>
        )}
        {!readOnly && (
          <div
            className={`rounded-lg border border-dashed p-3 transition-colors ${
              dragOver === 'inbox' ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 bg-muted/20'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver('inbox'); }}
            onDragLeave={() => setDragOver((d) => (d === 'inbox' ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const files = filesFromDataTransfer(e.dataTransfer);
              addToInbox(files);
            }}
          >
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex items-start gap-2 min-w-0">
                <Inbox className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    첨부 임시함
                    {staged.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-4">{staged.length}</Badge>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    여기에 드롭·붙여넣기 → 썸네일 클릭 후 아래 항목 클릭, 또는 각 파일에서 항목 선택
                  </p>
                  {selectedRow && (
                    <p className="text-[10px] text-primary mt-1 flex items-center gap-1">
                      <ClipboardPaste className="h-3 w-3" />
                      붙여넣기 대상: <b>{selectedRow.name}</b>
                      <button type="button" className="underline ml-1" onClick={() => setSelectedRowId(null)}>해제</button>
                    </p>
                  )}
                  {!selectedRow && (
                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <MousePointerClick className="h-3 w-3" />
                      아래 항목을 클릭하면 붙여넣기 대상으로 선택됩니다
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const list = e.target.files ? Array.from(e.target.files) : [];
                      if (list.length) addToInbox(list);
                      e.target.value = '';
                    }}
                  />
                  <Button asChild size="sm" variant="outline" className="h-7 text-[10px] gap-1">
                    <span><Upload className="h-3 w-3" /> 파일 담기</span>
                  </Button>
                </label>
                {staged.length > 0 && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      className="h-7 text-[10px] gap-1"
                      disabled={ocrBatchBusy}
                      onClick={() => void runOcrForAllStaged()}
                    >
                      {ocrBatchBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      {ocrBatchBusy ? 'AI 판독 중…' : 'AI 자동 분류'}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive gap-1" onClick={clearInbox}>
                      <Trash2 className="h-3 w-3" /> 비우기
                    </Button>
                  </>
                )}
              </div>
            </div>

            {staged.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {staged.map((s) => {
                  const armed = armedStageId === s.id;
                  const ocr = ocrByStageId[s.id];
                  const ocrBusy = !!ocrBusyIds[s.id];
                  const splitProgress = splitBusyMap[s.id];
                  const isPdfFile = !s.previewUrl && /\.pdf$/i.test(s.file.name);
                  const canSmartSplit = isPdfFile && (!ocr || isEligibleForSmartSplit(ocr.totalPages));
                  const suggestedRow = ocr?.suggestedKey
                    ? assignableRows.find((r) => r.attachment_key === ocr.suggestedKey) || null
                    : null;
                  return (
                    <div
                      key={s.id}
                      className={`w-[205px] rounded border bg-card p-2 space-y-1.5 ${armed ? 'border-primary ring-1 ring-primary/40' : ''}`}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => setArmedStageId((prev) => (prev === s.id ? null : s.id))}
                        title="클릭 후 아래 첨부 항목을 누르면 할당"
                      >
                        {s.previewUrl ? (
                          <img src={s.previewUrl} alt="" className="h-16 w-full object-cover rounded bg-muted" />
                        ) : (
                          <div className="h-16 w-full rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                            PDF
                          </div>
                        )}
                        <p className="text-[10px] font-medium truncate mt-1" title={s.file.name}>{s.file.name}</p>
                      </button>

                      {/* AI OCR 판독 결과 & 1클릭 확인 제안 */}
                      {ocrBusy && (
                        <div className="rounded bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin shrink-0" /> AI 서류 판독 중…
                        </div>
                      )}
                      {!ocrBusy && ocr && !ocr.ok && (
                        <div className="rounded border border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 px-2 py-1 text-[10px] text-amber-900 dark:text-amber-200 leading-snug">
                          {ocr.error}
                        </div>
                      )}
                      {!ocrBusy && ocr?.ok && (
                        <div className="rounded border bg-muted/20 p-1.5 space-y-1 text-[10px]">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold truncate">{ocr.docCategoryLabel}</span>
                            {ocr.confidence != null && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
                                {Math.round(ocr.confidence * 100)}%
                              </Badge>
                            )}
                          </div>
                          {ocr.companyOrHolder && (
                            <p className="text-muted-foreground truncate">대상: {ocr.companyOrHolder}</p>
                          )}
                          {ocr.expiryDate && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-muted-foreground">만료: {ocr.expiryDate}</span>
                              {ocr.expiryStatus === 'expired' && (
                                <Badge variant="destructive" className="text-[9px] h-4 px-1 gap-0.5">
                                  <AlertTriangle className="h-2.5 w-2.5" /> 만료됨
                                </Badge>
                              )}
                              {ocr.expiryStatus === 'expiring_soon' && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500 text-amber-700">
                                  임박
                                </Badge>
                              )}
                            </div>
                          )}
                          {ocr.ratedCapacityTon != null && (
                            <p className="text-muted-foreground">정격하중: {ocr.ratedCapacityTon}t</p>
                          )}
                          {ocr.needsPageSelect && (
                            <p className="text-amber-700 dark:text-amber-300 leading-snug">
                              표지/목차로 보입니다. 아래에서 하중표·본문 페이지를 선택해 다시 판독하세요.
                            </p>
                          )}
                          {ocr.totalPages > 1 && (
                            <div className="flex items-center gap-1 pt-0.5">
                              <span className="text-[9px] text-muted-foreground shrink-0">
                                페이지 ({ocr.pageNumber}/{ocr.totalPages})
                              </span>
                              <select
                                aria-label="판독 페이지 선택"
                                className="h-5 text-[10px] rounded border bg-background px-1 flex-1 min-w-0"
                                value={ocr.pageNumber}
                                onChange={(e) => {
                                  const nextPage = Number(e.target.value);
                                  if (nextPage >= 1 && nextPage <= ocr.totalPages) {
                                    void runOcrForStaged(s, nextPage);
                                  }
                                }}
                              >
                                {Array.from({ length: Math.min(ocr.totalPages, 30) }, (_, idx) => idx + 1).map((p) => (
                                  <option key={p} value={p}>{p}p 판독</option>
                                ))}
                              </select>
                            </div>
                          )}
                          {suggestedRow && (
                            <Button
                              type="button"
                              size="sm"
                              variant={ocr.expiryStatus === 'expired' ? 'destructive' : 'default'}
                              className="h-6 w-full text-[10px] gap-1"
                              onClick={() => void assignStagedToRow(s.id, suggestedRow)}
                            >
                              <CheckCircle2 className="h-3 w-3 shrink-0" />
                              <span className="truncate">{suggestedRow.name}에 넣기</span>
                            </Button>
                          )}
                        </div>
                      )}

                      {!ocr && !ocrBusy && !splitProgress && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 w-full text-[10px] gap-1"
                          onClick={() => void runOcrForStaged(s)}
                        >
                          <Sparkles className="h-3 w-3" /> AI 판독
                        </Button>
                      )}
                      {splitProgress && (
                        <div className="rounded bg-primary/5 border border-primary/20 px-2 py-1 text-[10px] text-primary flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                          페이지 분리 판독 ({splitProgress.done}/{splitProgress.total}p)…
                        </div>
                      )}
                      {canSmartSplit && !ocrBusy && !splitProgress && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 w-full text-[10px] gap-1 text-muted-foreground hover:text-primary"
                          title={`서류 여러 장이 묶인 소형 합본 PDF(2~${MAX_SMART_SPLIT_PAGES}p)를 페이지별 AI 판독 후 개별 파일로 자동 분리`}
                          onClick={() => void runSmartSplitForStaged(s)}
                        >
                          <Scissors className="h-3 w-3" /> 합본 PDF 페이지별 AI 분리
                        </Button>
                      )}

                      <Select
                        value=""
                        onValueChange={(rowId) => {
                          const row = rows.find((r) => r.id === rowId);
                          if (row) void assignStagedToRow(s.id, row);
                        }}
                      >
                        <SelectTrigger className="h-7 text-[10px]">
                          <SelectValue placeholder="수동으로 항목에 넣기" />
                        </SelectTrigger>
                        <SelectContent>
                          {assignableRows.map((r) => (
                            <SelectItem key={r.id} value={r.id} className="text-xs">
                              {r.is_mandatory ? '● ' : ''}{r.name}{r.file_url ? ' (교체)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-full text-[10px] text-muted-foreground"
                        onClick={() => removeStaged(s.id)}
                      >
                        제거
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            {armedStageId && (
              <p className="text-[10px] text-primary mt-2">
                임시 파일 선택됨 — 아래 첨부 항목을 클릭하면 그 항목에 넣습니다.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-4 p-3 bg-muted/30 rounded-lg">
          <span className="text-xs font-medium text-muted-foreground">작업 조건:</span>
          {[
            { field: 'night_work', label: '야간작업' },
            { field: 'road_work', label: '도로작업' },
            { field: 'hot_work', label: '화기작업' },
            { field: 'near_power_lines', label: '활선근접' },
          ].map(c => (
            <div key={c.field} className="flex items-center gap-1.5">
              <Switch id={c.field} checked={conditions[c.field] === 'true'}
                onCheckedChange={() => toggleCondition(c.field)} disabled={readOnly} />
              <Label htmlFor={c.field} className="text-xs cursor-pointer">{c.label}</Label>
            </div>
          ))}
        </div>

        {loading && <p className="text-xs text-muted-foreground">불러오는 중…</p>}

        {!loading && groups.map(g => {
          const items = rows.filter(r => r.category === g);
          if (items.length === 0) return null;
          const k = KIND_LABEL[g];
          return (
            <div key={g}>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className={`text-[10px] ${k.cls}`}>{k.label}</Badge>
                <span className="text-xs text-muted-foreground">
                  {g === 'legal' && '결재 차단 — 법령상 첨부 필수'}
                  {g === 'calc_evidence' && '계산서·도면·구조검토 등 (필수 표시 시 상신 차단)'}
                  {g === 'site_proof' && '현장 증빙'}
                </span>
              </div>
              <div className="space-y-1.5">
                {items.map(row => {
                  const isUploaded = !!row.file_url;
                  const isAuto = row.source_type && row.source_type !== 'manual';
                  const isSelected = selectedRowId === row.id;
                  const isDropTarget = dragOver === row.id;
                  return (
                    <div
                      key={row.id}
                      role={!readOnly && !row.locked ? 'button' : undefined}
                      tabIndex={!readOnly && !row.locked ? 0 : undefined}
                      onClick={() => { void handleRowClick(row); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void handleRowClick(row);
                        }
                      }}
                      onDragOver={(e) => {
                        if (readOnly || row.locked) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOver(row.id);
                      }}
                      onDragLeave={() => setDragOver((d) => (d === row.id ? null : d))}
                      onDrop={(e) => {
                        if (readOnly || row.locked) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOver(null);
                        const files = filesFromDataTransfer(e.dataTransfer);
                        if (files[0]) void handleUpload(row, files[0]);
                        if (files.length > 1) addToInbox(files.slice(1));
                      }}
                      className={`flex items-center gap-2 p-2 rounded border bg-card hover:bg-muted/20 cursor-pointer ${
                        row.is_mandatory && !isUploaded ? 'border-destructive/40' : ''
                      } ${isSelected ? 'border-primary ring-1 ring-primary/30' : ''} ${
                        isDropTarget ? 'border-primary bg-primary/5' : ''
                      }`}
                    >
                      {isUploaded
                        ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        : <div className={`h-4 w-4 rounded-full border-2 shrink-0 ${row.is_mandatory ? 'border-destructive/60' : 'border-muted-foreground/30'}`} />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate flex items-center gap-1 flex-wrap">
                          <span className="truncate">{row.name}</span>
                          {isCustomAttachmentKey(row.attachment_key) && (
                            <Badge variant="secondary" className="text-[9px] h-4 shrink-0">사용자 추가</Badge>
                          )}
                          {isAuto && <Bot className="h-3 w-3 text-primary" aria-label="자동 첨부" />}
                          {row.locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="잠금" />}
                          {isSelected && (
                            <Badge variant="outline" className="text-[9px] h-4 border-primary text-primary">붙여넣기</Badge>
                          )}
                          {rowOcrBusyIds[row.id] && (
                            <Badge variant="outline" className="text-[9px] h-4 gap-0.5 text-primary border-primary/40 shrink-0">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" /> AI 기간 확인 중…
                            </Badge>
                          )}
                          {!rowOcrBusyIds[row.id] && isUploaded && row.doc_expiry_date && (() => {
                            const status = evaluateExpiryStatus(row.doc_expiry_date);
                            const days = calcExpiryDaysRemaining(row.doc_expiry_date);
                            if (status === 'expired') {
                              return (
                                <Badge variant="destructive" className="text-[9px] h-4 gap-0.5 shrink-0">
                                  <AlertTriangle className="h-2.5 w-2.5" /> 만료됨 ({row.doc_expiry_date})
                                </Badge>
                              );
                            }
                            if (status === 'expiring_soon') {
                              return (
                                <Badge variant="outline" className="text-[9px] h-4 border-amber-500 text-amber-700 dark:text-amber-300 shrink-0">
                                  임박 {days != null ? `D-${days}` : ''} ({row.doc_expiry_date})
                                </Badge>
                              );
                            }
                            return (
                              <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 shrink-0">
                                유효 ~{row.doc_expiry_date}
                              </Badge>
                            );
                          })()}
                        </p>
                        {row.description && <p className="text-[10px] text-muted-foreground truncate">{row.description}</p>}
                      </div>
                      {row.is_mandatory && <Badge variant="destructive" className="text-[9px] h-4 shrink-0">필수</Badge>}
                      {isUploaded && (
                        <>
                          <a
                            href={row.file_url!}
                            target="_blank"
                            rel="noopener"
                            className="text-[10px] text-primary hover:underline shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              void resolveArchivedUrl(row.file_url!).then((resolved) => {
                                window.open(resolved, '_blank', 'noopener,noreferrer');
                              });
                            }}
                          >
                            보기
                          </a>
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 inline-flex items-center gap-0.5"
                            title="이 첨부만 인쇄"
                            onClick={(e) => {
                              e.stopPropagation();
                              void resolveArchivedUrl(row.file_url!).then((resolved) => {
                                const w = window.open(resolved, '_blank');
                                if (w) setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 800);
                              });
                            }}
                          >
                            <Printer className="h-3 w-3" /> 인쇄
                          </button>
                        </>
                      )}
                      {!readOnly && !row.locked && (
                        <>
                          <label
                            className={`cursor-pointer shrink-0 ${uploadingId === row.id ? 'opacity-50 pointer-events-none' : ''}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input type="file" className="hidden" disabled={uploadingId === row.id} onChange={e => {
                              if (e.target.files?.[0]) void handleUpload(row, e.target.files[0]);
                              e.target.value = '';
                            }} />
                            <Button asChild size="sm" variant="ghost" className="h-6 text-[10px] gap-1" disabled={uploadingId === row.id}>
                              <span>
                                {uploadingId === row.id
                                  ? <><Loader2 className="h-3 w-3 animate-spin" /> 업로드 중…</>
                                  : <><Upload className="h-3 w-3" /> {isUploaded ? '교체' : '업로드'}</>}
                              </span>
                            </Button>
                          </label>
                          {isUploaded && uploadingId !== row.id && companyId && isReusableAttachmentKey(row.attachment_key) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] text-muted-foreground hover:text-primary gap-0.5"
                              title="이 서류를 업체 보관함에 저장해 다음 작업계획서에서 재사용"
                              disabled={savingVaultRowId === row.id}
                              onClick={(e) => { e.stopPropagation(); void handleSaveRowToVault(row); }}
                            >
                              {savingVaultRowId === row.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <BookmarkPlus className="h-3 w-3" />}
                              보관함
                            </Button>
                          )}
                          {isUploaded && uploadingId !== row.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] text-destructive"
                              onClick={(e) => { e.stopPropagation(); void handleRemove(row); }}
                            >
                              제거
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!loading && !readOnly && (
          <div className="pt-2 border-t">
            {!customOpen ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full h-9 text-xs gap-1.5 border-dashed"
                onClick={() => setCustomOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> 기타 증빙 추가 (현장·발주처 추가 서류 자유 첨부)
              </Button>
            ) : (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">기타 증빙 추가</p>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setCustomOpen(false);
                      setCustomName('');
                      setCustomDesc('');
                      setCustomFile(null);
                    }}
                  >
                    닫기
                  </button>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">서류명 *</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="예: 지반 보강 사진, 발주처 협의서"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      disabled={addingCustom}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">설명 (선택)</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="간단한 참고 메모"
                      value={customDesc}
                      onChange={(e) => setCustomDesc(e.target.value)}
                      disabled={addingCustom}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,application/pdf,.xlsx,.xls,.pptx,.ppt,.docx,.doc"
                      disabled={addingCustom}
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setCustomFile(f);
                        if (f && !customName.trim()) {
                          setCustomName(f.name.replace(/\.[^.]+$/, ''));
                        }
                        e.target.value = '';
                      }}
                    />
                    <Button asChild type="button" size="sm" variant="outline" className="h-8 text-xs gap-1">
                      <span>
                        <Upload className="h-3.5 w-3.5" />
                        {customFile ? customFile.name : '파일 선택'}
                      </span>
                    </Button>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    disabled={addingCustom || !customName.trim() || !customFile}
                    onClick={() => void handleAddCustomAttachment()}
                  >
                    {addingCustom ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    {addingCustom ? '업로드 중…' : '첨부 추가'}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  결재를 차단하지 않으며, 최종 PDF 합본과 검토자 첨부 뷰어에 자동 포함됩니다.
                </p>
              </div>
            )}
          </div>
        )}
        {template.length === 0 && null}
      </CardContent>
    </Card>
    </div>
  );
}
