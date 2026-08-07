import { useState, useEffect, useCallback } from 'react';
import { generateAttachments, getAttachmentCategories, withKind, type AttachmentItem } from '@/lib/attachmentTemplates';
import { syncTemplateRows } from '@/lib/workPlanAttachments';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Paperclip, Upload, CheckCircle2, Lock, Bot, FileWarning, Loader2, Printer } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { computeAttachmentProgress, type AttachmentProgress } from '@/lib/workPlanAttachments';
import { compressUploadFile, formatBytes, DEFAULT_UPLOAD_MAX_BYTES } from '@/lib/compressUploadFile';

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
  /** 결재 상신 시 사용할 콜백 (예: setIsDirty) */
  onChange?: () => void;
  /** 상단 액션바 진행률/결재 차단용 */
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
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<AttachmentItem[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

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

  const toggleCondition = (field: string) => {
    setConditions(prev => ({ ...prev, [field]: prev[field] === 'true' ? 'false' : 'true' }));
  };

  const handleUpload = async (row: Row, file: File) => {
    setUploadingId(row.id);
    try {
      let prepared;
      try {
        prepared = await compressUploadFile(file, { maxBytes: DEFAULT_UPLOAD_MAX_BYTES });
      } catch (e: any) {
        toast({ title: '업로드 불가', description: e?.message || String(e), variant: 'destructive' });
        return;
      }
      const uploadFile = prepared.file;
      const safeName = uploadFile.name.replace(/[^\w.\-]+/g, '_');
      const path = `${projectId}/work-plans/${workPlanId}/${row.attachment_key}_${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, uploadFile, {
        upsert: true,
        contentType: uploadFile.type || undefined,
      });
      if (upErr) {
        toast({ title: '업로드 실패', description: upErr.message, variant: 'destructive' });
        return;
      }
      const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path);
      const { error } = await supabase
        .from('work_plan_attachments')
        .update({
          file_url: urlData.publicUrl,
          file_path: path,
          file_size: uploadFile.size,
          mime_type: uploadFile.type,
        })
        .eq('id', row.id);
      if (error) {
        toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
        return;
      }
      toast({
        title: '업로드되었습니다.',
        description: prepared.compressed
          ? `이미지 압축 ${formatBytes(prepared.originalBytes)} → ${formatBytes(prepared.finalBytes)}`
          : undefined,
      });
      onChange?.();
      await reload();
    } finally {
      setUploadingId(null);
    }
  };

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

  // group by 3-tier kind
  const groups: Row['category'][] = ['legal', 'calc_evidence', 'site_proof'];
  const uploaded = rows.filter(r => !!r.file_url).length;
  const mandatoryMissing = rows.filter(r => r.is_mandatory && !r.file_url).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Paperclip className="h-4 w-4" /> 필수 첨부자료
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {mandatoryMissing > 0 && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <FileWarning className="h-3 w-3" /> 필수 미첨부 {mandatoryMissing}
              </Badge>
            )}
            <Badge variant={uploaded === rows.length && rows.length > 0 ? 'default' : 'outline'} className="text-[10px]">
              {uploaded}/{rows.length} 업로드
            </Badge>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground pt-1">
          공종별 필수 서류를 모두 올리면 결재·인쇄에 포함됩니다. 법정필수 누락 시 결재가 차단됩니다.
          사진(JPG/PNG/WebP)은 업로드 시 자동 압축됩니다. PDF는 원본(최대 20MB)입니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Condition toggles */}
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
                  const uploaded = !!row.file_url;
                  const isAuto = row.source_type && row.source_type !== 'manual';
                  return (
                    <div key={row.id} className={`flex items-center gap-2 p-2 rounded border bg-card hover:bg-muted/20 ${row.is_mandatory && !uploaded ? 'border-destructive/40' : ''}`}>
                      {uploaded
                        ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        : <div className={`h-4 w-4 rounded-full border-2 shrink-0 ${row.is_mandatory ? 'border-destructive/60' : 'border-muted-foreground/30'}`} />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate flex items-center gap-1">
                          {row.name}
                          {isAuto && <Bot className="h-3 w-3 text-primary" aria-label="자동 첨부" />}
                          {row.locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="잠금" />}
                        </p>
                        {row.description && <p className="text-[10px] text-muted-foreground truncate">{row.description}</p>}
                      </div>
                      {row.is_mandatory && <Badge variant="destructive" className="text-[9px] h-4 shrink-0">필수</Badge>}
                      {uploaded && (
                        <>
                          <a href={row.file_url!} target="_blank" rel="noopener"
                            className="text-[10px] text-primary hover:underline shrink-0">보기</a>
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 inline-flex items-center gap-0.5"
                            title="이 첨부만 인쇄"
                            onClick={() => {
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
                          <label className={`cursor-pointer shrink-0 ${uploadingId === row.id ? 'opacity-50 pointer-events-none' : ''}`}>
                            <input type="file" className="hidden" disabled={uploadingId === row.id} onChange={e => {
                              if (e.target.files?.[0]) handleUpload(row, e.target.files[0]);
                              e.target.value = '';
                            }} />
                            <Button asChild size="sm" variant="ghost" className="h-6 text-[10px] gap-1" disabled={uploadingId === row.id}>
                              <span>
                                {uploadingId === row.id
                                  ? <><Loader2 className="h-3 w-3 animate-spin" /> 업로드 중…</>
                                  : <><Upload className="h-3 w-3" /> {uploaded ? '교체' : '업로드'}</>}
                              </span>
                            </Button>
                          </label>
                          {uploaded && uploadingId !== row.id && (
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive"
                              onClick={() => handleRemove(row)}>제거</Button>
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
      </CardContent>
    </Card>
  );
}
