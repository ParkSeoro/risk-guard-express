import { useState, useEffect, useCallback, useRef } from 'react';
import { generateAttachments, withKind, type AttachmentItem } from '@/lib/attachmentTemplates';
import { syncTemplateRows, computeAttachmentProgress, type AttachmentProgress } from '@/lib/workPlanAttachments';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Paperclip, Upload, CheckCircle2, Lock, Bot, FileWarning, Loader2, Printer,
  ClipboardPaste, Inbox, Trash2, MousePointerClick,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { uploadAttachmentFile, formatBytes } from '@/lib/compressUploadFile';
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
  source_type: string | null;
  locked: boolean | null;
}

interface Props {
  workPlanId: string;
  projectId: string;
  companyId?: string | null;
  workType: string;
  readOnly?: boolean;
  onChange?: () => void;
  onProgress?: (p: AttachmentProgress) => void;
}

const KIND_LABEL: Record<Row['category'], { label: string; cls: string }> = {
  legal:         { label: '법정필수',  cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  calc_evidence: { label: '계산근거',  cls: 'bg-warning/10 text-warning-foreground border-warning/30' },
  site_proof:    { label: '현장증빙',  cls: 'bg-muted text-muted-foreground' },
};

export default function AttachmentChecklist({
  workPlanId, projectId, companyId, workType, readOnly, onChange, onProgress,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<AttachmentItem[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [armedStageId, setArmedStageId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<'inbox' | string | null>(null);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('work_plan_attachments')
      .select('id, attachment_key, name, description, category, is_mandatory, file_url, source_type, locked')
      .eq('work_plan_id', workPlanId)
      .eq('is_deleted', false)
      .order('is_mandatory', { ascending: false });
    if (error) {
      toast({ title: '첨부 불러오기 실패', description: error.message, variant: 'destructive' });
      return;
    }
    const next = (data ?? []) as Row[];
    setRows(next);
    onProgress?.(computeAttachmentProgress(next));
  }, [workPlanId, onProgress]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const tpl = generateAttachments(workType, conditions).map(withKind);
      if (!cancelled) setTemplate(tpl);
      try {
        await syncTemplateRows({ workPlanId, projectId, companyId, workType, conditions });
      } catch (e: any) {
        toast({ title: '템플릿 동기화 실패', description: e?.message, variant: 'destructive' });
      }
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [workPlanId, projectId, companyId, workType, JSON.stringify(conditions), reload]);

  useEffect(() => () => { revokeAllStaged(stagedRef.current); }, []);

  const toggleCondition = (field: string) => {
    setConditions(prev => ({ ...prev, [field]: prev[field] === 'true' ? 'false' : 'true' }));
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
    if (armedStageId === id) setArmedStageId(null);
  };

  const clearInbox = () => {
    revokeAllStaged(staged);
    setStaged([]);
    setArmedStageId(null);
  };

  const handleUpload = async (row: Row, file: File, opts?: { quiet?: boolean }) => {
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
      const { error } = await supabase
        .from('work_plan_attachments')
        .update({
          file_url: uploaded.publicUrl,
          file_path: uploaded.path,
          file_size: uploaded.finalBytes,
          mime_type: uploaded.file.type,
          source_type: 'manual',
        })
        .eq('id', row.id);
      if (error) {
        toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
        return false;
      }
      if (!opts?.quiet) {
        toast({
          title: `${row.name}에 첨부됨`,
          description: uploaded.compressed
            ? `이미지 압축 ${formatBytes(uploaded.originalBytes)} → ${formatBytes(uploaded.finalBytes)}`
            : undefined,
        });
      }
      onChange?.();
      await reload();
      const mime = (uploaded.file.type || '').toLowerCase();
      if (mime === 'application/pdf' || /\.pdf($|\?)/i.test(uploaded.publicUrl)) {
        void import('@/lib/pdfRender')
          .then(({ warmWorkPlanAttachmentPrintCache }) =>
            warmWorkPlanAttachmentPrintCache(
              { file_url: uploaded.publicUrl, mime_type: uploaded.file.type },
              projectId,
              workPlanId,
            ),
          )
          .catch((e) => console.warn('print cache warm failed', e));
      }
      return true;
    } finally {
      setUploadingId(null);
    }
  };

  const assignStagedToRow = async (stageId: string, row: Row) => {
    const item = staged.find((s) => s.id === stageId);
    if (!item) return;
    const ok = await handleUpload(row, item.file, { quiet: false });
    if (ok) removeStaged(stageId);
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
    const { error } = await supabase
      .from('work_plan_attachments')
      .update({ file_url: null, file_path: null, file_size: null, mime_type: null })
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
      </CardHeader>
      <CardContent className="space-y-4">
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
                  <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive gap-1" onClick={clearInbox}>
                    <Trash2 className="h-3 w-3" /> 비우기
                  </Button>
                )}
              </div>
            </div>

            {staged.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {staged.map((s) => {
                  const armed = armedStageId === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`w-[140px] rounded border bg-card p-1.5 space-y-1.5 ${armed ? 'border-primary ring-1 ring-primary/40' : ''}`}
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
                        <p className="text-[9px] truncate mt-1" title={s.file.name}>{s.file.name}</p>
                      </button>
                      <Select
                        value=""
                        onValueChange={(rowId) => {
                          const row = rows.find((r) => r.id === rowId);
                          if (row) void assignStagedToRow(s.id, row);
                        }}
                      >
                        <SelectTrigger className="h-7 text-[10px]">
                          <SelectValue placeholder="항목에 넣기" />
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
                        <p className="text-xs font-medium truncate flex items-center gap-1">
                          {row.name}
                          {isAuto && <Bot className="h-3 w-3 text-primary" aria-label="자동 첨부" />}
                          {row.locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="잠금" />}
                          {isSelected && (
                            <Badge variant="outline" className="text-[9px] h-4 border-primary text-primary">붙여넣기</Badge>
                          )}
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
                            onClick={(e) => e.stopPropagation()}
                          >
                            보기
                          </a>
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 inline-flex items-center gap-0.5"
                            title="이 첨부만 인쇄"
                            onClick={(e) => {
                              e.stopPropagation();
                              const w = window.open(row.file_url!, '_blank');
                              if (w) setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 800);
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
        {template.length === 0 && null}
      </CardContent>
    </Card>
    </div>
  );
}
