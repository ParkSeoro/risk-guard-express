import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Camera, CheckCircle2, Clock, AlertTriangle, Image as ImageIcon } from 'lucide-react';

interface FeedbackItem {
  id: string;
  project_id: string;
  assessment_run_id: string;
  risk_item_id: string | null;
  feedback_type: string;
  description: string;
  status: string;
  before_image_urls: string[];
  after_image_urls: string[];
  created_by: string | null;
  assignee_user_id: string | null;
  created_at: string;
  completed_at: string | null;
}

interface RiskItemBasic {
  id: string;
  process: string;
  sub_task: string | null;
  hazard: string | null;
  risk_grade?: string;
  improved_risk_grade?: string;
}

interface ProjectMember {
  user_id: string;
  display_name: string;
  company: string;
}

interface FeedbackPanelProps {
  runId: string;
  projectId: string;
  isApproved: boolean;
  riskItems: RiskItemBasic[];
  projectMembers: ProjectMember[];
  /** Previous run's unresolved feedback to display */
  previousFeedback?: FeedbackItem[];
}

const FEEDBACK_TYPES = ['보완', '지적', '개선'] as const;
const FEEDBACK_STATUSES = ['미조치', '진행중', '완료'] as const;

// Allow both auto (improved_risk_grade === '상') and manual selection
function getFeedbackTargetItems(riskItems: RiskItemBasic[], manualIds: Set<string>): RiskItemBasic[] {
  return riskItems.filter(item => 
    (item as any).improved_risk_grade === '상' || manualIds.has(item.id)
  );
}

export default function FeedbackPanel({ runId, projectId, isApproved, riskItems, projectMembers, previousFeedback }: FeedbackPanelProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [manualFeedbackTargets, setManualFeedbackTargets] = useState<Set<string>>(new Set());
  const [showTargetSelection, setShowTargetSelection] = useState(false);

  // Form state
  const [formRiskItemId, setFormRiskItemId] = useState('');
  const [formType, setFormType] = useState<string>('보완');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<string>('미조치');
  const [formAssignee, setFormAssignee] = useState('');
  const [formBeforeFiles, setFormBeforeFiles] = useState<File[]>([]);
  const [formAfterFiles, setFormAfterFiles] = useState<File[]>([]);
  const [formBeforePreviews, setFormBeforePreviews] = useState<string[]>([]);
  const [formAfterPreviews, setFormAfterPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('risk_item_feedback' as any)
      .select('*')
      .eq('assessment_run_id', runId)
      .order('created_at', { ascending: false });
    setFeedbackList((data || []) as any);
    setLoading(false);
  }, [runId]);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);

  const uploadImages = async (files: File[], prefix: string): Promise<string[]> => {
    const urls: string[] = [];
    for (const file of files) {
      const ext = file.name.split('.').pop();
      const path = `feedback/${projectId}/${runId}/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('attachments').upload(path, file);
      if (!error) {
        const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
    }
    return urls;
  };

  const handleSave = async () => {
    if (!formDescription.trim()) {
      toast({ title: '조치내용을 입력하세요.', variant: 'destructive' });
      return;
    }
    // Validate: feedback only for items with improved_risk_grade === '상' (관리대상) OR manually selected
    if (formRiskItemId) {
      const selectedItem = riskItems.find(i => i.id === formRiskItemId);
      if (selectedItem && (selectedItem as any).improved_risk_grade !== '상' && !manualFeedbackTargets.has(formRiskItemId)) {
        toast({ title: "개선 후 위험도 '상'(관리대상) 또는 수동 선택 항목만 피드백 대상입니다.", variant: 'destructive' });
        return;
      }
    }
    // Before photo is REQUIRED for new feedback
    if (!editingId && formBeforeFiles.length === 0) {
      toast({ title: '조치 전(Before) 사진은 필수입니다.', variant: 'destructive' });
      return;
    }
    // After photo is REQUIRED when status is 완료
    if (formStatus === '완료' && formAfterFiles.length === 0) {
      // Check if editing and already has after images
      const existing = editingId ? feedbackList.find(f => f.id === editingId) : null;
      if (!existing?.after_image_urls?.length) {
        toast({ title: '완료 처리 시 조치 후(After) 사진이 필수입니다.', variant: 'destructive' });
        return;
      }
    }
    setSaving(true);
    try {
      let beforeUrls: string[] = [];
      let afterUrls: string[] = [];
      if (formBeforeFiles.length > 0) beforeUrls = await uploadImages(formBeforeFiles, 'before');
      if (formAfterFiles.length > 0) afterUrls = await uploadImages(formAfterFiles, 'after');

      if (editingId) {
        const updateData: Record<string, any> = {
          feedback_type: formType,
          description: formDescription,
          status: formStatus,
          risk_item_id: formRiskItemId || null,
          assignee_user_id: formAssignee || null,
        };
        if (beforeUrls.length > 0) {
          const existing = feedbackList.find(f => f.id === editingId);
          updateData.before_image_urls = [...(existing?.before_image_urls || []), ...beforeUrls];
        }
        if (afterUrls.length > 0) {
          const existing = feedbackList.find(f => f.id === editingId);
          updateData.after_image_urls = [...(existing?.after_image_urls || []), ...afterUrls];
        }
        if (formStatus === '완료') updateData.completed_at = new Date().toISOString();

        await supabase.from('risk_item_feedback' as any).update(updateData).eq('id', editingId);
        toast({ title: '피드백이 수정되었습니다.' });
      } else {
        const insertData = {
          project_id: projectId,
          assessment_run_id: runId,
          risk_item_id: formRiskItemId || null,
          feedback_type: formType,
          description: formDescription,
          status: formStatus,
          before_image_urls: beforeUrls,
          after_image_urls: afterUrls,
          created_by: user?.id || null,
          assignee_user_id: formAssignee || null,
          completed_at: formStatus === '완료' ? new Date().toISOString() : null,
        };
        await supabase.from('risk_item_feedback' as any).insert([insertData]);
        toast({ title: '피드백이 등록되었습니다.' });
      }

      resetForm();
      setShowAdd(false);
      setEditingId(null);
      fetchFeedback();
    } catch (err) {
      toast({ title: '저장 실패', description: String(err), variant: 'destructive' });
    }
    setSaving(false);
  };

  const resetForm = () => {
    setFormRiskItemId('');
    setFormType('보완');
    setFormDescription('');
    setFormStatus('미조치');
    setFormAssignee('');
    setFormBeforeFiles([]);
    setFormAfterFiles([]);
    setFormBeforePreviews([]);
    setFormAfterPreviews([]);
  };

  const handleFileChange = (files: File[], setter: (f: File[]) => void, previewSetter: (p: string[]) => void) => {
    setter(files);
    const previews = files.map(f => URL.createObjectURL(f));
    previewSetter(previews);
  };

  const openEdit = (fb: FeedbackItem) => {
    setEditingId(fb.id);
    setFormRiskItemId(fb.risk_item_id || '');
    setFormType(fb.feedback_type);
    setFormDescription(fb.description);
    setFormStatus(fb.status);
    setFormAssignee(fb.assignee_user_id || '');
    setFormBeforeFiles([]);
    setFormAfterFiles([]);
    setShowAdd(true);
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    const updateData: Record<string, any> = { status: newStatus };
    if (newStatus === '완료') updateData.completed_at = new Date().toISOString();
    else updateData.completed_at = null;
    await supabase.from('risk_item_feedback' as any).update(updateData).eq('id', id);
    fetchFeedback();
    toast({ title: `상태: ${newStatus}` });
  };

  const getRiskItemLabel = (id: string | null) => {
    if (!id) return '(항목 미지정)';
    const item = riskItems.find(i => i.id === id);
    return item ? `${item.process} – ${item.sub_task || ''} – ${item.hazard || ''}` : '(삭제된 항목)';
  };

  const getMemberName = (userId: string | null) => {
    if (!userId) return '미지정';
    const m = projectMembers.find(p => p.user_id === userId);
    return m ? m.display_name : '(알 수 없음)';
  };

  const statusIcon = (status: string) => {
    if (status === '완료') return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    if (status === '진행중') return <Clock className="h-3.5 w-3.5 text-warning" />;
    return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  };

  const statusColor = (status: string) => {
    if (status === '완료') return 'bg-success/10 text-success border-success/30';
    if (status === '진행중') return 'bg-warning/10 text-warning border-warning/30';
    return 'bg-destructive/10 text-destructive border-destructive/30';
  };

  const unresolvedPrevious = (previousFeedback || []).filter(f => f.status !== '완료');

  return (
    <div className="space-y-4">
      {/* Previous unresolved feedback */}
      {unresolvedPrevious.length > 0 && (
        <Card className="border-warning">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-warning">
              <AlertTriangle className="h-4 w-4" />
              이전 회차 미조치 항목 ({unresolvedPrevious.length}건)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-60 overflow-y-auto">
            {unresolvedPrevious.map(fb => (
              <div key={fb.id} className="flex items-start gap-3 text-xs p-2 bg-warning/5 rounded border border-warning/20">
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    {statusIcon(fb.status)}
                    <Badge variant="outline" className="text-[9px]">{fb.feedback_type}</Badge>
                    <Badge variant="outline" className={`text-[9px] ${statusColor(fb.status)}`}>{fb.status}</Badge>
                  </div>
                  <p className="text-muted-foreground">{getRiskItemLabel(fb.risk_item_id)}</p>
                  <p>{fb.description}</p>
                  <p className="text-muted-foreground text-[10px]">담당: {getMemberName(fb.assignee_user_id)}</p>
                </div>
                {fb.before_image_urls?.length > 0 && (
                  <div className="flex gap-1">
                    {fb.before_image_urls.slice(0, 2).map((url, i) => (
                      <img key={i} src={url} alt="before" className="w-10 h-10 rounded object-cover border" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">피드백(조치관리) · {feedbackList.length}건</h3>
        {isApproved ? (
          <Button size="sm" className="gap-1.5" onClick={() => { resetForm(); setEditingId(null); setShowAdd(true); }}>
            <Plus className="h-3.5 w-3.5" /> 피드백 등록
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">승인 완료된 회차만 피드백(조치관리)이 가능합니다.</p>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">※ 개선 후 위험도 '상'(관리대상) 항목만 피드백 등록 대상입니다.</p>

      {/* Feedback list */}
      {loading ? (
        <p className="text-xs text-muted-foreground text-center py-4">로딩 중...</p>
      ) : feedbackList.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">등록된 피드백이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {feedbackList.map(fb => (
            <Card key={fb.id} className="hover:shadow-sm transition-shadow cursor-pointer" onClick={() => isApproved && openEdit(fb)}>
              <CardContent className="py-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {statusIcon(fb.status)}
                  <Badge variant="outline" className="text-[9px]">{fb.feedback_type}</Badge>
                  <Badge variant="outline" className={`text-[9px] ${statusColor(fb.status)}`}>{fb.status}</Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto">{new Date(fb.created_at).toLocaleDateString('ko-KR')}</span>
                </div>
                <p className="text-xs text-muted-foreground">{getRiskItemLabel(fb.risk_item_id)}</p>
                <p className="text-xs">{fb.description}</p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>담당: {getMemberName(fb.assignee_user_id)}</span>
                  {fb.completed_at && <span>완료: {new Date(fb.completed_at).toLocaleDateString('ko-KR')}</span>}
                </div>
                {/* Image thumbnails */}
                {(fb.before_image_urls?.length > 0 || fb.after_image_urls?.length > 0) && (
                  <div className="flex gap-3 mt-1">
                    {fb.before_image_urls?.length > 0 && (
                      <div className="space-y-0.5">
                        <span className="text-[9px] text-muted-foreground">조치 전</span>
                        <div className="flex gap-1">
                          {fb.before_image_urls.map((url, i) => (
                            <img key={i} src={url} alt="before" className="w-12 h-12 rounded object-cover border" onClick={e => { e.stopPropagation(); window.open(url, '_blank'); }} />
                          ))}
                        </div>
                      </div>
                    )}
                    {fb.after_image_urls?.length > 0 && (
                      <div className="space-y-0.5">
                        <span className="text-[9px] text-muted-foreground">조치 후</span>
                        <div className="flex gap-1">
                          {fb.after_image_urls.map((url, i) => (
                            <img key={i} src={url} alt="after" className="w-12 h-12 rounded object-cover border" onClick={e => { e.stopPropagation(); window.open(url, '_blank'); }} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* Quick status change */}
                {isApproved && fb.status !== '완료' && (
                  <div className="flex gap-1 mt-1" onClick={e => e.stopPropagation()}>
                    {fb.status === '미조치' && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => handleStatusChange(fb.id, '진행중')}>진행중으로</Button>
                    )}
                    <Button size="sm" variant="outline" className="h-6 text-[10px] text-success" onClick={() => handleStatusChange(fb.id, '완료')}>완료 처리</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={showAdd} onOpenChange={(open) => { if (!open) { setShowAdd(false); setEditingId(null); } }}>
        <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingId ? '피드백 수정' : '피드백 등록'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>관련 위험성평가 항목 <span className="text-[10px] text-muted-foreground">(개선 후 위험도 '상' = 관리대상 항목만 표시)</span></Label>
              <Select value={formRiskItemId || '__none__'} onValueChange={v => setFormRiskItemId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="항목 선택 (선택사항)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(전체/일반)</SelectItem>
                  {riskItems.filter(item => (item as any).improved_risk_grade === '상').map(item => (
                    <SelectItem key={item.id} value={item.id} className="text-xs">
                      {item.process} – {item.sub_task || ''} – {item.hazard || ''} [관리대상]
                    </SelectItem>
                  ))}
                  {riskItems.filter(item => (item as any).improved_risk_grade === '상').length === 0 && (
                    <div className="px-2 py-1.5 text-[10px] text-muted-foreground">개선 후 위험도 '상' 항목이 없습니다.</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>피드백 유형</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FEEDBACK_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>조치 상태</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FEEDBACK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>조치 내용</Label>
              <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="조치 내용을 상세히 기록하세요..." className="text-xs min-h-[80px]" />
            </div>

            <div className="space-y-1.5">
              <Label>담당자</Label>
              <Select value={formAssignee || '__none__'} onValueChange={v => setFormAssignee(v === '__none__' ? '' : v)}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="담당자 선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(미지정)</SelectItem>
                  {projectMembers.map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.display_name}{m.company ? ` (${m.company})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> 조치 전 사진 <span className="text-destructive text-[10px]">*필수</span></Label>
                <Input type="file" accept="image/*" multiple className="text-xs" onChange={e => setFormBeforeFiles(Array.from(e.target.files || []))} />
                {formBeforeFiles.length > 0 && <p className="text-[10px] text-muted-foreground">{formBeforeFiles.length}개 파일 선택됨</p>}
                {editingId && (() => {
                  const existing = feedbackList.find(f => f.id === editingId);
                  return existing?.before_image_urls?.length ? (
                    <p className="text-[10px] text-success">기존 {existing.before_image_urls.length}개 사진 있음</p>
                  ) : null;
                })()}
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> 조치 후 사진 {formStatus === '완료' && <span className="text-destructive text-[10px]">*필수</span>}</Label>
                <Input type="file" accept="image/*" multiple className="text-xs" onChange={e => setFormAfterFiles(Array.from(e.target.files || []))} />
                {formAfterFiles.length > 0 && <p className="text-[10px] text-muted-foreground">{formAfterFiles.length}개 파일 선택됨</p>}
                {editingId && (() => {
                  const existing = feedbackList.find(f => f.id === editingId);
                  return existing?.after_image_urls?.length ? (
                    <p className="text-[10px] text-success">기존 {existing.after_image_urls.length}개 사진 있음</p>
                  ) : null;
                })()}
              </div>
            </div>

            {!editingId && formBeforeFiles.length === 0 && (
              <p className="text-[10px] text-destructive">⚠ 조치 전 사진을 첨부해야 저장할 수 있습니다.</p>
            )}

            <Button onClick={handleSave} className="w-full" disabled={saving || (!editingId && formBeforeFiles.length === 0)}>
              {saving ? '저장 중...' : editingId ? '수정' : '등록'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
