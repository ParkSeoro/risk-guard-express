import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { notifyProjectRoles } from '@/lib/notificationService';
import { ADMIN_PROJECT_ROLES } from '@/lib/permissions';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { SAFETY_COST_CATEGORIES, analyzeSafetyCostCompliance, classifySafetyCostItem, formatKRW, getSafetyCostStatusLabel, isSafetyCostReportLocked, sumSafetyCostByCategory } from '@/lib/safetyCost';
import { groupSafetyCostByCompany } from '@/lib/safetyCostScope';
import { companyTypeLabel } from '@/lib/companyTypes';
import {
  isPostgresUniqueViolation,
  monthlyReportExistsCopy,
  planCreateMonthlyReport,
  toSafetyCostMonthStart,
} from '@/lib/safetyCostMonthly';
import { softRestorePayload } from '@/lib/dataAccess';
import { SAFETY_COST_TEMPLATE_PATH, buildSafetyCostWorkbook, downloadSafetyCostWorkbook } from '@/lib/safetyCostExport';
import { getEvidenceGuide } from '@/lib/safetyCostEvidenceGuide';
import { evaluateEvidencePack } from '@/lib/safetyCostEvidencePack';
import { EvidencePackPanel } from '@/components/safety-cost/EvidencePackPanel';
import { LegacyImportWizard } from '@/components/safety-cost/LegacyImportWizard';
import { PpeLedgerPanel } from '@/components/safety-cost/PpeLedgerPanel';
import { PpeStockPanel } from '@/components/safety-cost/PpeStockPanel';
import SafetyCostValidationPanel from '@/components/safety-cost/SafetyCostValidationPanel';
import SubmitApprovalDialog from '@/components/approval/SubmitApprovalDialog';
import { isPpeInboundItem, normalizePpeItemKey } from '@/lib/safetyCostPpeStock';
import { uploadAttachmentFile } from '@/lib/compressUploadFile';
import {
  ocrReviewGaps,
  ocrStatusBadge,
  ocrStatusBadgeVariant,
  ocrStatusLabel,
  stampOcrOnItem,
  summarizeOcrItems,
} from '@/lib/safetyCostOcr';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Bot, CheckCircle2, ClipboardCheck, Eye, FileSpreadsheet, FileText, ListChecks, Paperclip, Pencil, Plus, Search, Send, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

type Construction = any;
type Report = any;
type Item = any;
type Evidence = any;

const statusVariant = (status: string) => status === 'usable' ? 'default' : status === 'warning' ? 'destructive' : 'secondary';
const statusLabel: Record<string, string> = { usable: '사용 가능', warning: '사용 불가', review: '검토 필요' };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch));
const sanitizeStorageFileName = (fileName: string) => {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'}` : '';
  const baseName = fileName.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return `${baseName || 'document'}${extension}`;
};

const toNumber = (value: unknown) => {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const normalizeMoneyFields = (row: Record<string, unknown>) => {
  const quantity = toNumber(row.quantity || row['수량'] || 1) || 1;
  const sourceUnitPrice = toNumber(row.unit_price || row['단가']);
  const sourceVat = toNumber(row.vat_amount || row.vat || row['부가세']);
  const sourceAmount = toNumber(row.amount || row['금액'] || row.total_amount || row['합계']);
  const sourceSupply = toNumber(row.supply_amount || row['공급가액']);
  const supplyAmount = sourceSupply || (sourceUnitPrice ? quantity * sourceUnitPrice : Math.max(sourceAmount - sourceVat, 0));
  const vatAmount = sourceVat;
  const amount = supplyAmount + vatAmount || sourceAmount;
  const unitPrice = sourceUnitPrice || (quantity ? Math.round(supplyAmount / quantity) : amount);
  return { quantity, unitPrice, supplyAmount, vatAmount, amount };
};
const getDisplayDate = (item: Item, report?: Report) => item.transaction_date || item.usage_date || (report?.report_month ? String(report.report_month).slice(0, 10) : '');
const getDatePriorityLabel = (item: Item) => item.transaction_date ? '거래날짜' : item.usage_date ? '사용일' : '작성월';

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.onerror = () => reject(reader.error || new Error('파일을 읽을 수 없습니다.'));
  reader.readAsDataURL(file);
});

const SafetyCost = () => {
  const { user, profile } = useAuth();
  const access = useGlobalProjectAccess();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'validation' ? 'validation' : 'reports';
  const setActiveTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'validation') next.set('tab', 'validation');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };
  const [companies, setCompanies] = useState<any[]>([]);
  const [constructions, setConstructions] = useState<Construction[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [selectedConstructionId, setSelectedConstructionId] = useState('');
  const [selectedReportId, setSelectedReportId] = useState('');
  const [constructionOpen, setConstructionOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [legalBasisItem, setLegalBasisItem] = useState<Item | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<any>(null);
  const [requestingEvidence, setRequestingEvidence] = useState(false);
  const [newConstruction, setNewConstruction] = useState({ company_id: '', construction_name: '', construction_type: '', construction_amount: '', safety_cost_total: '', notes: '' });
  const [constructionEditOpen, setConstructionEditOpen] = useState(false);
  const [editingConstruction, setEditingConstruction] = useState({ id: '', company_id: '', construction_name: '', construction_type: '', construction_amount: '', safety_cost_total: '', notes: '' });
  const [newReportMonth, setNewReportMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [creatingReport, setCreatingReport] = useState(false);
  const [companyFilter, setCompanyFilter] = useState('all');
  const [reportEditOpen, setReportEditOpen] = useState(false);
  const [editingReport, setEditingReport] = useState({ id: '', report_month: '', title: '' });
  const [itemEditOpen, setItemEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [itemSearch, setItemSearch] = useState('');
  const [ppeSignedCount, setPpeSignedCount] = useState(0);
  const [reportTab, setReportTab] = useState('items');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [editingItem, setEditingItem] = useState({ id: '', transaction_date: '', usage_date: '', category_code: '', category_name: '', item_name: '', specification: '', maker: '', quantity: '1', unit: '식', unit_price: '', supply_amount: '', vat_amount: '', amount: '', supplier_name: '', classification_status: 'review', ai_reason: '', legal_basis: '' });
  const [ocrBanner, setOcrBanner] = useState<{ warning?: string; summary?: ReturnType<typeof summarizeOcrItems> } | null>(null);

  const selectedConstruction = constructions.find((c) => c.id === selectedConstructionId);
  const selectedReport = reports.find((r) => r.id === selectedReportId);
  const approvedReports = reports.filter((r) => r.status === 'approved' && (!selectedConstructionId || r.construction_id === selectedConstructionId));
  const approvedTotal = useMemo(() => approvedReports.reduce((sum, r) => sum + Number(r.report_total || 0), 0), [approvedReports]);
  const existingApprovedByCategory = useMemo(() => {
    const ids = new Set(approvedReports.map((r) => r.id));
    return sumSafetyCostByCategory(items.filter((it) => ids.has(it.report_id)));
  }, [approvedReports, items]);
  const usageRate = selectedConstruction?.safety_cost_total ? Math.min(100, Math.round((approvedTotal / Number(selectedConstruction.safety_cost_total)) * 100)) : 0;

  const scopedCompanies = useMemo(() => {
    if (access.seesAllCompanies) return companies;
    const allow = new Set(access.accessibleCompanyIds || []);
    if (allow.size === 0 && access.userCompanyId) return companies.filter((c) => c.id === access.userCompanyId);
    return companies.filter((c) => allow.has(c.id));
  }, [companies, access.seesAllCompanies, access.accessibleCompanyIds, access.userCompanyId]);

  const scopedConstructions = useMemo(() => {
    if (access.seesAllCompanies) return constructions;
    const allow = new Set(access.accessibleCompanyIds || []);
    if (allow.size === 0 && access.userCompanyId) {
      return constructions.filter((c) => c.company_id === access.userCompanyId);
    }
    return constructions.filter((c) => c.company_id && allow.has(c.company_id));
  }, [constructions, access.seesAllCompanies, access.accessibleCompanyIds, access.userCompanyId]);
  const companyGroups = useMemo(
    () => groupSafetyCostByCompany(scopedCompanies, scopedConstructions, {
      includeEmptyExecCompanies: !!access.seesAllCompanies,
    }),
    [scopedCompanies, scopedConstructions, access.seesAllCompanies],
  );
  const visibleCompanyGroups = useMemo(
    () => (companyFilter === 'all' ? companyGroups : companyGroups.filter((g) => g.companyId === companyFilter)),
    [companyGroups, companyFilter],
  );
  const filteredReports = reports.filter((r) => r.construction_id === selectedConstructionId);
  const existingLiveForNewMonth = filteredReports.some(
    (r) => toSafetyCostMonthStart(String(r.report_month)) === toSafetyCostMonthStart(newReportMonth),
  );
  const baseItems = items.filter((i) => i.report_id === selectedReportId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return baseItems;
    const q = itemSearch.toLowerCase();
    return baseItems.filter((it) => [it.item_name, it.supplier_name, it.category_name, it.maker, it.specification].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [baseItems, itemSearch]);
  const evidenceMissingItems = filteredItems.filter((it) => !evidence.some((e) => e.item_id === it.id));
  const evidenceMissingCount = evidenceMissingItems.length;
  const compliance = useMemo(
    () => analyzeSafetyCostCompliance(filteredItems, selectedConstruction?.safety_cost_total, { approvedCumulative: approvedTotal }),
    [filteredItems, selectedConstruction?.safety_cost_total, approvedTotal],
  );
  const reportLocked = isSafetyCostReportLocked(selectedReport?.status);
  const evidencePack = useMemo(() => evaluateEvidencePack({
    items: filteredItems,
    files: evidence.filter((e: any) => e.report_id === selectedReportId || filteredItems.some((it) => it.id === e.item_id)),
    ppeLedgerSignedCount: ppeSignedCount,
  }), [filteredItems, evidence, selectedReportId, ppeSignedCount]);
  const auditChecklist = useMemo(() => [
    { label: '월별 사용 항목 입력', ok: filteredItems.length > 0, detail: `${filteredItems.length}건`, tab: 'items' as const },
    { label: '항목별 파일 첨부', ok: evidenceMissingCount === 0 && filteredItems.length > 0, detail: evidenceMissingCount ? `${evidenceMissingCount}건 누락` : '완료', tab: 'items' as const },
    { label: '비목별 필수 증빙 패키지', ok: evidencePack.ready && filteredItems.length > 0, detail: evidencePack.ready ? '완료' : `필수 ${evidencePack.hardMissing.length}건 누락`, tab: 'pack' as const },
    { label: '보호구 지급대장(3번)', ok: !filteredItems.some((it) => it.category_code === '3' && Number(it.amount || 0) > 0) || ppeSignedCount > 0, detail: ppeSignedCount > 0 ? `서명 ${ppeSignedCount}건` : (filteredItems.some((it) => it.category_code === '3' && Number(it.amount || 0) > 0) ? '서명 필요' : '해당 없음'), tab: 'ppe' as const },
    { label: '사용 불가 항목 제거', ok: compliance.warningCount === 0, detail: compliance.warningCount ? `${compliance.warningCount}건 경고` : '이상 없음', tab: 'audit' as const },
    { label: '검토 필요 항목 확인', ok: compliance.reviewCount === 0, detail: compliance.reviewCount ? `${compliance.reviewCount}건 검토` : '이상 없음', tab: 'audit' as const },
    { label: '법적 근거 자동 기록', ok: compliance.missingBasisCount === 0 && filteredItems.length > 0, detail: compliance.missingBasisCount ? `${compliance.missingBasisCount}건 누락` : '완료', tab: 'items' as const },
    { label: 'OCR 저신뢰도 검토', ok: ocrReviewGaps(filteredItems).length === 0, detail: ocrReviewGaps(filteredItems).length ? `${ocrReviewGaps(filteredItems).length}건 사유 필요` : '완료', tab: 'items' as const },
    { label: '계상금액 초과 여부', ok: Number(selectedConstruction?.safety_cost_total || 0) === 0 || compliance.rate <= 100, detail: `${compliance.rate}%`, tab: 'audit' as const },
  ], [filteredItems, evidenceMissingCount, compliance, selectedConstruction?.safety_cost_total, evidencePack, ppeSignedCount]);
  const firstFailingAudit = auditChecklist.find((item) => !item.ok) || null;
  const approvalReady = auditChecklist.every((item) => item.ok) && selectedReport?.status === 'draft';

  useEffect(() => {
    if (access.scopeStatus !== 'ready') {
      setLoading(true);
      return;
    }
    if (access.selectedProject) fetchAll();
  }, [access.selectedProject, access.scopeStatus, access.accessibleCompanyIds]);
  useEffect(() => {
    if (!selectedConstructionId && scopedConstructions.length) setSelectedConstructionId(scopedConstructions[0].id);
  }, [scopedConstructions, selectedConstructionId]);
  useEffect(() => {
    const filtered = reports.filter((r) => r.construction_id === selectedConstructionId);
    if (!filtered.some((r) => r.id === selectedReportId)) setSelectedReportId(filtered[0]?.id || '');
  }, [reports, selectedConstructionId, selectedReportId]);

  const refreshPpeSignedCount = async (reportId: string) => {
    if (!reportId) { setPpeSignedCount(0); return; }
    const { data: led } = await supabase.from('safety_cost_ppe_ledgers' as any).select('id').eq('report_id', reportId).eq('is_deleted', false).maybeSingle();
    if (!led) { setPpeSignedCount(0); return; }
    const { count } = await supabase.from('safety_cost_ppe_ledger_entries' as any).select('id', { count: 'exact', head: true }).eq('ledger_id', (led as any).id).eq('is_deleted', false).neq('signature_data', '');
    setPpeSignedCount(count || 0);
  };
  useEffect(() => { refreshPpeSignedCount(selectedReportId); }, [selectedReportId]);

  async function fetchAll() {
    if (!access.selectedProject) return;
    setLoading(true);
    try {
      const [companyRows, constructionRes, reportRes, itemRes, evidenceRes] = await Promise.all([
        (await import('@/lib/projectCompanies')).fetchProjectCompanies(access.selectedProject),
        supabase.from('safety_cost_constructions' as any).select('*').eq('project_id', access.selectedProject).order('created_at', { ascending: false }),
        supabase.from('safety_cost_monthly_reports' as any).select('*').eq('project_id', access.selectedProject).eq('is_deleted', false).order('report_month', { ascending: false }),
        supabase.from('safety_cost_items' as any).select('*').eq('project_id', access.selectedProject).eq('is_deleted', false).order('sort_order'),
        supabase.from('safety_cost_evidence_files' as any).select('*').eq('project_id', access.selectedProject).order('created_at', { ascending: false }),
      ]);
      setCompanies(companyRows as any[]);
      setConstructions((constructionRes.data || []) as any[]);
      setReports((reportRes.data || []) as any[]);
      setItems((itemRes.data || []) as any[]);
      setEvidence((evidenceRes.data || []) as any[]);
      // PPE ledger signed count for selected report (if any)
      // refreshed separately when report changes
    } finally {
      setLoading(false);
    }
  }

  async function createConstruction() {
    if (!access.selectedProject || !user || !newConstruction.company_id || !newConstruction.construction_name.trim()) {
      toast({ title: '공사명과 회사를 입력하세요.', variant: 'destructive' }); return;
    }
    const { error } = await supabase.from('safety_cost_constructions' as any).insert({
      project_id: access.selectedProject,
      company_id: newConstruction.company_id,
      construction_name: newConstruction.construction_name.trim(),
      construction_type: newConstruction.construction_type.trim(),
      construction_amount: Number(newConstruction.construction_amount || 0),
      safety_cost_total: Number(newConstruction.safety_cost_total || 0),
      notes: newConstruction.notes.trim(),
      created_by: user.id,
    });
    if (error) { toast({ title: '공사 등록 실패', description: error.message, variant: 'destructive' }); return; }
    setConstructionOpen(false); setNewConstruction({ company_id: '', construction_name: '', construction_type: '', construction_amount: '', safety_cost_total: '', notes: '' });
    toast({ title: '산업안전보건관리비 공사가 등록되었습니다.' }); fetchAll();
  }

  function openNewConstruction(companyId?: string) {
    if (companyId) setNewConstruction((p) => ({ ...p, company_id: companyId }));
    setConstructionOpen(true);
  }

  function openConstructionEditor(construction: Construction) {
    setEditingConstruction({
      id: construction.id,
      company_id: construction.company_id || '',
      construction_name: construction.construction_name || '',
      construction_type: construction.construction_type || '',
      construction_amount: String(construction.construction_amount || ''),
      safety_cost_total: String(construction.safety_cost_total || ''),
      notes: construction.notes || '',
    });
    setConstructionEditOpen(true);
  }

  async function updateConstruction() {
    if (!editingConstruction.id || !editingConstruction.company_id || !editingConstruction.construction_name.trim()) {
      toast({ title: '공사명과 회사를 입력하세요.', variant: 'destructive' }); return;
    }
    const before = constructions.find((c) => c.id === editingConstruction.id);
    const payload = {
      company_id: editingConstruction.company_id,
      construction_name: editingConstruction.construction_name.trim(),
      construction_type: editingConstruction.construction_type.trim(),
      construction_amount: Number(editingConstruction.construction_amount || 0),
      safety_cost_total: Number(editingConstruction.safety_cost_total || 0),
      notes: editingConstruction.notes.trim(),
    };
    const { error } = await supabase.from('safety_cost_constructions' as any).update(payload).eq('id', editingConstruction.id);
    if (error) { toast({ title: '공사 정보 수정 실패', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('safety_cost_audit_logs' as any).insert({
      project_id: before?.project_id || access.selectedProject,
      company_id: payload.company_id,
      construction_id: editingConstruction.id,
      action: '산업안전보건관리비 공사 정보 수정',
      target_type: 'safety_cost_construction',
      target_id: editingConstruction.id,
      before_data: before || {},
      after_data: payload,
      user_id: user?.id,
      user_name: profile?.display_name || '',
    });
    setConstructionEditOpen(false); toast({ title: '공사 정보가 수정되었습니다.' }); fetchAll();
  }

  async function createReport() {
    if (!selectedConstruction || !user || creatingReport) return;
    const monthStart = toSafetyCostMonthStart(newReportMonth);
    if (!/^\d{4}-\d{2}-01$/.test(monthStart)) {
      toast({ title: '작성월을 선택하세요.', variant: 'destructive' });
      return;
    }
    setCreatingReport(true);
    try {
      const { data: existingRows, error: findError } = await supabase
        .from('safety_cost_monthly_reports' as any)
        .select('id, is_deleted, created_at, approval_version, status')
        .eq('construction_id', selectedConstruction.id)
        .eq('report_month', monthStart)
        .order('created_at', { ascending: false });
      if (findError) {
        toast({ title: '월별 내역서 조회 실패', description: findError.message, variant: 'destructive' });
        return;
      }

      const plan = planCreateMonthlyReport((existingRows || []) as any[]);
      if (plan.action === 'open') {
        setReportOpen(false);
        setSelectedReportId(plan.row.id);
        toast(monthlyReportExistsCopy('create'));
        return;
      }
      if (plan.action === 'restore') {
        const { data: restored, error: restoreError } = await supabase
          .from('safety_cost_monthly_reports' as any)
          .update(softRestorePayload())
          .eq('id', plan.row.id)
          .select('id')
          .single();
        if (restoreError) {
          toast({ title: '월별 내역서 복구 실패', description: restoreError.message, variant: 'destructive' });
          return;
        }
        setReportOpen(false);
        setSelectedReportId((restored as any).id);
        toast({
          title: '삭제했던 해당 월 내역서를 다시 열었습니다',
          description: '기존 항목이 있으면 그대로 이어서 작성하세요.',
        });
        fetchAll();
        return;
      }

      const { data, error } = await supabase.from('safety_cost_monthly_reports' as any).insert({
        construction_id: selectedConstruction.id,
        project_id: selectedConstruction.project_id,
        company_id: selectedConstruction.company_id,
        report_month: monthStart,
        title: `${newReportMonth} 산업안전보건관리비 사용내역서`,
        created_by: user.id,
      }).select().single();
      if (error) {
        if (isPostgresUniqueViolation(error)) {
          const { data: raced } = await supabase
            .from('safety_cost_monthly_reports' as any)
            .select('id, is_deleted, created_at, approval_version, status')
            .eq('construction_id', selectedConstruction.id)
            .eq('report_month', monthStart)
            .order('created_at', { ascending: false });
          const racedPlan = planCreateMonthlyReport((raced || []) as any[]);
          if (racedPlan.action === 'open') {
            setReportOpen(false);
            setSelectedReportId(racedPlan.row.id);
            toast(monthlyReportExistsCopy('create'));
            return;
          }
          if (racedPlan.action === 'restore') {
            const { data: restored, error: restoreError } = await supabase
              .from('safety_cost_monthly_reports' as any)
              .update(softRestorePayload())
              .eq('id', racedPlan.row.id)
              .select('id')
              .single();
            if (!restoreError && restored) {
              setReportOpen(false);
              setSelectedReportId((restored as any).id);
              toast({
                title: '삭제했던 해당 월 내역서를 다시 열었습니다',
                description: '기존 항목이 있으면 그대로 이어서 작성하세요.',
              });
              fetchAll();
              return;
            }
          }
          toast({ ...monthlyReportExistsCopy('create'), variant: 'destructive' });
          return;
        }
        toast({ title: '월별 내역서 생성 실패', description: error.message, variant: 'destructive' });
        return;
      }
      setReportOpen(false);
      setSelectedReportId((data as any).id);
      toast({ title: '월별 사용내역서가 생성되었습니다.' });
      fetchAll();
    } finally {
      setCreatingReport(false);
    }
  }

  function openReportEditor(report: Report) {
    setEditingReport({ id: report.id, report_month: String(report.report_month || '').slice(0, 7), title: report.title || '' });
    setReportEditOpen(true);
  }

  async function updateReport() {
    if (!editingReport.id || !editingReport.report_month) return;
    const current = reports.find((r) => r.id === editingReport.id);
    if (current?.status === 'approved' || current?.status === 'submitted') { toast({ title: '상신·승인된 내역서는 수정할 수 없습니다.', variant: 'destructive' }); return; }
    const { error } = await supabase.from('safety_cost_monthly_reports' as any).update({
      report_month: `${editingReport.report_month}-01`,
      title: editingReport.title.trim() || `${editingReport.report_month} 산업안전보건관리비 사용내역서`,
    }).eq('id', editingReport.id);
    if (error) {
      toast({
        title: isPostgresUniqueViolation(error) ? monthlyReportExistsCopy('update').title : '월별 사용내역서 수정 실패',
        description: isPostgresUniqueViolation(error) ? monthlyReportExistsCopy('update').description : error.message,
        variant: 'destructive',
      });
      return;
    }
    setReportEditOpen(false); toast({ title: '월별 사용내역서가 수정되었습니다.' }); fetchAll();
  }

  const { softDelete: _softDeleteSC } = useSoftDelete();
  async function deleteReport(report: Report) {
    if (report.status === 'approved' || report.status === 'submitted') { toast({ title: '상신·승인된 내역서는 삭제할 수 없습니다.', variant: 'destructive' }); return; }
    const r = await _softDeleteSC('safety_cost_monthly_reports', report.id, {
      label: `${String(report.report_month).slice(0, 7)} 월별 사용내역서`,
      projectId: report.project_id,
    });
    if (r.ok) { setSelectedReportId(''); fetchAll(); }
  }

  async function updateReportTotal(reportId: string) {
    const { data } = await supabase.from('safety_cost_items' as any).select('amount').eq('report_id', reportId).eq('is_deleted', false);
    const total = ((data || []) as any[]).reduce((sum, i) => sum + Number(i.amount || 0), 0);
    await supabase.from('safety_cost_monthly_reports' as any).update({ report_total: total }).eq('id', reportId);
  }

  async function insertItems(rows: any[]) {
    if (!selectedReport || !selectedConstruction || !user) return;
    if (isSafetyCostReportLocked(selectedReport.status)) {
      toast({ title: '상신·승인된 내역서에는 항목을 추가할 수 없습니다.', variant: 'destructive' });
      return;
    }
    const inserts = rows.map((row, idx) => {
      const fallback = classifySafetyCostItem(row.item_name || row['품목'] || row['사용 항목'] || '');
      const money = normalizeMoneyFields(row);
      return {
        report_id: selectedReport.id,
        construction_id: selectedConstruction.id,
        project_id: selectedConstruction.project_id,
        company_id: selectedConstruction.company_id,
        transaction_date: row.transaction_date || row.usage_date || null,
        usage_date: row.usage_date || row.transaction_date || null,
        category_code: row.category_code || fallback.category_code,
        category_name: row.category_name || fallback.category_name,
        item_name: row.item_name || row['품목'] || row['사용 항목'] || '',
        specification: row.specification || row['규격'] || '',
        maker: row.maker || row.manufacturer || row['메이커'] || row['제조사'] || '',
        quantity: money.quantity,
        unit: row.unit || row['단위'] || '식',
        unit_price: money.unitPrice,
        supply_amount: money.supplyAmount,
        vat_amount: money.vatAmount,
        amount: money.amount,
        supplier_name: row.supplier_name || row['공급자 상호'] || row['공급자'] || row['상호'] || '',
        classification_status: row.classification_status || fallback.classification_status,
        ai_confidence: row.ai_confidence || null,
        ai_reason: row.ai_reason || fallback.ai_reason,
        legal_basis: row.legal_basis || fallback.legal_basis,
        sort_order: filteredItems.length + idx,
        created_by: user.id,
        ...stampOcrOnItem({
          ocr_status: row.ocr_status,
          ocr_raw_text: row.ocr_raw_text,
          ocr_confidence: row.ocr_confidence,
        }, {
          engine: row.ocr_status === 'rule_fallback' ? 'rule' : undefined,
          confidence: row.ocr_confidence,
          rawText: row.ocr_raw_text,
          fieldsCorrected: row.ocr_status === 'ai_corrected' || row.fields_corrected === true,
          noVision: row.ocr_status === 'no_vision',
        }),
      };
    }).filter((r) => r.item_name && r.amount > 0);
    if (!inserts.length) { toast({ title: '추가할 항목이 없습니다.', variant: 'destructive' }); return; }
    const { data: inserted, error } = await supabase.from('safety_cost_items' as any).insert(inserts).select('id, category_code, item_name, specification, maker, quantity, unit, transaction_date, usage_date');
    if (error) { toast({ title: '항목 추가 실패', description: error.message, variant: 'destructive' }); return; }
    const ppeRows = ((inserted as any[]) || []).filter((it) => isPpeInboundItem(it));
    for (const it of ppeRows) {
      try {
        const item_key = normalizePpeItemKey(it);
        let skuId: string | null = null;
        const { data: existing } = await supabase.from('safety_cost_ppe_skus' as any).select('id').eq('construction_id', selectedConstruction.id).eq('item_key', item_key).maybeSingle();
        if (existing) skuId = (existing as any).id;
        else {
          const { data: created, error: skuErr } = await supabase.from('safety_cost_ppe_skus' as any).insert({
            project_id: selectedConstruction.project_id,
            company_id: selectedConstruction.company_id,
            construction_id: selectedConstruction.id,
            item_key,
            item_name: it.item_name,
            specification: it.specification || '',
            maker: it.maker || '',
            unit: it.unit || '개',
          }).select('id').single();
          if (skuErr) throw skuErr;
          skuId = (created as any).id;
        }
        await supabase.from('safety_cost_ppe_stock_movements' as any).insert({
          project_id: selectedConstruction.project_id,
          company_id: selectedConstruction.company_id,
          construction_id: selectedConstruction.id,
          sku_id: skuId,
          movement_type: 'in',
          quantity: Number(it.quantity || 1),
          movement_date: it.transaction_date || it.usage_date || new Date().toISOString().slice(0, 10),
          source_type: 'item',
          source_item_id: it.id,
          report_id: selectedReport.id,
          note: '영수증/항목 자동입고',
          created_by: user.id,
        });
      } catch (e: any) {
        console.warn('PPE stock inbound failed', e);
      }
    }
    toast({ title: `${inserts.length}개 항목이 추가되었습니다.${ppeRows.length ? ` (보호구 입고 ${ppeRows.length})` : ''}` });
    await updateReportTotal(selectedReport.id);
    await fetchAll();
  }

  function openNewItem() {
    if (!selectedReport) { toast({ title: '월별 사용내역서를 먼저 만드세요.', variant: 'destructive' }); return; }
    if (reportLocked) { toast({ title: '상신·승인된 내역서에는 항목을 추가할 수 없습니다.', variant: 'destructive' }); return; }
    const monthDay = selectedReport.report_month ? String(selectedReport.report_month).slice(0, 10) : '';
    setEditingItem({
      id: '',
      transaction_date: monthDay,
      usage_date: monthDay,
      category_code: '',
      category_name: '검토 필요',
      item_name: '',
      specification: '',
      maker: '',
      quantity: '1',
      unit: '식',
      unit_price: '',
      supply_amount: '',
      vat_amount: '',
      amount: '',
      supplier_name: '',
      classification_status: 'review',
      ai_reason: '',
      legal_basis: '',
    });
    setItemEditOpen(true);
  }

  function openItemEditor(item: Item) {
    setEditingItem({
      id: item.id,
      transaction_date: item.transaction_date || item.usage_date || '',
      usage_date: item.usage_date || '',
      category_code: item.category_code || '',
      category_name: item.category_name || '',
      item_name: item.item_name || '',
      specification: item.specification || '',
      maker: item.maker || '',
      quantity: String(item.quantity || 1),
      unit: item.unit || '식',
      unit_price: String(item.unit_price || ''),
      supply_amount: String(item.supply_amount || ''),
      vat_amount: String(item.vat_amount || ''),
      amount: String(item.amount || ''),
      supplier_name: item.supplier_name || '',
      classification_status: item.classification_status || 'review',
      ai_reason: item.ai_reason || '',
      legal_basis: item.legal_basis || '',
    });
    setItemEditOpen(true);
  }

  function updateEditingItemMoney(field: 'quantity' | 'unit_price' | 'supply_amount' | 'vat_amount', value: string) {
    setEditingItem((prev) => {
      const next = { ...prev, [field]: value };
      const money = normalizeMoneyFields(next);
      return { ...next, quantity: String(money.quantity), unit_price: String(money.unitPrice), supply_amount: String(money.supplyAmount), vat_amount: String(money.vatAmount), amount: String(money.amount) };
    });
  }

  async function updateItem() {
    if (!editingItem.item_name.trim()) { toast({ title: '품목명을 입력하세요.', variant: 'destructive' }); return; }
    const selectedCategory = SAFETY_COST_CATEGORIES.find((c) => c.code === editingItem.category_code);
    const money = normalizeMoneyFields(editingItem);
    if (!editingItem.id) {
      if (money.amount <= 0) { toast({ title: '금액을 입력하세요.', variant: 'destructive' }); return; }
      await insertItems([{
        ...editingItem,
        category_name: selectedCategory?.name || editingItem.category_name,
        quantity: money.quantity,
        unit_price: money.unitPrice,
        supply_amount: money.supplyAmount,
        vat_amount: money.vatAmount,
        amount: money.amount,
        ai_reason: editingItem.ai_reason.trim() || '수기 입력',
        legal_basis: editingItem.legal_basis.trim() || '건설업 산업안전보건관리비 계상 및 사용기준 확인 필요',
        ocr_status: 'user_edited',
      }]);
      setItemEditOpen(false);
      return;
    }
    const before = items.find((it) => it.id === editingItem.id);
    const payload = {
      transaction_date: editingItem.transaction_date || editingItem.usage_date || null,
      usage_date: editingItem.usage_date || null,
      category_code: editingItem.category_code,
      category_name: selectedCategory?.name || editingItem.category_name || '검토 필요',
      item_name: editingItem.item_name.trim(),
      specification: editingItem.specification.trim(),
      maker: editingItem.maker.trim(),
      quantity: money.quantity,
      unit: editingItem.unit.trim() || '식',
      unit_price: money.unitPrice,
      supply_amount: money.supplyAmount,
      vat_amount: money.vatAmount,
      amount: money.amount,
      supplier_name: editingItem.supplier_name.trim(),
      classification_status: editingItem.classification_status,
      ai_reason: editingItem.ai_reason.trim() || '사용자가 AI 판독 결과를 직접 수정했습니다.',
      legal_basis: editingItem.legal_basis.trim() || '건설업 산업안전보건관리비 계상 및 사용기준 확인 필요',
      ocr_status: 'user_edited',
    };
    const { error } = await supabase.from('safety_cost_items' as any).update(payload).eq('id', editingItem.id);
    if (error) { toast({ title: '항목 수정 실패', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('safety_cost_audit_logs' as any).insert({
      project_id: before?.project_id || access.selectedProject,
      company_id: before?.company_id || selectedConstruction?.company_id,
      construction_id: before?.construction_id || selectedConstruction?.id,
      report_id: before?.report_id || selectedReport?.id,
      action: '산업안전보건관리비 항목 수동 수정',
      target_type: 'safety_cost_item',
      target_id: editingItem.id,
      before_data: before || {},
      after_data: payload,
      user_id: user?.id,
      user_name: profile?.display_name || '',
    });
    if (before?.report_id) await updateReportTotal(before.report_id);
    setItemEditOpen(false); toast({ title: '항목이 수정되었습니다.' }); fetchAll();
  }

  async function deleteItem(item: Item) {
    if (selectedReport?.status === 'approved' || selectedReport?.status === 'submitted') { toast({ title: '상신·승인된 내역서의 항목은 삭제할 수 없습니다.', variant: 'destructive' }); return; }
    const reason = window.prompt(`'${item.item_name}' 항목을 삭제합니다. 사유를 입력하세요. (필수)`);
    if (!reason || !reason.trim()) return;
    const { error } = await supabase.from('safety_cost_items' as any).update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_reason: reason,
      deleted_by: user?.id || null,
    }).eq('id', item.id);
    if (error) { toast({ title: '항목 삭제 실패', description: error.message, variant: 'destructive' }); return; }
    if (String(item.category_code) === '3') {
      await supabase.from('safety_cost_ppe_stock_movements' as any)
        .update({ is_deleted: true })
        .eq('source_item_id', item.id);
    }
    await supabase.from('safety_cost_audit_logs' as any).insert({
      project_id: item.project_id || access.selectedProject,
      company_id: item.company_id || selectedConstruction?.company_id,
      construction_id: item.construction_id || selectedConstruction?.id,
      report_id: item.report_id || selectedReport?.id,
      action: '산업안전보건관리비 항목 삭제',
      target_type: 'safety_cost_item',
      target_id: item.id,
      before_data: item,
      after_data: {},
      user_id: user?.id,
      user_name: profile?.display_name || '',
    });
    if (item.report_id) await updateReportTotal(item.report_id);
    toast({ title: '항목이 삭제되었습니다.' }); fetchAll();
  }

  async function analyzeWithAI() {
    if (!aiText.trim()) { toast({ title: '거래명세서 텍스트를 입력하거나 파일을 업로드하세요.', variant: 'destructive' }); return; }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-safety-cost-document', { body: { text: aiText, fileName: 'manual-input' } });
      if (error) throw error;
      setAiSummary(data?.summary || null);
      const summary = summarizeOcrItems(data?.items || []);
      setOcrBanner({ warning: data?.warning, summary });
      if (data?.warning) toast({ title: '판독 주의', description: data.warning });
      await insertItems(data?.items || []);
      setAiText('');
    } catch (e: any) {
      toast({ title: 'AI 분석 실패', description: e.message || String(e), variant: 'destructive' });
    } finally { setAiLoading(false); }
  }

  async function handleDocumentUpload(file: File) {
    if (!selectedReport || !selectedConstruction || !user) return;
    setAiLoading(true);
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
      // storage RLS: path must contain project UUID (attachment_path_belongs_to_member)
      const path = `safety-cost/${selectedConstruction.project_id}/${selectedReport.id}/documents/${Date.now()}_${safeName}`;
      let uploaded;
      try {
        uploaded = await uploadAttachmentFile(path, file);
      } catch (e: any) {
        toast({ title: '거래명세표 업로드 실패', description: e?.message || String(e), variant: 'destructive' });
        return;
      }
      const { error: evidenceError } = await supabase.from('safety_cost_evidence_files' as any).insert({
        report_id: selectedReport.id, construction_id: selectedConstruction.id, project_id: selectedConstruction.project_id, company_id: selectedConstruction.company_id,
        evidence_kind: 'transaction', file_name: uploaded.file.name, file_path: uploaded.path, file_url: uploaded.publicUrl, mime_type: uploaded.file.type || 'application/octet-stream', file_size: uploaded.finalBytes, uploaded_by: user.id,
      });
      if (evidenceError) { toast({ title: '거래명세표 기록 실패', description: evidenceError.message, variant: 'destructive' }); return; }
      const canAnalyzeFile = ext === 'pdf' || file.type.startsWith('image/') || uploaded.file.type.startsWith('image/');
      const { data, error } = await supabase.functions.invoke('analyze-safety-cost-document', {
        body: {
          text,
          fileName: file.name,
          fileBase64: canAnalyzeFile ? await fileToBase64(file) : undefined,
          mimeType: file.type || (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
        },
      });
      if (error) throw error;
      setAiSummary(data?.summary || null);
      const summary = summarizeOcrItems(data?.items || []);
      setOcrBanner({ warning: data?.warning, summary });
      await insertItems(data?.items || []);
      if (text.trim()) setAiText(text);
      toast({
        title: '거래명세표 자동분석 완료',
        description: data?.warning
          ? data.warning
          : `${data?.items?.length || 0}개 항목을 인식했습니다.${summary.rawChars ? ` OCR 원문 ${summary.rawChars}자` : ''}`,
        variant: data?.warning && (!data?.items?.length || summary.lowCount > 0) ? 'destructive' : 'default',
      });
      fetchAll();
    } catch (e: any) {
      toast({ title: '거래명세표 자동분석 실패', description: e.message || String(e), variant: 'destructive' });
    } finally { setAiLoading(false); }
  }

  async function handleItemEvidenceUpload(item: Item, files: FileList | null) {
    if (!files || !selectedConstruction || !user) return;
    const rows = [];
    for (const file of Array.from(files)) {
      const path = `safety-cost/${item.project_id}/${item.report_id}/items/${item.id}/${Date.now()}_${sanitizeStorageFileName(file.name)}`;
      let uploaded;
      try {
        uploaded = await uploadAttachmentFile(path, file);
      } catch (e: any) {
        toast({ title: '증빙 업로드 실패', description: e?.message || String(e), variant: 'destructive' });
        continue;
      }
      const kind = uploaded.file.type.startsWith('image/') || file.type.startsWith('image/') ? 'site_photo' : (file.name.includes('세금') || /tax/i.test(file.name) ? 'tax_invoice' : 'transaction');
      rows.push({ report_id: item.report_id, item_id: item.id, construction_id: item.construction_id, project_id: item.project_id, company_id: item.company_id, category_code: item.category_code || '', evidence_kind: kind, file_name: uploaded.file.name, file_path: uploaded.path, file_url: uploaded.publicUrl, mime_type: uploaded.file.type, file_size: uploaded.finalBytes, uploaded_by: user.id });
    }
    if (rows.length) await supabase.from('safety_cost_evidence_files' as any).insert(rows);
    toast({ title: '항목별 증빙이 업로드되었습니다.' }); fetchAll();
  }

  async function requestMissingEvidence() {
    if (!selectedReport || !selectedConstruction || !user || evidenceMissingCount === 0) {
      toast({ title: '요청할 누락 증빙이 없습니다.' }); return;
    }
    setRequestingEvidence(true);
    try {
      // Same-company managers only (never workers/viewers)
      const notified = await notifyProjectRoles({
        projectId: selectedReport.project_id,
        companyId: selectedReport.company_id,
        roles: [...ADMIN_PROJECT_ROLES],
        title: '산업안전보건관리비 증빙 보완 요청',
        message: `${selectedConstruction.construction_name} ${String(selectedReport.report_month).slice(0, 7)} 사용내역서에 항목별 증빙 ${evidenceMissingCount}건이 누락되었습니다.`,
        type: 'safety_cost',
        relatedType: 'safety_cost_report',
        relatedId: selectedReport.id,
        link: '/safety-cost',
      });
      if (!notified) {
        toast({ title: '요청 대상자가 없습니다.', description: '해당 회사의 관리자(안전·현장·감리)를 먼저 지정하세요.', variant: 'destructive' });
        setRequestingEvidence(false);
        return;
      }
      await supabase.from('audit_logs').insert({
        project_id: selectedReport.project_id,
        user_id: user.id,
        user_name: profile?.display_name || '',
        action: '산업안전보건관리비 증빙 보완 요청',
        target_type: 'safety_cost_report',
        target_id: selectedReport.id,
        details: { missing_count: evidenceMissingCount, item_names: evidenceMissingItems.map((it) => it.item_name), notified },
      });
      toast({ title: '증빙 보완 요청 발송 완료', description: `${notified}명(관리자)에게 알림을 보냈습니다.` });
    } catch (e: any) {
      toast({ title: '증빙 요청 실패', description: e?.message || String(e), variant: 'destructive' });
    }
    setRequestingEvidence(false);
  }

  async function openSubmitDialog() {
    if (!selectedReport || !selectedConstruction || !user) return;
    if (!approvalReady) {
      const fail = firstFailingAudit;
      const packHint = evidencePack.hardMissing.length
        ? ` · 필수 증빙: ${evidencePack.hardMissing.slice(0, 2).map((r) => `${r.code}·${r.requirement.label}`).join(', ')}`
        : '';
      toast({
        title: fail ? `여기서 막힘: ${fail.label}` : '결재 상신 전 자동검토를 완료하세요.',
        description: fail
          ? `${fail.detail || '보완 필요'}${packHint} — 해당 탭으로 이동합니다.`
          : '사용 불가 항목, 증빙 패키지, 법적 근거를 먼저 보완해야 합니다.',
        variant: 'destructive',
      });
      if (fail?.tab) setReportTab(fail.tab);
      return;
    }
    const { data: validated, error: vErr } = await supabase.rpc('validate_safety_cost_report', { _report_id: selectedReport.id });
    if (vErr) {
      toast({ title: '법정 검증 실패', description: vErr.message, variant: 'destructive' });
      return;
    }
    const warningCount = Number((validated as any)?.warning_count || 0);
    if (warningCount > 0) {
      toast({ title: '사용 불가 항목이 있어 상신할 수 없습니다.', variant: 'destructive' });
      setReportTab('audit');
      return;
    }
    setSubmitOpen(true);
  }

  async function exportExcel() {
    if (!selectedReport || !selectedConstruction) return;
    try {
      const res = await fetch(SAFETY_COST_TEMPLATE_PATH);
      if (!res.ok) throw new Error('공식 양식 템플릿을 불러오지 못했습니다.');
      const companyName = companies.find((c) => c.id === selectedConstruction.company_id)?.name || '';
      const monthKey = String(selectedReport.report_month).slice(0, 7);
      const priorApproved = reports.filter((r) =>
        r.construction_id === selectedConstruction.id
        && r.status === 'approved'
        && String(r.report_month).slice(0, 7) < monthKey,
      );
      const approvedCumulativeBeforeMonth = priorApproved.reduce((sum, r) => sum + Number(r.report_total || 0), 0);
      const priorIds = new Set(priorApproved.map((r) => r.id));
      const approvedByCategoryBefore = sumSafetyCostByCategory(items.filter((it) => priorIds.has(it.report_id)));

      const wb = buildSafetyCostWorkbook(await res.arrayBuffer(), {
        companyName,
        constructionName: selectedConstruction.construction_name,
        constructionAmount: Number(selectedConstruction.construction_amount || 0),
        safetyCostTotal: Number(selectedConstruction.safety_cost_total || 0),
        reportMonth: String(selectedReport.report_month),
        writerName: profile?.display_name || '',
        approvedCumulativeBeforeMonth,
        approvedByCategoryBefore,
        currentMonthApproved: selectedReport.status === 'approved',
        items: filteredItems,
        statusLabel,
        getDisplayDate: (it) => getDisplayDate(it, selectedReport),
      });
      downloadSafetyCostWorkbook(
        wb,
        `산업안전보건관리비_사용내역서_${selectedConstruction.construction_name}_${monthKey}.xlsx`,
      );
    } catch (e: any) {
      toast({ title: '엑셀 출력 실패', description: e.message || String(e), variant: 'destructive' });
    }
  }

  function exportPDF() {
    if (!selectedReport || !selectedConstruction) return;
    const monthKey = String(selectedReport.report_month).slice(0, 7);
    const priorApproved = reports.filter((r) =>
      r.construction_id === selectedConstruction.id
      && r.status === 'approved'
      && String(r.report_month).slice(0, 7) < monthKey,
    );
    const priorIds = new Set(priorApproved.map((r) => r.id));
    const priorByCat = sumSafetyCostByCategory(items.filter((it) => priorIds.has(it.report_id)));
    const priorTotal = priorApproved.reduce((sum, r) => sum + Number(r.report_total || 0), 0);
    const monthApproved = selectedReport.status === 'approved';
    const companyName = companies.find((c) => c.id === selectedConstruction.company_id)?.name || '';
    const grouped = SAFETY_COST_CATEGORIES.map((cat) => ({ cat, rows: filteredItems.filter((it) => it.category_code === cat.code || it.category_name === cat.name) }));
    const itemRows = grouped.flatMap(({ cat, rows }) => rows.length ? rows.map((it, idx) => `<tr><td>${escapeHtml(cat.name)}</td><td>${idx + 1}</td><td>${escapeHtml(getDisplayDate(it, selectedReport))}</td><td>${escapeHtml(it.supplier_name || '')}</td><td>${escapeHtml(it.item_name)}</td><td>${escapeHtml(it.specification || '')}</td><td>${escapeHtml(it.maker || '')}</td><td>${escapeHtml(it.quantity)}</td><td>${formatKRW(it.unit_price)}</td><td>${formatKRW(it.supply_amount || it.amount)}</td><td>${formatKRW(it.vat_amount || 0)}</td><td>${formatKRW(it.amount)}</td><td>${escapeHtml(statusLabel[it.classification_status] || it.classification_status)}</td></tr>`) : [`<tr class="section"><td colspan="13">${escapeHtml(cat.code)}. ${escapeHtml(cat.name)}</td></tr>`]).join('');
    const printTotals = filteredItems.reduce((acc, it) => ({ supply: acc.supply + Number(it.supply_amount || it.amount || 0), vat: acc.vat + Number(it.vat_amount || 0), amount: acc.amount + Number(it.amount || 0) }), { supply: 0, vat: 0, amount: 0 });
    const totalRow = `<tr class="section"><td colspan="9">합계</td><td>${formatKRW(printTotals.supply)}</td><td>${formatKRW(printTotals.vat)}</td><td>${formatKRW(printTotals.amount)}</td><td></td></tr>`;
    const checklistRows = auditChecklist.map((it) => `<tr><td>${escapeHtml(it.label)}</td><td>${it.ok ? '완료' : '보완 필요'}</td><td>${escapeHtml(it.detail)}</td></tr>`).join('');
    const packRows = evidencePack.rows.map((r) => `<tr><td>${escapeHtml(r.code)}. ${escapeHtml(r.name)}</td><td>${escapeHtml(r.requirement.label)}${r.requirement.hard ? ' (필수)' : ''}</td><td>${r.ok ? '완료' : '누락'} (${r.count})</td></tr>`).join('');
    const tocRows = ['1. 사용내역서 총괄','2. 월별 집계표','3. 업체별 집계표','4. 증빙서류 목록','5. 항목별 사용내역 + 증빙(1~9)','6. 보호구 지급대장(해당 시)'].map((t) => `<tr><td colspan="3">${escapeHtml(t)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>산업안전보건관리비 사용내역서</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif;color:#111;margin:0}.page{page-break-after:always}h1{text-align:center;font-size:22px;letter-spacing:6px;margin:8px 0 28px}.title{text-align:left;font-weight:700;font-size:18px;margin:0 0 8px}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:14px}th,td{border:1px solid #333;padding:6px 7px;font-size:11px;line-height:1.35;vertical-align:middle;word-break:keep-all}th{background:#eef2f7;font-weight:700}.meta td{height:30px}.section td{background:#f8fafc;font-weight:700}.notice{margin-top:20px;font-size:13px}.sign{text-align:right;margin-top:28px;font-size:14px}.no-print{position:fixed;right:18px;top:18px}@media print{.no-print{display:none}}</style></head><body><button class="no-print" onclick="window.print()">인쇄</button><section class="page"><h1>${escapeHtml(String(selectedReport.report_month).slice(0,7))} 산업안전보건관리비 사용내역서</h1><table class="meta"><tbody><tr><th>건설업체명</th><td>${escapeHtml(companyName)}</td><th>대표자</th><td></td></tr><tr><th>소재지</th><td colspan="3"></td></tr><tr><th>공사명</th><td colspan="3">${escapeHtml(selectedConstruction.construction_name)}</td></tr><tr><th>발주처</th><td></td><th>공사기간</th><td></td></tr><tr><th>계약금액</th><td>${formatKRW(selectedConstruction.construction_amount)}</td><th>공정율</th><td></td></tr><tr><th>계상된 안전관리비</th><td>${formatKRW(selectedConstruction.safety_cost_total)}</td><th>공사진척에 따른 사용기준금액</th><td></td></tr><tr><th>잔여금액</th><td>${formatKRW(Number(selectedConstruction.safety_cost_total || 0) - approvedTotal)}</td><th>누계집행율</th><td>${usageRate}%</td></tr></tbody></table><p class="title">1. 산업안전보건관리비 사용내역서 총괄</p><table><thead><tr><th>항목</th><th>전월</th><th>금월</th><th>누계</th><th>기준비율</th></tr></thead><tbody>${grouped.map(({ cat, rows }) => { const total = rows.reduce((sum, it) => sum + Number(it.amount || 0), 0); const prev = Number(priorByCat[cat.code] || 0); const cum = prev + (monthApproved ? total : 0); return `<tr><td>${escapeHtml(cat.code)}. ${escapeHtml(cat.name)}</td><td>${formatKRW(prev)}</td><td>${formatKRW(total)}${monthApproved ? '' : ' (작성중)'}</td><td>${formatKRW(cum)}</td><td></td></tr>`; }).join('')}</tbody></table><p class="notice">｢건설업 산업안전보건관리비 계상 및 사용기준｣ 제10조제1항에 따라 위와 같이 사용내역서를 작성하였습니다.</p><p class="sign">작성자: ${escapeHtml(profile?.display_name || '')}</p></section><section class="page"><p class="title">2. 항목별 사용내역</p><table><thead><tr><th>구분</th><th>No.</th><th>거래날짜</th><th>공급자</th><th>품명</th><th>규격</th><th>메이커</th><th>수량</th><th>단가</th><th>공급가액</th><th>부가세</th><th>금액</th><th>판정</th></tr></thead><tbody>${itemRows}${totalRow}</tbody></table><p class="title">감사대응 체크리스트</p><table><thead><tr><th>항목</th><th>상태</th><th>비고</th></tr></thead><tbody>${checklistRows}</tbody></table><p class="title">실무 철 순서</p><table><tbody>${tocRows}</tbody></table><p class="title">비목별 필수 증빙</p><table><thead><tr><th>비목</th><th>증빙</th><th>상태</th></tr></thead><tbody>${packRows || '<tr><td colspan="3">해당 없음</td></tr>'}</tbody></table><p class="title">보호구 지급대장</p><table><tbody><tr><td>서명 수령 건수</td><td>${ppeSignedCount}건</td><td>${ppeSignedCount > 0 ? '첨부/작성됨' : '해당 없거나 미작성'}</td></tr></tbody></table></section><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) { toast({ title: '인쇄 창을 열 수 없습니다.', variant: 'destructive' }); return; }
    printWindow.document.write(html);
    printWindow.document.close();
  }

  if (!access.selectedProject) return <div className="text-muted-foreground">프로젝트를 선택하세요.</div>;

  return <div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-xl font-bold flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> 산업안전보건관리비</h1><p className="text-xs text-muted-foreground mt-1">{access.seesAllCompanies ? '프로젝트 관리자·안전관리자·마스터는 전체 시공사를 조회합니다.' : '사용내역 · AI 자동분류 · 증빙 · 결재 · 법정 비율 검증'}</p></div>
      {activeTab === 'reports' && (
      <div className="flex gap-2">
        <a href="/templates/safety-cost-template.xlsx" download><Button variant="outline" size="sm" className="gap-1"><FileSpreadsheet className="h-4 w-4" /> 공식양식(별지1호)</Button></a>
        <Dialog open={constructionOpen} onOpenChange={setConstructionOpen}><DialogTrigger asChild><Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> 공사 등록</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>산업안전보건관리비 공사 등록</DialogTitle></DialogHeader><div className="grid grid-cols-2 gap-3"><div className="col-span-2 space-y-1"><Label>회사</Label><Select value={newConstruction.company_id} onValueChange={(v) => setNewConstruction((p) => ({ ...p, company_id: v }))}><SelectTrigger><SelectValue placeholder="회사 선택" /></SelectTrigger><SelectContent>{scopedCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div><div className="col-span-2 space-y-1"><Label>공사명</Label><Input value={newConstruction.construction_name} onChange={(e) => setNewConstruction((p) => ({ ...p, construction_name: e.target.value }))} /></div><div className="space-y-1"><Label>공사종류</Label><Input value={newConstruction.construction_type} onChange={(e) => setNewConstruction((p) => ({ ...p, construction_type: e.target.value }))} /></div><div className="space-y-1"><Label>공사금액</Label><Input type="number" value={newConstruction.construction_amount} onChange={(e) => setNewConstruction((p) => ({ ...p, construction_amount: e.target.value }))} /></div><div className="space-y-1"><Label>산업안전보건관리비 총액</Label><Input type="number" value={newConstruction.safety_cost_total} onChange={(e) => setNewConstruction((p) => ({ ...p, safety_cost_total: e.target.value }))} /></div><div className="space-y-1"><Label>비고</Label><Input value={newConstruction.notes} onChange={(e) => setNewConstruction((p) => ({ ...p, notes: e.target.value }))} /></div></div><DialogFooter><Button onClick={createConstruction}>등록</Button></DialogFooter></DialogContent></Dialog>
      </div>
      )}
    </div>

    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        <TabsTrigger value="reports">사용내역·정산</TabsTrigger>
        <TabsTrigger value="validation">산안비 검증</TabsTrigger>
      </TabsList>
    </Tabs>

    {activeTab === 'validation' ? (
      <SafetyCostValidationPanel focusReportId={selectedReportId || null} />
    ) : (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="space-y-3">
        {access.seesAllCompanies && companyGroups.length > 1 && (
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger><SelectValue placeholder="시공사 선택" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 시공사 ({companyGroups.length})</SelectItem>
              {companyGroups.map((g) => (
                <SelectItem key={g.companyId} value={g.companyId}>{g.companyName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {loading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />) : visibleCompanyGroups.map((group) => (
          <div key={group.companyId} className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <div>
                <div className="text-sm font-semibold">{group.companyName}</div>
                <div className="text-[11px] text-muted-foreground">{companyTypeLabel(group.companyType)} · {group.constructions.length}건</div>
              </div>
              {access.seesAllCompanies && (
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => openNewConstruction(group.companyId)}>
                  <Plus className="h-3 w-3 mr-1" /> 공사
                </Button>
              )}
            </div>
            {group.constructions.length === 0 && (
              <Card><CardContent className="py-4 text-center text-xs text-muted-foreground">등록된 공사가 없습니다.</CardContent></Card>
            )}
            {group.constructions.map((c) => {
              const selected = c.id === selectedConstructionId;
              const constructionReports = reports.filter((r) => r.construction_id === c.id && r.status === 'approved');
              const total = constructionReports.reduce((sum, r) => sum + Number(r.report_total || 0), 0);
              const rate = c.safety_cost_total ? Math.round((total / Number(c.safety_cost_total)) * 100) : 0;
              return (
                <div key={c.id} className={`rounded-lg border p-3 transition-colors ${selected ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/50'}`}>
                  <button type="button" onClick={() => setSelectedConstructionId(c.id)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-sm">{c.construction_name}</div>
                      </div>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); openConstructionEditor(c); }} aria-label="공사 정보 수정"><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="mt-3 space-y-1"><div className="flex justify-between text-xs"><span>사용률</span><span>{rate}%</span></div><Progress value={Math.min(100, rate)} className="h-2" /></div>
                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs"><span>총액 {formatKRW(c.safety_cost_total)}</span><span>잔여 {formatKRW(Number(c.safety_cost_total || 0) - total)}</span></div>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {!loading && visibleCompanyGroups.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">등록된 공사가 없습니다.<div className="mt-2"><Button size="sm" onClick={() => openNewConstruction()}><Plus className="h-3 w-3 mr-1" /> 공사 등록</Button></div></CardContent></Card>
        )}
      </div>

      <div className="space-y-4 min-w-0 overflow-x-auto">
        {selectedConstruction && <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center justify-between"><span>{selectedConstruction.construction_name}</span>{usageRate < 50 && <Badge variant="secondary" className="gap-1"><AlertTriangle className="h-3 w-3" /> 저사용 경고</Badge>}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-4"><div><p className="text-xs text-muted-foreground">공사금액</p><p className="font-semibold">{formatKRW(selectedConstruction.construction_amount)}</p></div><div><p className="text-xs text-muted-foreground">산업안전보건관리비 총액</p><p className="font-semibold">{formatKRW(selectedConstruction.safety_cost_total)}</p></div><div><p className="text-xs text-muted-foreground">승인 누계</p><p className="font-semibold">{formatKRW(approvedTotal)}</p></div><div><p className="text-xs text-muted-foreground">잔여 금액</p><p className="font-semibold">{formatKRW(Number(selectedConstruction.safety_cost_total || 0) - approvedTotal)}</p></div></CardContent></Card>}

        {selectedConstruction && (
          <LegacyImportWizard
            projectId={selectedConstruction.project_id}
            companyId={selectedConstruction.company_id}
            constructionId={selectedConstruction.id}
            userId={user?.id}
            files={evidence}
            liveReports={filteredReports}
            safetyCostTotal={Number(selectedConstruction.safety_cost_total || 0)}
            existingApprovedTotal={approvedTotal}
            existingApprovedByCategory={existingApprovedByCategory}
            onChanged={() => fetchAll()}
          />
        )}

        <Card><CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm">월별 사용내역서</CardTitle><Dialog open={reportOpen} onOpenChange={setReportOpen}><DialogTrigger asChild><Button size="sm" variant="outline" disabled={!selectedConstruction}>월별 작성</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>월별 사용내역서 생성</DialogTitle></DialogHeader><Label>작성월</Label><Input type="month" value={newReportMonth} onChange={(e) => setNewReportMonth(e.target.value)} />{existingLiveForNewMonth && <p className="text-sm text-muted-foreground">이미 해당 월 내역서가 있습니다. 생성을 누르면 기존 내역서를 엽니다.</p>}<DialogFooter><Button onClick={createReport} disabled={creatingReport}>{creatingReport ? '처리 중…' : '생성'}</Button></DialogFooter></DialogContent></Dialog></div></CardHeader><CardContent><div className="flex flex-wrap gap-2">{filteredReports.map((r) => <div key={r.id} className={`flex items-center rounded-md border ${r.id === selectedReportId ? 'border-primary bg-primary text-primary-foreground' : 'bg-card'}`}><button type="button" className="px-3 py-1.5 text-sm" onClick={() => setSelectedReportId(r.id)}>{String(r.report_month).slice(0, 7)} <Badge variant="secondary" className="ml-2">{getSafetyCostStatusLabel(r.status)}</Badge>{r.source === 'legacy_import' && <Badge variant="outline" className="ml-1">이관</Badge>}</button><Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => openReportEditor(r)} disabled={r.status === 'approved' || r.status === 'submitted'} aria-label="월별 사용내역서 수정"><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => deleteReport(r)} disabled={r.status === 'approved' || r.status === 'submitted'} aria-label="월별 사용내역서 삭제"><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div></CardContent></Card>

        {selectedReport && <Tabs value={reportTab} onValueChange={setReportTab}><TabsList className="flex flex-wrap h-auto gap-1"><TabsTrigger value="items">사용 항목 <Badge variant="secondary" className="ml-2">{baseItems.length}</Badge></TabsTrigger><TabsTrigger value="pack">증빙패키지 {!evidencePack.ready && filteredItems.length > 0 && <Badge variant="destructive" className="ml-2">{evidencePack.hardMissing.length}</Badge>}</TabsTrigger><TabsTrigger value="ppe-stock">보호구 수불</TabsTrigger><TabsTrigger value="ppe">보호구 지급대장 {ppeSignedCount > 0 && <Badge variant="secondary" className="ml-2">{ppeSignedCount}</Badge>}</TabsTrigger><TabsTrigger value="ai">AI 자동분석</TabsTrigger><TabsTrigger value="audit">자동검토 {(compliance.warningCount + evidenceMissingCount + evidencePack.hardMissing.length) > 0 && <Badge variant="destructive" className="ml-2">{compliance.warningCount + evidenceMissingCount + evidencePack.hardMissing.length}</Badge>}</TabsTrigger><TabsTrigger value="output">출력/결재</TabsTrigger></TabsList><TabsContent value="pack" className="space-y-3">
          {selectedConstruction && selectedReport && (
            <EvidencePackPanel
              projectId={selectedConstruction.project_id}
              companyId={selectedConstruction.company_id}
              constructionId={selectedConstruction.id}
              reportId={selectedReport.id}
              items={filteredItems}
              evidence={evidence as any}
              ppeLedgerSignedCount={ppeSignedCount}
              userId={user?.id}
              onChanged={() => { fetchAll(); refreshPpeSignedCount(selectedReport.id); }}
              onOpenPpeLedger={() => setReportTab('ppe')}
            />
          )}
        </TabsContent>
        <TabsContent value="ppe-stock" className="space-y-3">
          {selectedConstruction && (
            <PpeStockPanel
              projectId={selectedConstruction.project_id}
              companyId={selectedConstruction.company_id}
              constructionId={selectedConstruction.id}
              userId={user?.id}
            />
          )}
        </TabsContent>
        <TabsContent value="ppe" className="space-y-3">
          {selectedConstruction && selectedReport && (
            <PpeLedgerPanel
              projectId={selectedConstruction.project_id}
              companyId={selectedConstruction.company_id}
              constructionId={selectedConstruction.id}
              reportId={selectedReport.id}
              constructionName={selectedConstruction.construction_name}
              defaultItemNames={[...new Set(filteredItems.filter((it) => it.category_code === '3').map((it) => String(it.item_name || '')).filter(Boolean))].slice(0, 8)}
              userId={user?.id}
              onChanged={() => refreshPpeSignedCount(selectedReport.id)}
            />
          )}
        </TabsContent>
        <TabsContent value="items" className="space-y-3">{filteredItems.length > 0 && (() => { const s = summarizeOcrItems(filteredItems); if (!s.rawChars && !s.lowCount && !s.correctedCount && !s.fallbackCount) return null; return <p className="text-xs text-muted-foreground">OCR 원문 {s.rawChars}자 · 신뢰도 낮음 {s.lowCount}건 · AI 보정 {s.correctedCount}건{s.fallbackCount ? ` · 예비 추출 ${s.fallbackCount}건` : ''}</p>; })()}<div className="flex flex-wrap items-center gap-2"><div className="relative max-w-sm flex-1 min-w-[12rem]"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="품명·공급자·분류·메이커 검색" className="pl-8" /></div><Button type="button" size="sm" variant="outline" className="gap-1" onClick={openNewItem} disabled={reportLocked}><Plus className="h-3.5 w-3.5" /> 항목 추가</Button></div><Card><CardContent className="p-0 overflow-auto"><Table><TableHeader><TableRow><TableHead>거래날짜</TableHead><TableHead>공급자</TableHead><TableHead>분류</TableHead><TableHead>품명/규격</TableHead><TableHead>메이커</TableHead><TableHead>수량</TableHead><TableHead>단가</TableHead><TableHead>공급가액</TableHead><TableHead>부가세</TableHead><TableHead>금액</TableHead><TableHead>판정</TableHead><TableHead>판독</TableHead><TableHead>법적 근거</TableHead><TableHead>증빙</TableHead><TableHead>관리</TableHead></TableRow></TableHeader><TableBody>{filteredItems.map((it) => <TableRow key={it.id} className={it.ocr_status === 'ocr_low' || it.ocr_status === 'no_vision' || it.ocr_status === 'rule_fallback' ? 'bg-amber-50/70 dark:bg-amber-950/20' : undefined}><TableCell className="text-xs">{getDisplayDate(it, selectedReport) || '—'}<div className="text-[10px] text-muted-foreground">{getDatePriorityLabel(it)}</div></TableCell><TableCell className="text-xs">{it.supplier_name || '—'}</TableCell><TableCell className="text-xs">{it.category_name}</TableCell><TableCell><div className="font-medium text-sm">{it.item_name}</div><div className="text-[11px] text-muted-foreground">{it.specification || it.ai_reason}</div></TableCell><TableCell className="text-xs">{it.maker || '—'}</TableCell><TableCell>{it.quantity} {it.unit}</TableCell><TableCell>{formatKRW(it.unit_price)}</TableCell><TableCell>{formatKRW(it.supply_amount || it.amount)}</TableCell><TableCell>{formatKRW(it.vat_amount || 0)}</TableCell><TableCell className="font-semibold">{formatKRW(it.amount)}</TableCell><TableCell><Badge variant={statusVariant(it.classification_status) as any}>{statusLabel[it.classification_status] || it.classification_status}</Badge></TableCell><TableCell><Badge variant={ocrStatusBadgeVariant(it.ocr_status)} title={ocrStatusLabel(it.ocr_status)}>{ocrStatusBadge(it.ocr_status) || '—'}</Badge></TableCell><TableCell><Button size="sm" variant="ghost" className="gap-1" onClick={() => setLegalBasisItem(it)}><Eye className="h-3 w-3" /> 열람</Button></TableCell><TableCell><Label className="inline-flex items-center gap-1 cursor-pointer text-xs"><Paperclip className="h-3 w-3" /> {evidence.filter((e) => e.item_id === it.id).length}개<Input type="file" multiple className="hidden" onChange={(e) => handleItemEvidenceUpload(it, e.target.files)} /></Label></TableCell><TableCell><div className="flex items-center gap-1"><Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => openItemEditor(it)} aria-label="항목 수정"><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteItem(it)} disabled={reportLocked} aria-label="항목 삭제"><Trash2 className="h-3.5 w-3.5" /></Button></div></TableCell></TableRow>)}{filteredItems.length === 0 && <TableRow><TableCell colSpan={15} className="py-10 text-center text-muted-foreground">{itemSearch ? '검색 결과가 없습니다.' : '항목이 없습니다. 항목 추가로 수기 입력하거나, 당월 거래명세는 AI 자동분석을 사용하세요.'}</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent><TabsContent value="ai" className="space-y-3"><Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" /> 대한민국 산업안전보건법 기준 AI 자동분석</CardTitle></CardHeader><CardContent className="space-y-3">{ocrBanner?.warning && <div className="rounded-md border border-amber-200 bg-amber-50/70 dark:bg-amber-950/20 p-2 text-xs flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /><span>{ocrBanner.warning}{ocrBanner.summary ? ` OCR 원문 ${ocrBanner.summary.rawChars}자 · 신뢰도 낮음 ${ocrBanner.summary.lowCount}건 · AI 보정 ${ocrBanner.summary.correctedCount}건` : ''}</span></div>}<div className="flex gap-2"><Label className="inline-flex items-center gap-2"><Input type="file" accept=".xls,.xlsx,.csv,.txt,.pdf,image/*" onChange={(e) => e.target.files?.[0] && handleDocumentUpload(e.target.files[0])} /><Upload className="h-4 w-4" /></Label></div><Textarea rows={10} value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="거래명세서 텍스트를 붙여넣거나 엑셀/텍스트 파일을 업로드하세요." /><Button onClick={analyzeWithAI} disabled={aiLoading} className="gap-1"><Bot className="h-4 w-4" /> {aiLoading ? '분석 중...' : 'AI 자동분류 및 입력'}</Button>{aiSummary && <div className="rounded-md border bg-muted/40 p-3 space-y-2 text-sm"><p className="font-medium">AI 분석 요약</p><div className="grid gap-2 md:grid-cols-3 text-xs"><div>사용가능 합계: {formatKRW(aiSummary.usable_total || 0)}</div><div>사용불가 합계: {formatKRW(aiSummary.warning_total || 0)}</div><div>검토필요 합계: {formatKRW(aiSummary.review_total || 0)}</div></div>{Array.isArray(aiSummary.audit_notes) && aiSummary.audit_notes.length > 0 && <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">{aiSummary.audit_notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>}</div>}<div className="grid gap-2 md:grid-cols-3">{SAFETY_COST_CATEGORIES.slice(0, 9).map((c) => { const g = getEvidenceGuide(c.code); return <div key={c.code} className="rounded-md border bg-muted/30 p-2 text-xs space-y-1"><b>{c.code}. {c.name}</b>{g && <p className="text-[10px] text-muted-foreground leading-snug">증빙: {g.requiredEvidence.slice(0, 2).join(' · ')}{g.requiredEvidence.length > 2 ? ' 등' : ''}</p>}</div>; })}</div></CardContent></Card></TabsContent><TabsContent value="audit" className="space-y-3"><Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> 산업안전보건관리비 자동검토</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-4"><div><p className="text-xs text-muted-foreground">검토 결과</p><Badge variant={approvalReady ? 'default' : 'secondary'}>{approvalReady ? '상신 가능' : '보완 필요'}</Badge></div><div><p className="text-xs text-muted-foreground">검토 필요</p><p className="font-semibold">{compliance.reviewCount}건</p></div><div><p className="text-xs text-muted-foreground">사용 불가 경고</p><p className="font-semibold">{compliance.warningCount}건</p></div><div><p className="text-xs text-muted-foreground">증빙 누락</p><p className="font-semibold">{evidenceMissingCount}건</p></div></div><div className="rounded-md border bg-muted/30 p-3"><div className="flex items-center justify-between gap-2 mb-3"><p className="font-medium flex items-center gap-2"><ListChecks className="h-4 w-4" /> 감사대응 체크리스트</p><Button size="sm" variant="outline" onClick={requestMissingEvidence} disabled={requestingEvidence || evidenceMissingCount === 0} className="gap-1"><Send className="h-4 w-4" /> 증빙누락 자동요청</Button></div><div className="grid gap-2">{auditChecklist.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border bg-card p-2 text-sm"><span className="flex items-center gap-2">{item.ok ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}{item.label}</span><Badge variant={item.ok ? 'default' : 'secondary'}>{item.detail}</Badge></div>)}</div></div></CardContent></Card></TabsContent><TabsContent value="output" className="space-y-3"><Card><CardContent className="pt-6 flex flex-wrap gap-2"><Button variant="outline" onClick={exportExcel} className="gap-1"><FileSpreadsheet className="h-4 w-4" /> 엑셀 출력</Button><Button variant="outline" onClick={exportPDF} className="gap-1"><FileText className="h-4 w-4" /> PDF 출력</Button><Button onClick={openSubmitDialog} disabled={!approvalReady || reportLocked} className="gap-1"><ShieldCheck className="h-4 w-4" /> 결재 상신</Button><Button variant="outline" onClick={() => setReportTab('pack')} className="gap-1"><ClipboardCheck className="h-4 w-4" /> 증빙패키지</Button><Button variant="outline" onClick={() => setReportTab('ppe')} className="gap-1"><ClipboardCheck className="h-4 w-4" /> 지급대장</Button><Button variant="outline" onClick={() => setActiveTab('validation')} className="gap-1"><ClipboardCheck className="h-4 w-4" /> 법정 검증 탭</Button></CardContent></Card></TabsContent></Tabs>}
      </div>
    </div>
    )}

    <Dialog open={!!legalBasisItem} onOpenChange={(open) => !open && setLegalBasisItem(null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>법적 근거 열람</DialogTitle></DialogHeader>
        {legalBasisItem && <div className="space-y-3 text-sm"><div><p className="text-xs text-muted-foreground">품목</p><p className="font-medium">{legalBasisItem.item_name}</p></div><div><p className="text-xs text-muted-foreground">분류</p><p>{legalBasisItem.category_name || '검토 필요'}</p></div>{ocrStatusLabel(legalBasisItem.ocr_status) && <div><p className="text-xs text-muted-foreground">판독 상태</p><p>{ocrStatusLabel(legalBasisItem.ocr_status)}</p></div>}<div><p className="text-xs text-muted-foreground">판정 사유</p><p>{legalBasisItem.ai_reason || '자동 판정 사유가 없습니다.'}</p></div><div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground mb-1">관련 기준</p><p>{legalBasisItem.legal_basis || '건설업 산업안전보건관리비 계상 및 사용기준 확인 필요'}</p></div>{(() => { const g = getEvidenceGuide(legalBasisItem.category_code); return g ? <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900 p-3 space-y-1"><p className="text-xs font-medium">필수 증빙 — {g.name}</p><ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">{g.requiredEvidence.map((e) => <li key={e}>{e}</li>)}</ul><ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">{g.tips.map((t) => <li key={t}>{t}</li>)}</ul></div> : null; })()}</div>}
      </DialogContent>
    </Dialog>
    <Dialog open={reportEditOpen} onOpenChange={setReportEditOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>월별 사용내역서 수정</DialogTitle></DialogHeader>
        <div className="space-y-3"><div className="space-y-1"><Label>작성월</Label><Input type="month" value={editingReport.report_month} onChange={(e) => setEditingReport((p) => ({ ...p, report_month: e.target.value }))} /></div><div className="space-y-1"><Label>제목</Label><Input value={editingReport.title} onChange={(e) => setEditingReport((p) => ({ ...p, title: e.target.value }))} /></div></div>
        <DialogFooter><Button variant="outline" onClick={() => setReportEditOpen(false)}>취소</Button><Button onClick={updateReport}>저장</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={itemEditOpen} onOpenChange={setItemEditOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editingItem.id ? '항목 수정' : '항목 추가'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1"><Label>거래날짜</Label><Input type="date" value={editingItem.transaction_date} onChange={(e) => setEditingItem((p) => ({ ...p, transaction_date: e.target.value, usage_date: e.target.value }))} /></div>
          <div className="space-y-1"><Label>분류</Label><Select value={editingItem.category_code || 'review'} onValueChange={(v) => { const cat = SAFETY_COST_CATEGORIES.find((c) => c.code === v); setEditingItem((p) => ({ ...p, category_code: v === 'review' ? '' : v, category_name: cat?.name || '검토 필요' })); }}><SelectTrigger><SelectValue placeholder="분류 선택" /></SelectTrigger><SelectContent><SelectItem value="review">검토 필요</SelectItem>{SAFETY_COST_CATEGORIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}. {c.name}</SelectItem>)}</SelectContent></Select></div>
          {(() => { const g = getEvidenceGuide(editingItem.category_code); return g ? <div className="md:col-span-2 rounded-md border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900 p-3 space-y-1 text-sm"><p className="font-medium text-amber-900 dark:text-amber-100">필수 증빙 가이드 — {g.name}</p><ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">{g.requiredEvidence.map((e) => <li key={e}>{e}</li>)}</ul><p className="text-[11px] text-muted-foreground">{g.tips.join(' · ')}</p></div> : <div className="md:col-span-2 text-xs text-muted-foreground">분류를 선택하면 필요 증빙이 안내됩니다.</div>; })()}
          <div className="space-y-1"><Label>공급자 상호</Label><Input value={editingItem.supplier_name} onChange={(e) => setEditingItem((p) => ({ ...p, supplier_name: e.target.value }))} /></div><div className="space-y-1"><Label>품명</Label><Input value={editingItem.item_name} onChange={(e) => setEditingItem((p) => ({ ...p, item_name: e.target.value }))} /></div>
          <div className="space-y-1"><Label>규격</Label><Input value={editingItem.specification} onChange={(e) => setEditingItem((p) => ({ ...p, specification: e.target.value }))} /></div><div className="space-y-1"><Label>메이커</Label><Input value={editingItem.maker} onChange={(e) => setEditingItem((p) => ({ ...p, maker: e.target.value }))} /></div>
          <div className="space-y-1"><Label>판정</Label><Select value={editingItem.classification_status} onValueChange={(v) => setEditingItem((p) => ({ ...p, classification_status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="usable">사용 가능</SelectItem><SelectItem value="warning">사용 불가</SelectItem><SelectItem value="review">검토 필요</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>수량</Label><Input type="number" value={editingItem.quantity} onChange={(e) => updateEditingItemMoney('quantity', e.target.value)} /></div>
          <div className="space-y-1"><Label>단위</Label><Input value={editingItem.unit} onChange={(e) => setEditingItem((p) => ({ ...p, unit: e.target.value }))} /></div>
          <div className="space-y-1"><Label>단가</Label><Input type="number" value={editingItem.unit_price} onChange={(e) => updateEditingItemMoney('unit_price', e.target.value)} /></div>
          <div className="space-y-1"><Label>공급가액</Label><Input type="number" value={editingItem.supply_amount} onChange={(e) => updateEditingItemMoney('supply_amount', e.target.value)} /></div><div className="space-y-1"><Label>부가세</Label><Input type="number" value={editingItem.vat_amount} onChange={(e) => updateEditingItemMoney('vat_amount', e.target.value)} /></div><div className="space-y-1"><Label>금액</Label><Input type="number" value={editingItem.amount} readOnly className="bg-muted/40" /></div>
          <div className="space-y-1 md:col-span-2"><Label>판정 사유</Label><Textarea rows={3} value={editingItem.ai_reason} onChange={(e) => setEditingItem((p) => ({ ...p, ai_reason: e.target.value }))} /></div>
          <div className="space-y-1 md:col-span-2"><Label>법적 근거</Label><Textarea rows={3} value={editingItem.legal_basis} onChange={(e) => setEditingItem((p) => ({ ...p, legal_basis: e.target.value }))} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setItemEditOpen(false)}>취소</Button><Button onClick={updateItem}>저장</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={constructionEditOpen} onOpenChange={setConstructionEditOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>산업안전보건관리비 공사 정보 수정</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3"><div className="col-span-2 space-y-1"><Label>회사</Label><Select value={editingConstruction.company_id} onValueChange={(v) => setEditingConstruction((p) => ({ ...p, company_id: v }))}><SelectTrigger><SelectValue placeholder="회사 선택" /></SelectTrigger><SelectContent>{scopedCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div><div className="col-span-2 space-y-1"><Label>공사명</Label><Input value={editingConstruction.construction_name} onChange={(e) => setEditingConstruction((p) => ({ ...p, construction_name: e.target.value }))} /></div><div className="space-y-1"><Label>공사종류</Label><Input value={editingConstruction.construction_type} onChange={(e) => setEditingConstruction((p) => ({ ...p, construction_type: e.target.value }))} /></div><div className="space-y-1"><Label>공사금액</Label><Input type="number" value={editingConstruction.construction_amount} onChange={(e) => setEditingConstruction((p) => ({ ...p, construction_amount: e.target.value }))} /></div><div className="space-y-1"><Label>산업안전보건관리비 총액</Label><Input type="number" value={editingConstruction.safety_cost_total} onChange={(e) => setEditingConstruction((p) => ({ ...p, safety_cost_total: e.target.value }))} /></div><div className="space-y-1"><Label>비고</Label><Input value={editingConstruction.notes} onChange={(e) => setEditingConstruction((p) => ({ ...p, notes: e.target.value }))} /></div></div>
        <DialogFooter><Button variant="outline" onClick={() => setConstructionEditOpen(false)}>취소</Button><Button onClick={updateConstruction}>저장</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {selectedReport && selectedConstruction && (
      <SubmitApprovalDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        entityType="safety_cost"
        entityId={selectedReport.id}
        projectId={selectedReport.project_id}
        submitterCompanyId={selectedConstruction.company_id}
        title="산업안전보건관리비 결재 상신"
        onSubmitted={() => { fetchAll(); }}
      />
    )}
  </div>;
};

export default SafetyCost;
