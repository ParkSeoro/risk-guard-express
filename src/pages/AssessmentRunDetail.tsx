import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { validateRiskItemField } from '@/lib/inputValidation';
import { sendNotification } from '@/lib/notificationService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Download, Filter, Search, Copy, Trash2, Printer, FileText, Wand2, ShieldCheck, Send,
  Lock, Users, XCircle, AlertTriangle, CheckCircle2, Upload, RotateCcw, FileWarning, RefreshCw,
  Edit3, Archive,
} from 'lucide-react';
import { calculateRiskGrade, getGradeClassName, GRADES } from '@/lib/riskGrade';
import { generateRiskItems } from '@/lib/riskAutoGen';
import { exportToXLSX, exportToPDF, exportToPDFServer, printRiskAssessment } from '@/lib/exportUtils';
import { validateRiskItems, saveValidationResults, validateImportedItems, type ValidationReport, type ValidationIssue } from '@/lib/validationEngine';
import { generateRemediationActions, applyRemediationActions, buildRemediationSummaryText, executeAutoRemediation, type RemediationAction } from '@/lib/remediationEngine';
import type { Database } from '@/integrations/supabase/types';
import IMESafeInput from '@/components/IMESafeInput';
import { Checkbox } from '@/components/ui/checkbox';
import * as XLSX from 'xlsx';

type RiskItemRow = Database['public']['Tables']['risk_items']['Row'];

// All statuses where editing is allowed (everything except 승인완료 and 폐기)
const EDITABLE_STATUSES = ['작성중', '제출됨', '검증중', '검증대기', '검토대기', '보완요청', '보완중', '반려', '검증완료', '결재진행'];

const STATUS_FLOW = {
  '작성중': { label: '작성중 (Draft)', color: 'bg-muted text-muted-foreground' },
  '제출됨': { label: '제출됨 (Submitted)', color: 'bg-primary/10 text-primary' },
  '검증중': { label: '검증중 (Validating)', color: 'bg-warning/10 text-warning' },
  '보완요청': { label: '보완요청 (Returned)', color: 'bg-warning/10 text-warning' },
  '검증완료': { label: '검증완료 (Validated)', color: 'bg-accent/10 text-accent' },
  '결재진행': { label: '결재진행 (InApproval)', color: 'bg-primary/10 text-primary' },
  '승인완료': { label: '승인완료 (Approved)', color: 'bg-success/10 text-success' },
  '폐기': { label: '폐기 (Archived)', color: 'bg-muted text-muted-foreground' },
};

const AssessmentRunDetail = () => {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { user, profile, isAdmin, roles } = useAuth();
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

  // Auto-gen
  const [showAutoGen, setShowAutoGen] = useState(false);
  const [autoGenProcess, setAutoGenProcess] = useState('');
  const [autoGenTargetCount, setAutoGenTargetCount] = useState(50);
  const [autoGenTags, setAutoGenTags] = useState<string[]>([]);
  const [autoGenLoading, setAutoGenLoading] = useState(false);

  // Validation
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [validationTab, setValidationTab] = useState('summary');

  // Participants dialog
  const [showParticipants, setShowParticipants] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ role: '작성자', user_name: '', company: '' });
  const [userDirectory, setUserDirectory] = useState<{ user_id: string; display_name: string; company: string; position: string }[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [showUserSuggestions, setShowUserSuggestions] = useState(false);

  // Approval
  const [showApproval, setShowApproval] = useState(false);
  const [approvalComment, setApprovalComment] = useState('');

  // Excel upload
  const [showExcelUpload, setShowExcelUpload] = useState(false);
  const [excelData, setExcelData] = useState<Record<string, string>[]>([]);
  const [excelColumnMap, setExcelColumnMap] = useState<Record<string, string>>({});
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelIssues, setExcelIssues] = useState<ValidationIssue[]>([]);
  const [excelStep, setExcelStep] = useState<'upload' | 'map' | 'result'>('upload');

  // Force edit (approved run)
  const [showForceEdit, setShowForceEdit] = useState(false);
  const [forceEditReason, setForceEditReason] = useState('');
  // Archive dialog
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  // Revision dialog
  const [showRevision, setShowRevision] = useState(false);
  // Remediation panel
  const [showRemediation, setShowRemediation] = useState(false);
  const [remediationActions, setRemediationActions] = useState<RemediationAction[]>([]);
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [remediationLoading, setRemediationLoading] = useState(false);
  const [applyAndRevalidate, setApplyAndRevalidate] = useState(true);
  const [autoRemediationLoading, setAutoRemediationLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    const [runRes, itemsRes, partRes, profilesRes] = await Promise.all([
      supabase.from('assessment_runs').select('*').eq('id', runId).single(),
      supabase.from('risk_items').select('*').eq('run_id', runId).order('sort_order'),
      supabase.from('assessment_run_participants').select('*').eq('run_id', runId).order('created_at'),
      supabase.from('profiles').select('user_id, display_name, company, position'),
    ]);
    if (runRes.data) {
      setRun(runRes.data);
      const { data: proj } = await supabase.from('projects').select('*').eq('id', runRes.data.project_id).single();
      setProject(proj);

      // Auto-populate participants from approval route template if none exist
      const currentParticipants = partRes.data || [];
      if (currentParticipants.length === 0 && runRes.data.project_id) {
        const { data: templates } = await supabase
          .from('approval_route_templates' as any)
          .select('*')
          .eq('project_id', runRes.data.project_id)
          .order('is_default', { ascending: false });
        
        if (templates && templates.length > 0) {
          // Find matching template by type, or use default
          const matchingTemplate = (templates as any[]).find((t: any) => t.assessment_type === runRes.data.type) 
            || (templates as any[]).find((t: any) => t.is_default)
            || templates[0];
          
          if (matchingTemplate) {
            const steps = Array.isArray(matchingTemplate.steps) ? matchingTemplate.steps : [];
            if (steps.length > 0) {
              const participantInserts = steps.map((s: any) => ({
                run_id: runId,
                role: s.role,
                user_name: s.name || '',
                company: '',
              }));
              const { data: newParts } = await supabase.from('assessment_run_participants').insert(participantInserts).select();
              if (newParts) {
                setParticipants(newParts);
                setItems(itemsRes.data || []);
                setUserDirectory((profilesRes.data || []) as any);
                setLoading(false);
                return;
              }
            }
          }
        }
      }
    }
    setItems(itemsRes.data || []);
    setParticipants(partRes.data || []);
    setUserDirectory((profilesRes.data || []) as any);
    setLoading(false);
  }, [runId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const isApproved = run?.status === '승인완료';
  const isArchived = run?.status === '폐기';
  const isMasterOrCreator = isAdmin() || (user && run?.created_by === user.id);
  // Normal edit: any editable status
  const canEdit = run && EDITABLE_STATUSES.includes(run.status);
  // Force edit for approved runs (master/creator only)
  const canForceEdit = isApproved && isMasterOrCreator;

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
    if (!canEdit && !canForceEdit) { toast({ title: '현재 상태에서는 수정할 수 없습니다.', variant: 'destructive' }); return; }
    const validation = validateRiskItemField(field, value);
    if (!validation.success) { toast({ title: (validation as { success: false; error: string }).error, variant: 'destructive' }); return; }
    const updateData: Record<string, any> = { [field]: validation.data };
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
    if (!run || !user || (!canEdit && !canForceEdit)) return;
    const { data } = await supabase.from('risk_items').insert([{
      project_id: run.project_id, run_id: runId, process: '신규공정', created_by: user.id, sort_order: items.length,
      likelihood_grade: '중', severity_grade: '중', risk_grade: '중',
      improved_likelihood_grade: '하', improved_severity_grade: '하', improved_risk_grade: '하',
    }]).select().single();
    if (data) { setItems(prev => [...prev, data]); toast({ title: '새 항목 추가됨' }); }
  };

  const handleDelete = async (id: string) => {
    if (!canEdit && !canForceEdit) return;
    await supabase.from('risk_items').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleDuplicate = async (item: RiskItemRow) => {
    if (!user || (!canEdit && !canForceEdit)) return;
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

  // Validation (supports re-validation)
  const handleValidate = async () => {
    if (!run || !user) return;
    try {
      await supabase.from('assessment_runs').update({ status: '검증중' }).eq('id', runId);
      setRun((prev: any) => ({ ...prev, status: '검증중' }));
      
      // Re-fetch items to get latest data
      const { data: freshItems } = await supabase.from('risk_items').select('*').eq('run_id', runId).order('sort_order');
      const currentItems = freshItems || items;
      if (freshItems) setItems(freshItems);

      const report = await validateRiskItems(currentItems, run.project_id);
      setValidationReport(report);
      setShowValidation(true);
      setValidationTab('summary');
      await saveValidationResults(report, run.project_id, user.id, runId);

      // Status transition based on verdict
      let newStatus: string;
      if (report.verdict === '적정') {
        newStatus = '검증완료';
      } else if (report.verdict === '조건부 적정') {
        newStatus = '검증완료'; // 조건부도 결재 가능
      } else {
        newStatus = '보완요청'; // 부적정 → 보완요청
      }

      await supabase.from('assessment_runs').update({
        status: newStatus, validation_score: report.score, validation_verdict: report.verdict,
      }).eq('id', runId);
      setRun((prev: any) => ({ ...prev, status: newStatus, validation_score: report.score, validation_verdict: report.verdict }));
      toast({ title: `검증 완료: ${report.verdict} (${report.score}점)${newStatus === '검증완료' ? ' → 결재 상신 가능' : ' → 보완 필요'}` });
      log('검증실행', 'assessment_run', runId!, run.project_id, { score: report.score, verdict: report.verdict });
    } catch { toast({ title: '검증 실패', variant: 'destructive' }); }
  };

  // Submit for validation (Draft → Submitted)
  const handleSubmit = async () => {
    await supabase.from('assessment_runs').update({ status: '제출됨' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '제출됨' }));
    toast({ title: '제출됨 상태로 전환되었습니다.' });
    log('제출', 'assessment_run', runId!, run?.project_id);
  };

  // Submit for approval (Validated → InApproval) — also handles resubmission
  const handleSubmitForApproval = async () => {
    if (!run || !user || !profile) return;
    if (items.length === 0) {
      toast({ title: '항목이 1건 이상 있어야 결재 상신이 가능합니다.', variant: 'destructive' }); return;
    }
    if (!['검증완료', '보완요청', '보완중', '반려'].includes(run.status)) {
      toast({ title: '검증 완료 후에만 결재 상신이 가능합니다.', variant: 'destructive' }); return;
    }
    if (run.validation_verdict === '부적정') {
      toast({ title: '부적정 판정 시 결재 상신이 불가합니다. 보완 후 재검증하세요.', variant: 'destructive' }); return;
    }

    // Resolve participants to user_ids for approval routing
    const reviewerParticipants = participants.filter(p => p.role === '검토자');
    const approverParticipants = participants.filter(p => p.role === '승인자');

    if (reviewerParticipants.length === 0 || approverParticipants.length === 0) {
      toast({ title: '검토자와 승인자를 모두 지정해야 결재 상신이 가능합니다.', description: '참여자 관리에서 검토자/승인자를 추가하세요.', variant: 'destructive' });
      setShowParticipants(true);
      return;
    }

    // Resolve participant names to user_ids from directory
    const resolveUserId = (name: string) => {
      const match = userDirectory.find(u => u.display_name === name);
      return match?.user_id || null;
    };

    const firstReviewer = reviewerParticipants[0];
    const firstApprover = approverParticipants[0];
    const reviewerId = resolveUserId(firstReviewer.user_name);
    const approverId = resolveUserId(firstApprover.user_name);

    // Determine approval version: check existing approvals for this run
    const { data: existingApprovals } = await supabase.from('approvals').select('approval_version').eq('run_id', runId).order('approval_version', { ascending: false }).limit(1);
    const nextVersion = ((existingApprovals?.[0]?.approval_version) || 0) + 1;

    // Close any previous pending approvals (mark as '취소' instead of deleting)
    await supabase.from('approvals').update({ status: '취소' }).eq('run_id', runId).eq('status', '대기');

    // Create new approval steps: 작성(auto-approved) → 검토 → 승인
    const inserts = [
      {
        project_id: run.project_id, run_id: runId, step: '작성', status: '승인',
        approver_id: user.id, approver_name: profile.display_name,
        comment: approvalComment, approval_version: nextVersion,
      },
      {
        project_id: run.project_id, run_id: runId, step: '검토', status: '대기',
        approver_id: reviewerId, approver_name: firstReviewer.user_name || '',
        comment: '', approval_version: nextVersion,
      },
      {
        project_id: run.project_id, run_id: runId, step: '승인', status: '대기',
        approver_id: approverId, approver_name: firstApprover.user_name || '',
        comment: '', approval_version: nextVersion,
      },
    ];
    await supabase.from('approvals').insert(inserts);
    await supabase.from('assessment_runs').update({ status: '결재진행' }).eq('id', runId);

    // Send notifications to reviewer and approver
    const isResubmission = nextVersion > 1;
    const notifTitle = isResubmission ? '재결재 요청' : '결재 요청';
    const notifTargets = [
      { userId: reviewerId, name: firstReviewer.user_name, step: '검토' },
      { userId: approverId, name: firstApprover.user_name, step: '승인' },
    ].filter(t => t.userId);

    if (notifTargets.length > 0) {
      const projectName = project?.name || '';
      // Use sendNotification (via edge function → email) instead of direct DB insert
      for (const t of notifTargets) {
        await sendNotification({
          user_id: t.userId!,
          title: notifTitle,
          message: `[${projectName}] [${run.type}] ${run.period_label} 회차의 ${t.step} 결재가 ${isResubmission ? '재' : ''}요청되었습니다. 요청자: ${profile.display_name}${isResubmission ? ` (${nextVersion}차 상신)` : ''}`,
          type: 'approval_request',
          related_id: runId,
          related_type: 'assessment_run',
          project_id: run.project_id,
        });
      }
    }

    setRun((prev: any) => ({ ...prev, status: '결재진행' }));
    setShowApproval(false); setApprovalComment('');
    toast({ title: isResubmission ? `재상신 완료 (${nextVersion}차)` : '결재가 상신되었습니다.' });
    log(isResubmission ? '재상신' : '결재상신', 'assessment_run', runId!, run.project_id, {
      reviewer: firstReviewer.user_name,
      approver: firstApprover.user_name,
      version: nextVersion,
    });
  };

  // Cancel approval
  const handleCancelApproval = async () => {
    if (!run || !user) return;
    // Cancel pending approvals instead of deleting (preserve history)
    await supabase.from('approvals').update({ status: '취소' }).eq('run_id', runId).eq('status', '대기');
    await supabase.from('assessment_runs').update({ status: '검증완료' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '검증완료' }));
    toast({ title: '결재 상신이 취소되었습니다.' });
    log('상신취소', 'assessment_run', runId!, run.project_id);
  };

  // Final approval actions
  const handleFinalApproval = async (action: '승인' | '반려', comment?: string) => {
    if (!run || !user || !profile) return;
    // Get the latest version's pending approvals
    const { data: latestVersionData } = await supabase.from('approvals')
      .select('approval_version').eq('run_id', runId).order('approval_version', { ascending: false }).limit(1);
    const currentVersion = latestVersionData?.[0]?.approval_version || 1;
    
    const { data: pendingApprovals } = await supabase.from('approvals')
      .select('*').eq('run_id', runId).eq('status', '대기').eq('approval_version', currentVersion).order('created_at').limit(1);
    if (!pendingApprovals || pendingApprovals.length === 0) return;
    const ap = pendingApprovals[0];
    await supabase.from('approvals').update({
      status: action, approver_id: user.id, approver_name: profile.display_name,
      comment: comment || '',
    }).eq('id', ap.id);

    if (action === '승인') {
      const { data: allAp } = await supabase.from('approvals').select('*').eq('run_id', runId).eq('approval_version', currentVersion);
      const allApproved = (allAp || []).every((a: any) => a.status === '승인');
      if (allApproved) {
        await supabase.from('assessment_runs').update({ status: '승인완료' }).eq('id', runId);
        await supabase.from('risk_items').update({ is_locked: true }).eq('run_id', runId);
        setRun((prev: any) => ({ ...prev, status: '승인완료' }));
        // Notify author via edge function (sends email)
        const authorStep = (allAp || []).find((a: any) => a.step === '작성');
        if (authorStep?.approver_id) {
          await sendNotification({
            user_id: authorStep.approver_id,
            title: '결재 최종 승인',
            message: `[${run.type}] ${run.period_label} 회차가 최종 승인되었습니다.`,
            type: 'approval_approved',
            related_id: runId,
            related_type: 'assessment_run',
            project_id: run.project_id,
          });
        }
        toast({ title: '최종 승인 완료! 해당 회차가 잠금되었습니다.' });
      } else {
        toast({ title: `${ap.step} 단계가 승인되었습니다.` });
      }
    } else {
      await supabase.from('assessment_runs').update({ status: '보완중' }).eq('id', runId);
      setRun((prev: any) => ({ ...prev, status: '보완중' }));
      // Notify author via edge function (sends email)
      const { data: authorData } = await supabase.from('approvals').select('*').eq('run_id', runId).eq('step', '작성').eq('approval_version', currentVersion).limit(1);
      const authorStep = authorData?.[0];
      if (authorStep?.approver_id) {
        await sendNotification({
          user_id: authorStep.approver_id,
          title: '결재 반려',
          message: `[${run.type}] ${run.period_label} 반려됨. 사유: ${comment || '(없음)'}`,
          type: 'approval_rejected',
          related_id: runId,
          related_type: 'assessment_run',
          project_id: run.project_id,
        });
      }
      toast({ title: '반려되었습니다. 보완 후 재제출하세요.', variant: 'destructive' });
    }
    log(action, 'assessment_run', runId!, run.project_id);
    fetchAll();
  };

  // Resubmit (after rejection/supplement request → back to Submitted for revalidation)
  const handleResubmit = async () => {
    if (!run) return;
    // Don't delete old approvals — they stay as history. New ones will be created on next 결재상신.
    // Cancel any remaining pending approvals
    await supabase.from('approvals').update({ status: '취소' }).eq('run_id', runId).eq('status', '대기');
    await supabase.from('assessment_runs').update({ status: '제출됨' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '제출됨' }));
    toast({ title: '재제출 완료. 재검증을 실행하세요.' });
    log('재제출', 'assessment_run', runId!, run.project_id);
  };

  // Auto-remediation: generate action suggestions
  const handleGenerateRemediation = async () => {
    if (!validationReport || !run) return;
    setRemediationLoading(true);
    try {
      const actions = await generateRemediationActions(items, validationReport, run.project_id);
      setRemediationActions(actions);
      // Auto-select non-user-confirm actions
      setSelectedActionIds(new Set(actions.filter(a => !a.requiresUserConfirm).map(a => a.id)));
      setShowRemediation(true);
    } catch (err) {
      toast({ title: '보완 제안 생성 실패', description: String(err), variant: 'destructive' });
    }
    setRemediationLoading(false);
  };

  // Apply selected remediation actions
  const handleApplyRemediation = async () => {
    if (!run || !user) return;
    const selected = remediationActions.filter(a => selectedActionIds.has(a.id));
    if (selected.length === 0) { toast({ title: '적용할 액션을 선택하세요.', variant: 'destructive' }); return; }
    setRemediationLoading(true);
    try {
      const { appliedCount, newItemCount, summary } = await applyRemediationActions(
        selected, items, runId!, run.project_id, user.id
      );

      // Build summary text for audit
      const summaryText = buildRemediationSummaryText(selected);

      // Log
      log('자동보완적용', 'assessment_run', runId!, run.project_id, {
        appliedCount, newItemCount, actions: selected.map(a => a.actionType), summary,
      });

      // Reload items
      const { data: refreshed } = await supabase.from('risk_items').select('*').eq('run_id', runId).order('sort_order');
      if (refreshed) setItems(refreshed);

      toast({ title: `${appliedCount}건 보완 적용 완료${newItemCount > 0 ? ` (신규 ${newItemCount}건 추가)` : ''}` });
      setShowRemediation(false);

      // Auto re-validate if option is on
      if (applyAndRevalidate) {
        setTimeout(() => handleValidate(), 500);
      }
    } catch (err) {
      toast({ title: '보완 적용 실패', description: String(err), variant: 'destructive' });
    }
    setRemediationLoading(false);
  };

  // Full auto-remediation: analyze → apply all auto actions → revalidate → transition status
  const handleAutoRemediation = async () => {
    if (!run || !user || !validationReport) return;
    setAutoRemediationLoading(true);
    try {
      const result = await executeAutoRemediation(
        items, validationReport, runId!, run.project_id, user.id
      );

      // Refresh items
      const { data: refreshed } = await supabase.from('risk_items').select('*').eq('run_id', runId).order('sort_order');
      if (refreshed) setItems(refreshed);

      // Update local state
      setValidationReport(result.revalidationReport);
      setRun((prev: any) => ({
        ...prev,
        status: result.newStatus,
        validation_score: result.revalidationReport.score,
        validation_verdict: result.revalidationReport.verdict,
      }));

      // Audit log
      log('자동적정전환실행', 'assessment_run', runId!, run.project_id, {
        appliedCount: result.appliedCount,
        newItemCount: result.newItemCount,
        modifiedItemIds: result.modifiedItemIds,
        verdict: result.revalidationReport.verdict,
        score: result.revalidationReport.score,
        statusTransitioned: result.statusTransitioned,
        summary: result.summary,
      });

      if (result.statusTransitioned) {
        toast({
          title: `✅ 자동 보완 완료 → ${result.revalidationReport.verdict} (${result.revalidationReport.score}점)`,
          description: `${result.appliedCount}건 보완 적용. 결재 상신이 가능합니다.`,
        });
      } else {
        toast({
          title: `⚠ 자동 보완 후에도 부적정 (${result.revalidationReport.score}점)`,
          description: `${result.appliedCount}건 적용했으나 ${result.revalidationReport.errors}건의 오류가 남아있습니다. 수동 보완이 필요합니다.`,
          variant: 'destructive',
        });
        setShowValidation(true);
      }
    } catch (err) {
      toast({ title: '자동 보완 실행 실패', description: String(err), variant: 'destructive' });
    }
    setAutoRemediationLoading(false);
  };

  // Force edit on approved run (creates audit log)
  const handleForceEditConfirm = async () => {
    if (!forceEditReason.trim()) { toast({ title: '수정 사유를 입력해주세요.', variant: 'destructive' }); return; }
    // Unlock items
    await supabase.from('risk_items').update({ is_locked: false }).eq('run_id', runId);
    // Set status back to 작성중 with flag
    await supabase.from('assessment_runs').update({ status: '작성중' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '작성중' }));
    // Log
    log('승인후강제수정', 'assessment_run', runId!, run?.project_id, { reason: forceEditReason });
    toast({ title: '승인완료 회차가 수정 모드로 전환되었습니다. 재결재가 필요합니다.' });
    setShowForceEdit(false); setForceEditReason('');
    fetchAll();
  };

  // Create revision (clone approved run)
  const handleCreateRevision = async () => {
    if (!run || !user) return;
    // Create new run as clone
    const { data: newRun } = await supabase.from('assessment_runs').insert([{
      project_id: run.project_id, type: run.type, period_label: `${run.period_label} (개정)`,
      target_processes: run.target_processes, target_contractors: run.target_contractors,
      notes: `${run.period_label} 개정본`, status: '작성중', created_by: user.id,
    }]).select().single();
    if (!newRun) { toast({ title: '개정 회차 생성 실패', variant: 'destructive' }); return; }
    // Clone items
    const cloneItems = items.map((item, i) => {
      const { id, risk, improved_risk, created_at, updated_at, ...rest } = item;
      return { ...rest, run_id: newRun.id, is_locked: false, status: '초안', created_by: user.id, sort_order: i };
    });
    if (cloneItems.length > 0) await supabase.from('risk_items').insert(cloneItems);
    // Clone participants
    if (participants.length > 0) {
      const cloneParts = participants.map(p => ({
        run_id: newRun.id, role: p.role, user_name: p.user_name, company: p.company,
      }));
      await supabase.from('assessment_run_participants').insert(cloneParts);
    }
    log('개정회차생성', 'assessment_run', newRun.id, run.project_id, { source_run_id: runId });
    toast({ title: '개정 회차가 생성되었습니다.' });
    setShowRevision(false);
    navigate(`/assessment-run/${newRun.id}`);
  };

  // Archive (soft delete)
  const handleArchive = async () => {
    if (!archiveReason.trim()) { toast({ title: '삭제 사유를 입력해주세요.', variant: 'destructive' }); return; }
    await supabase.from('assessment_runs').update({ status: '폐기' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '폐기' }));
    log('회차폐기', 'assessment_run', runId!, run?.project_id, { reason: archiveReason });
    toast({ title: '회차가 폐기되었습니다.' });
    setShowArchive(false); setArchiveReason('');
  };

  // Participants
  const handleAddParticipant = async () => {
    if (!runId) return;
    const name = newParticipant.user_name || participantSearch;
    if (!name) return;
    await supabase.from('assessment_run_participants').insert([{ run_id: runId, role: newParticipant.role, user_name: name, company: newParticipant.company }]);
    setNewParticipant({ role: '작성자', user_name: '', company: '' });
    setParticipantSearch('');
    const { data } = await supabase.from('assessment_run_participants').select('*').eq('run_id', runId);
    setParticipants(data || []);
  };

  const handleDeleteParticipant = async (id: string) => {
    await supabase.from('assessment_run_participants').delete().eq('id', id);
    setParticipants(prev => prev.filter(p => p.id !== id));
  };

  // Export helpers
  const buildRiskRows = () => items.map(i => ({
    ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
    existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
    likelihood_grade: i.likelihood_grade || '중', severity_grade: i.severity_grade || '중', risk_grade: i.risk_grade || '중',
    improved_likelihood_grade: i.improved_likelihood_grade || '하', improved_severity_grade: i.improved_severity_grade || '하', improved_risk_grade: i.improved_risk_grade || '하',
    ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
  }));

  const buildProjectInfo = () => ({
    name: project?.name || '', site_name: project?.site_name || '',
    period_start: project?.period_start || '', period_end: project?.period_end || '',
    client: project?.client || '', contractor: project?.contractor || '',
  });

  const handleExportPDF = async () => {
    if (!run) return;
    try {
      await exportToPDFServer(runId!, 'assessment');
      log('PDF다운로드', 'assessment_run', runId!, run.project_id);
      toast({ title: 'PDF가 생성되었습니다. 인쇄 대화상자에서 PDF로 저장하세요.' });
    } catch {
      // Fallback to client-side
      if (!project) return;
      try {
        exportToPDF(buildRiskRows(), buildProjectInfo(), null, participants, { type: run.type, period_label: run.period_label });
        log('PDF다운로드(클라이언트)', 'assessment_run', runId!, run.project_id);
      } catch (err) {
        toast({ title: 'PDF 다운로드 실패', description: String(err), variant: 'destructive' });
      }
    }
  };

  const handleExportValidationPDF = async () => {
    if (!run) return;
    try {
      await exportToPDFServer(runId!, 'validation');
      log('검증PDF다운로드', 'assessment_run', runId!, run.project_id);
      toast({ title: '검증 리포트 PDF가 생성되었습니다.' });
    } catch {
      if (!project || !validationReport) return;
      try {
        exportToPDF(buildRiskRows(), buildProjectInfo(), null, participants, { type: run.type, period_label: run.period_label }, validationReport);
        log('검증PDF다운로드(클라이언트)', 'assessment_run', runId!, run.project_id);
      } catch (err) {
        toast({ title: '검증 리포트 PDF 다운로드 실패', description: String(err), variant: 'destructive' });
      }
    }
  };

  const handleExportXLSX = () => {
    if (!project) return;
    try {
      exportToXLSX(buildRiskRows(), buildProjectInfo(), undefined, participants, { type: run?.type, period_label: run?.period_label });
      log('XLSX다운로드', 'assessment_run', runId!, run?.project_id);
    } catch (err) {
      toast({ title: 'XLSX 다운로드 실패', description: String(err), variant: 'destructive' });
    }
  };

  // Excel upload
  const handleExcelFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
        if (json.length === 0) { toast({ title: '데이터가 없습니다.', variant: 'destructive' }); return; }
        const headers = Object.keys(json[0]);
        setExcelHeaders(headers);
        setExcelData(json);
        const autoMap: Record<string, string> = {};
        const knownMappings: Record<string, string[]> = {
          process: ['공정', 'Process', '공종'],
          sub_task: ['세부작업', 'Sub Task', '세부공종'],
          hazard: ['위험요인', 'Hazard', '유해위험요인'],
          hazard_situation: ['위험발생상황', 'Hazard Situation', '위험상황'],
          existing_measure: ['기존대책', 'Existing Measure', '현재대책'],
          improvement_measure: ['개선대책', 'Improvement', '추가대책'],
          likelihood_grade: ['가능성', 'Likelihood', '빈도'],
          severity_grade: ['중대성', 'Severity', '강도'],
          legal_basis: ['법적근거', 'Legal', '관련법령'],
        };
        for (const [field, aliases] of Object.entries(knownMappings)) {
          const found = headers.find(h => aliases.some(a => h.includes(a)));
          if (found) autoMap[field] = found;
        }
        setExcelColumnMap(autoMap);
        setExcelStep('map');
      } catch {
        toast({ title: '파일 파싱 실패', variant: 'destructive' });
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExcelValidate = () => {
    const mapped = excelData.map(row => {
      const mapped: Record<string, string> = {};
      for (const [field, col] of Object.entries(excelColumnMap)) {
        mapped[field] = row[col] || '';
      }
      return mapped;
    });
    const issues = validateImportedItems(mapped);
    setExcelIssues(issues);
    setExcelStep('result');
    log('엑셀검증', 'assessment_run', runId!, run?.project_id, { rows: excelData.length, issues: issues.length });
  };

  const handleExcelImport = async () => {
    if (!run || !user || !runId) return;
    const inserts = excelData.map((row, i) => {
      const get = (field: string) => row[excelColumnMap[field] || ''] || '';
      const lg = get('likelihood_grade') || '중';
      const sg = get('severity_grade') || '중';
      return {
        project_id: run.project_id, run_id: runId,
        process: get('process') || '미분류', sub_task: get('sub_task'), hazard: get('hazard'),
        hazard_situation: get('hazard_situation'), existing_measure: get('existing_measure'),
        improvement_measure: get('improvement_measure'),
        likelihood_grade: ['상', '중', '하'].includes(lg) ? lg : '중',
        severity_grade: ['상', '중', '하'].includes(sg) ? sg : '중',
        risk_grade: calculateRiskGrade((['상', '중', '하'].includes(lg) ? lg : '중') as '상' | '중' | '하', (['상', '중', '하'].includes(sg) ? sg : '중') as '상' | '중' | '하'),
        improved_likelihood_grade: '하', improved_severity_grade: '하', improved_risk_grade: '하',
        legal_basis: get('legal_basis') ? get('legal_basis').split(',').map(s => s.trim()) : [],
        status: '초안', created_by: user.id, sort_order: items.length + i,
      };
    });
    const { data } = await supabase.from('risk_items').insert(inserts).select();
    if (data) {
      setItems(prev => [...prev, ...data]);
      toast({ title: `${data.length}건 반영 완료` });
      log('엑셀반영', 'assessment_run', runId!, run.project_id, { count: data.length });
    }
    setShowExcelUpload(false); setExcelStep('upload'); setExcelData([]);
  };

  // Components
  const GradeSelect = ({ item, field }: { item: RiskItemRow; field: string }) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    const value = (item as any)[field] || '중';
    const editable = canEdit || canForceEdit;
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
        onClick={() => editable && setEditingCell({ id: item.id, field })}>{value}</span>
    );
  };

  const EditableCell = ({ item, field }: { item: RiskItemRow; field: string }) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    const value = (item as any)[field];
    const editable = canEdit || canForceEdit;
    const itemIssues = validationReport?.itemVerdicts?.[item.id]?.issues?.filter(iss => iss.field === field) || [];
    const hasIssue = itemIssues.length > 0;

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
      <span className={`${editable ? 'cursor-pointer hover:bg-accent/20' : ''} px-1 py-0.5 rounded transition-colors block min-h-[1.5em] ${hasIssue ? 'ring-1 ring-destructive/50 bg-destructive/5' : ''}`}
        onClick={() => editable && setEditingCell({ id: item.id, field })}
        title={hasIssue ? itemIssues.map(i => i.message).join('; ') : undefined}>
        {String(value || '—')}
      </span>
    );
  };

  if (loading) return <div className="py-12 text-center text-muted-foreground">로딩 중...</div>;
  if (!run) return <div className="py-12 text-center text-muted-foreground">회차를 찾을 수 없습니다.</div>;

  // CTA conditions
  const canSubmitForValidation = run.status === '작성중' && items.length > 0;
  const canValidate = ['제출됨', '작성중', '보완요청', '보완중', '검증대기', '반려'].includes(run.status) && isAdmin();
  const hasReviewerAndApprover = participants.some(p => p.role === '검토자') && participants.some(p => p.role === '승인자');
  const canSubmitApproval = ['검증완료', '보완요청', '보완중', '반려'].includes(run.status) && run.validation_verdict !== '부적정' && items.length > 0 && hasReviewerAndApprover;
  const canCancelApproval = run.status === '결재진행' && (isAdmin() || (user && run.created_by === user.id));
  const canResubmit = ['보완요청', '보완중', '반려'].includes(run.status);
  const canAutoRemediate = validationReport && validationReport.verdict !== '적정' && (canEdit || canForceEdit);
  const statusInfo = STATUS_FLOW[run.status as keyof typeof STATUS_FLOW] || { label: run.status, color: '' };

  return (
    <div className="space-y-4 animate-fade-in print:space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/risk-assessment')}>← 목록</Button>
            <Badge variant="outline" className="text-[10px]">{run.type}</Badge>
            <h1 className="text-xl font-bold">{run.period_label || '(기간 미지정)'}</h1>
            <Badge variant="outline" className={`text-[10px] ${statusInfo.color}`}>
              {run.status} {isApproved && <Lock className="h-3 w-3 ml-1 inline" />}
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
        {/* Draft actions */}
        {(canEdit || canForceEdit) && (
          <>
            <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setShowAutoGen(true)}>
              <Wand2 className="h-3.5 w-3.5" /> 공종 자동작성
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleAddNew}>
              <Plus className="h-3.5 w-3.5" /> 행 추가
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setShowExcelUpload(true); setExcelStep('upload'); }}>
              <Upload className="h-3.5 w-3.5" /> 엑셀 업로드
            </Button>
          </>
        )}
        {canSubmitForValidation && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleSubmit}>
            <Send className="h-3.5 w-3.5" /> 제출
          </Button>
        )}
        {canValidate && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleValidate}>
            <ShieldCheck className="h-3.5 w-3.5" /> {validationReport ? '재검증' : '검증 실행'}
          </Button>
        )}
        {canSubmitApproval && (
          hasReviewerAndApprover ? (
            <Button size="sm" className="gap-1.5" onClick={() => setShowApproval(true)}>
              <Send className="h-3.5 w-3.5" /> {['보완요청','보완중','반려'].includes(run.status) ? '재상신' : '결재 상신'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowParticipants(true)}
              title="검토자/승인자를 지정해야 결재 상신이 가능합니다">
              <Send className="h-3.5 w-3.5 text-muted-foreground" /> 결재 상신 (결재자 미지정)
            </Button>
          )
        )}
        {canCancelApproval && (
          <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={handleCancelApproval}>
            <RotateCcw className="h-3.5 w-3.5" /> 상신 취소
          </Button>
        )}
        {canResubmit && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleResubmit}>
            <RefreshCw className="h-3.5 w-3.5" /> 재제출
          </Button>
        )}
        {canAutoRemediate && (
          <>
            <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={handleAutoRemediation} disabled={autoRemediationLoading}>
              <Wand2 className="h-3.5 w-3.5" /> {autoRemediationLoading ? '자동 보완 중...' : '자동 보완 실행'}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-accent" onClick={handleGenerateRemediation} disabled={remediationLoading}>
              <Wand2 className="h-3.5 w-3.5" /> {remediationLoading ? '분석 중...' : '보완 항목 선택'}
            </Button>
          </>
        )}
        {run.status === '결재진행' && (isAdmin() || (user && participants.some(p => ['검토자','승인자'].includes(p.role) && p.user_name === profile?.display_name))) && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="gap-1 text-success" onClick={() => handleFinalApproval('승인')}>
              <CheckCircle2 className="h-3.5 w-3.5" /> 승인
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => handleFinalApproval('반려')}>
              <XCircle className="h-3.5 w-3.5" /> 반려
            </Button>
          </div>
        )}
        {/* Approved run actions */}
        {isApproved && isMasterOrCreator && (
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowRevision(true)}>
              <Copy className="h-3.5 w-3.5" /> 개정 회차 생성
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-warning" onClick={() => setShowForceEdit(true)}>
              <Edit3 className="h-3.5 w-3.5" /> 강제 수정
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => setShowArchive(true)}>
              <Archive className="h-3.5 w-3.5" /> 폐기
            </Button>
          </>
        )}
        {validationReport && (
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setShowValidation(true)}>
            <FileWarning className="h-3.5 w-3.5" /> 검증 결과 보기
          </Button>
        )}
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setShowParticipants(true)}>
          <Users className="h-3.5 w-3.5" /> 참여자
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={printRiskAssessment}><Printer className="h-3.5 w-3.5" /> 인쇄</Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPDF}><FileText className="h-3.5 w-3.5" /> PDF</Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportXLSX}><Download className="h-3.5 w-3.5" /> XLSX</Button>
      </div>

      {/* Status notices */}
      {['보완요청', '보완중', '반려'].includes(run.status) && (
        <Card className="border-warning print:hidden">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">보완 필요:</span>
              <span>지적사항을 수정한 후 재제출 → 재검증 → 재상신하세요.</span>
            </div>
          </CardContent>
        </Card>
      )}
      {isApproved && (
        <Card className="border-success print:hidden">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm text-success">
              <Lock className="h-4 w-4" />
              <span className="font-medium">승인완료:</span>
              <span>이 회차는 최종 승인되어 잠금 상태입니다. {isMasterOrCreator && '작성자/마스터는 강제수정 또는 개정 회차를 생성할 수 있습니다.'}</span>
            </div>
          </CardContent>
        </Card>
      )}
      {isArchived && (
        <Card className="border-muted print:hidden">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Archive className="h-4 w-4" />
              <span>이 회차는 폐기되었습니다.</span>
            </div>
          </CardContent>
        </Card>
      )}

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
                  {validationReport && <th className="w-16 text-center">판정</th>}
                  {(canEdit || canForceEdit) && <th className="w-16 text-center print:hidden">작업</th>}
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr><td colSpan={20} className="text-center py-8 text-muted-foreground">항목이 없습니다.</td></tr>
                ) : filteredItems.map((item, idx) => {
                  const itemVerdict = validationReport?.itemVerdicts?.[item.id];
                  return (
                    <tr key={item.id} className={itemVerdict?.verdict === '부적정' ? 'bg-destructive/5' : itemVerdict?.verdict === '조건부 적정' ? 'bg-warning/5' : ''}>
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
                      <td className="text-xs max-w-[120px] truncate">
                        {(item.ppe || []).join(', ') || '—'}
                        {item.note?.includes('[자동보완]') && (
                          <Badge variant="outline" className="text-[8px] ml-1 bg-accent/10 text-accent border-accent/30">자동보완</Badge>
                        )}
                      </td>
                      <td className="text-xs max-w-[150px] truncate">{(item.legal_basis || []).join(', ') || '—'}</td>
                      <td className="editable whitespace-nowrap"><EditableCell item={item} field="department" /></td>
                      <td className="whitespace-nowrap text-muted-foreground">{item.assignee || '—'}</td>
                      {validationReport && (
                        <td className="text-center">
                          {itemVerdict && (
                            <Badge variant="outline" className={`text-[9px] ${
                              itemVerdict.verdict === '적정' ? 'bg-success/10 text-success' :
                              itemVerdict.verdict === '부적정' ? 'bg-destructive/10 text-destructive' :
                              'bg-warning/10 text-warning'
                            }`}>{itemVerdict.verdict}</Badge>
                          )}
                        </td>
                      )}
                      {(canEdit || canForceEdit) && (
                        <td className="text-center print:hidden">
                          <div className="flex items-center gap-0.5 justify-center">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDuplicate(item)}><Copy className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
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
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>검증 결과 · {run.period_label}</DialogTitle></DialogHeader>
          {validationReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{validationReport.score}</p>
                  <p className="text-xs text-muted-foreground">점수</p>
                </div>
                <div className={`p-3 rounded-lg ${validationReport.verdict === '적정' ? 'bg-success/10' : validationReport.verdict === '조건부 적정' ? 'bg-warning/10' : 'bg-destructive/10'}`}>
                  <p className="text-lg font-bold">{validationReport.verdict}</p>
                  <p className="text-xs text-muted-foreground">판정</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-destructive">{validationReport.errors}</p>
                  <p className="text-xs text-muted-foreground">오류</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-warning">{validationReport.warnings}</p>
                  <p className="text-xs text-muted-foreground">경고</p>
                </div>
              </div>

              <Tabs value={validationTab} onValueChange={setValidationTab}>
                <TabsList className="w-full">
                  <TabsTrigger value="summary" className="flex-1">항목별 판정</TabsTrigger>
                  <TabsTrigger value="issues" className="flex-1">지적사항 전체 ({validationReport.totalIssues})</TabsTrigger>
                  <TabsTrigger value="coverage" className="flex-1">누락 검증 ({validationReport.coverageGaps.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="max-h-60 overflow-y-auto space-y-1">
                  {items.map((item, idx) => {
                    const v = validationReport.itemVerdicts[item.id];
                    if (!v || v.verdict === '적정') return null;
                    return (
                      <div key={item.id} className={`text-xs p-2 rounded border ${v.verdict === '부적정' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className={`text-[9px] ${v.verdict === '부적정' ? 'text-destructive' : 'text-warning'}`}>{v.verdict}</Badge>
                          <span className="font-medium">#{idx + 1} {item.process} – {item.sub_task || ''}</span>
                        </div>
                        {v.issues.map((iss, j) => (
                          <div key={j} className="flex items-start gap-1.5 ml-4 mt-0.5">
                            {iss.severity === 'error' ? <XCircle className="h-3 w-3 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-3 w-3 text-warning mt-0.5 shrink-0" />}
                            <div>
                              <span>{iss.message}</span>
                              {iss.recommendation && <p className="text-muted-foreground italic">→ {iss.recommendation}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {Object.values(validationReport.itemVerdicts).every(v => v.verdict === '적정') && (
                    <p className="text-center text-success py-4 font-medium">✅ 모든 항목 적정</p>
                  )}
                </TabsContent>

                <TabsContent value="issues" className="max-h-60 overflow-y-auto space-y-1">
                  {validationReport.issues.map((issue, i) => {
                    const item = items.find(it => it.id === issue.riskItemId);
                    return (
                      <div key={i} className={`text-xs p-2 rounded flex items-start gap-2 ${issue.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5'}`}>
                        {issue.severity === 'error' ? <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />}
                        <div>
                          <span className="font-medium">{item?.process} – {item?.sub_task || ''}</span>
                          <p className="text-muted-foreground">{issue.message}</p>
                          {issue.recommendation && <p className="text-muted-foreground italic text-[10px]">→ {issue.recommendation}</p>}
                        </div>
                      </div>
                    );
                  })}
                  {validationReport.issues.length === 0 && <p className="text-center text-success py-4 font-medium">✅ 문제 없음</p>}
                </TabsContent>

                <TabsContent value="coverage" className="max-h-60 overflow-y-auto space-y-1">
                  {validationReport.coverageGaps.length === 0 ? (
                    <p className="text-center text-success py-4 font-medium">✅ 누락 없음</p>
                  ) : (
                    validationReport.coverageGaps.map((gap, i) => (
                      <div key={i} className="text-xs p-2 rounded bg-warning/5 flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                        <div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className={`text-[9px] ${gap.severity === '상' ? 'text-destructive' : gap.severity === '중' ? 'text-warning' : 'text-muted-foreground'}`}>{gap.severity}</Badge>
                            <span className="font-medium">{gap.process} – {gap.subTask}</span>
                          </div>
                          <p className="text-muted-foreground">{gap.message}</p>
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>
              </Tabs>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5" onClick={handleExportValidationPDF}>
                  <FileText className="h-3.5 w-3.5" /> 검증 리포트 PDF 다운로드
                </Button>
                {(canEdit || canForceEdit) && validationReport.verdict !== '적정' && (
                  <>
                    <Button className="flex-1 gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => { setShowValidation(false); handleAutoRemediation(); }} disabled={autoRemediationLoading}>
                      <Wand2 className="h-3.5 w-3.5" /> {autoRemediationLoading ? '보완 중...' : '자동 보완 실행'}
                    </Button>
                    <Button variant="outline" className="flex-1 gap-1.5 text-accent" onClick={() => { setShowValidation(false); handleGenerateRemediation(); }} disabled={remediationLoading}>
                      <Wand2 className="h-3.5 w-3.5" /> 보완 항목 선택
                    </Button>
                    <Button variant="outline" className="flex-1 gap-1.5" onClick={() => { setShowValidation(false); }}>
                      수정하러 가기
                    </Button>
                  </>
                )}
              </div>
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
              {participants.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">참여자를 추가하세요. 작성자는 로그인 사용자로 자동 설정됩니다.</p>
              )}
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Select value={newParticipant.role} onValueChange={v => setNewParticipant(p => ({ ...p, role: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['작성자','검토자','승인자','협력사 담당자','안전관리자'].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="relative col-span-2">
                  <Input
                    className="text-xs"
                    placeholder="이름 검색 (자동완성)..."
                    value={participantSearch}
                    onChange={e => {
                      setParticipantSearch(e.target.value);
                      setShowUserSuggestions(true);
                    }}
                    onFocus={() => setShowUserSuggestions(true)}
                  />
                  {showUserSuggestions && participantSearch.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {userDirectory
                        .filter(u => u.display_name.toLowerCase().includes(participantSearch.toLowerCase()))
                        .slice(0, 8)
                        .map(u => (
                          <div
                            key={u.user_id}
                            className="px-3 py-2 text-xs cursor-pointer hover:bg-accent/20 flex items-center justify-between"
                            onClick={() => {
                              setNewParticipant(p => ({ ...p, user_name: u.display_name, company: u.company || '' }));
                              setParticipantSearch(u.display_name);
                              setShowUserSuggestions(false);
                            }}
                          >
                            <span className="font-medium">{u.display_name}</span>
                            <span className="text-muted-foreground">{u.company || ''} {u.position ? `· ${u.position}` : ''}</span>
                          </div>
                        ))}
                      {userDirectory.filter(u => u.display_name.toLowerCase().includes(participantSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">결과 없음 – 직접 입력 후 추가하세요</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                  if (!profile) return;
                  setNewParticipant({ role: '작성자', user_name: profile.display_name, company: profile.company || '' });
                  setParticipantSearch(profile.display_name);
                }}>현재 사용자 자동입력</Button>
                <Button size="sm" className="flex-1" onClick={() => {
                  const name = newParticipant.user_name || participantSearch;
                  if (!name) return;
                  handleAddParticipant();
                  setParticipantSearch('');
                }} disabled={!newParticipant.user_name && !participantSearch}>추가</Button>
              </div>
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
            {run.validation_verdict && (
              <div className={`p-2 rounded text-sm ${run.validation_verdict === '적정' ? 'bg-success/10' : 'bg-warning/10'}`}>
                검증 결과: {run.validation_verdict} ({run.validation_score}점)
              </div>
            )}
            {/* Approval routing info */}
            <div className="space-y-1.5 p-3 bg-muted/50 rounded-md text-xs">
              <p className="font-medium text-sm">결재 라인</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">작성</Badge>
                <span>{profile?.display_name} (자동 승인)</span>
              </div>
              {participants.filter(p => p.role === '검토자').map(p => (
                <div key={p.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">검토</Badge>
                  <span>{p.user_name} {p.company && `(${p.company})`}</span>
                </div>
              ))}
              {participants.filter(p => p.role === '승인자').map(p => (
                <div key={p.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">승인</Badge>
                  <span>{p.user_name} {p.company && `(${p.company})`}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1"><Label>코멘트 (선택)</Label><Textarea value={approvalComment} onChange={e => setApprovalComment(e.target.value)} placeholder="결재 메모..." /></div>
            <Button onClick={handleSubmitForApproval} className="w-full gap-1.5"><Send className="h-3.5 w-3.5" /> 결재 상신</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Force Edit Dialog (Approved Run) */}
      <Dialog open={showForceEdit} onOpenChange={setShowForceEdit}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>승인완료 회차 강제 수정</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-destructive">⚠ 승인완료 회차를 직접 수정하면 재결재가 필요합니다. 감사 로그에 수정 이력이 기록됩니다.</p>
            <div className="space-y-1">
              <Label>수정 사유 (필수)</Label>
              <Textarea value={forceEditReason} onChange={e => setForceEditReason(e.target.value)} placeholder="수정 사유를 입력하세요..." rows={3} />
            </div>
            <Button onClick={handleForceEditConfirm} variant="destructive" className="w-full" disabled={!forceEditReason.trim()}>
              강제 수정 시작
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revision Dialog */}
      <Dialog open={showRevision} onOpenChange={setShowRevision}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>개정 회차 생성</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">현재 승인완료 회차를 복제하여 새 개정본을 생성합니다. 원본은 유지됩니다.</p>
            <p className="text-sm">원본: <strong>[{run.type}] {run.period_label}</strong> ({items.length}건)</p>
            <Button onClick={handleCreateRevision} className="w-full gap-1.5">
              <Copy className="h-3.5 w-3.5" /> 개정 회차 생성
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive Dialog */}
      <Dialog open={showArchive} onOpenChange={setShowArchive}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>회차 폐기 (소프트 삭제)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-destructive">⚠ 폐기된 회차는 목록에서 비활성 표시됩니다. 감사 로그에 기록됩니다.</p>
            <div className="space-y-1">
              <Label>삭제 사유 (필수)</Label>
              <Textarea value={archiveReason} onChange={e => setArchiveReason(e.target.value)} placeholder="삭제 사유를 입력하세요..." rows={3} />
            </div>
            <Button onClick={handleArchive} variant="destructive" className="w-full" disabled={!archiveReason.trim()}>
              폐기 확인
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Excel Upload Dialog */}
      <Dialog open={showExcelUpload} onOpenChange={setShowExcelUpload}>
        <DialogContent className="max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>협력사 엑셀 업로드 검증</DialogTitle></DialogHeader>
          {excelStep === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">협력사가 제공한 위험성평가 엑셀(XLSX/CSV) 파일을 업로드하세요.</p>
              <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFileChange} />
            </div>
          )}
          {excelStep === 'map' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{excelData.length}행 파싱 완료. 컬럼을 매핑하세요.</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'process', label: '공정' }, { key: 'sub_task', label: '세부작업' },
                  { key: 'hazard', label: '위험요인' }, { key: 'hazard_situation', label: '위험발생상황' },
                  { key: 'existing_measure', label: '기존대책' }, { key: 'improvement_measure', label: '개선대책' },
                  { key: 'likelihood_grade', label: '가능성' }, { key: 'severity_grade', label: '중대성' },
                  { key: 'legal_basis', label: '법적근거' },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs w-20 shrink-0">{label}</span>
                    <Select value={excelColumnMap[key] || '__none__'} onValueChange={v => setExcelColumnMap(prev => ({ ...prev, [key]: v === '__none__' ? '' : v }))}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">(없음)</SelectItem>
                        {excelHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleExcelValidate}>검증만 수행</Button>
                <Button className="flex-1" onClick={() => { handleExcelValidate(); }}>검증 후 반영 준비</Button>
              </div>
            </div>
          )}
          {excelStep === 'result' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xl font-bold">{excelData.length}</p>
                  <p className="text-xs text-muted-foreground">총 행수</p>
                </div>
                <div className={`p-3 rounded-lg ${excelIssues.length === 0 ? 'bg-success/10' : 'bg-warning/10'}`}>
                  <p className="text-xl font-bold">{excelIssues.length}</p>
                  <p className="text-xs text-muted-foreground">지적사항</p>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {excelIssues.map((iss, i) => (
                  <div key={i} className={`text-xs p-2 rounded ${iss.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5'}`}>
                    {iss.severity === 'error' ? <XCircle className="h-3 w-3 text-destructive inline mr-1" /> : <AlertTriangle className="h-3 w-3 text-warning inline mr-1" />}
                    {iss.message}
                  </div>
                ))}
                {excelIssues.length === 0 && <p className="text-center text-success py-3">✅ 문제 없음</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowExcelUpload(false)}>닫기 (검증만)</Button>
                <Button className="flex-1 gap-1.5" onClick={handleExcelImport}>
                  <Upload className="h-3.5 w-3.5" /> 회차에 반영 ({excelData.length}건)
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Remediation Panel Dialog */}
      <Dialog open={showRemediation} onOpenChange={setShowRemediation}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-accent" /> 자동 보완 제안 · {remediationActions.length}건
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3 text-center text-xs">
              <div className="p-2 bg-muted rounded">
                <p className="text-lg font-bold">{remediationActions.length}</p>
                <p className="text-muted-foreground">전체 액션</p>
              </div>
              <div className="p-2 bg-accent/10 rounded">
                <p className="text-lg font-bold">{selectedActionIds.size}</p>
                <p className="text-muted-foreground">선택됨</p>
              </div>
              <div className="p-2 bg-muted rounded">
                <p className="text-lg font-bold">{remediationActions.filter(a => a.requiresUserConfirm).length}</p>
                <p className="text-muted-foreground">수동 확인 필요</p>
              </div>
              <div className="p-2 bg-muted rounded">
                <p className="text-lg font-bold">{remediationActions.filter(a => a.confidence === 'high').length}</p>
                <p className="text-muted-foreground">높은 신뢰도</p>
              </div>
            </div>

            {/* Select all / deselect */}
            <div className="flex items-center gap-3 text-xs">
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedActionIds(new Set(remediationActions.map(a => a.id)))}>전체 선택</Button>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedActionIds(new Set())}>전체 해제</Button>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedActionIds(new Set(remediationActions.filter(a => !a.requiresUserConfirm).map(a => a.id)))}>자동 적용 가능만</Button>
              <div className="flex-1" />
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={applyAndRevalidate} onCheckedChange={(c) => setApplyAndRevalidate(!!c)} />
                <span>적용 후 즉시 재검증</span>
              </label>
            </div>

            {/* Action List by Category */}
            {(() => {
              const byCategory = new Map<string, RemediationAction[]>();
              for (const a of remediationActions) {
                if (!byCategory.has(a.category)) byCategory.set(a.category, []);
                byCategory.get(a.category)!.push(a);
              }
              return [...byCategory.entries()].map(([cat, acts]) => (
                <div key={cat} className="space-y-1">
                  <h4 className="text-xs font-bold text-muted-foreground px-1">{cat}</h4>
                  {acts.map(action => {
                    const isSelected = selectedActionIds.has(action.id);
                    const targetItems = action.targetRiskItemIds.map(tid => items.find(i => i.id === tid)).filter(Boolean);
                    return (
                      <div key={action.id}
                        className={`text-xs p-3 rounded border cursor-pointer transition-colors ${
                          isSelected ? 'border-accent/50 bg-accent/5' : 'border-border hover:bg-muted/50'
                        } ${action.requiresUserConfirm ? 'border-l-2 border-l-warning' : ''}`}
                        onClick={() => {
                          setSelectedActionIds(prev => {
                            const next = new Set(prev);
                            if (next.has(action.id)) next.delete(action.id);
                            else next.add(action.id);
                            return next;
                          });
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <Checkbox checked={isSelected} className="mt-0.5" />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{action.label}</span>
                              <Badge variant="outline" className={`text-[9px] ${
                                action.confidence === 'high' ? 'text-success' : action.confidence === 'medium' ? 'text-warning' : 'text-muted-foreground'
                              }`}>{action.confidence === 'high' ? '높음' : action.confidence === 'medium' ? '보통' : '낮음'}</Badge>
                              {action.requiresUserConfirm && <Badge variant="outline" className="text-[9px] text-warning">수동확인</Badge>}
                            </div>
                            <p className="text-muted-foreground">{action.description}</p>
                            <p className="text-muted-foreground italic text-[10px]">사유: {action.rationale}</p>
                            <p className="text-accent text-[10px]">→ 예상 효과: {action.expectedEffect}</p>
                            
                            {/* Patch preview */}
                            {Object.keys(action.patch).length > 0 && (
                              <details className="mt-1">
                                <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">변경 내용 미리보기</summary>
                                <div className="mt-1 p-2 bg-muted/50 rounded text-[10px] space-y-0.5">
                                  {Object.entries(action.patch).map(([field, val]) => (
                                    <div key={field}>
                                      <span className="font-medium">{field}:</span>{' '}
                                      <span className="text-accent">{Array.isArray(val) ? val.join(', ') : String(val).slice(0, 100)}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}

                            {/* New items preview */}
                            {action.newItems && action.newItems.length > 0 && (
                              <details className="mt-1">
                                <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">추가될 항목 ({action.newItems.length}건)</summary>
                                <div className="mt-1 p-2 bg-muted/50 rounded text-[10px] space-y-0.5 max-h-32 overflow-y-auto">
                                  {action.newItems.map((ni, idx) => (
                                    <div key={idx}>#{idx + 1} {ni.process} – {ni.sub_task} – {ni.hazard}</div>
                                  ))}
                                </div>
                              </details>
                            )}

                            {/* Target items */}
                            {targetItems.length > 0 && targetItems.length <= 3 && (
                              <div className="text-[10px] text-muted-foreground">
                                대상: {targetItems.map((ti: any) => `${ti.process}/${ti.sub_task || ''}`).join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ));
            })()}

            {remediationActions.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                <p>추가 보완 제안이 없습니다.</p>
              </div>
            )}

            {/* Apply Button */}
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setShowRemediation(false)}>닫기</Button>
              <Button className="flex-1 gap-1.5" onClick={handleApplyRemediation} disabled={selectedActionIds.size === 0 || remediationLoading}>
                <Wand2 className="h-3.5 w-3.5" />
                {remediationLoading ? '적용 중...' : `선택한 ${selectedActionIds.size}건 보완 적용${applyAndRevalidate ? ' + 재검증' : ''}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AssessmentRunDetail;
