import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Download, Filter, Search, Copy, Trash2, Printer, FileText, Wand2, ShieldCheck, Send, Lock, Users, XCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { calculateRiskGrade, getGradeClassName, GRADES, type RiskGrade } from '@/lib/riskGrade';
import { generateRiskItems } from '@/lib/riskAutoGen';
import { exportToXLSX, exportToPDF, printRiskAssessment } from '@/lib/exportUtils';
import { validateRiskItems, type ValidationReport } from '@/lib/validationEngine';
import type { Database } from '@/integrations/supabase/types';
import IMESafeInput from '@/components/IMESafeInput';

type RiskItemRow = Database['public']['Tables']['risk_items']['Row'];

const statusFlow = ['작성중', '검증대기', '검증완료', '결재진행', '승인완료'];

const AssessmentRunDetail = () => {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { user, profile, isAdmin } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();

  const [run, setRun] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [items, setItems] = useState<RiskItemRow[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [filterRiskGrade, setFilterRiskGrade] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // Auto-gen state
  const [showAutoGen, setShowAutoGen] = useState(false);
  const [autoGenProcess, setAutoGenProcess] = useState('');
  const [autoGenTargetCount, setAutoGenTargetCount] = useState(50);
  const [autoGenTags, setAutoGenTags] = useState<string[]>([]);
  const [autoGenLoading, setAutoGenLoading] = useState(false);

  // Validation
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  // Participants dialog
  const [showParticipants, setShowParticipants] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ role: '작성자', user_name: '', company: '' });

  // Approval dialog
  const [showApproval, setShowApproval] = useState(false);
  const [approvalComment, setApprovalComment] = useState('');

  const fetchAll = async () => {
    if (!runId) return;
    setLoading(true);
    const [runRes, itemsRes, partRes] = await Promise.all([
      supabase.from('assessment_runs').select('*').eq('id', runId).single(),
      supabase.from('risk_items').select('*').eq('run_id', runId).order('sort_order'),
      supabase.from('assessment_run_participants').select('*').eq('run_id', runId).order('created_at'),
    ]);
    if (runRes.data) {
      setRun(runRes.data);
      const { data: proj } = await supabase.from('projects').select('*').eq('id', runRes.data.project_id).single();
      setProject(proj);
    }
    setItems(itemsRes.data || []);
    setParticipants(partRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [runId]);

  const isLocked = run?.status === '승인완료';

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filterRiskGrade !== 'all' && item.risk_grade !== filterRiskGrade) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (item.hazard || '').toLowerCase().includes(term) || (item.sub_task || '').toLowerCase().includes(term) || item.process.toLowerCase().includes(term);
      }
      return true;
    });
  }, [items, filterRiskGrade, searchTerm]);

  const stats = useMemo(() => ({
    total: items.length,
    high: items.filter(i => i.risk_grade === '상').length,
    med: items.filter(i => i.risk_grade === '중').length,
    low: items.filter(i => i.risk_grade === '하').length,
    highRemain: items.filter(i => i.improved_risk_grade === '상').length,
  }), [items]);

  // Cell edit
  const handleCellEdit = async (id: string, field: string, value: any) => {
    if (isLocked) { toast({ title: '승인완료된 회차는 수정할 수 없습니다.', variant: 'destructive' }); return; }
    const updateData: Record<string, any> = { [field]: value };
    if (field === 'likelihood_grade' || field === 'severity_grade') {
      const item = items.find(i => i.id === id);
      if (item) {
        const lg = field === 'likelihood_grade' ? value : item.likelihood_grade || '중';
        const sg = field === 'severity_grade' ? value : item.severity_grade || '중';
        updateData.risk_grade = calculateRiskGrade(lg, sg);
      }
    }
    if (field === 'improved_likelihood_grade' || field === 'improved_severity_grade') {
      const item = items.find(i => i.id === id);
      if (item) {
        const lg = field === 'improved_likelihood_grade' ? value : item.improved_likelihood_grade || '하';
        const sg = field === 'improved_severity_grade' ? value : item.improved_severity_grade || '하';
        updateData.improved_risk_grade = calculateRiskGrade(lg, sg);
      }
    }
    await supabase.from('risk_items').update(updateData).eq('id', id);
    const { data: updated } = await supabase.from('risk_items').select('*').eq('id', id).single();
    if (updated) setItems(prev => prev.map(item => item.id === id ? updated : item));
    setEditingCell(null);
  };

  const handleAddNew = async () => {
    if (!run || !user || isLocked) return;
    const { data } = await supabase.from('risk_items').insert([{
      project_id: run.project_id, run_id: runId, process: '신규공정', created_by: user.id, sort_order: items.length,
      likelihood_grade: '중', severity_grade: '중', risk_grade: '중',
      improved_likelihood_grade: '하', improved_severity_grade: '하', improved_risk_grade: '하',
    }]).select().single();
    if (data) { setItems(prev => [...prev, data]); toast({ title: '새 항목 추가됨' }); }
  };

  const handleDelete = async (id: string) => {
    if (isLocked) return;
    await supabase.from('risk_items').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleDuplicate = async (item: RiskItemRow) => {
    if (!user || isLocked) return;
    const { id, risk, improved_risk, created_at, updated_at, ...rest } = item;
    const { data } = await supabase.from('risk_items').insert([{ ...rest, status: '미착수', created_by: user.id, sort_order: items.length }]).select().single();
    if (data) setItems(prev => [...prev, data]);
  };

  // Auto-generate
  const handleAutoGenerate = async () => {
    if (!autoGenProcess || !run || !user) return;
    setAutoGenLoading(true);
    try {
      const generated = await generateRiskItems({ processName: autoGenProcess, tags: autoGenTags, targetCount: autoGenTargetCount, deduplicate: true });
      if (generated.length === 0) { toast({ title: '해당 공종 템플릿 없음', variant: 'destructive' }); setAutoGenLoading(false); return; }
      const inserts = generated.map((g, i) => ({
        project_id: run.project_id, run_id: runId,
        process: g.process, sub_task: g.sub_task, hazard: g.hazard, hazard_situation: g.hazard_situation,
        existing_measure: g.existing_measure, improvement_measure: g.improvement_measure,
        frequency: g.frequency, severity: g.severity, improved_frequency: g.improved_frequency, improved_severity: g.improved_severity,
        likelihood_grade: g.likelihood_grade, severity_grade: g.severity_grade, risk_grade: g.risk_grade,
        improved_likelihood_grade: g.improved_likelihood_grade, improved_severity_grade: g.improved_severity_grade, improved_risk_grade: g.improved_risk_grade,
        status: '초안', ppe: g.ppe, legal_basis: g.legal_basis, department: g.department, assignee: g.assignee,
        created_by: user.id, sort_order: items.length + i,
      }));
      const { data } = await supabase.from('risk_items').insert(inserts).select();
      if (data) { setItems(prev => [...prev, ...data]); toast({ title: `${data.length}건 자동 생성 완료` }); }
      setShowAutoGen(false); setAutoGenProcess(''); setAutoGenTags([]);
    } catch { toast({ title: '자동 생성 실패', variant: 'destructive' }); }
    setAutoGenLoading(false);
  };

  // Validation
  const handleValidate = async () => {
    if (!run || !user) return;
    try {
      const report = await validateRiskItems(items, run.project_id);
      setValidationReport(report);
      setShowValidation(true);
      // Update run
      await supabase.from('assessment_runs').update({
        status: '검증완료', validation_score: report.score, validation_verdict: report.verdict,
      }).eq('id', runId);
      setRun((prev: any) => ({ ...prev, status: '검증완료', validation_score: report.score, validation_verdict: report.verdict }));
      toast({ title: `검증 완료: ${report.verdict} (${report.score}점)` });
    } catch { toast({ title: '검증 실패', variant: 'destructive' }); }
  };

  // Submit for validation
  const handleSubmitForValidation = async () => {
    await supabase.from('assessment_runs').update({ status: '검증대기' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '검증대기' }));
    toast({ title: '검증대기 상태로 전환되었습니다.' });
  };

  // Submit for approval
  const handleSubmitForApproval = async () => {
    if (!run || !user || !profile) return;
    if (run.status !== '검증완료') {
      toast({ title: '검증 완료 후에만 결재 상신이 가능합니다.', variant: 'destructive' });
      return;
    }
    if (run.validation_verdict === '부적정') {
      toast({ title: '부적정 판정 시 결재 상신이 불가합니다. 보완 후 재검증하세요.', variant: 'destructive' });
      return;
    }
    // Create approval records
    const steps = ['작성', '검토', '승인'];
    const inserts = steps.map((step, i) => ({
      project_id: run.project_id, run_id: runId,
      step, status: i === 0 ? '승인' : '대기',
      approver_id: i === 0 ? user.id : null, approver_name: i === 0 ? profile.display_name : '',
      comment: i === 0 ? approvalComment : '',
    }));
    await supabase.from('approvals').insert(inserts);
    await supabase.from('assessment_runs').update({ status: '결재진행' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '결재진행' }));
    setShowApproval(false);
    toast({ title: '결재가 상신되었습니다.' });
    log('결재상신', 'assessment_run', runId!, run.project_id);
  };

  // Final approval
  const handleFinalApproval = async (action: '승인' | '반려') => {
    if (!run || !user || !profile) return;
    const { data: pendingApprovals } = await supabase.from('approvals')
      .select('*').eq('run_id', runId).eq('status', '대기').order('created_at').limit(1);
    if (!pendingApprovals || pendingApprovals.length === 0) return;
    const ap = pendingApprovals[0];
    await supabase.from('approvals').update({
      status: action, approver_id: user.id, approver_name: profile.display_name,
    }).eq('id', ap.id);
    
    if (action === '승인') {
      // Check if all steps are approved
      const { data: allAp } = await supabase.from('approvals').select('*').eq('run_id', runId);
      const allApproved = (allAp || []).every((a: any) => a.status === '승인');
      if (allApproved) {
        await supabase.from('assessment_runs').update({ status: '승인완료' }).eq('id', runId);
        // Lock all items
        await supabase.from('risk_items').update({ is_locked: true }).eq('run_id', runId);
        setRun((prev: any) => ({ ...prev, status: '승인완료' }));
        toast({ title: '최종 승인 완료! 해당 회차가 잠금되었습니다.' });
      } else {
        toast({ title: `${ap.step} 단계가 승인되었습니다.` });
      }
    } else {
      await supabase.from('assessment_runs').update({ status: '작성중' }).eq('id', runId);
      setRun((prev: any) => ({ ...prev, status: '작성중' }));
      toast({ title: '반려되었습니다. 보완 후 재제출하세요.', variant: 'destructive' });
    }
    fetchAll();
  };

  // Participants
  const handleAddParticipant = async () => {
    if (!runId) return;
    await supabase.from('assessment_run_participants').insert([{ run_id: runId, ...newParticipant }]);
    setNewParticipant({ role: '작성자', user_name: '', company: '' });
    const { data } = await supabase.from('assessment_run_participants').select('*').eq('run_id', runId);
    setParticipants(data || []);
  };

  const handleDeleteParticipant = async (id: string) => {
    await supabase.from('assessment_run_participants').delete().eq('id', id);
    setParticipants(prev => prev.filter(p => p.id !== id));
  };

  // Export
  const handleExportPDF = () => {
    if (!project || !run) return;
    exportToPDF(
      items.map(i => ({
        ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
        existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
        likelihood_grade: i.likelihood_grade || '중', severity_grade: i.severity_grade || '중', risk_grade: i.risk_grade || '중',
        improved_likelihood_grade: i.improved_likelihood_grade || '하', improved_severity_grade: i.improved_severity_grade || '하', improved_risk_grade: i.improved_risk_grade || '하',
        ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
      })),
      { ...project, period_start: project.period_start || '', period_end: project.period_end || '', client: project.client || '', contractor: project.contractor || '' },
      null,
      participants,
      { type: run.type, period_label: run.period_label }
    );
  };

  const handleExportXLSX = () => {
    if (!project) return;
    exportToXLSX(
      items.map(i => ({
        ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
        existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
        likelihood_grade: i.likelihood_grade || '중', severity_grade: i.severity_grade || '중', risk_grade: i.risk_grade || '중',
        improved_likelihood_grade: i.improved_likelihood_grade || '하', improved_severity_grade: i.improved_severity_grade || '하', improved_risk_grade: i.improved_risk_grade || '하',
        ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
      })),
      { ...project, period_start: project.period_start || '', period_end: project.period_end || '', client: project.client || '', contractor: project.contractor || '' },
      undefined,
      participants,
      { type: run?.type, period_label: run?.period_label }
    );
  };

  // IMESafeInput is now imported from @/components/IMESafeInput

  const GradeSelect = ({ item, field }: { item: RiskItemRow; field: string }) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    const value = (item as any)[field] || '중';
    if (isEditing) {
      return (
        <Select defaultValue={value} onValueChange={(v) => handleCellEdit(item.id, field, v)}>
          <SelectTrigger className="h-7 text-xs w-14"><SelectValue /></SelectTrigger>
          <SelectContent>{GRADES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    return (
      <span className={`cursor-pointer inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(value)}`}
        onClick={() => !isLocked && setEditingCell({ id: item.id, field })}>{value}</span>
    );
  };

  const EditableCell = ({ item, field }: { item: RiskItemRow; field: string }) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    const value = (item as any)[field];
    if (isEditing) {
      if (field === 'status') {
        return (
          <Select defaultValue={value as string} onValueChange={(v) => handleCellEdit(item.id, field, v)}>
            <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['초안','제출','검토대기','반려','보완중','승인','폐기','미착수','진행','완료'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        );
      }
      return <IMESafeInput defaultValue={value as string || ''} className="h-7 text-xs min-w-[100px]" autoFocus onCommit={(val) => handleCellEdit(item.id, field, val)} />;
    }
    return (
      <span className={`${isLocked ? '' : 'cursor-pointer hover:bg-accent/20'} px-1 py-0.5 rounded transition-colors block min-h-[1.5em]`}
        onClick={() => !isLocked && setEditingCell({ id: item.id, field })}>{String(value || '—')}</span>
    );
  };

  if (loading) return <div className="py-12 text-center text-muted-foreground">로딩 중...</div>;
  if (!run) return <div className="py-12 text-center text-muted-foreground">회차를 찾을 수 없습니다.</div>;

  const canSubmitValidation = run.status === '작성중' && items.length > 0;
  const canValidate = (run.status === '검증대기' || run.status === '작성중') && isAdmin();
  const canSubmitApproval = run.status === '검증완료' && run.validation_verdict !== '부적정';

  return (
    <div className="space-y-4 animate-fade-in print:space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/risk-assessment`)}>← 목록</Button>
            <Badge variant="outline" className="text-[10px]">{run.type}</Badge>
            <h1 className="text-xl font-bold">{run.period_label || '(기간 미지정)'}</h1>
            <Badge variant="outline" className={`text-[10px] ${run.status === '승인완료' ? 'bg-success/10 text-success' : run.status === '결재진행' ? 'bg-primary/10 text-primary' : ''}`}>
              {run.status} {isLocked && <Lock className="h-3 w-3 ml-1 inline" />}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            항목 {stats.total}건 · 상 {stats.high} · 중 {stats.med} · 하 {stats.low}
            {stats.highRemain > 0 && <span className="text-destructive ml-2">· 개선후 상 잔존 {stats.highRemain}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run.validation_score != null && (
            <Badge variant="outline" className="gap-1">검증 {run.validation_verdict} ({run.validation_score}점)</Badge>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 print:hidden flex-wrap">
        {!isLocked && (
          <>
            <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setShowAutoGen(true)}>
              <Wand2 className="h-3.5 w-3.5" /> 공종 자동작성
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleAddNew}>
              <Plus className="h-3.5 w-3.5" /> 행 추가
            </Button>
          </>
        )}
        {canSubmitValidation && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleSubmitForValidation}>
            <Send className="h-3.5 w-3.5" /> 검증 제출
          </Button>
        )}
        {canValidate && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleValidate}>
            <ShieldCheck className="h-3.5 w-3.5" /> 검증 실행
          </Button>
        )}
        {canSubmitApproval && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowApproval(true)}>
            <Send className="h-3.5 w-3.5" /> 결재 상신
          </Button>
        )}
        {run.status === '결재진행' && isAdmin() && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="gap-1 text-success" onClick={() => handleFinalApproval('승인')}>
              <CheckCircle2 className="h-3.5 w-3.5" /> 승인
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => handleFinalApproval('반려')}>
              <XCircle className="h-3.5 w-3.5" /> 반려
            </Button>
          </div>
        )}
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setShowParticipants(true)}>
          <Users className="h-3.5 w-3.5" /> 참여자
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={printRiskAssessment}><Printer className="h-3.5 w-3.5" /> 인쇄</Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPDF}><FileText className="h-3.5 w-3.5" /> PDF</Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportXLSX}><Download className="h-3.5 w-3.5" /> XLSX</Button>
      </div>

      {/* Filters */}
      <Card className="print:hidden">
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={filterRiskGrade} onValueChange={setFilterRiskGrade}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">위험도 전체</SelectItem>
                <SelectItem value="상">상</SelectItem>
                <SelectItem value="중">중</SelectItem>
                <SelectItem value="하">하</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="검색..." className="h-8 pl-8 text-xs" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <span className="text-xs text-muted-foreground">{filteredItems.length}건</span>
          </div>
        </CardContent>
      </Card>

      {/* Risk Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full data-table text-xs">
              <thead>
                <tr>
                  <th className="w-8 text-center">#</th>
                  <th>공정</th><th>세부작업</th><th>위험요인</th><th>위험발생상황</th>
                  <th>기존대책</th><th>개선대책</th>
                  <th className="text-center w-12">가능성</th><th className="text-center w-12">중대성</th><th className="text-center w-12">위험도</th>
                  <th className="text-center w-12">가능성'</th><th className="text-center w-12">중대성'</th><th className="text-center w-12">위험도'</th>
                  <th className="text-center w-16">상태</th>
                  <th>PPE</th><th>법적근거</th><th>부서</th><th>담당</th>
                  {!isLocked && <th className="w-16 text-center print:hidden">작업</th>}
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr><td colSpan={19} className="text-center py-8 text-muted-foreground">항목이 없습니다. '공종 자동작성' 또는 '행 추가'를 사용하세요.</td></tr>
                ) : filteredItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="text-center text-muted-foreground">{idx + 1}</td>
                    <td className="editable whitespace-nowrap"><EditableCell item={item} field="process" /></td>
                    <td className="editable"><EditableCell item={item} field="sub_task" /></td>
                    <td className="editable"><EditableCell item={item} field="hazard" /></td>
                    <td className="editable max-w-[200px]"><EditableCell item={item} field="hazard_situation" /></td>
                    <td className="editable max-w-[180px]"><EditableCell item={item} field="existing_measure" /></td>
                    <td className="editable max-w-[180px]"><EditableCell item={item} field="improvement_measure" /></td>
                    <td className="text-center editable"><GradeSelect item={item} field="likelihood_grade" /></td>
                    <td className="text-center editable"><GradeSelect item={item} field="severity_grade" /></td>
                    <td className="text-center"><span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(item.risk_grade || '중')}`}>{item.risk_grade || '중'}</span></td>
                    <td className="text-center editable"><GradeSelect item={item} field="improved_likelihood_grade" /></td>
                    <td className="text-center editable"><GradeSelect item={item} field="improved_severity_grade" /></td>
                    <td className="text-center"><span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(item.improved_risk_grade || '하')}`}>{item.improved_risk_grade || '하'}</span></td>
                    <td className="text-center editable"><EditableCell item={item} field="status" /></td>
                    <td className="text-xs max-w-[120px] truncate">{(item.ppe || []).join(', ') || '—'}</td>
                    <td className="text-xs max-w-[150px] truncate">{(item.legal_basis || []).join(', ') || '—'}</td>
                    <td className="editable whitespace-nowrap"><EditableCell item={item} field="department" /></td>
                    <td className="whitespace-nowrap text-muted-foreground">{item.assignee || '—'}</td>
                    {!isLocked && (
                      <td className="text-center print:hidden">
                        <div className="flex items-center gap-0.5 justify-center">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDuplicate(item)}><Copy className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Auto Generate Dialog */}
      <Dialog open={showAutoGen} onOpenChange={setShowAutoGen}>
        <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>공종명으로 위험성평가 자동작성</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>공종명 입력</Label>
              <Input value={autoGenProcess} onChange={e => setAutoGenProcess(e.target.value)} placeholder="예: 배관, 용접, 비계, 굴착..." />
            </div>
            <div className="space-y-1.5">
              <Label>환경/장비 태그 (선택)</Label>
              <div className="flex flex-wrap gap-1.5">
                {['고소','야간','밀폐','화기','양중','굴착','전기','분진','소음','고온','해상','화학'].map(tag => (
                  <Badge key={tag} variant={autoGenTags.includes(tag) ? 'default' : 'outline'} className="cursor-pointer text-[11px]"
                    onClick={() => setAutoGenTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}>{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>생성 개수</Label>
              <Select value={String(autoGenTargetCount)} onValueChange={v => setAutoGenTargetCount(Number(v))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[30, 50, 100, 150, 300].map(n => <SelectItem key={n} value={String(n)}>{n}개</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAutoGenerate} disabled={!autoGenProcess || autoGenLoading} className="w-full">
              {autoGenLoading ? '생성 중...' : `${autoGenTargetCount}개 자동 생성`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Validation Report Dialog */}
      <Dialog open={showValidation} onOpenChange={setShowValidation}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>검증 결과 · {run.period_label}</DialogTitle></DialogHeader>
          {validationReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{validationReport.score}</p>
                  <p className="text-xs text-muted-foreground">점수</p>
                </div>
                <div className={`p-3 rounded-lg ${validationReport.verdict === '적정' ? 'bg-success/10' : validationReport.verdict === '조건부 적정' ? 'bg-warning/10' : 'bg-destructive/10'}`}>
                  <p className="text-lg font-bold">{validationReport.verdict}</p>
                  <p className="text-xs text-muted-foreground">판정</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{validationReport.totalIssues}</p>
                  <p className="text-xs text-muted-foreground">지적사항</p>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1">
                {validationReport.issues.map((issue, i) => {
                  const item = items.find(it => it.id === issue.riskItemId);
                  return (
                    <div key={i} className={`text-xs p-2 rounded flex items-start gap-2 ${issue.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5'}`}>
                      {issue.severity === 'error' ? <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />}
                      <div>
                        <span className="font-medium">{item?.process} – {item?.sub_task || ''}</span>
                        <p className="text-muted-foreground">{issue.message}</p>
                      </div>
                    </div>
                  );
                })}
                {validationReport.issues.length === 0 && <p className="text-center text-success py-4 font-medium">✅ 문제 없음</p>}
              </div>
              <Button variant="outline" className="w-full gap-1.5" onClick={() => {
                exportToPDF(
                  items.map(i => ({
                    ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
                    existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
                    likelihood_grade: i.likelihood_grade || '중', severity_grade: i.severity_grade || '중', risk_grade: i.risk_grade || '중',
                    improved_likelihood_grade: i.improved_likelihood_grade || '하', improved_severity_grade: i.improved_severity_grade || '하', improved_risk_grade: i.improved_risk_grade || '하',
                    ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
                  })),
                  { name: project?.name || '', site_name: project?.site_name || '', period_start: project?.period_start || '', period_end: project?.period_end || '', client: project?.client || '', contractor: project?.contractor || '' },
                  null, participants, { type: run.type, period_label: run.period_label }, validationReport
                );
              }}>
                <FileText className="h-3.5 w-3.5" /> 검증 리포트 PDF 다운로드
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Participants Dialog */}
      <Dialog open={showParticipants} onOpenChange={setShowParticipants}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>참여자 / 서명란 지정</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              {participants.map(p => (
                <div key={p.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                  <div><Badge variant="outline" className="text-[10px] mr-2">{p.role}</Badge>{p.user_name} {p.company && `(${p.company})`}</div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteParticipant(p.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Select value={newParticipant.role} onValueChange={v => setNewParticipant(p => ({ ...p, role: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['작성자','검토자','승인자','협력사 담당자','안전관리자'].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="text-xs" placeholder="성명" value={newParticipant.user_name} onChange={e => setNewParticipant(p => ({ ...p, user_name: e.target.value }))} />
                <Input className="text-xs" placeholder="소속" value={newParticipant.company} onChange={e => setNewParticipant(p => ({ ...p, company: e.target.value }))} />
              </div>
              <Button size="sm" onClick={handleAddParticipant} disabled={!newParticipant.user_name} className="w-full">추가</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approval Dialog */}
      <Dialog open={showApproval} onOpenChange={setShowApproval}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>결재 상신 · {run.period_label}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">이 회차 전체({items.length}건)를 결재 상신합니다.</p>
            <div className="space-y-1"><Label>코멘트 (선택)</Label><Textarea value={approvalComment} onChange={e => setApprovalComment(e.target.value)} placeholder="결재 메모..." /></div>
            <Button onClick={handleSubmitForApproval} className="w-full gap-1.5"><Send className="h-3.5 w-3.5" /> 결재 상신</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AssessmentRunDetail;
