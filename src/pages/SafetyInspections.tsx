import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ClipboardCheck, Plus, Camera, Printer, AlertTriangle, CheckCircle2, XCircle, Loader2, Trash2, Search, Copy, Pencil, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { buildChecklist, INSPECTION_TYPE_LABELS, PROCESS_CATEGORIES, type InspectionType } from '@/lib/inspectionTemplates';
import IMESafeInput from '@/components/IMESafeInput';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import MultiCompanyFilter from '@/components/MultiCompanyFilter';
import AssigneeSelect from '@/components/AssigneeSelect';
import { uploadAttachmentFile } from '@/lib/compressUploadFile';
import { datePartFromDateTime } from '@/lib/permitWorkDate';
import { fetchTodayPermitRoute, fetchPatrolPrintContext } from '@/lib/legalForms/fetchTodayPermitRoute';
import { closePendingInspectionAction, notifyInspectionFailSummary } from '@/lib/inspectionFailNotify';
import {
  PATROL_INSPECTION_CATEGORY,
  PATROL_LOG_DISCLAIMER,
  PATROL_LOG_TITLE,
  PATROL_PROCESS_CATEGORY,
  PATROL_WALK_PHOTO_LABEL,
  buildPatrolLogHtml,
  emptyDirectorPatrolItems,
  formatInspectorLine,
  formatSiteLabel,
  inspectorTitleFromMember,
  isPatrolInspection,
  isPatrolLogLocked,
  canWithdrawPatrolLog,
  patrolLockEditHint,
  normalizeDirectorPatrolItems,
  type DirectorPatrolItem,
} from '@/lib/legalForms/patrolLog';
import ApprovalLineManager, { type DraftStatusInfo } from '@/components/ApprovalLineManager';
import { submitApprovalFromDraft } from '@/lib/approvalPlatform';
import { DEFAULT_STEPS_BY_ENTITY } from '@/lib/approvalRules';
import {
  filterVisibleInspectionActions,
  isOpenInspectionAction,
  INSPECTION_ACTION_DONE_STATUS,
} from '@/lib/inspectionActions';
type Inspection = {
  id: string;
  inspection_type: InspectionType;
  process_category: string;
  inspector_name: string;
  inspector_id?: string | null;
  inspected_at: string;
  location: string;
  summary: string;
  status: string;
  created_at: string;
  company_id?: string | null;
  project_id?: string;
  is_deleted?: boolean;
  weather?: string;
  patrol_photos?: string[];
  director_items?: DirectorPatrolItem[];
  submitted_payload?: Record<string, unknown> | null;
};

type InspItem = {
  id: string;
  inspection_id: string;
  checklist_code: string;
  label: string;
  legal_basis: string;
  result: 'pass' | 'fail' | 'na';
  note: string;
  photos: string[];
  sort_order: number;
};

type InspAction = {
  id: string;
  inspection_id: string;
  item_id: string | null;
  issue: string;
  severity: string;
  assignee_name: string;
  due_date: string | null;
  status: 'pending' | 'in_progress' | 'done';
  evidence_photos: string[];
  completed_at: string | null;
  completion_note: string;
};

export default function SafetyInspections() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { selectedProject, userCompanyId, userRole, userPosition, projects } = useGlobalProjectAccess();
  const [searchParams] = useSearchParams();
  const deepId = searchParams.get('id');
  const projectId = selectedProject;
  const projectLabel = (() => {
    const p = projects.find((x) => x.id === projectId);
    return p ? formatSiteLabel(p.name, p.site_name) : '';
  })();
  const selfTitle = inspectorTitleFromMember({ position: userPosition, role: userRole });
  const patrolSeedSteps = DEFAULT_STEPS_BY_ENTITY.safety_inspection;
  const [tab, setTab] = useState('list');
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [actions, setActions] = useState<(InspAction & { inspection?: Inspection })[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [detail, setDetail] = useState<Inspection | null>(null);
  const [detailItems, setDetailItems] = useState<InspItem[]>([]);
  const [detailActions, setDetailActions] = useState<InspAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_progress' | 'completed'>('all');

  // create form
  const [form, setForm] = useState({
    inspection_type: 'patrol' as InspectionType,
    process_category: PATROL_PROCESS_CATEGORY,
    location: '',
    summary: '',
    inspector_name: profile?.display_name || '',
  });
  const [todayRoute, setTodayRoute] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ location: '', summary: '', inspector_name: '', inspected_at: '' });
  const [findingText, setFindingText] = useState('');
  const [inspectorTitle, setInspectorTitle] = useState('');
  const [weather, setWeather] = useState('');
  const [patrolPhotos, setPatrolPhotos] = useState<string[]>([]);
  const [directorItems, setDirectorItems] = useState<DirectorPatrolItem[]>(emptyDirectorPatrolItems());
  const [approvalDraftInfo, setApprovalDraftInfo] = useState<DraftStatusInfo | null>(null);
  const [approverMembers, setApproverMembers] = useState<Array<{
    user_id: string; display_name: string; company: string; company_id: string | null; position: string; role: string;
  }>>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; type: string; parent_company_id?: string | null }>>([]);
  const [myPendingApprovalId, setMyPendingApprovalId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!projectId) return;
    setListLoading(true);
    const { data: insps } = await supabase
      .from('safety_inspections' as any)
      .select('*')
      .eq('project_id', projectId)
      .eq('is_deleted', false)
      .order('inspected_at', { ascending: false })
      .limit(200);
    setInspections((insps as any) || []);

    const { data: acts } = await supabase
      .from('safety_inspection_actions' as any)
      .select('*, inspection:inspection_id(id, is_deleted)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(200);
    // 삭제된·권한상 안 보이는 점검에 속한 조치(유령) 제외
    setActions(filterVisibleInspectionActions(((acts as any) || []) as any));
    setListLoading(false);
  };
  useEffect(() => { load(); }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    fetchTodayPermitRoute(projectId).then((route) => {
      setTodayRoute(route);
      setForm((f) => {
        if (!isPatrolInspection(f.inspection_type) || f.location.trim()) return f;
        return { ...f, location: route };
      });
    });
  }, [projectId]);

  const handleCreate = async () => {
    if (!projectId) return toast({ title: '프로젝트를 선택하세요.', variant: 'destructive' });
    const patrol = isPatrolInspection(form.inspection_type);
    const location = form.location.trim() || (patrol ? todayRoute : '');
    if (!location) return toast({ title: patrol ? '순회 구간을 입력하세요.' : '점검 위치를 입력하세요.', variant: 'destructive' });
    setLoading(true);
    try {
      const { data: ins, error } = await supabase
        .from('safety_inspections' as any)
        .insert({
          project_id: projectId,
          // Prefer own company for GC peer isolation; NULL still allowed by RLS for managers
          company_id: userCompanyId || null,
          inspection_type: form.inspection_type,
          process_category: patrol ? PATROL_PROCESS_CATEGORY : form.process_category,
          inspection_category: patrol ? PATROL_INSPECTION_CATEGORY : null,
          location,
          summary: form.summary,
          inspector_name: form.inspector_name || profile?.display_name || '',
          inspector_id: profile?.user_id,
          created_by: profile?.user_id,
          status: 'in_progress',
          weather: weather || '',
          patrol_photos: [],
          director_items: emptyDirectorPatrolItems(),
        })
        .select()
        .single();
      if (error) throw error;

      const checklist = buildChecklist(form.inspection_type, patrol ? PATROL_PROCESS_CATEGORY : form.process_category);
      const items = checklist.map((c, i) => ({
        inspection_id: (ins as any).id,
        checklist_code: c.code,
        label: c.label,
        legal_basis: c.legal_basis,
        sort_order: i,
      }));
      if (items.length > 0) {
        const { error: e2 } = await supabase.from('safety_inspection_items' as any).insert(items);
        if (e2) throw e2;
      }
      toast({ title: patrol ? '순회점검일지가 생성되었습니다.' : '점검이 생성되었습니다.', description: `체크리스트 ${items.length}개 항목 자동 생성` });
      setOpenCreate(false);
      await load();
      await openDetail((ins as any));
    } catch (e: any) {
      toast({ title: '생성 실패', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (insp: Inspection) => {
    setDetail(insp);
    const { data: its } = await supabase.from('safety_inspection_items' as any)
      .select('*').eq('inspection_id', insp.id).order('sort_order');
    const normalized = ((its as any) || []).map((x: any) => ({ ...x, photos: x.photos || [] }));
    setDetailItems(normalized);
    const { data: acts } = await supabase.from('safety_inspection_actions' as any)
      .select('*').eq('inspection_id', insp.id).order('created_at');
    setDetailActions(((acts as any) || []).map((x: any) => ({ ...x, evidence_photos: x.evidence_photos || [] })));
    setWeather(String(insp.weather || ''));
    setPatrolPhotos(Array.isArray(insp.patrol_photos) ? insp.patrol_photos : []);
    setDirectorItems(normalizeDirectorPatrolItems(insp.director_items));
    setMyPendingApprovalId(null);
    if (insp.inspector_id && projectId) {
      const { data: mem } = await supabase
        .from('project_members')
        .select('role_new, position_new')
        .eq('project_id', projectId)
        .eq('user_id', insp.inspector_id)
        .maybeSingle();
      setInspectorTitle(inspectorTitleFromMember({
        position: (mem as any)?.position_new,
        role: (mem as any)?.role_new,
      }));
    } else {
      setInspectorTitle('');
    }
    if (isPatrolInspection(insp.inspection_type) && projectId) {
      const [{ data: mems }, { data: cos }] = await Promise.all([
        supabase.from('project_members').select('user_id, role_new, position_new, company_id, companies(name, type, parent_company_id), profiles(display_name)').eq('project_id', projectId),
        supabase.from('project_companies').select('company_id, companies(id, name, type, parent_company_id)').eq('project_id', projectId),
      ]);
      setApproverMembers(((mems as any[]) || []).map((m) => ({
        user_id: m.user_id,
        display_name: m.profiles?.display_name || '',
        company: m.companies?.name || '',
        company_id: m.company_id,
        position: m.position_new || '',
        role: m.role_new || '',
      })));
      const uniq = new Map<string, { id: string; name: string; type: string; parent_company_id?: string | null }>();
      for (const row of (cos as any[]) || []) {
        const c = row.companies;
        if (c?.id) uniq.set(c.id, { id: c.id, name: c.name, type: c.type, parent_company_id: c.parent_company_id });
      }
      setCompanies(Array.from(uniq.values()));
      if (profile?.user_id) {
        const { data: pending } = await supabase
          .from('approvals')
          .select('id')
          .eq('entity_type', 'safety_inspection')
          .eq('entity_id', insp.id)
          .eq('approver_id', profile.user_id)
          .eq('status', '진행중')
          .maybeSingle();
        setMyPendingApprovalId((pending as any)?.id || null);
      }
    }
  };

  useEffect(() => {
    if (!deepId || !projectId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('safety_inspections' as any).select('*').eq('id', deepId).maybeSingle();
      if (cancelled) return;
      if (!data) {
        toast({ title: '점검을 찾을 수 없습니다.', variant: 'destructive' });
        return;
      }
      if ((data as Inspection).is_deleted) {
        toast({
          title: '삭제된 점검입니다.',
          description: '불합격 알람 후 결과가 정정·삭제된 경우가 있습니다.',
          variant: 'destructive',
        });
        return;
      }
      await openDetail(data as Inspection);
    })();
    return () => { cancelled = true; };
  }, [deepId, projectId]);

  const cloneInspection = async (src: Inspection, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!projectId) return;
    setLoading(true);
    try {
      const { data: ins, error } = await supabase.from('safety_inspections' as any).insert({
        project_id: projectId,
        company_id: (src as any).company_id || userCompanyId || null,
        inspection_type: src.inspection_type,
        process_category: isPatrolInspection(src.inspection_type) ? PATROL_PROCESS_CATEGORY : src.process_category,
        inspection_category: isPatrolInspection(src.inspection_type) ? PATROL_INSPECTION_CATEGORY : null,
        location: src.location,
        summary: src.summary ? `(복제) ${src.summary}` : '',
        inspector_name: profile?.display_name || src.inspector_name,
        inspector_id: profile?.user_id || src.inspector_id,
        created_by: profile?.user_id,
        status: 'in_progress',
      }).select().single();
      if (error) throw error;
      const { data: srcItems } = await supabase.from('safety_inspection_items' as any)
        .select('checklist_code, label, legal_basis, sort_order').eq('inspection_id', src.id).order('sort_order');
      const rows = ((srcItems as any[]) || []).map((c) => ({
        inspection_id: (ins as any).id,
        checklist_code: c.checklist_code,
        label: c.label,
        legal_basis: c.legal_basis,
        sort_order: c.sort_order,
      }));
      if (rows.length) {
        const { error: e2 } = await supabase.from('safety_inspection_items' as any).insert(rows);
        if (e2) throw e2;
      }
      toast({ title: '복제되었습니다.', description: '결과·사진은 비우고 새 일지로 열었습니다.' });
      await load();
      await openDetail(ins as any);
    } catch (err: any) {
      toast({ title: '복제 실패', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (insp: Inspection, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isPatrolInspection(insp.inspection_type) && isPatrolLogLocked(insp.status)) {
      return toast({ title: patrolLockEditHint(insp.status), variant: 'destructive' });
    }
    const d = new Date(insp.inspected_at);
    const local = Number.isNaN(d.getTime())
      ? ''
      : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setEditTargetId(insp.id);
    setEditForm({
      location: insp.location || '',
      summary: insp.summary || '',
      inspector_name: insp.inspector_name || '',
      inspected_at: local,
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editTargetId) return;
    if (!editForm.location.trim()) return toast({ title: '순회 구간(위치)을 입력하세요.', variant: 'destructive' });
    const patch: Record<string, string> = {
      location: editForm.location.trim(),
      summary: editForm.summary,
      inspector_name: editForm.inspector_name,
    };
    if (editForm.inspected_at) patch.inspected_at = new Date(editForm.inspected_at).toISOString();
    const { error } = await supabase.from('safety_inspections' as any).update(patch).eq('id', editTargetId);
    if (error) return toast({ title: '수정 실패', description: error.message, variant: 'destructive' });
    setInspections((prev) => prev.map((x) => x.id === editTargetId ? { ...x, ...patch } : x));
    if (detail?.id === editTargetId) setDetail({ ...detail, ...patch });
    setEditOpen(false);
    toast({ title: '수정되었습니다.' });
  };

  const addDetailFinding = async () => {
    if (!detail || !findingText.trim()) return toast({ title: '발견사항을 입력하세요.', variant: 'destructive' });
    const sort = detailItems.length;
    const { data, error } = await supabase.from('safety_inspection_items' as any).insert({
      inspection_id: detail.id,
      checklist_code: `PT-FIND-${sort + 1}`,
      label: findingText.trim(),
      legal_basis: '산업안전보건법 시행령 제18조제1항제5호',
      sort_order: sort,
      result: 'fail',
    }).select().single();
    if (error) return toast({ title: '추가 실패', description: error.message, variant: 'destructive' });
    setFindingText('');
    const row = { ...(data as any), photos: [] } as InspItem;
    setDetailItems((prev) => [...prev, row]);
    await updateItemResult(row, 'fail');
  };

  const updateItemResult = async (item: InspItem, result: 'pass' | 'fail' | 'na') => {
    if (detail && isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status)) {
      return toast({ title: patrolLockEditHint(detail.status), variant: 'destructive' });
    }
    const { error } = await supabase.from('safety_inspection_items' as any)
      .update({ result }).eq('id', item.id);
    if (error) return toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    setDetailItems(prev => prev.map(x => x.id === item.id ? { ...x, result } : x));

    // 조치 요청만 생성. 불합격 알람은 점검 완료 시점에 남은 fail 만 보낸다.
    if (result === 'fail' && detail) {
      const exists = detailActions.find(a => a.item_id === item.id);
      if (!exists) {
        const { data: a, error: e2 } = await supabase.from('safety_inspection_actions' as any).insert({
          inspection_id: detail.id,
          item_id: item.id,
          project_id: projectId,
          issue: item.label,
          severity: 'medium',
          status: 'pending',
        }).select().single();
        if (!e2 && a) {
          setDetailActions(prev => [...prev, { ...(a as any), evidence_photos: [] }]);
        }
      }
    } else {
      await closePendingInspectionAction(item.id);
      setDetailActions(prev => prev.map((a) =>
        a.item_id === item.id && a.status === 'pending'
          ? { ...a, status: 'done', completion_note: '점검 결과 합격/해당없음으로 정정', completed_at: new Date().toISOString() }
          : a
      ));
    }
  };

  const assertEditable = () => {
    if (detail && isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status)) {
      toast({ title: patrolLockEditHint(detail.status), variant: 'destructive' });
      return false;
    }
    return true;
  };

  const updateItemNote = async (item: InspItem, note: string) => {
    if (!assertEditable()) return;
    setDetailItems(prev => prev.map(x => x.id === item.id ? { ...x, note } : x));
    await supabase.from('safety_inspection_items' as any).update({ note }).eq('id', item.id);
  };

  const uploadPhoto = async (file: File, folder: string): Promise<string | null> => {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${projectId}/safety-inspection/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    try {
      const uploaded = await uploadAttachmentFile(path, file);
      return uploaded.publicUrl;
    } catch (e: any) {
      toast({ title: '업로드 실패', description: e?.message || String(e), variant: 'destructive' });
      return null;
    }
  };

  const onItemPhoto = async (item: InspItem, files: FileList | null) => {
    if (!assertEditable()) return;
    if (!files || files.length === 0) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await uploadPhoto(f, `item-${item.id}`);
      if (u) urls.push(u);
    }
    const newPhotos = [...(item.photos || []), ...urls];
    await supabase.from('safety_inspection_items' as any).update({ photos: newPhotos }).eq('id', item.id);
    setDetailItems(prev => prev.map(x => x.id === item.id ? { ...x, photos: newPhotos } : x));
  };

  const onActionEvidence = async (action: InspAction, files: FileList | null) => {
    if (!assertEditable()) return;
    if (!files || files.length === 0) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await uploadPhoto(f, `action-${action.id}`);
      if (u) urls.push(u);
    }
    const newPhotos = [...(action.evidence_photos || []), ...urls];
    await supabase.from('safety_inspection_actions' as any).update({ evidence_photos: newPhotos }).eq('id', action.id);
    setDetailActions(prev => prev.map(x => x.id === action.id ? { ...x, evidence_photos: newPhotos } : x));
  };

  const completeAction = async (action: InspAction) => {
    if (!action.evidence_photos || action.evidence_photos.length === 0) {
      return toast({ title: '증빙 사진 필수', description: '조치 완료를 위해 증빙 사진을 1장 이상 첨부하세요.', variant: 'destructive' });
    }
    const { error } = await supabase.from('safety_inspection_actions' as any).update({
      status: 'done', completed_at: new Date().toISOString(), completed_by: profile?.user_id,
    }).eq('id', action.id);
    if (error) return toast({ title: '실패', description: error.message, variant: 'destructive' });
    setDetailActions(prev => prev.map(x => x.id === action.id ? { ...x, status: 'done', completed_at: new Date().toISOString() } : x));
    toast({ title: '조치 완료 처리되었습니다.' });
  };

  const updateActionField = async (action: InspAction, patch: Partial<InspAction>) => {
    if (!assertEditable()) return;
    setDetailActions(prev => prev.map(x => x.id === action.id ? { ...x, ...patch } : x));
    await supabase.from('safety_inspection_actions' as any).update(patch).eq('id', action.id);
  };

  const persistWeather = async (value: string) => {
    if (!detail || !assertEditable()) return;
    setWeather(value);
    await supabase.from('safety_inspections' as any).update({ weather: value }).eq('id', detail.id);
    setDetail({ ...detail, weather: value });
  };

  const persistDirectorItems = async (next: DirectorPatrolItem[]) => {
    if (!detail || !assertEditable()) return;
    setDirectorItems(next);
    await supabase.from('safety_inspections' as any).update({ director_items: next }).eq('id', detail.id);
    setDetail({ ...detail, director_items: next });
  };

  const onPatrolPhoto = async (slot: 0 | 1, files: FileList | null) => {
    if (!detail || !assertEditable()) return;
    if (!files?.[0]) return;
    const url = await uploadPhoto(files[0], `patrol-${detail.id}-${slot}`);
    if (!url) return;
    const next = [...patrolPhotos];
    next[slot] = url;
    const clipped = [next[0] || '', next[1] || ''].filter((x, i) => i < 2);
    setPatrolPhotos(clipped);
    await supabase.from('safety_inspections' as any).update({ patrol_photos: clipped }).eq('id', detail.id);
    setDetail({ ...detail, patrol_photos: clipped });
  };

  const submitPatrolApproval = async () => {
    if (!detail || !projectId) return;
    if (isPatrolLogLocked(detail.status)) {
      return toast({ title: '이미 상신된 일지입니다.' });
    }
    if (!approvalDraftInfo?.ready) {
      return toast({
        title: '결재선을 저장하세요.',
        description: '안전관리자·안전보건관리책임자(현장소장)를 지정한 뒤 [저장]하세요.',
        variant: 'destructive',
      });
    }
    setSubmitting(true);
    try {
      const { inserted, error } = await submitApprovalFromDraft({
        entityType: 'safety_inspection',
        entityId: detail.id,
      });
      if (error) {
        toast({ title: '상신 실패', description: error, variant: 'destructive' });
        return;
      }
      const failLabels = detailItems.filter((i) => i.result === 'fail').map((i) => i.label);
      if (failLabels.length) {
        try {
          await notifyInspectionFailSummary({
            projectId,
            inspectionId: detail.id,
            location: detail.location,
            failLabels,
          });
        } catch (e) {
          if (import.meta.env.DEV) console.warn('notify failed', e);
        }
      }
      toast({ title: `결재 상신 완료 (${inserted ?? 2}단계)` });
      setDetail({ ...detail, status: '결재진행' });
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const withdrawPatrolApproval = async () => {
    if (!detail) return;
    if (!canWithdrawPatrolLog(detail.status)) {
      return toast({
        title: '회수할 수 없습니다.',
        description: detail.status === 'completed'
          ? '승인 완료된 일지는 회수할 수 없습니다. 필요하면 복제하세요.'
          : '상신(결재진행) 상태에서만 회수할 수 있습니다.',
        variant: 'destructive',
      });
    }
    if (!confirm('결재를 회수하고 일지를 다시 수정할 수 있게 할까요?')) return;
    const reason = window.prompt('회수 사유 (선택)') ?? '';
    const { data, error } = await supabase.rpc('withdraw_approval', {
      _entity_type: 'safety_inspection',
      _entity_id: detail.id,
      _reason: reason || null,
    });
    const r: any = data;
    if (error || r?.error) {
      const code = r?.error || error?.message || '';
      const msg = code === 'ALREADY_DECIDED'
        ? '이미 다음 결재자가 처리한 단계가 있어 회수할 수 없습니다.'
        : code === 'NOT_SUBMITTER'
          ? '상신자 또는 관리자만 회수할 수 있습니다.'
          : code === 'ALREADY_REJECTED'
            ? '이미 반려된 결재입니다. 수정 후 재상신하세요.'
            : code;
      return toast({ title: '회수 실패', description: msg, variant: 'destructive' });
    }
    toast({ title: '결재를 회수했습니다.', description: '이제 일지를 수정한 뒤 다시 상신할 수 있습니다.' });
    setDetail({ ...detail, status: 'in_progress' });
    setApprovalDraftInfo(null);
    load();
  };

  const actOnPatrol = async (action: 'approve' | 'reject') => {
    if (!myPendingApprovalId) return;
    if (action === 'reject') {
      const reason = window.prompt('반려 사유를 입력하세요.');
      if (!reason?.trim()) return toast({ title: '반려 사유를 입력하세요.', variant: 'destructive' });
      const { error } = await supabase.rpc('act_on_entity_approval', {
        _approval_id: myPendingApprovalId,
        _action: 'reject',
        _comment: reason.trim(),
      });
      if (error) return toast({ title: '반려 실패', description: error.message, variant: 'destructive' });
      toast({ title: '반려되었습니다.', variant: 'destructive' });
      setDetail({ ...detail!, status: '반려' });
    } else {
      const { error } = await supabase.rpc('act_on_entity_approval', {
        _approval_id: myPendingApprovalId,
        _action: 'approve',
        _comment: '',
      });
      if (error) return toast({ title: '승인 실패', description: error.message, variant: 'destructive' });
      toast({ title: '승인되었습니다.' });
    }
    setMyPendingApprovalId(null);
    if (detail) await openDetail({ ...detail });
    load();
  };

  const finishInspection = async () => {
    if (!detail) return;
    if (isPatrolInspection(detail.inspection_type)) {
      return submitPatrolApproval();
    }
    const failLabels = detailItems.filter((i) => i.result === 'fail').map((i) => i.label);
    await supabase.from('safety_inspections' as any).update({ status: 'completed' }).eq('id', detail.id);
    if (failLabels.length && projectId) {
      try {
        await notifyInspectionFailSummary({
          projectId,
          inspectionId: detail.id,
          location: detail.location,
          failLabels,
        });
      } catch (e) {
        if (import.meta.env.DEV) console.warn('notify failed', e);
      }
    }
    toast({ title: '점검이 완료되었습니다.' });
    setDetail({ ...detail, status: 'completed' });
    load();
  };

  const removeInspection = async (id: string) => {
    const target = inspections.find((x) => x.id === id) || (detail?.id === id ? detail : null);
    if (target && isPatrolInspection(target.inspection_type) && isPatrolLogLocked(target.status)) {
      return toast({ title: patrolLockEditHint(target.status), variant: 'destructive' });
    }
    if (!confirm('점검을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('safety_inspections' as any).update({ is_deleted: true }).eq('id', id);
    if (error) return toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    toast({ title: '삭제되었습니다.' });
    setDetail(null);
    load();
  };

  const printDetail = async () => {
    if (!detail) return;
    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) return;
    if (isPatrolInspection(detail.inspection_type)) {
      const snap = (detail.submitted_payload || null) as {
        inspection?: Inspection;
        items?: InspItem[];
        actions?: InspAction[];
      } | null;
      const src = isPatrolLogLocked(detail.status) && snap?.inspection ? snap.inspection : detail;
      const items = isPatrolLogLocked(detail.status) && snap?.items ? snap.items : detailItems;
      const actions = isPatrolLogLocked(detail.status) && snap?.actions ? snap.actions : detailActions;
      let title = inspectorTitle;
      if (src.inspector_id) {
        const { data: mem } = await supabase
          .from('project_members')
          .select('role_new, position_new')
          .eq('project_id', projectId)
          .eq('user_id', src.inspector_id)
          .maybeSingle();
        title = inspectorTitleFromMember({ position: (mem as any)?.position_new, role: (mem as any)?.role_new }) || title;
      }
      const day = datePartFromDateTime(src.inspected_at) || undefined;
      const ctx = await fetchPatrolPrintContext(projectId, day, src.company_id);
      const p = projects.find((x) => x.id === projectId);
      win.document.write(buildPatrolLogHtml({
        projectName: p?.name || projectLabel || '현장',
        siteName: p?.site_name,
        inspectedAt: src.inspected_at,
        inspectorName: src.inspector_name,
        inspectorTitle: title,
        location: src.location || ctx.route,
        summary: src.summary,
        weather: src.weather || weather,
        workItems: ctx.works,
        manpower: ctx.manpower,
        tbmAttendees: ctx.tbmAttendees || undefined,
        tbmRate: ctx.tbmRate || undefined,
        items,
        actions,
        patrolPhotos: src.patrol_photos || patrolPhotos,
        directorItems: normalizeDirectorPatrolItems(src.director_items || directorItems),
      }));
      win.document.close();
      setTimeout(() => win.print(), 400);
      return;
    }
    const photoTag = (urls: string[]) => urls.map(u => `<img src="${u}" style="width:120px;height:90px;object-fit:cover;border:1px solid #ccc;margin:2px;"/>`).join('');
    const itemRows = detailItems.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.checklist_code}</td>
        <td>${it.label}</td>
        <td style="font-size:10px;color:#555">${it.legal_basis}</td>
        <td style="text-align:center;font-weight:bold;color:${it.result === 'fail' ? '#c00' : it.result === 'pass' ? '#080' : '#888'}">
          ${it.result === 'pass' ? '통과' : it.result === 'fail' ? '불합격' : '해당없음'}
        </td>
        <td>${it.note || ''}</td>
        <td>${photoTag(it.photos || [])}</td>
      </tr>
    `).join('');
    const actionRows = detailActions.map((a, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${a.issue}</td>
        <td>${a.assignee_name || '-'}</td>
        <td>${a.due_date || '-'}</td>
        <td style="text-align:center;color:${a.status === 'done' ? '#080' : '#c80'}">
          ${a.status === 'done' ? '완료' : a.status === 'in_progress' ? '진행중' : '대기'}
        </td>
        <td>${photoTag(a.evidence_photos || [])}</td>
      </tr>
    `).join('');
    win.document.write(`
      <html><head><title>안전점검표</title>
      <style>
        body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;padding:20px;font-size:12px}
        h1{font-size:18px;text-align:center;margin-bottom:10px}
        h2{font-size:14px;border-bottom:2px solid #333;padding-bottom:4px;margin-top:20px}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{border:1px solid #999;padding:5px;vertical-align:top}
        th{background:#eee;font-weight:bold}
        .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:10px 0}
        .meta div{border:1px solid #ccc;padding:6px}
        @media print{body{padding:10mm}}
      </style></head><body>
      <h1>산업안전보건법 기반 안전점검표</h1>
      <div class="meta">
        <div><b>점검 유형:</b> ${INSPECTION_TYPE_LABELS[detail.inspection_type]}</div>
        <div><b>공종:</b> ${detail.process_category}</div>
        <div><b>점검자:</b> ${detail.inspector_name}</div>
        <div><b>점검일시:</b> ${new Date(detail.inspected_at).toLocaleString('ko-KR')}</div>
        <div><b>점검위치:</b> ${detail.location}</div>
        <div><b>상태:</b> ${detail.status}</div>
      </div>
      <h2>점검 항목 (${detailItems.length})</h2>
      <table><thead><tr><th>#</th><th>코드</th><th>점검 항목</th><th>법적 근거</th><th>결과</th><th>비고</th><th>사진</th></tr></thead><tbody>${itemRows}</tbody></table>
      ${detailActions.length > 0 ? `<h2>조치 요청 (${detailActions.length})</h2>
        <table><thead><tr><th>#</th><th>내용</th><th>담당</th><th>기한</th><th>상태</th><th>증빙</th></tr></thead><tbody>${actionRows}</tbody></table>` : ''}
      <p style="margin-top:30px;font-size:10px;color:#666">출력일: ${new Date().toLocaleString('ko-KR')}</p>
      <script>setTimeout(()=>window.print(),500)</script>
      </body></html>
    `);
    win.document.close();
  };

  const failCount = detailItems.filter(x => x.result === 'fail').length;
  const passCount = detailItems.filter(x => x.result === 'pass').length;
  const openActions = actions.filter((a) => isOpenInspectionAction(a.status));
  const pendingActions = openActions.length;

  const openActionParent = async (action: InspAction) => {
    const parent = inspections.find((i) => i.id === action.inspection_id);
    if (parent) {
      setTab('list');
      await openDetail(parent);
      return;
    }
    const { data, error } = await supabase
      .from('safety_inspections' as any)
      .select('*')
      .eq('id', action.inspection_id)
      .maybeSingle();
    if (error || !data || (data as any).is_deleted) {
      toast({
        title: '점검을 열 수 없습니다.',
        description: '삭제되었거나 권한이 없는 점검입니다.',
        variant: 'destructive',
      });
      return;
    }
    setTab('list');
    await openDetail(data as Inspection);
  };

  if (!projectId) {
    return <div className="p-6 text-sm text-muted-foreground">프로젝트를 먼저 선택하세요.</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="h-6 w-6" />안전점검</h1>
          <p className="text-sm text-muted-foreground">순회점검일지 · 산업안전보건법 기준 점검 · 조치관리</p>
        </div>
        <Button onClick={() => setOpenCreate(true)}><Plus className="h-4 w-4 mr-1" />새 점검</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">점검 목록 ({inspections.length})</TabsTrigger>
          <TabsTrigger value="actions">미조치 항목 <Badge variant={pendingActions > 0 ? 'destructive' : 'secondary'} className="ml-2">{pendingActions}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <MultiCompanyFilter projectId={projectId} value={companyFilter} onChange={setCompanyFilter} />
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="위치/점검자/공종 검색" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="in_progress">진행중</SelectItem>
                <SelectItem value="completed">완료</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            {listLoading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : (() => {
              const key = q.trim().toLowerCase();
              const filtered = inspections
                .filter((i: any) => companyFilter.length === 0 || (i.company_id && companyFilter.includes(i.company_id)))
                .filter(i => statusFilter === 'all' || i.status === statusFilter)
                .filter(i => !key || i.location?.toLowerCase().includes(key) || i.inspector_name?.toLowerCase().includes(key) || i.process_category?.toLowerCase().includes(key));
              if (filtered.length === 0) {
                return <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{q || companyFilter.length || statusFilter !== 'all' ? '조건에 맞는 점검 기록이 없습니다.' : '점검 기록이 없습니다. 새 점검을 시작하세요.'}</CardContent></Card>;
              }
              return filtered.map(i => (
                <Card key={i.id} className="cursor-pointer hover:bg-accent/30" onClick={() => openDetail(i)}>
                  <CardContent className="p-3 flex items-center justify-between text-sm gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">
                        {isPatrolInspection(i.inspection_type) ? PATROL_LOG_TITLE : `${INSPECTION_TYPE_LABELS[i.inspection_type]} · ${i.process_category}`}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{i.location} · {i.inspector_name} · {new Date(i.inspected_at).toLocaleString('ko-KR')}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Badge variant={i.status === 'completed' ? 'default' : i.status === '결재진행' ? 'outline' : i.status === '반려' ? 'destructive' : 'secondary'}>
                        {i.status === 'completed' ? '완료' : i.status === '결재진행' ? '결재중' : i.status === '반려' ? '반려' : '진행중'}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="수정"
                        disabled={isPatrolInspection(i.inspection_type) && isPatrolLogLocked(i.status)}
                        onClick={(e) => startEdit(i, e)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="복제" onClick={(e) => cloneInspection(i, e)}><Copy className="h-3.5 w-3.5" /></Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="삭제"
                        disabled={isPatrolInspection(i.inspection_type) && isPatrolLogLocked(i.status)}
                        onClick={(e) => { e.stopPropagation(); removeInspection(i.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ));
            })()}
          </div>
        </TabsContent>

        <TabsContent value="actions">
          <div className="grid gap-2">
            {listLoading ? (
              [...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : openActions.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-sm text-muted-foreground"><CheckCircle2 className="h-8 w-8 mx-auto text-success mb-2" />미조치 항목이 없습니다.</CardContent></Card>
            ) : openActions.map(a => {
              const dday = a.due_date ? Math.ceil((new Date(a.due_date).getTime() - Date.now()) / 86400000) : null;
              const overdue = dday !== null && dday < 0;
              return (
                <Card
                  key={a.id}
                  className={`cursor-pointer hover:bg-accent/30 ${overdue ? 'border-destructive' : ''}`}
                  onClick={() => void openActionParent(a)}
                >
                  <CardContent className="p-3 text-sm">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="font-semibold">{a.issue}</span>
                      <Badge variant="outline">{a.severity}</Badge>
                      <Badge variant="secondary">{a.status === 'pending' ? '대기' : '진행중'}</Badge>
                      {dday !== null && (
                        <Badge variant={overdue ? 'destructive' : dday <= 3 ? 'default' : 'outline'}>
                          {overdue ? `D+${Math.abs(dday)} 초과` : dday === 0 ? 'D-Day' : `D-${dday}`}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">담당: {a.assignee_name || '미지정'} · 기한: {a.due_date || '미정'}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isPatrolInspection(form.inspection_type) ? '새 순회점검일지' : '새 안전점검'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>점검 유형</Label>
              <Select value={form.inspection_type} onValueChange={(v) => {
                const next = v as InspectionType;
                setForm({
                  ...form,
                  inspection_type: next,
                  process_category: isPatrolInspection(next) ? PATROL_PROCESS_CATEGORY : (form.process_category === PATROL_PROCESS_CATEGORY ? '굴착' : form.process_category),
                  location: isPatrolInspection(next) && !form.location.trim() ? todayRoute : form.location,
                });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(INSPECTION_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isPatrolInspection(form.inspection_type) && (
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                <div>현장명 · <strong>{projectLabel || '-'}</strong></div>
                <div>점검자·직책 · {formatInspectorLine(form.inspector_name || profile?.display_name || '', selfTitle)}</div>
                <p className="text-muted-foreground">{PATROL_LOG_DISCLAIMER}</p>
              </div>
            )}
            {!isPatrolInspection(form.inspection_type) && (
            <div>
              <Label>공종</Label>
              <Select value={form.process_category} onValueChange={(v) => setForm({ ...form, process_category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROCESS_CATEGORIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  <SelectItem value="일반">일반</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}
            <div>
              <Label>{isPatrolInspection(form.inspection_type) ? '순회 구간' : '점검 위치'}</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder={isPatrolInspection(form.inspection_type) ? '당일 허가서 위치 자동' : '예: 1동 3층 A구역'} />
              {isPatrolInspection(form.inspection_type) && todayRoute && (
                <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 text-[11px]"
                  onClick={() => setForm({ ...form, location: todayRoute })}>당일 허가서 구간으로 채우기</Button>
              )}
            </div>
            <div>
              <Label>점검자</Label>
              <IMESafeInput defaultValue={form.inspector_name} onCommit={(v) => setForm({ ...form, inspector_name: v })} />
            </div>
            {isPatrolInspection(form.inspection_type) && (
              <div>
                <Label>날씨</Label>
                <Input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="맑음 / 흐림 / 비 등 직접 입력" />
              </div>
            )}
            <div>
              <Label>요약(선택)</Label>
              <Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>취소</Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between">
                  <span>{isPatrolInspection(detail.inspection_type) ? PATROL_LOG_TITLE : `${INSPECTION_TYPE_LABELS[detail.inspection_type]} · ${detail.process_category}`}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEdit(detail)} disabled={isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status)}><Pencil className="h-4 w-4 mr-1" />수정</Button>
                    <Button size="sm" variant="outline" onClick={() => cloneInspection(detail)}><Copy className="h-4 w-4 mr-1" />복제</Button>
                    <Button size="sm" variant="outline" onClick={printDetail}><Printer className="h-4 w-4 mr-1" />인쇄/PDF</Button>
                    {isPatrolInspection(detail.inspection_type) ? (
                      <>
                        {myPendingApprovalId && (
                          <>
                            <Button size="sm" variant="outline" className="text-success" onClick={() => actOnPatrol('approve')}><CheckCircle2 className="h-4 w-4 mr-1" />승인</Button>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => actOnPatrol('reject')}><XCircle className="h-4 w-4 mr-1" />반려</Button>
                          </>
                        )}
                        {detail.status !== 'completed' && detail.status !== '결재진행' && (
                          <Button size="sm" onClick={submitPatrolApproval} disabled={submitting}>
                            {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                            결재 상신
                          </Button>
                        )}
                        {detail.status === '결재진행' && <Badge variant="outline">결재중</Badge>}
                        {isPatrolInspection(detail.inspection_type) && canWithdrawPatrolLog(detail.status) && (
                          <Button size="sm" variant="outline" className="text-destructive" onClick={() => void withdrawPatrolApproval()}>
                            <RotateCcw className="h-4 w-4 mr-1" />회수
                          </Button>
                        )}
                        {isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status) && (
                          <span className="text-[11px] text-muted-foreground max-w-[220px] leading-snug">
                            {patrolLockEditHint(detail.status)}
                          </span>
                        )}
                        {detail.status === 'completed' && <Badge className="bg-success">종료</Badge>}
                      </>
                    ) : (
                      detail.status !== 'completed' && (
                        <Button size="sm" onClick={finishInspection}><CheckCircle2 className="h-4 w-4 mr-1" />점검 완료</Button>
                      )
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeInspection(detail.id)} disabled={isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="text-xs text-muted-foreground mb-2">
                {detail.location} · {formatInspectorLine(detail.inspector_name, inspectorTitle)} · {new Date(detail.inspected_at).toLocaleString('ko-KR')}
                {projectLabel ? ` · ${projectLabel}` : ''}
                <span className="ml-3"><Badge variant="default" className="bg-success">통과 {passCount}</Badge> <Badge variant="destructive">불합격 {failCount}</Badge></span>
              </div>

              {isPatrolInspection(detail.inspection_type) && (
                <div className="grid gap-3 mb-3 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">날씨</Label>
                    <Input
                      value={weather}
                      disabled={isPatrolLogLocked(detail.status)}
                      onChange={(e) => setWeather(e.target.value)}
                      onBlur={(e) => persistWeather(e.target.value)}
                      placeholder="맑음 / 흐림 / 비 등"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{PATROL_WALK_PHOTO_LABEL} (2장)</Label>
                    <div className="flex gap-2 mt-1">
                      {[0, 1].map((slot) => (
                        <label key={slot} className={`flex-1 border rounded p-2 text-center text-xs ${isPatrolLogLocked(detail.status) ? 'opacity-60' : 'cursor-pointer hover:bg-accent'}`}>
                          {patrolPhotos[slot] ? (
                            <img src={patrolPhotos[slot]} alt={`${PATROL_WALK_PHOTO_LABEL} ${slot + 1}`} className="h-20 w-full object-cover rounded mb-1" />
                          ) : (
                            <div className="h-20 flex items-center justify-center text-muted-foreground">{PATROL_WALK_PHOTO_LABEL} {slot + 1}</div>
                          )}
                          <span className="inline-flex items-center gap-1"><Camera className="h-3 w-3" />첨부</span>
                          <input type="file" accept="image/*" capture="environment" className="hidden" disabled={isPatrolLogLocked(detail.status)} onChange={(e) => onPatrolPhoto(slot as 0 | 1, e.target.files)} />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <h3 className="font-semibold mt-2">점검 항목</h3>
              <div className="space-y-2">
                {detailItems.map((it, i) => (
                  <Card key={it.id} className={it.result === 'fail' ? 'border-destructive' : ''}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-medium">{i + 1}. [{it.checklist_code}] {it.label}</div>
                          <div className="text-[10px] text-muted-foreground">{it.legal_basis}</div>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant={it.result === 'pass' ? 'default' : 'outline'} disabled={isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status)} onClick={() => updateItemResult(it, 'pass')} className={it.result === 'pass' ? 'bg-success' : ''}>{isPatrolInspection(detail.inspection_type) ? '양호' : '통과'}</Button>
                          <Button size="sm" variant={it.result === 'fail' ? 'destructive' : 'outline'} disabled={isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status)} onClick={() => updateItemResult(it, 'fail')}>{isPatrolInspection(detail.inspection_type) ? '불량' : '불합격'}</Button>
                          <Button size="sm" variant={it.result === 'na' ? 'secondary' : 'outline'} disabled={isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status)} onClick={() => updateItemResult(it, 'na')}>해당없음</Button>
                        </div>
                      </div>
                      <div className="flex gap-2 items-start">
                        <IMESafeInput defaultValue={it.note} onCommit={(v) => updateItemNote(it, v)} placeholder={isPatrolInspection(detail.inspection_type) ? '발견사항·즉시조치' : '비고'} className="flex-1 text-sm" />
                        <label className="cursor-pointer inline-flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-accent">
                          <Camera className="h-3 w-3" />사진
                          <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => onItemPhoto(it, e.target.files)} />
                        </label>
                      </div>
                      {(it.photos || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {it.photos.map((p, idx) => <img key={idx} src={p} alt="" className="h-16 w-16 object-cover border rounded" />)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {isPatrolInspection(detail.inspection_type) && !isPatrolLogLocked(detail.status) && (
                <div className="flex gap-2 mt-3">
                  <Input value={findingText} onChange={(e) => setFindingText(e.target.value)} placeholder="추가 발견사항" />
                  <Button variant="outline" onClick={addDetailFinding}><Plus className="h-4 w-4 mr-1" />추가</Button>
                </div>
              )}

              {isPatrolInspection(detail.inspection_type) && (
                <div className="mt-5 space-y-2">
                  <h3 className="font-semibold">관리책임자(현장소장) 순회 3항목</h3>
                  <p className="text-[11px] text-muted-foreground">결재선과 별개입니다. 보통·불량일 때 개선요망 사항을 적으세요. 사진은 없습니다.</p>
                  {directorItems.map((row, idx) => (
                    <Card key={row.code}>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium">{row.category} · {row.label}</div>
                          <div className="flex gap-1">
                            {(['pass', 'mid', 'fail'] as const).map((r) => (
                              <Button
                                key={r}
                                size="sm"
                                variant={row.result === r ? (r === 'fail' ? 'destructive' : 'default') : 'outline'}
                                disabled={isPatrolLogLocked(detail.status)}
                                onClick={() => persistDirectorItems(directorItems.map((x, i) => i === idx ? { ...x, result: r, improve: r === 'pass' ? '' : x.improve } : x))}
                              >
                                {r === 'pass' ? '양호' : r === 'mid' ? '보통' : '불량'}
                              </Button>
                            ))}
                          </div>
                        </div>
                        {(row.result === 'mid' || row.result === 'fail') && (
                          <Textarea
                            rows={2}
                            disabled={isPatrolLogLocked(detail.status)}
                            value={row.improve}
                            placeholder="개선요망 사항"
                            onChange={(e) => setDirectorItems((prev) => prev.map((x, i) => i === idx ? { ...x, improve: e.target.value } : x))}
                            onBlur={() => persistDirectorItems(directorItems)}
                          />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {isPatrolInspection(detail.inspection_type) && projectId && (
                <div className="mt-5">
                  <ApprovalLineManager
                    projectId={projectId}
                    projectMembers={approverMembers}
                    companies={companies}
                    submitterCompanyId={detail.company_id}
                    readOnly={isPatrolLogLocked(detail.status)}
                    documentDraft={{ entityType: 'safety_inspection', entityId: detail.id, companyId: detail.company_id }}
                    seedSteps={patrolSeedSteps}
                    onDraftStatusChange={setApprovalDraftInfo}
                  />
                </div>
              )}

              {detailActions.length > 0 && (
                <>
                  <h3 className="font-semibold mt-4 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />조치 요청 ({detailActions.length})</h3>
                  <div className="space-y-2">
                    {detailActions.map(a => (
                      <Card key={a.id} className={a.status === 'done' ? 'border-success' : 'border-warning'}>
                        <CardContent className="p-3 space-y-2 text-sm">
                          <div className="font-medium">{a.issue}</div>
                          <div>
                            <Label className="text-xs">조치 결과</Label>
                            <Input
                              value={a.completion_note || ''}
                              disabled={isPatrolInspection(detail.inspection_type) && isPatrolLogLocked(detail.status)}
                              onChange={(e) => updateActionField(a, { completion_note: e.target.value })}
                              placeholder="조치 결과 문구"
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label className="text-xs">담당자</Label>
                              <AssigneeSelect
                                projectId={projectId || ''}
                                value={a.assignee_name || ''}
                                onChange={({ name }) => updateActionField(a, { assignee_name: name })}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">기한</Label>
                              <Input type="date" value={a.due_date || ''} onChange={(e) => updateActionField(a, { due_date: e.target.value || null })} />
                            </div>
                            <div>
                              <Label className="text-xs">심각도</Label>
                              <Select value={a.severity} onValueChange={(v) => updateActionField(a, { severity: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="low">낮음</SelectItem>
                                  <SelectItem value="medium">보통</SelectItem>
                                  <SelectItem value="high">높음</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex gap-2 items-center">
                            <label className="cursor-pointer inline-flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-accent">
                              <Camera className="h-3 w-3" />증빙 사진
                              <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => onActionEvidence(a, e.target.files)} />
                            </label>
                            {isOpenInspectionAction(a.status) ? (
                              <Button size="sm" onClick={() => completeAction(a)}><CheckCircle2 className="h-4 w-4 mr-1" />조치 완료</Button>
                            ) : (
                              <Badge className="bg-success">완료 · {a.completed_at ? new Date(a.completed_at).toLocaleString('ko-KR') : ''}</Badge>
                            )}
                          </div>
                          {(a.evidence_photos || []).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {a.evidence_photos.map((p, idx) => <img key={idx} src={p} alt="" className="h-16 w-16 object-cover border rounded" />)}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>점검 수정</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>순회 구간 / 위치</Label>
              <Input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
            </div>
            <div>
              <Label>점검자</Label>
              <Input value={editForm.inspector_name} onChange={(e) => setEditForm({ ...editForm, inspector_name: e.target.value })} />
            </div>
            <div>
              <Label>점검일시</Label>
              <Input type="datetime-local" value={editForm.inspected_at} onChange={(e) => setEditForm({ ...editForm, inspected_at: e.target.value })} />
            </div>
            <div>
              <Label>요약</Label>
              <Textarea value={editForm.summary} onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
            <Button onClick={saveEdit}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
