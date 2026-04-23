import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notificationService';
import { SAFETY_COST_CATEGORIES, analyzeSafetyCostCompliance, classifySafetyCostItem, formatKRW, getSafetyCostStatusLabel } from '@/lib/safetyCost';
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
import { AlertTriangle, Bot, CheckCircle2, ClipboardCheck, Eye, FileSpreadsheet, FileText, ListChecks, Paperclip, Pencil, Plus, Send, ShieldCheck, Trash2, Upload } from 'lucide-react';

type Construction = any;
type Report = any;
type Item = any;
type Evidence = any;

const statusVariant = (status: string) => status === 'usable' ? 'default' : status === 'warning' ? 'destructive' : 'secondary';
const statusLabel: Record<string, string> = { usable: '사용 가능', warning: '사용 불가', review: '검토 필요' };
const sanitizeStorageFileName = (fileName: string) => {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'}` : '';
  const baseName = fileName.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return `${baseName || 'document'}${extension}`;
};

const SafetyCost = () => {
  const { user, profile } = useAuth();
  const access = useGlobalProjectAccess();
  const { toast } = useToast();
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
  const [requestingEvidence, setRequestingEvidence] = useState(false);
  const [newConstruction, setNewConstruction] = useState({ company_id: '', construction_name: '', construction_type: '', construction_amount: '', safety_cost_total: '', notes: '' });
  const [constructionEditOpen, setConstructionEditOpen] = useState(false);
  const [editingConstruction, setEditingConstruction] = useState({ id: '', company_id: '', construction_name: '', construction_type: '', construction_amount: '', safety_cost_total: '', notes: '' });
  const [newReportMonth, setNewReportMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [reportEditOpen, setReportEditOpen] = useState(false);
  const [editingReport, setEditingReport] = useState({ id: '', report_month: '', title: '' });

  const selectedConstruction = constructions.find((c) => c.id === selectedConstructionId);
  const selectedReport = reports.find((r) => r.id === selectedReportId);
  const approvedReports = reports.filter((r) => r.status === 'approved' && (!selectedConstructionId || r.construction_id === selectedConstructionId));
  const approvedTotal = useMemo(() => approvedReports.reduce((sum, r) => sum + Number(r.report_total || 0), 0), [approvedReports]);
  const usageRate = selectedConstruction?.safety_cost_total ? Math.min(100, Math.round((approvedTotal / Number(selectedConstruction.safety_cost_total)) * 100)) : 0;

  const scopedCompanies = useMemo(() => {
    if (access.isMaster || access.isProjectAdmin) return companies;
    return companies.filter((c) => c.id === access.userCompanyId);
  }, [companies, access.isMaster, access.isProjectAdmin, access.userCompanyId]);

  const filteredReports = reports.filter((r) => r.construction_id === selectedConstructionId);
  const filteredItems = items.filter((i) => i.report_id === selectedReportId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const evidenceMissingItems = filteredItems.filter((it) => !evidence.some((e) => e.item_id === it.id));
  const evidenceMissingCount = evidenceMissingItems.length;
  const compliance = useMemo(() => analyzeSafetyCostCompliance(filteredItems, selectedConstruction?.safety_cost_total), [filteredItems, selectedConstruction?.safety_cost_total]);
  const auditChecklist = useMemo(() => [
    { label: '월별 사용 항목 입력', ok: filteredItems.length > 0, detail: `${filteredItems.length}건` },
    { label: '항목별 증빙 첨부', ok: evidenceMissingCount === 0 && filteredItems.length > 0, detail: evidenceMissingCount ? `${evidenceMissingCount}건 누락` : '완료' },
    { label: '사용 불가 항목 제거', ok: compliance.warningCount === 0, detail: compliance.warningCount ? `${compliance.warningCount}건 경고` : '이상 없음' },
    { label: '검토 필요 항목 확인', ok: compliance.reviewCount === 0, detail: compliance.reviewCount ? `${compliance.reviewCount}건 검토` : '이상 없음' },
    { label: '법적 근거 자동 기록', ok: compliance.missingBasisCount === 0 && filteredItems.length > 0, detail: compliance.missingBasisCount ? `${compliance.missingBasisCount}건 누락` : '완료' },
    { label: '계상금액 초과 여부', ok: Number(selectedConstruction?.safety_cost_total || 0) === 0 || compliance.rate <= 100, detail: `${compliance.rate}%` },
  ], [filteredItems.length, evidenceMissingCount, compliance, selectedConstruction?.safety_cost_total]);
  const approvalReady = auditChecklist.every((item) => item.ok) && selectedReport?.status === 'draft';

  useEffect(() => { if (access.selectedProject) fetchAll(); }, [access.selectedProject]);
  useEffect(() => {
    if (!selectedConstructionId && constructions.length) setSelectedConstructionId(constructions[0].id);
  }, [constructions, selectedConstructionId]);
  useEffect(() => {
    const filtered = reports.filter((r) => r.construction_id === selectedConstructionId);
    if (!filtered.some((r) => r.id === selectedReportId)) setSelectedReportId(filtered[0]?.id || '');
  }, [reports, selectedConstructionId, selectedReportId]);

  async function fetchAll() {
    if (!access.selectedProject) return;
    const [companyRes, constructionRes, reportRes, itemRes, evidenceRes] = await Promise.all([
      supabase.from('companies').select('*').eq('project_id', access.selectedProject).order('name'),
      supabase.from('safety_cost_constructions' as any).select('*').eq('project_id', access.selectedProject).order('created_at', { ascending: false }),
      supabase.from('safety_cost_monthly_reports' as any).select('*').eq('project_id', access.selectedProject).order('report_month', { ascending: false }),
      supabase.from('safety_cost_items' as any).select('*').eq('project_id', access.selectedProject).order('sort_order'),
      supabase.from('safety_cost_evidence_files' as any).select('*').eq('project_id', access.selectedProject).order('created_at', { ascending: false }),
    ]);
    setCompanies(companyRes.data || []);
    setConstructions((constructionRes.data || []) as any[]);
    setReports((reportRes.data || []) as any[]);
    setItems((itemRes.data || []) as any[]);
    setEvidence((evidenceRes.data || []) as any[]);
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
    if (!selectedConstruction || !user) return;
    const { data, error } = await supabase.from('safety_cost_monthly_reports' as any).insert({
      construction_id: selectedConstruction.id,
      project_id: selectedConstruction.project_id,
      company_id: selectedConstruction.company_id,
      report_month: `${newReportMonth}-01`,
      title: `${newReportMonth} 산업안전보건관리비 사용내역서`,
      created_by: user.id,
    }).select().single();
    if (error) { toast({ title: '월별 내역서 생성 실패', description: error.message, variant: 'destructive' }); return; }
    setReportOpen(false); setSelectedReportId((data as any).id); toast({ title: '월별 사용내역서가 생성되었습니다.' }); fetchAll();
  }

  function openReportEditor(report: Report) {
    setEditingReport({ id: report.id, report_month: String(report.report_month || '').slice(0, 7), title: report.title || '' });
    setReportEditOpen(true);
  }

  async function updateReport() {
    if (!editingReport.id || !editingReport.report_month) return;
    const current = reports.find((r) => r.id === editingReport.id);
    if (current?.status === 'approved') { toast({ title: '승인 완료된 내역서는 수정할 수 없습니다.', variant: 'destructive' }); return; }
    const { error } = await supabase.from('safety_cost_monthly_reports' as any).update({
      report_month: `${editingReport.report_month}-01`,
      title: editingReport.title.trim() || `${editingReport.report_month} 산업안전보건관리비 사용내역서`,
    }).eq('id', editingReport.id);
    if (error) { toast({ title: '월별 사용내역서 수정 실패', description: error.message, variant: 'destructive' }); return; }
    setReportEditOpen(false); toast({ title: '월별 사용내역서가 수정되었습니다.' }); fetchAll();
  }

  async function deleteReport(report: Report) {
    if (report.status === 'approved') { toast({ title: '승인 완료된 내역서는 삭제할 수 없습니다.', variant: 'destructive' }); return; }
    if (!window.confirm(`${String(report.report_month).slice(0, 7)} 월별 사용내역서를 삭제할까요? 항목과 증빙 연결도 함께 삭제됩니다.`)) return;
    const { error } = await supabase.from('safety_cost_monthly_reports' as any).delete().eq('id', report.id);
    if (error) { toast({ title: '월별 사용내역서 삭제 실패', description: error.message, variant: 'destructive' }); return; }
    setSelectedReportId(''); toast({ title: '월별 사용내역서가 삭제되었습니다.' }); fetchAll();
  }

  async function updateReportTotal(reportId: string) {
    const { data } = await supabase.from('safety_cost_items' as any).select('amount').eq('report_id', reportId);
    const total = ((data || []) as any[]).reduce((sum, i) => sum + Number(i.amount || 0), 0);
    await supabase.from('safety_cost_monthly_reports' as any).update({ report_total: total }).eq('id', reportId);
  }

  async function insertItems(rows: any[]) {
    if (!selectedReport || !selectedConstruction || !user) return;
    const inserts = rows.map((row, idx) => {
      const fallback = classifySafetyCostItem(row.item_name || row['품목'] || row['사용 항목'] || '');
      return {
        report_id: selectedReport.id,
        construction_id: selectedConstruction.id,
        project_id: selectedConstruction.project_id,
        company_id: selectedConstruction.company_id,
        usage_date: row.usage_date || null,
        category_code: row.category_code || fallback.category_code,
        category_name: row.category_name || fallback.category_name,
        item_name: row.item_name || row['품목'] || row['사용 항목'] || '',
        specification: row.specification || row['규격'] || '',
        quantity: Number(row.quantity || row['수량'] || 1),
        unit: row.unit || row['단위'] || '식',
        unit_price: Number(row.unit_price || row['단가'] || row.amount || row['금액'] || 0),
        amount: Number(row.amount || row['금액'] || 0),
        classification_status: row.classification_status || fallback.classification_status,
        ai_confidence: row.ai_confidence || null,
        ai_reason: row.ai_reason || fallback.ai_reason,
        legal_basis: row.legal_basis || fallback.legal_basis,
        sort_order: filteredItems.length + idx,
        created_by: user.id,
      };
    }).filter((r) => r.item_name && r.amount > 0);
    if (!inserts.length) { toast({ title: '추가할 항목이 없습니다.', variant: 'destructive' }); return; }
    const { error } = await supabase.from('safety_cost_items' as any).insert(inserts);
    if (error) { toast({ title: '항목 추가 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `${inserts.length}개 항목이 추가되었습니다.` });
    await updateReportTotal(selectedReport.id);
    await fetchAll();
  }

  async function analyzeWithAI() {
    if (!aiText.trim()) { toast({ title: '거래명세서 텍스트를 입력하거나 파일을 업로드하세요.', variant: 'destructive' }); return; }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-safety-cost-document', { body: { text: aiText, fileName: 'manual-input' } });
      if (error) throw error;
      await insertItems(data?.items || []);
      setAiText('');
    } catch (e: any) {
      toast({ title: 'AI 분석 실패', description: e.message || String(e), variant: 'destructive' });
    } finally { setAiLoading(false); }
  }

  async function handleDocumentUpload(file: File) {
    if (!selectedReport || !selectedConstruction || !user) return;
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
      const path = `safety-cost/${selectedReport.id}/documents/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) { toast({ title: '거래명세표 업로드 실패', description: upErr.message, variant: 'destructive' }); return; }
      const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path);
      const { error: evidenceError } = await supabase.from('safety_cost_evidence_files' as any).insert({
        report_id: selectedReport.id, construction_id: selectedConstruction.id, project_id: selectedConstruction.project_id, company_id: selectedConstruction.company_id,
        evidence_kind: 'transaction', file_name: file.name, file_path: path, file_url: urlData.publicUrl, mime_type: file.type || 'application/octet-stream', file_size: file.size, uploaded_by: user.id,
      });
      if (evidenceError) { toast({ title: '거래명세표 기록 실패', description: evidenceError.message, variant: 'destructive' }); return; }
      if (text.trim()) {
        setAiText(text);
        toast({ title: '거래명세표 업로드 완료', description: '추출된 텍스트를 확인 후 AI 자동분석을 실행하세요.' });
      } else {
        toast({ title: '업로드 완료', description: 'PDF/이미지는 텍스트 추출이 제한되어 내용을 붙여넣은 뒤 AI 분석을 실행하세요.' });
      }
      fetchAll();
    } catch (e: any) {
      toast({ title: '거래명세표 처리 실패', description: e.message || String(e), variant: 'destructive' });
    }
  }

  async function handleItemEvidenceUpload(item: Item, files: FileList | null) {
    if (!files || !selectedConstruction || !user) return;
    const rows = [];
    for (const file of Array.from(files)) {
      const path = `safety-cost/${item.report_id}/items/${item.id}/${Date.now()}_${sanitizeStorageFileName(file.name)}`;
      const { error } = await supabase.storage.from('attachments').upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
      if (error) { toast({ title: '증빙 업로드 실패', description: error.message, variant: 'destructive' }); continue; }
      const { data } = supabase.storage.from('attachments').getPublicUrl(path);
      rows.push({ report_id: item.report_id, item_id: item.id, construction_id: item.construction_id, project_id: item.project_id, company_id: item.company_id, evidence_kind: file.type.startsWith('image/') ? 'site_photo' : 'transaction', file_name: file.name, file_path: path, file_url: data.publicUrl, mime_type: file.type, file_size: file.size, uploaded_by: user.id });
    }
    if (rows.length) await supabase.from('safety_cost_evidence_files' as any).insert(rows);
    toast({ title: '항목별 증빙이 업로드되었습니다.' }); fetchAll();
  }

  async function requestMissingEvidence() {
    if (!selectedReport || !selectedConstruction || !user || evidenceMissingCount === 0) {
      toast({ title: '요청할 누락 증빙이 없습니다.' }); return;
    }
    setRequestingEvidence(true);
    const { data: members, error } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', selectedReport.project_id)
      .eq('company_id', selectedReport.company_id);
    if (error) { toast({ title: '증빙 요청 실패', description: error.message, variant: 'destructive' }); setRequestingEvidence(false); return; }
    const recipients = [...new Set((members || []).map((m: any) => m.user_id).filter(Boolean))];
    if (!recipients.length) { toast({ title: '요청 대상자가 없습니다.', description: '해당 회사의 프로젝트 멤버를 먼저 지정하세요.', variant: 'destructive' }); setRequestingEvidence(false); return; }
    await Promise.all(recipients.map((userId) => sendNotification({
      user_id: userId,
      title: '산업안전보건관리비 증빙 보완 요청',
      message: `${selectedConstruction.construction_name} ${String(selectedReport.report_month).slice(0, 7)} 사용내역서에 항목별 증빙 ${evidenceMissingCount}건이 누락되었습니다.`,
      type: 'safety_cost',
      related_id: selectedReport.id,
      related_type: 'safety_cost_report',
      project_id: selectedReport.project_id,
    })));
    await supabase.from('audit_logs').insert({
      project_id: selectedReport.project_id,
      user_id: user.id,
      user_name: profile?.display_name || '',
      action: '산업안전보건관리비 증빙 보완 요청',
      target_type: 'safety_cost_report',
      target_id: selectedReport.id,
      details: { missing_count: evidenceMissingCount, item_names: evidenceMissingItems.map((it) => it.item_name), recipients },
    });
    toast({ title: '증빙 보완 요청 발송 완료', description: `${recipients.length}명에게 알림을 보냈습니다.` });
    setRequestingEvidence(false);
  }

  async function submitApproval() {
    if (!selectedReport || !selectedConstruction || !user || !profile) return;
    if (!approvalReady) {
      toast({ title: '결재 상신 전 자동검토를 완료하세요.', description: '사용 불가 항목, 증빙 누락, 법적 근거 누락을 먼저 보완해야 합니다.', variant: 'destructive' });
      return;
    }
    const { data: lines } = await supabase.from('approval_lines').select('*').eq('project_id', selectedReport.project_id).order('step_order');
    if (!lines?.length || lines.some((l: any) => !l.user_id)) { toast({ title: '프로젝트 결재라인을 먼저 설정하세요.', variant: 'destructive' }); return; }
    const inserts = lines.map((line: any, idx: number) => ({ report_id: selectedReport.id, construction_id: selectedConstruction.id, project_id: selectedReport.project_id, company_id: selectedReport.company_id, step_order: idx, step_label: line.step_label, position: line.position, approver_id: line.user_id, approver_name: line.user_name || '', company_name: line.company_name || '', status: idx === 0 ? 'approved' : 'pending', approved_at: idx === 0 ? new Date().toISOString() : null }));
    await supabase.from('safety_cost_approval_steps' as any).delete().eq('report_id', selectedReport.id);
    const { error } = await supabase.from('safety_cost_approval_steps' as any).insert(inserts);
    if (error) { toast({ title: '결재 상신 실패', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('safety_cost_monthly_reports' as any).update({ status: 'submitted', submitted_by: user.id, submitted_at: new Date().toISOString() }).eq('id', selectedReport.id);
    toast({ title: '산업안전보건관리비 결재가 상신되었습니다.' }); fetchAll();
  }

  async function approveReport() {
    if (!selectedReport || !user || !profile) return;
    await supabase.from('safety_cost_monthly_reports' as any).update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', selectedReport.id);
    await supabase.from('safety_cost_approval_steps' as any).update({ status: 'approved', approver_name: profile.display_name, approved_at: new Date().toISOString() }).eq('report_id', selectedReport.id).eq('approver_id', user.id).eq('status', 'pending');
    toast({ title: '승인 완료', description: '승인된 금액만 사용 누계에 반영됩니다.' }); fetchAll();
  }

  function exportExcel() {
    if (!selectedReport || !selectedConstruction) return;
    const wb = XLSX.utils.book_new();
    const summary = [
      ['산업안전보건관리비 사용내역서 총괄'], ['공사명', selectedConstruction.construction_name], ['회사', companies.find((c) => c.id === selectedConstruction.company_id)?.name || ''], ['공사금액', selectedConstruction.construction_amount], ['계상된 산업안전보건관리비', selectedConstruction.safety_cost_total], ['승인 누계', approvedTotal], ['잔여 금액', Number(selectedConstruction.safety_cost_total || 0) - approvedTotal], ['사용률', `${usageRate}%`], ['작성월', selectedReport.report_month], ['상태', getSafetyCostStatusLabel(selectedReport.status)], [],
      ['구분', 'No.', '월일', '사용 항목', '규격', '수량', '단위', '단가', '금액', '판정', '법적 근거', '증빙 수'],
      ...filteredItems.map((it, idx) => [it.category_name, idx + 1, it.usage_date || '', it.item_name, it.specification, it.quantity, it.unit, it.unit_price, it.amount, statusLabel[it.classification_status] || it.classification_status, it.legal_basis, evidence.filter((e) => e.item_id === it.id).length]),
      [], ['감사대응 체크리스트'], ...auditChecklist.map((it) => [it.label, it.ok ? '완료' : '보완 필요', it.detail]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), '산업안전보건관리비');
    XLSX.writeFile(wb, `산업안전보건관리비_${selectedConstruction.construction_name}_${selectedReport.report_month}.xlsx`);
  }

  function exportPDF() {
    if (!selectedReport || !selectedConstruction) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(16); doc.text('산업안전보건관리비 사용내역서', 14, 16);
    doc.setFontSize(10); doc.text(`공사명: ${selectedConstruction.construction_name} / 작성월: ${selectedReport.report_month}`, 14, 24);
    autoTable(doc, { startY: 30, head: [['구분', 'No.', '사용 항목', '수량', '단위', '단가', '금액', '판정', '법적 근거']], body: filteredItems.map((it, idx) => [it.category_name, idx + 1, it.item_name, it.quantity, it.unit, formatKRW(it.unit_price), formatKRW(it.amount), statusLabel[it.classification_status] || it.classification_status, it.legal_basis]), styles: { fontSize: 8 }, headStyles: { fillColor: [30, 41, 59] } });
    let y = (doc as any).lastAutoTable.finalY + 10;
    doc.text(`승인 누계: ${formatKRW(approvedTotal)} / 잔여 금액: ${formatKRW(Number(selectedConstruction.safety_cost_total || 0) - approvedTotal)} / 사용률: ${usageRate}%`, 14, y);
    autoTable(doc, { startY: y + 6, head: [['감사대응 항목', '상태', '비고']], body: auditChecklist.map((it) => [it.label, it.ok ? '완료' : '보완 필요', it.detail]), styles: { fontSize: 8 } });
    filteredItems.forEach((it) => {
      const files = evidence.filter((e) => e.item_id === it.id);
      if (!files.length) return;
      doc.addPage(); doc.setFontSize(13); doc.text(`증빙: ${it.item_name}`, 14, 16);
      doc.setFontSize(9); files.forEach((f, idx) => doc.text(`${idx + 1}. ${f.file_name}`, 16, 28 + idx * 7));
    });
    doc.save(`산업안전보건관리비_${selectedConstruction.construction_name}_${selectedReport.report_month}.pdf`);
  }

  if (!access.selectedProject) return <div className="text-muted-foreground">프로젝트를 선택하세요.</div>;

  return <div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-xl font-bold flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> 산업안전보건관리비</h1><p className="text-xs text-muted-foreground mt-1">공사 단위 월별 작성 · AI 자동분류 · 증빙 · 결재 승인 후 누계 반영</p></div>
      <div className="flex gap-2">
        <a href="/templates/safety-cost-template.xls" download><Button variant="outline" size="sm" className="gap-1"><FileSpreadsheet className="h-4 w-4" /> 공식 양식</Button></a>
        <Dialog open={constructionOpen} onOpenChange={setConstructionOpen}><DialogTrigger asChild><Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> 공사 등록</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>산업안전보건관리비 공사 등록</DialogTitle></DialogHeader><div className="grid grid-cols-2 gap-3"><div className="col-span-2 space-y-1"><Label>회사</Label><Select value={newConstruction.company_id} onValueChange={(v) => setNewConstruction((p) => ({ ...p, company_id: v }))}><SelectTrigger><SelectValue placeholder="회사 선택" /></SelectTrigger><SelectContent>{scopedCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div><div className="col-span-2 space-y-1"><Label>공사명</Label><Input value={newConstruction.construction_name} onChange={(e) => setNewConstruction((p) => ({ ...p, construction_name: e.target.value }))} /></div><div className="space-y-1"><Label>공사종류</Label><Input value={newConstruction.construction_type} onChange={(e) => setNewConstruction((p) => ({ ...p, construction_type: e.target.value }))} /></div><div className="space-y-1"><Label>공사금액</Label><Input type="number" value={newConstruction.construction_amount} onChange={(e) => setNewConstruction((p) => ({ ...p, construction_amount: e.target.value }))} /></div><div className="space-y-1"><Label>산업안전보건관리비 총액</Label><Input type="number" value={newConstruction.safety_cost_total} onChange={(e) => setNewConstruction((p) => ({ ...p, safety_cost_total: e.target.value }))} /></div><div className="space-y-1"><Label>비고</Label><Input value={newConstruction.notes} onChange={(e) => setNewConstruction((p) => ({ ...p, notes: e.target.value }))} /></div></div><DialogFooter><Button onClick={createConstruction}>등록</Button></DialogFooter></DialogContent></Dialog>
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">{constructions.map((c) => { const selected = c.id === selectedConstructionId; const constructionReports = reports.filter((r) => r.construction_id === c.id && r.status === 'approved'); const total = constructionReports.reduce((sum, r) => sum + Number(r.report_total || 0), 0); const rate = c.safety_cost_total ? Math.round((total / Number(c.safety_cost_total)) * 100) : 0; return <div key={c.id} className={`rounded-lg border p-3 transition-colors ${selected ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/50'}`}><button type="button" onClick={() => setSelectedConstructionId(c.id)} className="w-full text-left"><div className="flex items-start justify-between gap-2"><div><div className="font-medium text-sm">{c.construction_name}</div><div className="text-xs text-muted-foreground mt-1">{companies.find((co) => co.id === c.company_id)?.name || ''}</div></div><Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); openConstructionEditor(c); }} aria-label="공사 정보 수정"><Pencil className="h-3.5 w-3.5" /></Button></div><div className="mt-3 space-y-1"><div className="flex justify-between text-xs"><span>사용률</span><span>{rate}%</span></div><Progress value={Math.min(100, rate)} className="h-2" /></div><div className="grid grid-cols-2 gap-2 mt-3 text-xs"><span>총액 {formatKRW(c.safety_cost_total)}</span><span>잔여 {formatKRW(Number(c.safety_cost_total || 0) - total)}</span></div></button></div>; })}{constructions.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">등록된 공사가 없습니다.</CardContent></Card>}</div>

      <div className="space-y-4">
        {selectedConstruction && <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center justify-between"><span>{selectedConstruction.construction_name}</span>{usageRate < 50 && <Badge variant="secondary" className="gap-1"><AlertTriangle className="h-3 w-3" /> 저사용 경고</Badge>}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-4"><div><p className="text-xs text-muted-foreground">공사금액</p><p className="font-semibold">{formatKRW(selectedConstruction.construction_amount)}</p></div><div><p className="text-xs text-muted-foreground">산업안전보건관리비 총액</p><p className="font-semibold">{formatKRW(selectedConstruction.safety_cost_total)}</p></div><div><p className="text-xs text-muted-foreground">승인 누계</p><p className="font-semibold">{formatKRW(approvedTotal)}</p></div><div><p className="text-xs text-muted-foreground">잔여 금액</p><p className="font-semibold">{formatKRW(Number(selectedConstruction.safety_cost_total || 0) - approvedTotal)}</p></div></CardContent></Card>}

        <Card><CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm">월별 사용내역서</CardTitle><Dialog open={reportOpen} onOpenChange={setReportOpen}><DialogTrigger asChild><Button size="sm" variant="outline" disabled={!selectedConstruction}>월별 작성</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>월별 사용내역서 생성</DialogTitle></DialogHeader><Label>작성월</Label><Input type="month" value={newReportMonth} onChange={(e) => setNewReportMonth(e.target.value)} /><DialogFooter><Button onClick={createReport}>생성</Button></DialogFooter></DialogContent></Dialog></div></CardHeader><CardContent><div className="flex flex-wrap gap-2">{filteredReports.map((r) => <div key={r.id} className={`flex items-center rounded-md border ${r.id === selectedReportId ? 'border-primary bg-primary text-primary-foreground' : 'bg-card'}`}><button type="button" className="px-3 py-1.5 text-sm" onClick={() => setSelectedReportId(r.id)}>{String(r.report_month).slice(0, 7)} <Badge variant="secondary" className="ml-2">{getSafetyCostStatusLabel(r.status)}</Badge></button><Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => openReportEditor(r)} disabled={r.status === 'approved'} aria-label="월별 사용내역서 수정"><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => deleteReport(r)} disabled={r.status === 'approved'} aria-label="월별 사용내역서 삭제"><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div></CardContent></Card>

        {selectedReport && <Tabs defaultValue="items"><TabsList><TabsTrigger value="items">사용 항목</TabsTrigger><TabsTrigger value="ai">AI 자동분석</TabsTrigger><TabsTrigger value="audit">자동검토</TabsTrigger><TabsTrigger value="output">출력/결재</TabsTrigger></TabsList><TabsContent value="items" className="space-y-3"><Card><CardContent className="p-0 overflow-auto"><Table><TableHeader><TableRow><TableHead>분류</TableHead><TableHead>품목</TableHead><TableHead>수량</TableHead><TableHead>단가</TableHead><TableHead>금액</TableHead><TableHead>판정</TableHead><TableHead>법적 근거</TableHead><TableHead>증빙</TableHead></TableRow></TableHeader><TableBody>{filteredItems.map((it) => <TableRow key={it.id}><TableCell className="text-xs">{it.category_name}</TableCell><TableCell><div className="font-medium text-sm">{it.item_name}</div><div className="text-[11px] text-muted-foreground">{it.ai_reason}</div></TableCell><TableCell>{it.quantity} {it.unit}</TableCell><TableCell>{formatKRW(it.unit_price)}</TableCell><TableCell className="font-semibold">{formatKRW(it.amount)}</TableCell><TableCell><Badge variant={statusVariant(it.classification_status) as any}>{statusLabel[it.classification_status] || it.classification_status}</Badge></TableCell><TableCell><Button size="sm" variant="ghost" className="gap-1" onClick={() => setLegalBasisItem(it)}><Eye className="h-3 w-3" /> 열람</Button></TableCell><TableCell><Label className="inline-flex items-center gap-1 cursor-pointer text-xs"><Paperclip className="h-3 w-3" /> {evidence.filter((e) => e.item_id === it.id).length}개<Input type="file" multiple className="hidden" onChange={(e) => handleItemEvidenceUpload(it, e.target.files)} /></Label></TableCell></TableRow>)}{filteredItems.length === 0 && <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">항목이 없습니다. AI 자동분석으로 거래명세서를 분석하세요.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent><TabsContent value="ai" className="space-y-3"><Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" /> 대한민국 산업안전보건법 기준 AI 자동분석</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex gap-2"><Label className="inline-flex items-center gap-2"><Input type="file" accept=".xls,.xlsx,.csv,.txt,.pdf,image/*" onChange={(e) => e.target.files?.[0] && handleDocumentUpload(e.target.files[0])} /><Upload className="h-4 w-4" /></Label></div><Textarea rows={10} value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="거래명세서 텍스트를 붙여넣거나 엑셀/텍스트 파일을 업로드하세요." /><Button onClick={analyzeWithAI} disabled={aiLoading} className="gap-1"><Bot className="h-4 w-4" /> {aiLoading ? '분석 중...' : 'AI 자동분류 및 입력'}</Button><div className="grid gap-2 md:grid-cols-3">{SAFETY_COST_CATEGORIES.slice(0, 9).map((c) => <div key={c.code} className="rounded-md border bg-muted/30 p-2 text-xs"><b>{c.code}. {c.name}</b></div>)}</div></CardContent></Card></TabsContent><TabsContent value="audit" className="space-y-3"><Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> 산업안전보건관리비 자동검토</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-4"><div><p className="text-xs text-muted-foreground">검토 결과</p><Badge variant={approvalReady ? 'default' : 'secondary'}>{approvalReady ? '상신 가능' : '보완 필요'}</Badge></div><div><p className="text-xs text-muted-foreground">검토 필요</p><p className="font-semibold">{compliance.reviewCount}건</p></div><div><p className="text-xs text-muted-foreground">사용 불가 경고</p><p className="font-semibold">{compliance.warningCount}건</p></div><div><p className="text-xs text-muted-foreground">증빙 누락</p><p className="font-semibold">{evidenceMissingCount}건</p></div></div><div className="rounded-md border bg-muted/30 p-3"><div className="flex items-center justify-between gap-2 mb-3"><p className="font-medium flex items-center gap-2"><ListChecks className="h-4 w-4" /> 감사대응 체크리스트</p><Button size="sm" variant="outline" onClick={requestMissingEvidence} disabled={requestingEvidence || evidenceMissingCount === 0} className="gap-1"><Send className="h-4 w-4" /> 증빙누락 자동요청</Button></div><div className="grid gap-2">{auditChecklist.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border bg-card p-2 text-sm"><span className="flex items-center gap-2">{item.ok ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}{item.label}</span><Badge variant={item.ok ? 'default' : 'secondary'}>{item.detail}</Badge></div>)}</div></div></CardContent></Card></TabsContent><TabsContent value="output" className="space-y-3"><Card><CardContent className="pt-6 flex flex-wrap gap-2"><Button variant="outline" onClick={exportExcel} className="gap-1"><FileSpreadsheet className="h-4 w-4" /> 엑셀 출력</Button><Button variant="outline" onClick={exportPDF} className="gap-1"><FileText className="h-4 w-4" /> PDF 출력</Button><Button onClick={submitApproval} disabled={!approvalReady} className="gap-1"><ShieldCheck className="h-4 w-4" /> 결재 상신</Button><Button variant="secondary" onClick={approveReport} disabled={selectedReport.status !== 'submitted'} className="gap-1"><CheckCircle2 className="h-4 w-4" /> 승인 처리</Button></CardContent></Card></TabsContent></Tabs>}
      </div>
    </div>

    <Dialog open={!!legalBasisItem} onOpenChange={(open) => !open && setLegalBasisItem(null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>법적 근거 열람</DialogTitle></DialogHeader>
        {legalBasisItem && <div className="space-y-3 text-sm"><div><p className="text-xs text-muted-foreground">품목</p><p className="font-medium">{legalBasisItem.item_name}</p></div><div><p className="text-xs text-muted-foreground">분류</p><p>{legalBasisItem.category_name || '검토 필요'}</p></div><div><p className="text-xs text-muted-foreground">판정 사유</p><p>{legalBasisItem.ai_reason || '자동 판정 사유가 없습니다.'}</p></div><div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground mb-1">관련 기준</p><p>{legalBasisItem.legal_basis || '건설업 산업안전보건관리비 계상 및 사용기준 확인 필요'}</p></div></div>}
      </DialogContent>
    </Dialog>
    <Dialog open={reportEditOpen} onOpenChange={setReportEditOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>월별 사용내역서 수정</DialogTitle></DialogHeader>
        <div className="space-y-3"><div className="space-y-1"><Label>작성월</Label><Input type="month" value={editingReport.report_month} onChange={(e) => setEditingReport((p) => ({ ...p, report_month: e.target.value }))} /></div><div className="space-y-1"><Label>제목</Label><Input value={editingReport.title} onChange={(e) => setEditingReport((p) => ({ ...p, title: e.target.value }))} /></div></div>
        <DialogFooter><Button variant="outline" onClick={() => setReportEditOpen(false)}>취소</Button><Button onClick={updateReport}>저장</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={constructionEditOpen} onOpenChange={setConstructionEditOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>산업안전보건관리비 공사 정보 수정</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3"><div className="col-span-2 space-y-1"><Label>회사</Label><Select value={editingConstruction.company_id} onValueChange={(v) => setEditingConstruction((p) => ({ ...p, company_id: v }))}><SelectTrigger><SelectValue placeholder="회사 선택" /></SelectTrigger><SelectContent>{scopedCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div><div className="col-span-2 space-y-1"><Label>공사명</Label><Input value={editingConstruction.construction_name} onChange={(e) => setEditingConstruction((p) => ({ ...p, construction_name: e.target.value }))} /></div><div className="space-y-1"><Label>공사종류</Label><Input value={editingConstruction.construction_type} onChange={(e) => setEditingConstruction((p) => ({ ...p, construction_type: e.target.value }))} /></div><div className="space-y-1"><Label>공사금액</Label><Input type="number" value={editingConstruction.construction_amount} onChange={(e) => setEditingConstruction((p) => ({ ...p, construction_amount: e.target.value }))} /></div><div className="space-y-1"><Label>산업안전보건관리비 총액</Label><Input type="number" value={editingConstruction.safety_cost_total} onChange={(e) => setEditingConstruction((p) => ({ ...p, safety_cost_total: e.target.value }))} /></div><div className="space-y-1"><Label>비고</Label><Input value={editingConstruction.notes} onChange={(e) => setEditingConstruction((p) => ({ ...p, notes: e.target.value }))} /></div></div>
        <DialogFooter><Button variant="outline" onClick={() => setConstructionEditOpen(false)}>취소</Button><Button onClick={updateConstruction}>저장</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
};

export default SafetyCost;
