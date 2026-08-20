import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { isForceDesktop } from '@/components/MobileRedirectGuard';
import MobileAssessmentViewer from '@/pages/MobileAssessmentViewer';
import { validateRiskItemField } from '@/lib/inputValidation';
import { sendNotification } from '@/lib/notificationService';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ToastAction } from '@/components/ui/toast';
import {
  Plus, Download, Filter, Search, Copy, Trash2, Printer, FileText, Wand2, ShieldCheck, Send,
  Lock, Users, XCircle, AlertTriangle, CheckCircle2, Upload, RotateCcw, FileWarning, RefreshCw,
  Edit3, Archive, Clock, Pencil, Ban, Camera, Loader2, MoreHorizontal, ChevronDown, ChevronRight,
} from 'lucide-react';
import { calculateRiskGrade, getGradeClassName, GRADES } from '@/lib/riskGrade';
import { uploadAttachmentFile } from '@/lib/compressUploadFile';
import {
  acknowledgeRiskAutoGenJob,
  cancelRiskAutoGenJob,
  clearAutoGenReviewForLockedRun,
  continueRiskAutoGenFill,
  dismissRiskAutoGenReview,
  getRiskAutoGenJob,
  isLockedAssessmentRunStatus,
  isRiskAutoGenRunning,
  recoverRiskAutoGenReview,
  startRiskAutoGenJob,
  subscribeRiskAutoGenJob,
  type RiskAutoGenJobState,
} from '@/lib/riskAutoGenJob';
import {
  isAiPendingRiskItem,
  isAiFailedRiskItem,
  isAiScopeDraftItem,
  isFillableRiskItem,
  fetchRiskRowDetailWithRetry,
} from '@/lib/riskAutoGenAI';
import { enrichLegalBasis } from '@/lib/enrichLegalBasis';
import { Skeleton } from '@/components/ui/skeleton';
import { ConditionTagPicker, SmartEquipmentTagInput, DEFAULT_CONDITION_TAGS, DEFAULT_EQUIPMENT_SUGGESTIONS } from '@/components/assessment/RiskAutoGenFields';
import { exportToXLSX, exportToPDF, exportToPDFServer, printRiskAssessment } from '@/lib/exportUtils';
import { validateRiskItems, saveValidationResults, validateImportedItems, type ValidationReport, type ValidationIssue } from '@/lib/validationEngine';
import { generateRemediationActions, applyRemediationActions, buildRemediationSummaryText, executeAutoRemediation, type RemediationAction } from '@/lib/remediationEngine';
import type { Database } from '@/integrations/supabase/types';
import IMESafeInput from '@/components/IMESafeInput';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { pickProjectMemberRow, resolveAssessmentDocumentCompanies } from '@/lib/companyDocScope';
import FeedbackPanel from '@/components/FeedbackPanel';
import ApprovalLineManager, { type ApprovalLine, type ApprovalLineManagerHandle, type DraftStatusInfo } from '@/components/ApprovalLineManager';
import WorkerParticipationPanel from '@/components/assessment/WorkerParticipationPanel';
import CloneRunDialog from '@/components/assessment-runs/CloneRunDialog';
import EditRunDialog from '@/components/assessment-runs/EditRunDialog';
import { evaluateResidualHigh } from '@/lib/residualRiskGuardrails';
import { buildAssessmentSubmitPreflight, countIncompleteAssessmentItems } from '@/lib/assessmentSubmitPreflight';
import {
  assessmentAuthorSubmitMessage,
  canAssistAssessmentWrite,
  canSubmitAssessmentRun,
  hasAssessmentLegalAuthor,
} from '@/lib/assessmentAuthor';
import AssessmentAuthorPicker from '@/components/assessment-runs/AssessmentAuthorPicker';
import { submitApprovalFromDraft } from '@/lib/approvalPlatform';
import {
  buildAssessmentAssigneeOptions,
  formatAssigneeLabel,
  resolveAuthorCompanyIds,
} from '@/lib/assessmentAssigneePool';
import { ADMIN_PROJECT_ROLES } from '@/lib/permissions';
import {
  canManuallyActOnApprovalStep,
  isSubmitterApprovalStep,
  sequentialDisplayStatus,
  sortStepsByHierarchy,
  validateApprovalLinesSSOT,
} from '@/lib/approvalRules';
import { buildAssessmentSignatureRows } from '@/lib/approvalSignatureRows';
import { jobTitleLabel, localizePersonName } from '@/lib/jobTitleLabel';
import { parseRiskAssessmentExcelFile } from '@/lib/riskExcelImport';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { todayKst } from '@/lib/permitWorkDate';
import {
  isManagedResidualHigh,
  pickPreviousApprovedRun,
  resolveExecutionFeedbackTarget,
  type WeeklyLinkRun,
} from '@/lib/weeklyAssessmentLink';

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
  const [searchParams] = useSearchParams();
  const { user, profile, isAdmin, roles } = useAuth();
  const { userRole, userCompanyId, userCompanyType, userPosition, isMaster, accessibleCompanyIds } = useGlobalProjectAccess();
  const isMobile = useIsMobile();
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
  const hasLoadedRef = useRef(false);

  // Auto-gen
  const [showAutoGen, setShowAutoGen] = useState(false);
  const [autoGenProcesses, setAutoGenProcesses] = useState<string[]>([]);
  const [autoGenProcessInput, setAutoGenProcessInput] = useState('');
  const [autoGenDetailLevel, setAutoGenDetailLevel] = useState<'core' | 'comprehensive'>('core');
  const [autoGenConditionTags, setAutoGenConditionTags] = useState<string[]>([]);
  const [autoGenLoading, setAutoGenLoading] = useState(() => isRiskAutoGenRunning());
  const [autoGenJob, setAutoGenJob] = useState<RiskAutoGenJobState>(() => getRiskAutoGenJob());
  const [autoGenStreamCount, setAutoGenStreamCount] = useState(0);
  const [autoGenPhaseLabel, setAutoGenPhaseLabel] = useState('');
  const autoGenAckRef = useRef<string | null>(null);
  const runStatusRef = useRef<string | null>(null);
  runStatusRef.current = run?.status ?? null;
  const [autoGenConditionText, setAutoGenConditionText] = useState('');
  const [autoGenWorkLocation, setAutoGenWorkLocation] = useState('');
  const [autoGenEquipmentTags, setAutoGenEquipmentTags] = useState<string[]>([]);
  const [autoGenUseAI, setAutoGenUseAI] = useState(true);
  const [environmentTags, setEnvironmentTags] = useState<{ id: string; name: string; category: string }[]>([]);

  // Validation
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [validationTab, setValidationTab] = useState('summary');

  const [newParticipant, setNewParticipant] = useState({ role: '작성자', user_name: '', company: '' });
  const [userDirectory, setUserDirectory] = useState<{ user_id: string; display_name: string; company: string; position: string }[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [showUserSuggestions, setShowUserSuggestions] = useState(false);

  // Approval
  const [showApproval, setShowApproval] = useState(false);
  const [approvalPreflightMeta, setApprovalPreflightMeta] = useState<{
    lineCount: number;
    missingLabels: string[];
    ssotInvalid: string[];
  }>({ lineCount: 0, missingLabels: [], ssotInvalid: [] });
  const [approvalComment, setApprovalComment] = useState('');
  const [latestApprovals, setLatestApprovals] = useState<any[]>([]);
  const [rejectCommentDialog, setRejectCommentDialog] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [approvalLines, setApprovalLines] = useState<ApprovalLine[]>([]);
  const [approvalDraftInfo, setApprovalDraftInfo] = useState<DraftStatusInfo>({
    status: 'none',
    ready: false,
    stepCount: 0,
    errors: [],
    dirty: false,
  });
  const approvalLineRef = useRef<ApprovalLineManagerHandle>(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [showResidualCols, setShowResidualCols] = useState(false);
  const [showCloneRun, setShowCloneRun] = useState(false);
  const [showEditRun, setShowEditRun] = useState(false);
  const [projectCompanies, setProjectCompanies] = useState<{ id: string; name: string; type: string; parent_company_id?: string | null }[]>([]);
  const [creatorCompany, setCreatorCompany] = useState<{
    company_id: string | null;
    company_name: string | null;
    company_type: string | null;
  } | null>(null);

  // Excel upload
  const [showExcelUpload, setShowExcelUpload] = useState(false);
  const [excelData, setExcelData] = useState<Record<string, string>[]>([]);
  const [excelColumnMap, setExcelColumnMap] = useState<Record<string, string>>({});
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelIssues, setExcelIssues] = useState<ValidationIssue[]>([]);
  const [excelStep, setExcelStep] = useState<'upload' | 'map' | 'result'>('upload');
  const [excelParseError, setExcelParseError] = useState<string | null>(null);
  const [excelFileName, setExcelFileName] = useState('');

  // Force edit (approved run)
  const [showForceEdit, setShowForceEdit] = useState(false);
  const [forceEditReason, setForceEditReason] = useState('');
  // Archive dialog
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  // Revision dialog
  const [showRevision, setShowRevision] = useState(false);
  // Remediation wizard (unified)
  const [showRemediationWizard, setShowRemediationWizard] = useState(false);
  const [remediationActions, setRemediationActions] = useState<RemediationAction[]>([]);
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [remediationLoading, setRemediationLoading] = useState(false);
  const [applyAndRevalidate, setApplyAndRevalidate] = useState(true);
  const [remediationStep, setRemediationStep] = useState<1 | 2>(1);

  // Department names for auto-write when an assignee is picked
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [projectMembers, setProjectMembers] = useState<{ user_id: string; real_user_id?: string | null; assignee_name?: string; display_name: string; company: string; company_id: string | null; position: string; role: string; department_id?: string | null; department_name?: string }[]>([]);

  // Exclusion dialog
  const [excludeDialogItem, setExcludeDialogItem] = useState<string | null>(null);
  const [excludeReason, setExcludeReason] = useState('');

  // Batch apply
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [showBatchApply, setShowBatchApply] = useState(false);
  
  // Feedback / Active tab
  const [activeMainTab, setActiveMainTab] = useState<'assessment' | 'execution' | 'forecast'>(() =>
    searchParams.get('tab') === 'feedback' || searchParams.get('tab') === 'execution'
      ? 'execution'
      : searchParams.get('tab') === 'forecast'
        ? 'forecast'
        : 'assessment',
  );

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'feedback' || tab === 'execution') setActiveMainTab('execution');
    else if (tab === 'forecast') setActiveMainTab('forecast');
  }, [searchParams]);
  const [previousFeedback, setPreviousFeedback] = useState<any[]>([]);
  const [previousRun, setPreviousRun] = useState<WeeklyLinkRun | null>(null);
  const [previousItems, setPreviousItems] = useState<RiskItemRow[]>([]);
  const [previousManagedCount, setPreviousManagedCount] = useState(0);
  const [batchDeptId, setBatchDeptId] = useState('');
  const [batchAssigneeUserId, setBatchAssigneeUserId] = useState('');
  const [batchScope, setBatchScope] = useState<'empty' | 'all' | 'selected'>('empty');
  const [batchApplyDept, setBatchApplyDept] = useState(true);
  const [batchApplyAssignee, setBatchApplyAssignee] = useState(true);
  const [batchOverrideManual, setBatchOverrideManual] = useState(false);

  // Worker participation photos
  const [workerPhotoUploading, setWorkerPhotoUploading] = useState(false);

  // Worker opinion / health / accident counts (for approval gate)
  const [participationCounts, setParticipationCounts] = useState({ opinions: 0, healths: 0, accidents: 0, unreviewedHealth: 0, unreviewedAi: 0 });
  const refreshParticipation = useCallback(async () => {
    if (!runId) return;
    const [op, hz, ac, ai] = await Promise.all([
      supabase.from('worker_opinions' as any).select('id', { count: 'exact', head: true }).eq('run_id', runId),
      supabase.from('health_hazards' as any).select('id, is_user_reviewed').eq('run_id', runId),
      supabase.from('assessment_accidents' as any).select('id', { count: 'exact', head: true }).eq('run_id', runId),
      supabase.from('risk_items').select('id, is_user_reviewed, source_type').eq('run_id', runId).eq('source_type', 'ai_opinion'),
    ]);
    const healthRows = (hz.data as any[]) || [];
    const aiRows = (ai.data as any[]) || [];
    setParticipationCounts({
      opinions: op.count || 0,
      healths: healthRows.length,
      accidents: ac.count || 0,
      unreviewedHealth: healthRows.filter(r => !r.is_user_reviewed).length,
      unreviewedAi: aiRows.filter((r: any) => !r.is_user_reviewed).length,
    });
  }, [runId]);
  useEffect(() => { refreshParticipation(); }, [refreshParticipation]);

  const recommendationKey = (item: { process?: string; sub_task?: string; hazard?: string }) =>
    `${item.process || ''}|||${item.sub_task || ''}|||${item.hazard || ''}`;

  const filterDismissedCoverageRecommendations = async (actions: RemediationAction[]) => {
    if (!runId) return actions;

    const { data: dismissed } = await supabase
      .from('dismissed_recommendations')
      .select('gap_key')
      .eq('run_id', runId);

    const dismissedKeys = new Set((dismissed || []).map((d) => d.gap_key));
    if (dismissedKeys.size === 0) return actions;

    const filtered = actions
      .map((action) => {
        if (action.actionType !== 'ACTION_ADD_MISSING_RISK_ITEMS_FROM_LIBRARY' || !action.newItems) {
          return action;
        }

        const visibleNewItems = action.newItems.filter(
          (ni) => !dismissedKeys.has(recommendationKey(ni as any))
        );

        if (visibleNewItems.length === 0) return null;

        return {
          ...action,
          newItems: visibleNewItems,
          label: `누락 항목 추천 (${visibleNewItems.length}건)`,
          description: `커버리지 검증에서 누락된 ${visibleNewItems.length}건의 위험성평가 항목을 라이브러리에서 추천`,
          expectedEffect: `누락 ${visibleNewItems.length}건 보완 (선택 항목만 추가)`,
        };
      })
      .filter((a): a is RemediationAction => a !== null);

    const hasActionable = filtered.some((a) => a.actionType !== 'ACTION_CREATE_REMEDIATION_SUMMARY');
    if (hasActionable) return filtered;

    return filtered.filter((a) => a.actionType !== 'ACTION_CREATE_REMEDIATION_SUMMARY');
  };

  const fetchAll = useCallback(async () => {
    if (!runId) return;
    // First load only — background refresh must not unmount the page/dialogs.
    if (!hasLoadedRef.current) setLoading(true);
    const [runRes, itemsRes, partRes, profilesRes] = await Promise.all([
      supabase.from('assessment_runs').select('*').eq('id', runId).single(),
      supabase.from('risk_items').select('*').eq('run_id', runId).eq('is_deleted', false).order('sort_order'),
      supabase.from('assessment_run_participants').select('*').eq('run_id', runId).order('created_at'),
      supabase.from('profiles').select('user_id, display_name, company, position'),
    ]);
    if (runRes.data) {
      setRun(runRes.data);
      const projectId = runRes.data.project_id;
      const { fetchProjectCompanies } = await import('@/lib/projectCompanies');
      const [projRes, companies, poolRes, envTagsRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        fetchProjectCompanies(projectId),
        supabase.from('project_assignee_pool' as any).select('source, source_id, user_id, display_name, position, company_id, company_name, department_id, department_name').eq('project_id', projectId),
        supabase.from('environment_tags' as any).select('id, name, category').or(`project_id.eq.${projectId},project_id.is.null`).order('sort_order'),
      ]);
      setProject(projRes.data);
      setProjectCompanies(companies as any[]);
      setEnvironmentTags((envTagsRes.data || []) as any);

      const legalAuthorId = runRes.data.author_user_id || runRes.data.created_by;
      const { data: creatorRows } = legalAuthorId
        ? await supabase
            .from('project_members')
            .select('user_id, company_id, role_new, companies:company_id(name, type)')
            .eq('project_id', projectId)
            .eq('user_id', legalAuthorId)
        : { data: [] as any[] };
      const creatorPicked = pickProjectMemberRow((creatorRows || []) as any[]);
      const creatorCo = (creatorPicked as any)?.companies;
      setCreatorCompany(creatorPicked
        ? {
            company_id: (creatorPicked as any).company_id || null,
            company_name: creatorCo?.name || null,
            company_type: creatorCo?.type || null,
          }
        : null);
      const assigneeCompanyIds = resolveAuthorCompanyIds({
        createdBy: legalAuthorId,
        creatorMembers: (creatorRows || []) as any[],
        targetCompanyIds: runRes.data.target_company_ids,
        fallbackCompanyId: userCompanyId,
      });

      let deptRows: any[] = [];
      let companyManagerRows: any[] = [];
      let managerMemberRows: any[] = [];
      if (assigneeCompanyIds.length > 0) {
        const [cdRes, cmRes, pmRes] = await Promise.all([
          supabase
            .from('company_departments' as any)
            .select('id, name, company_id')
            .in('company_id', assigneeCompanyIds)
            .eq('is_deleted', false)
            .order('sort_order', { ascending: true }),
          supabase
            .from('company_managers' as any)
            .select('id, name, user_id, department_id, company_id, position, is_primary')
            .in('company_id', assigneeCompanyIds)
            .eq('is_deleted', false),
          supabase
            .from('project_members')
            .select('user_id, company_id, role_new, position_new')
            .eq('project_id', projectId)
            .in('company_id', assigneeCompanyIds)
            .in('role_new', [...ADMIN_PROJECT_ROLES] as any),
        ]);
        const companyName = new Map(companies.map((c) => [c.id, c.name]));
        deptRows = (cdRes.data || []).map((d: any) => ({
          id: d.id,
          name: assigneeCompanyIds.length > 1 ? `${companyName.get(d.company_id) || ''} · ${d.name}` : d.name,
          company_id: d.company_id,
        }));
        companyManagerRows = (cmRes.data || []) as any[];
        managerMemberRows = (pmRes.data || []) as any[];
      }
      setDepartments(deptRows);

      const companyNameById = new Map(companies.map((c: any) => [c.id, c.name]));
      const poolRows = [
        ...((poolRes.data || []) as any[]),
        ...managerMemberRows.map((m: any) => ({
          source: 'project_member',
          user_id: m.user_id,
          display_name: ((poolRes.data || []) as any[]).find((p: any) => p.user_id === m.user_id)?.display_name || '',
          position: m.position_new || '',
          company_id: m.company_id,
          company_name: companyNameById.get(m.company_id) || '',
          role: m.role_new,
        })),
      ];
      const assigneeOptions = buildAssessmentAssigneeOptions({
        companyIds: assigneeCompanyIds,
        poolRows,
        companyManagers: companyManagerRows,
        companyNameById,
      });
      const membersList = assigneeOptions.map((r) => ({
        user_id: r.key,
        real_user_id: r.user_id,
        assignee_name: r.display_name,
        display_name: formatAssigneeLabel(r.display_name, r.position),
        company: r.company_name || '',
        company_id: r.company_id || null,
        position: r.position,
        role: r.position || 'viewer',
        department_id: r.department_id,
        department_name: r.department_name,
      }));
      setProjectMembers(membersList);
      console.debug('[AssessmentRunDetail] projectMembers built', {
        total: membersList.length,
        withAuthUser: membersList.filter(m => m.real_user_id).length,
        nameOnly: membersList.filter(m => !m.real_user_id).length,
        sample: membersList.slice(0, 5).map(m => ({ name: m.display_name, hasUser: !!m.real_user_id, co: m.company })),
      });

      // Auto-populate participants from approval route template if none exist
      const currentParticipants = partRes.data || [];
      if (currentParticipants.length === 0 && runRes.data.project_id) {
        const { data: templates } = await supabase
          .from('approval_route_templates' as any)
          .select('*')
          .eq('project_id', runRes.data.project_id)
          .is('owner_user_id', null)
          .eq('is_deleted', false)
          .order('is_default', { ascending: false });
        
        if (templates && templates.length > 0) {
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
                hasLoadedRef.current = true;
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

    // Fetch latest approval records (run_id 또는 entity 키 — 둘 다 SSOT)
    if (runId) {
      const { data: byRun } = await supabase.from('approvals')
        .select('*').eq('run_id', runId).order('approval_version', { ascending: false });
      let approvalsData = byRun || [];
      if (approvalsData.length === 0) {
        const { data: byEntity } = await supabase.from('approvals')
          .select('*')
          .eq('entity_type', 'assessment_run')
          .eq('entity_id', runId)
          .order('approval_version', { ascending: false });
        approvalsData = byEntity || [];
      }
      if (approvalsData.length > 0) {
        const maxVersion = approvalsData[0].approval_version || 1;
        const latestVersionApprovals = approvalsData.filter(a => (a.approval_version || 1) === maxVersion);
        setLatestApprovals(latestVersionApprovals);
        // Sync run status from approval records — never overwrite 반려 back to 결재진행
        const activeRows = latestVersionApprovals.filter(a => a.status !== '취소');
        const allApproved = activeRows.length > 0 && activeRows.every(a => a.status === '승인');
        const anyRejected = latestVersionApprovals.some(a => a.status === '반려');
        const anyInFlight = latestVersionApprovals.some(a => a.status === '대기' || a.status === '진행중');
        if (runRes.data) {
          const dbStatus = runRes.data.status as string;
          let expectedStatus = dbStatus;
          if (anyRejected) {
            // RPC SSOT is 반려; keep 보완중/보완요청 if already returned
            expectedStatus = ['보완중', '보완요청', '반려'].includes(dbStatus) ? dbStatus : '반려';
          } else if (allApproved) {
            expectedStatus = '승인완료';
          } else if (anyInFlight) {
            expectedStatus = '결재진행';
          }
          // Do not client-heal 승인완료/폐기 into something else here
          if (dbStatus === '폐기') expectedStatus = '폐기';
          if (expectedStatus !== dbStatus) {
            const { error: syncErr } = await supabase.from('assessment_runs').update({ status: expectedStatus }).eq('id', runId);
            if (!syncErr) {
              setRun((prev: any) => prev ? { ...prev, status: expectedStatus } : prev);
            } else {
              // Still reflect approval-derived status in UI even if write blocked
              setRun((prev: any) => prev ? { ...prev, status: expectedStatus } : prev);
            }
          }
        }
      } else {
        setLatestApprovals([]);
      }
    }

    hasLoadedRef.current = true;
    setLoading(false);
  }, [runId, isMaster, userCompanyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    const loadWeeklyLink = async () => {
      if (!runId || !run?.project_id) return;
      const { data: candidates } = await supabase
        .from('assessment_runs')
        .select('id, project_id, type, status, start_date, end_date, created_at, target_company_ids, period_label, is_deleted, feedback_status')
        .eq('project_id', run.project_id)
        .eq('status', '승인완료')
        .eq('is_deleted', false)
        .neq('id', runId)
        .order('created_at', { ascending: false })
        .limit(80);
      if (cancelled) return;
      const previous = pickPreviousApprovedRun(run as WeeklyLinkRun, (candidates || []) as WeeklyLinkRun[]);
      if (!previous) {
        setPreviousRun(null);
        setPreviousItems([]);
        setPreviousFeedback([]);
        setPreviousManagedCount(0);
        return;
      }
      const [itemsRes, fbRes] = await Promise.all([
        supabase.from('risk_items').select('*').eq('run_id', previous.id).eq('is_deleted', false).order('sort_order'),
        supabase.from('risk_item_feedback' as any).select('*').eq('assessment_run_id', previous.id),
      ]);
      if (cancelled) return;
      const prevItems = (itemsRes.data || []) as RiskItemRow[];
      const prevFb = (fbRes.data || []) as any[];
      setPreviousRun(previous);
      setPreviousItems(prevItems);
      setPreviousManagedCount(prevItems.filter((i) => isManagedResidualHigh(i)).length);
      setPreviousFeedback(prevFb.filter((f) => f.status === '미조치' || f.status === '진행중'));
    };
    void loadWeeklyLink();
    return () => { cancelled = true; };
  }, [runId, run]);

  // 결재 반려/승인 시 작성자 화면이 즉시 작성·재상신 상태로 돌아오도록
  useEffect(() => {
    if (!runId) return;
    const channel = supabase
      .channel(`assessment-run-approval-${runId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'assessment_runs', filter: `id=eq.${runId}` },
        () => { void fetchAll(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'approvals', filter: `run_id=eq.${runId}` },
        () => { void fetchAll(); },
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [runId, fetchAll]);

  // After reload: restore [나머지 채우기] banner if fillable drafts already exist in DB.
  // Locked runs must not resurrect a draft-review job (session leftover or blank-field heuristic).
  useEffect(() => {
    if (!runId || !run?.project_id) return;
    if (isLockedAssessmentRunStatus(run.status)) {
      clearAutoGenReviewForLockedRun(runId, run.status);
      setAutoGenJob(getRiskAutoGenJob());
      return;
    }
    let cancelled = false;
    (async () => {
      const ok = await recoverRiskAutoGenReview(runId, run.project_id);
      if (!cancelled && ok) {
        setAutoGenJob(getRiskAutoGenJob());
      }
    })();
    return () => { cancelled = true; };
  }, [runId, run?.project_id, run?.status]);

  // Toast only after run status is known so an approved lock is not called "draft ready".
  useEffect(() => {
    if (!runId || !run) return;
    if (isLockedAssessmentRunStatus(run.status)) return;
    if (autoGenJob.status !== 'awaiting_review' || autoGenJob.runId !== runId) return;
    if (autoGenAckRef.current === `review:${autoGenJob.startedAt}`) return;
    autoGenAckRef.current = `review:${autoGenJob.startedAt}`;
    toast({
      title: '초안이 준비되었습니다. 공종·세부작업·위험요인을 확인·삭제한 뒤 [나머지 채우기]를 누르세요.',
      description: `${autoGenJob.insertedTotal}행 · 세부작업·위험요인만 생성됨 · 사고사례는 [사고사례 AI 작성]에서 별도`,
    });
  }, [runId, run, autoGenJob.status, autoGenJob.runId, autoGenJob.startedAt, autoGenJob.insertedTotal, toast]);

  // Prevent accidental leave while AI generation is in progress
  useEffect(() => {
    if (!autoGenLoading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '위험성평가 AI 생성이 진행 중입니다. 이 탭을 닫으면 생성이 중단될 수 있습니다.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [autoGenLoading]);

  // Background job: survives dialog close; shows live progress on this page
  useEffect(() => {
    let lastInserted = -1;
    let lastFilled = -1;
    return subscribeRiskAutoGenJob((job) => {
      setAutoGenJob(job);
      const mine = !job.runId || job.runId === runId;
      setAutoGenLoading(job.status === 'running' && mine);
      setAutoGenStreamCount(job.filledTotal ?? job.insertedTotal);
      setAutoGenPhaseLabel(job.currentProcess || job.message || '');

      if (!mine) return;

      // Refresh table as soon as drafts land / rows fill
      if (
        (job.status === 'running' || job.status === 'awaiting_review') &&
        (job.insertedTotal !== lastInserted || job.filledTotal !== lastFilled)
      ) {
        lastInserted = job.insertedTotal;
        lastFilled = job.filledTotal ?? job.insertedTotal;
        fetchAll();
      }

      if (job.status === 'awaiting_review' && autoGenAckRef.current !== `review:${job.startedAt}`) {
        if (isLockedAssessmentRunStatus(runStatusRef.current)) {
          if (job.runId) clearAutoGenReviewForLockedRun(job.runId, runStatusRef.current);
          return;
        }
        if (job.runId === runId) fetchAll();
      }
      if (job.status === 'done' && autoGenAckRef.current !== `done:${job.startedAt}`) {
        autoGenAckRef.current = `done:${job.startedAt}`;
        toast({
          title: '위험성평가 채움이 완료되었습니다. 법적근거·대책을 확인해 주세요.',
          description: `${job.filledTotal ?? job.insertedTotal}건 · 경과 ${job.elapsedSec}초 · 사고사례는 [사고사례 AI 작성]에서 별도`,
        });
        fetchAll();
        acknowledgeRiskAutoGenJob();
      }
      if (job.status === 'partial' && autoGenAckRef.current !== `partial:${job.startedAt}`) {
        autoGenAckRef.current = `partial:${job.startedAt}`;
        toast({
          title: '일부 행 채움이 중단·실패했습니다.',
          description: `채움 ${job.filledTotal ?? 0}행. 실패 행은 [재시도]하거나 다시 [나머지 채우기]하세요.`,
        });
        fetchAll();
        acknowledgeRiskAutoGenJob();
      }
      if (job.status === 'error' && autoGenAckRef.current !== `err:${job.startedAt}`) {
        autoGenAckRef.current = `err:${job.startedAt}`;
        toast({
          title: `자동작성 오류: ${job.error || '자동 생성 실패'}`,
          variant: 'destructive',
        });
        if (job.insertedTotal > 0) fetchAll();
        acknowledgeRiskAutoGenJob();
      }
    });
  }, [runId, toast, fetchAll]);

  // When returning to this tab, refresh items if a job just finished in background
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const job = getRiskAutoGenJob();
      if (job.runId === runId && (job.status === 'done' || job.status === 'running' || job.status === 'awaiting_review')) {
        fetchAll();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [runId, fetchAll]);

  // While draft/fill is running, poll the table so rows appear as soon as they are saved
  useEffect(() => {
    if (!runId) return;
    if (!(autoGenJob.status === 'running' && autoGenJob.runId === runId)) return;
    const t = setInterval(() => { fetchAll(); }, 4000);
    return () => clearInterval(t);
  }, [runId, autoGenJob.status, autoGenJob.runId, fetchAll]);

  // Auto-refresh to sync approval status changes from other pages
  useEffect(() => {
    if (!runId || !run) return;
    if (!['결재진행'].includes(run?.status)) return;
    const interval = setInterval(() => { fetchAll(); }, 15000);
    return () => clearInterval(interval);
  }, [runId, run?.status, fetchAll]);

  const isApproved = run?.status === '승인완료';
  const isArchived = run?.status === '폐기';
  const isMasterOrCreator = !!isAdmin || (user && run?.created_by === user.id);
  const canEdit = run && EDITABLE_STATUSES.includes(run.status);
  const canForceEdit = isApproved && isMasterOrCreator;

  const todayKstValue = useMemo(() => todayKst(), []);
  const executionRun = useMemo(() => {
    if (!run) return null;
    return resolveExecutionFeedbackTarget({
      current: run as WeeklyLinkRun,
      previous: previousRun,
      today: todayKstValue,
    });
  }, [run, previousRun, todayKstValue]);
  const executionIsPrevious = !!(executionRun && previousRun && executionRun.id === previousRun.id);
  const executionApproved = executionRun?.status === '승인완료';
  const executionFeedbackStatus = executionIsPrevious
    ? (previousRun as any)?.feedback_status
    : (run as any)?.feedback_status;

  // Only non-excluded items for display
  const activeItems = useMemo(() => (items || []).filter(i => !(i as any).is_excluded), [items]);
  const excludedItems = useMemo(() => (items || []).filter(i => (i as any).is_excluded), [items]);
  const executionItems = executionIsPrevious ? previousItems : activeItems;
  const forecastItems = useMemo(
    () => activeItems.filter((i) => isManagedResidualHigh(i)),
    [activeItems],
  );

  const filteredItems = useMemo(() => {
    return (activeItems || []).filter(item => {
      if (filterRiskGrade !== 'all' && item.risk_grade !== filterRiskGrade) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (item.hazard || '').toLowerCase().includes(term)
          || (item.sub_task || '').toLowerCase().includes(term)
          || (item.process || '').toLowerCase().includes(term);
      }
      return true;
    });
  }, [activeItems, filterRiskGrade, searchTerm]);

  const stats = useMemo(() => ({
    total: activeItems.length,
    high: (activeItems || []).filter(i => i.risk_grade === '상').length,
    med: (activeItems || []).filter(i => i.risk_grade === '중').length,
    low: (activeItems || []).filter(i => i.risk_grade === '하').length,
    highRemain: (activeItems || []).filter(i => i.improved_risk_grade === '상').length,
    excluded: excludedItems.length,
  }), [activeItems, excludedItems]);

  // Must stay above early returns (React hooks order / error #310)
  const conditionTagSuggestions = useMemo(() => {
    const fromDb = (environmentTags || []).filter(t => t.category === 'environment' || !t.category).map(t => t.name);
    return Array.from(new Set([...DEFAULT_CONDITION_TAGS, ...fromDb]));
  }, [environmentTags]);
  const equipmentSuggestions = useMemo(() => {
    const fromDb = (environmentTags || []).filter(t => t.category === 'equipment').map(t => t.name);
    return Array.from(new Set([...DEFAULT_EQUIPMENT_SUGGESTIONS, ...fromDb]));
  }, [environmentTags]);

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

  // For synthetic `mgr:<id>` keys (org-chart managers without auth user) we
  // must NOT write the key into risk_items.assignee_user_id (uuid column).
  const resolveAssigneeWrite = (key: string | null | undefined, displayName: string) => {
    if (!key || key.startsWith('mgr:')) return { assignee_user_id: null, assignee: displayName };
    return { assignee_user_id: key, assignee: displayName };
  };

  // Assignee: name only. Org-chart department is written automatically when present.
  const handleAssigneeChange = async (itemId: string, userId: string) => {
    if (!canEdit && !canForceEdit) return;
    const member = projectMembers.find(m => m.user_id === userId);
    const updateData: Record<string, any> = resolveAssigneeWrite(userId, member?.assignee_name || member?.display_name || '');
    const deptId = (member as any)?.department_id;
    if (deptId) {
      const dept = departments.find(d => d.id === deptId);
      updateData.responsible_department_id = deptId;
      updateData.department = dept?.name || (member as any).department_name || '';
    }
    await supabase.from('risk_items').update(updateData).eq('id', itemId);
    const { data: updated } = await supabase.from('risk_items').select('*').eq('id', itemId).single();
    if (updated) setItems(prev => prev.map(item => item.id === itemId ? updated : item));
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

  const { softDelete: _softDeleteARD, restore: restoreRiskItem } = useSoftDelete();
  const handleDelete = async (id: string) => {
    if (!canEdit && !canForceEdit) return;
    const snapshot = items.find(i => i.id === id);
    const r = await _softDeleteARD('risk_items', id, {
      label: '위험성평가 항목',
      projectId: run?.project_id,
      promptReason: false,
      reason: '행 삭제',
      quiet: true,
    });
    if (r.ok) {
      setItems(prev => prev.filter(i => i.id !== id));
      setSelectedRowIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({
        title: '행이 삭제되었습니다.',
        action: (
          <ToastAction
            altText="되돌리기"
            onClick={async () => {
              const ok = await restoreRiskItem('risk_items', id, { projectId: run?.project_id, label: '위험성평가 항목' });
              if (ok.ok && snapshot) {
                setItems(prev => prev.some(x => x.id === id) ? prev : [...prev, snapshot].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
              }
            }}
          >
            되돌리기
          </ToastAction>
        ),
      });
    }
  };

  const handleBulkDeleteSelected = async () => {
    if (!canEdit && !canForceEdit) return;
    const ids = [...selectedRowIds];
    if (ids.length === 0) return;
    const snapshots = items.filter(i => ids.includes(i.id));
    const removed = new Set<string>();
    for (const id of ids) {
      const r = await _softDeleteARD('risk_items', id, {
        label: '위험성평가 항목',
        projectId: run?.project_id,
        promptReason: false,
        reason: '선택 행 삭제',
        quiet: true,
      });
      if (r.ok) removed.add(id);
    }
    if (removed.size === 0) return;
    setItems(prev => prev.filter(i => !removed.has(i.id)));
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      for (const id of removed) next.delete(id);
      return next;
    });
    toast({
      title: removed.size === ids.length
        ? `${removed.size}개 행 삭제됨`
        : `${removed.size}/${ids.length}개 행 삭제됨`,
      action: (
        <ToastAction
          altText="되돌리기"
          onClick={async () => {
            for (const id of removed) {
              await restoreRiskItem('risk_items', id, { projectId: run?.project_id, label: '위험성평가 항목' });
            }
            const restored = snapshots.filter(s => removed.has(s.id));
            setItems(prev => {
              const have = new Set(prev.map(p => p.id));
              return [...prev, ...restored.filter(s => !have.has(s.id))]
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            });
          }}
        >
          되돌리기
        </ToastAction>
      ),
    });
  };

  const handleDuplicate = async (item: RiskItemRow) => {
    if (!user || (!canEdit && !canForceEdit)) return;
    const { id, risk, improved_risk, created_at, updated_at, ...rest } = item;
    const { data } = await supabase.from('risk_items').insert([{ ...rest, status: '미착수', created_by: user.id, sort_order: items.length }]).select().single();
    if (data) setItems(prev => [...prev, data]);
  };

  // Exclude item (해당없음 처리)
  const handleExcludeItem = async (itemId: string, reason: string) => {
    if (!user) return;
    await supabase.from('risk_items').update({
      is_excluded: true,
      excluded_reason: reason,
      excluded_at: new Date().toISOString(),
      excluded_by: user.id,
    } as any).eq('id', itemId);
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, is_excluded: true, excluded_reason: reason } as any : i));
    toast({ title: '해당없음 처리 완료', description: '검증 시 누락으로 잡히지 않습니다.' });
    log('해당없음처리', 'risk_item', itemId, run?.project_id, { reason });
    setExcludeDialogItem(null);
    setExcludeReason('');
  };

  // Restore excluded item
  const handleRestoreItem = async (itemId: string) => {
    await supabase.from('risk_items').update({
      is_excluded: false,
      excluded_reason: '',
      excluded_at: null,
      excluded_by: null,
    } as any).eq('id', itemId);
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, is_excluded: false, excluded_reason: '' } as any : i));
    toast({ title: '제외 해제됨' });
  };

  // Auto-generate: background job (survives dialog close) + bulk insert per process
  const handleRetryFailedRow = async (item: any) => {
    if (!run || !user) return;
    const subTask = (item.sub_task || '').trim();
    if (!subTask) {
      toast({ title: '세부작업명이 없어 재시도할 수 없습니다.', variant: 'destructive' });
      return;
    }
    toast({ title: '행 재생성 중…', description: subTask });
    try {
      await supabase
        .from('risk_items')
        .update({ hazard: '…생성중', note: '[AI_PENDING]', hazard_situation: '' })
        .eq('id', item.id);
      setItems((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, hazard: '…생성중', note: '[AI_PENDING]' } as any : r)),
      );

      const detail = await fetchRiskRowDetailWithRetry({
        processName: item.process || run.period_label || '공종',
        subTask,
        projectId: run.project_id,
        detailLevel: 'core',
      });
      const lg = detail.likelihood_grade || '중';
      const sg = detail.severity_grade || '중';
      const ilg = detail.improved_likelihood_grade || '하';
      const isg = detail.improved_severity_grade || '하';
      const legal = await enrichLegalBasis({
        processName: detail.process || item.process || '',
        hazard: detail.hazard,
        hazardSituation: detail.hazard_situation,
        existingMeasure: detail.existing_measure,
        improvementMeasure: detail.improvement_measure,
        existing: detail.legal_basis || [],
      });
      const patch = {
        process: detail.process || item.process,
        sub_task: detail.sub_task || subTask,
        hazard: detail.hazard,
        hazard_situation: detail.hazard_situation,
        existing_measure: detail.existing_measure,
        improvement_measure: detail.improvement_measure,
        frequency: detail.frequency,
        severity: detail.severity,
        improved_frequency: detail.improved_frequency,
        improved_severity: detail.improved_severity,
        likelihood_grade: lg,
        severity_grade: sg,
        risk_grade: detail.risk_grade || calculateRiskGrade(lg as any, sg as any),
        improved_likelihood_grade: ilg,
        improved_severity_grade: isg,
        improved_risk_grade: detail.improved_risk_grade || calculateRiskGrade(ilg as any, isg as any),
        ppe: detail.ppe || [],
        legal_basis: legal,
        note: null,
      };
      const { error } = await supabase.from('risk_items').update(patch).eq('id', item.id);
      if (error) throw error;
      setItems((prev) => prev.map((r) => (r.id === item.id ? { ...r, ...patch } as any : r)));
      toast({ title: '행 재생성 완료', description: subTask });
    } catch (e: any) {
      await supabase
        .from('risk_items')
        .update({
          hazard: 'API 과부하로 생성 지연. [재시도] 버튼을 눌러주세요',
          note: `[AI_ROW_FAILED] ${e?.message || ''}`.slice(0, 240),
        })
        .eq('id', item.id);
      fetchAll();
      toast({
        title: '재시도 실패',
        description: e?.message || '잠시 후 다시 [재시도]를 눌러주세요.',
        variant: 'destructive',
      });
    }
  };

  const handleAutoGenerate = async () => {
    console.log('[AutoGen] handleAutoGenerate start', {
      processTags: autoGenProcesses.length,
      pendingInput: autoGenProcessInput,
      hasRun: !!run,
      hasUser: !!user,
      runId,
      useAI: autoGenUseAI,
      loading: autoGenLoading,
    });

    try {
      // Flush typed-but-not-added process names (Enter/추가 없이 제출하는 UX)
      const pending = autoGenProcessInput
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const processes = [
        ...autoGenProcesses,
        ...pending.filter((p) => !autoGenProcesses.includes(p)),
      ];

      if (processes.length === 0) {
        console.warn('[AutoGen] blocked: empty processes');
        toast({
          title: '자동작성 요청 전 에러 발생: 공종명을 입력하세요.',
          description: '공종명을 입력한 뒤 Enter 또는 [추가]를 누르거나, 입력 후 바로 제출하세요.',
          variant: 'destructive',
        });
        return;
      }
      if (!run) {
        console.warn('[AutoGen] blocked: run missing');
        toast({
          title: '자동작성 요청 전 에러 발생: 회차 정보가 없습니다.',
          description: '페이지를 새로고침 후 다시 시도하세요.',
          variant: 'destructive',
        });
        return;
      }
      if (!user) {
        console.warn('[AutoGen] blocked: user missing');
        toast({
          title: '자동작성 요청 전 에러 발생: 로그인이 필요합니다.',
          description: '세션이 만료되었을 수 있습니다. 다시 로그인해 주세요.',
          variant: 'destructive',
        });
        return;
      }
      if (!runId) {
        console.warn('[AutoGen] blocked: runId missing');
        toast({
          title: '자동작성 요청 전 에러 발생: 회차 ID가 없습니다.',
          variant: 'destructive',
        });
        return;
      }
      if (isRiskAutoGenRunning()) {
        console.warn('[AutoGen] blocked: job already running', getRiskAutoGenJob());
        toast({
          title: '이미 생성이 진행 중입니다.',
          description: '화면 상단 진행 상태를 확인해주세요. 멈춘 경우 페이지를 새로고침하세요.',
        });
        return;
      }

      if (pending.length > 0) {
        setAutoGenProcesses(processes);
        setAutoGenProcessInput('');
      }

      console.log('[AutoGen] calling startRiskAutoGenJob', {
        runId,
        projectId: run.project_id,
        processes,
        useAI: autoGenUseAI,
      });

      const started = startRiskAutoGenJob({
        runId,
        projectId: run.project_id,
        userId: user.id,
        processes,
        useAI: autoGenUseAI,
        detailLevel: autoGenDetailLevel,
        equipmentTags: autoGenEquipmentTags,
        conditionTags: autoGenConditionTags,
        workLocation: autoGenWorkLocation,
        conditionText: autoGenConditionText,
        sortStart: items.length,
        accessibleCompanyIds: accessibleCompanyIds ?? null,
        preferCompanyIds: run.target_company_ids || (userCompanyId ? [userCompanyId] : null),
      });

      if (!started) {
        console.error('[AutoGen] startRiskAutoGenJob returned false');
        toast({
          title: '자동작성 요청 전 에러 발생: 생성 시작에 실패했습니다.',
          description: '다른 생성이 진행 중이거나 공종 목록이 비어 있습니다.',
          variant: 'destructive',
        });
        return;
      }

      setShowAutoGen(false);
      setAutoGenProcesses([]);
      setAutoGenProcessInput('');
      toast({
        title: '위험성평가 초안 생성을 시작했습니다.',
        description: autoGenUseAI
          ? '이전 승인 평가를 먼저 반영하고, 부족분만 AI 초안 → 검수 → [나머지 채우기].'
          : '표준 라이브러리 전용으로 등록합니다.',
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[AutoGen] handleAutoGenerate threw before/during start:', err);
      toast({
        title: `초안 생성 요청 전 에러 발생: ${msg}`,
        variant: 'destructive',
      });
    }
  };

  // Add process tag
  const handleAddProcessTag = () => {
    const trimmed = autoGenProcessInput.trim();
    if (!trimmed) return;
    // Support comma-separated input
    const newTags = trimmed.split(/[,，]/).map(s => s.trim()).filter(s => s && !autoGenProcesses.includes(s));
    if (newTags.length > 0) {
      setAutoGenProcesses(prev => [...prev, ...newTags]);
    }
    setAutoGenProcessInput('');
  };

  // Validation (supports re-validation). Does not mutate run.status — 참고용.
  const handleValidate = async () => {
    if (!run || !user) return;
    try {
      const { data: freshItems } = await supabase.from('risk_items').select('*').eq('run_id', runId).eq('is_deleted', false).order('sort_order');
      const currentItems = (freshItems || items).filter((i: any) => !i.is_excluded);
      if (freshItems) setItems(freshItems);

      const report = await validateRiskItems(currentItems, run.project_id);
      setValidationReport(report);
      setShowValidation(true);
      setValidationTab('summary');
      await saveValidationResults(report, run.project_id, user.id, runId);

      await supabase.from('assessment_runs').update({
        validation_score: report.score, validation_verdict: report.verdict,
      }).eq('id', runId);
      setRun((prev: any) => ({ ...prev, validation_score: report.score, validation_verdict: report.verdict }));
      const verdictLabel = report.verdict === '적정' ? '적정' : report.verdict === '조건부 적정' ? '조건부' : report.verdict === '적정(관리대상)' ? '적정(관리대상)' : '부적정';
      toast({ title: `품질 점검: ${verdictLabel} (${report.score}점)`, description: '참고용입니다. 결재 상신과는 별개입니다.' });
      log('검증실행', 'assessment_run', runId!, run.project_id, { score: report.score, verdict: report.verdict });
    } catch { toast({ title: '점검 실패', variant: 'destructive' }); }
  };

  // Submit for validation (Draft → Submitted)
  const handleSubmit = async () => {
    await supabase.from('assessment_runs').update({ status: '제출됨' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '제출됨' }));
    toast({ title: '제출됨 상태로 전환되었습니다.' });
    log('제출', 'assessment_run', runId!, run?.project_id);
  };

  /** Sort approval rows: step_order first, then hierarchy SSOT (시공→안전→소장→CM→SM) */
  const sortApprovalRows = (rows: any[]) =>
    sortStepsByHierarchy(
      [...rows].sort((a, b) => (a.step_order ?? 99) - (b.step_order ?? 99)),
    );

  const applyApprovalPreflightFromLines = useCallback((linesToUse: ApprovalLine[]) => {
    const missingLabels = (linesToUse || [])
      .filter((l) => !l.user_id || !l.position)
      .map((l) => l.step_label || '단계');
    const ssot = validateApprovalLinesSSOT((linesToUse || []) as any);
    setApprovalPreflightMeta({
      lineCount: (linesToUse || []).length,
      missingLabels,
      ssotInvalid: ssot.ok ? [] : Array.from(new Set(ssot.invalid)),
    });
  }, []);

  const handleApprovalLinesChanged = useCallback((lines: ApprovalLine[]) => {
    setApprovalLines(lines);
    applyApprovalPreflightFromLines(lines);
  }, [applyApprovalPreflightFromLines]);

  const approvalLineMembers = useMemo(
    () => projectMembers
      .filter((m) => m.real_user_id)
      .map((m) => ({
        ...m,
        user_id: m.real_user_id as string,
      })),
    [projectMembers],
  );

  const docCompanies = useMemo(
    () =>
      resolveAssessmentDocumentCompanies({
        authorCompanyId: creatorCompany?.company_id,
        authorCompanyName: creatorCompany?.company_name,
        authorCompanyType: creatorCompany?.company_type,
        companies: projectCompanies,
      }),
    [creatorCompany, projectCompanies],
  );

  const refreshApprovalPreflightMeta = useCallback(async () => {
    if (!run?.project_id) return;
    // Platform draft status is SSOT for approval-line gate; keep meta for display only.
    if (approvalLines.length > 0) {
      applyApprovalPreflightFromLines(approvalLines);
      return;
    }
    applyApprovalPreflightFromLines([]);
  }, [run?.project_id, approvalLines, applyApprovalPreflightFromLines]);

  useEffect(() => {
    if (showApproval) void refreshApprovalPreflightMeta();
  }, [showApproval, refreshApprovalPreflightMeta]);

  const itemGaps = useMemo(() => countIncompleteAssessmentItems(activeItems as any), [activeItems]);

  const submitPreflight = useMemo(() => buildAssessmentSubmitPreflight({
    itemCount: activeItems.length,
    opinionRequired: run?.opinion_required ?? true,
    healthRequired: run?.health_required ?? true,
    opinions: participationCounts.opinions,
    healths: participationCounts.healths,
    unreviewedAi: participationCounts.unreviewedAi,
    unreviewedHealth: participationCounts.unreviewedHealth,
    approvalLineCount: Math.max(approvalDraftInfo.stepCount, approvalLines.length),
    missingApproverLabels: approvalPreflightMeta.missingLabels,
    ssotInvalidKeys: approvalPreflightMeta.ssotInvalid,
    approvalDraftReady: approvalDraftInfo.ready,
    approvalDraftDetail: approvalDraftInfo.dirty
      ? '결재선이 수정됨 — [결재선 저장] 필요'
      : approvalDraftInfo.errors[0]
        || (approvalDraftInfo.ready ? `임시 저장 완료 · ${approvalDraftInfo.stepCount}단계` : '결재선 [저장] 후 상신 가능'),
    authorUserId: run?.author_user_id,
    authorName: userDirectory.find((u) => u.user_id === run?.author_user_id)?.display_name || null,
    currentUserId: user?.id,
    incompleteItemCount: itemGaps.count,
    incompleteItemDetail: itemGaps.detail,
  }), [
    activeItems.length,
    itemGaps,
    run?.opinion_required,
    run?.health_required,
    run?.author_user_id,
    participationCounts,
    approvalPreflightMeta,
    approvalLines.length,
    approvalDraftInfo,
    userDirectory,
    user?.id,
  ]);

  const submitBlockedReason = useMemo(() => {
    const bad = submitPreflight.items.filter((i) => !i.ok);
    if (bad.length === 0) return undefined;
    return bad.map((i) => `${i.label}${i.detail ? ` (${i.detail})` : ''}`).join(' · ');
  }, [submitPreflight]);

  const jumpFromPreflight = (jump?: 'items' | 'participation' | 'approval') => {
    if (!jump) return;
    setShowApproval(false);
    setActiveMainTab('assessment');
    if (jump === 'participation') setEvidenceOpen(true);
    window.setTimeout(() => {
      const id =
        jump === 'participation' ? 'ra-worker-participation'
          : jump === 'approval' ? 'ra-approval-line'
            : 'ra-risk-items';
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  // Submit for approval — 전자결재 플랫폼 draft 만 사용 (설정과 상신 분리)
  const handleSubmitForApproval = async () => {
    if (!run || !user || !profile || !runId) return;
    const authorBlock = assessmentAuthorSubmitMessage({
      authorUserId: run.author_user_id,
      authorName: userDirectory.find((u) => u.user_id === run.author_user_id)?.display_name || null,
      userId: user.id,
    });
    if (authorBlock) {
      toast({ title: '상신 불가', description: authorBlock, variant: 'destructive' });
      return;
    }
    if (approvalDraftInfo.dirty) {
      const saved = await approvalLineRef.current?.saveIfDirty();
      if (!saved) {
        toast({
          title: '결재선을 저장하지 못했습니다.',
          description: '결재자를 확인한 뒤 다시 상신하세요.',
          variant: 'destructive',
        });
        return;
      }
    }
    if (!submitPreflight.ready) {
      toast({
        title: '상신 불가',
        description: submitBlockedReason || '점검 항목을 완료하세요.',
        variant: 'destructive',
      });
      return;
    }
    if (!approvalDraftInfo.ready && !approvalDraftInfo.dirty) {
      toast({
        title: '결재선이 저장되지 않았습니다.',
        description: '본문의 [결재선 설정]에서 [결재선 저장]을 먼저 하세요.',
        variant: 'destructive',
      });
      return;
    }

    const { inserted, error: submitErr } = await submitApprovalFromDraft({
      entityType: 'assessment_run',
      entityId: runId,
      reason: approvalComment || null,
    });
    if (submitErr) {
      const msg = submitErr.includes('draft_not_ready')
        ? '결재선이 상신 가능 상태가 아닙니다. [결재선 저장]을 다시 해주세요.'
        : submitErr.includes('draft_not_found')
          ? '저장된 결재선이 없습니다. 결재선을 설정·저장한 뒤 상신하세요.'
          : submitErr.includes('submit_step_mismatch')
            ? '결재 단계 일부가 누락되어 상신이 취소되었습니다. 결재선을 다시 저장하세요.'
            : submitErr;
      toast({ title: '상신 실패', description: msg, variant: 'destructive' });
      return;
    }

    setRun((prev: any) => ({ ...prev, status: '결재진행' }));
    setShowApproval(false);
    setApprovalComment('');
    setApprovalDraftInfo((prev) => ({ ...prev, status: 'submitted', ready: false, dirty: false }));
    toast({ title: `결재 상신 완료 (${inserted ?? approvalDraftInfo.stepCount}단계 순차 결재)` });
    log('결재상신', 'assessment_run', runId, run.project_id, { steps: inserted, via: 'approval_platform_draft' });
    fetchAll();
  };

  // Cancel approval — withdraw_approval cancels 진행중/대기 + auto-approved 상신
  const handleCancelApproval = async () => {
    if (!run || !user) return;
    const { data, error } = await supabase.rpc('withdraw_approval', {
      _entity_type: 'assessment_run',
      _entity_id: runId,
      _reason: '상신 취소',
    });
    if (error) {
      toast({ title: '상신 취소 실패', description: error.message, variant: 'destructive' });
      return;
    }
    const r = data as any;
    if (r?.error) {
      if (r.error === 'ALREADY_REJECTED') {
        setRun((prev: any) => ({ ...prev, status: '반려' }));
        toast({
          title: '이미 반려된 결재입니다.',
          description: r.message || '문서를 수정한 뒤 재상신하세요.',
          variant: 'destructive',
        });
        fetchAll();
        return;
      }
      const msg =
        r.error === 'ALREADY_DECIDED' ? '이미 결재가 진행된 문서는 회수할 수 없습니다. 반려 후 재상신하세요.'
        : r.error === 'NOT_SUBMITTER' ? '상신자 또는 관리자만 회수할 수 있습니다.'
        : r.error;
      toast({ title: '상신 취소 실패', description: msg, variant: 'destructive' });
      fetchAll();
      return;
    }
    setRun((prev: any) => ({ ...prev, status: '검증완료' }));
    toast({ title: '결재 상신이 취소되었습니다.' });
    log('상신취소', 'assessment_run', runId!, run.project_id);
    fetchAll();
  };

  // Final approval — uses unified RPC
  const handleFinalApproval = async (action: '승인' | '반려', comment?: string) => {
    if (!run || !user || !profile) return;
    const { data: latestVersionData } = await supabase.from('approvals')
      .select('approval_version').eq('run_id', runId).order('approval_version', { ascending: false }).limit(1);
    const currentVersion = latestVersionData?.[0]?.approval_version || 1;

    // Find current step assigned to me (진행중) — 상신칸은 수동 결재 불가
    const { data: mySteps } = await supabase.from('approvals')
      .select('id, step, position, status, approver_id')
      .eq('run_id', runId).eq('approval_version', currentVersion)
      .eq('status', '진행중').eq('approver_id', user.id);

    const myStep = (mySteps || []).find((s) =>
      canManuallyActOnApprovalStep({ actorUserId: user.id, step: s }).ok,
    );
    if (!myStep) {
      const blocked = (mySteps || [])[0];
      const why = blocked
        ? canManuallyActOnApprovalStep({ actorUserId: user.id, step: blocked }).reason
        : 'NOT_ACTIVE_STEP';
      const desc =
        why === 'SUBMITTER_STEP_NO_SELF_APPROVE'
          ? '담당자(시공) 상신 단계는 상신 시 자동 완료됩니다. 다음 결재자의 순서를 기다리세요.'
          : '현재 진행중 단계의 지정된 결재자만 승인/반려할 수 있습니다.';
      toast({ title: '결재 권한이 없습니다.', description: desc, variant: 'destructive' });
      return;
    }

    const { data: res, error } = await supabase.rpc('act_on_approval', {
      _approval_id: myStep.id,
      _action: action === '승인' ? 'approve' : 'reject',
      _comment: comment || '',
    });
    if (error) {
      toast({ title: '처리 실패', description: error.message, variant: 'destructive' });
      return;
    }
    const r = res as any;
    if (r?.error) {
      toast({ title: '처리 실패', description: r.error, variant: 'destructive' });
      return;
    }
    toast({
      title: action === '승인'
        ? (r?.action === 'approved' ? '최종 승인 완료!' : `${myStep.step} 단계 승인됨`)
        : '반려되었습니다. 보완 후 재제출하세요.',
      variant: action === '반려' ? 'destructive' : 'default',
    });
    log(action, 'assessment_run', runId!, run.project_id);
    fetchAll();
  };

  // Resubmit — clear any active approval via RPC, then return to 제출됨 for re-validation
  const handleResubmit = async () => {
    if (!run || !user) return;
    if (run.status === '결재진행') {
      const { data, error } = await supabase.rpc('withdraw_approval', {
        _entity_type: 'assessment_run',
        _entity_id: runId,
        _reason: '재제출을 위한 회수',
      });
      if (error) {
        toast({ title: '회수 실패', description: error.message, variant: 'destructive' });
        return;
      }
      const r = data as any;
      if (r?.error && r.error !== 'NO_APPROVAL') {
        if (r.error === 'ALREADY_REJECTED') {
          // Already rejected — continue into 제출됨 resubmit path below
        } else {
          const msg =
            r.error === 'ALREADY_DECIDED' ? '이미 결재가 진행된 문서는 회수할 수 없습니다. 반려 후 재제출하세요.'
            : r.error;
          toast({ title: '회수 실패', description: msg, variant: 'destructive' });
          return;
        }
      }
    }
    const { error: updErr } = await supabase.from('assessment_runs').update({ status: '제출됨' }).eq('id', runId);
    if (updErr) {
      toast({ title: '재제출 실패', description: updErr.message, variant: 'destructive' });
      return;
    }
    setRun((prev: any) => ({ ...prev, status: '제출됨' }));
    toast({ title: '재제출 완료. 재검증을 실행하세요.' });
    log('재제출', 'assessment_run', runId!, run.project_id);
    fetchAll();
  };

  // Unified auto-remediation wizard: step 1 = generate & show, step 2 = apply
  const handleOpenRemediationWizard = async () => {
    if (!validationReport || !run) return;
    setRemediationLoading(true);
    setRemediationStep(1);
    setShowRemediationWizard(true);
    try {
      const nonExcludedItems = items.filter((i: any) => !i.is_excluded);
      const actions = await generateRemediationActions(nonExcludedItems, validationReport, run.project_id);
      const visibleActions = await filterDismissedCoverageRecommendations(actions);
      setRemediationActions(visibleActions);
      // 자동 선택 금지 — 사용자가 직접 선택만 허용
      setSelectedActionIds(new Set());
    } catch (err) {
      toast({ title: '보완 제안 생성 실패', variant: 'destructive' });
    }
    setRemediationLoading(false);
  };

  const handleApplyRemediation = async () => {
    if (!run || !user) return;
    const selected = remediationActions.filter(a => selectedActionIds.has(a.id));
    if (selected.length === 0) { toast({ title: '적용할 액션을 선택하세요.', variant: 'destructive' }); return; }
    setRemediationLoading(true);
    try {
      const nonExcludedItems = items.filter((i: any) => !i.is_excluded);
      const { appliedCount, newItemCount } = await applyRemediationActions(
        selected, nonExcludedItems, runId!, run.project_id, user.id
      );
      const summaryText = buildRemediationSummaryText(selected);
      log('자동보완적용', 'assessment_run', runId!, run.project_id, { appliedCount, newItemCount });
      const { data: refreshed } = await supabase.from('risk_items').select('*').eq('run_id', runId).eq('is_deleted', false).order('sort_order');
      if (refreshed) setItems(refreshed);
      toast({ title: `${appliedCount}건 보완 적용 완료${newItemCount > 0 ? ` (신규 ${newItemCount}건)` : ''}` });

      // Auto re-validate (참고용 — 상태 전환 없음)
      if (applyAndRevalidate) {
        const currentItems = (refreshed || items).filter((i: any) => !i.is_excluded);
        const report = await validateRiskItems(currentItems, run.project_id);
        setValidationReport(report);
        await saveValidationResults(report, run.project_id, user.id, runId);
        await supabase.from('assessment_runs').update({ validation_score: report.score, validation_verdict: report.verdict }).eq('id', runId);
        setRun((prev: any) => ({ ...prev, validation_score: report.score, validation_verdict: report.verdict }));
        toast({ title: `재검증: ${report.verdict} (${report.score}점)`, description: '검증 결과는 참고용입니다.' });
      }

      setShowRemediationWizard(false);
    } catch (err) {
      toast({ title: '보완 적용 실패', description: String(err), variant: 'destructive' });
    }
    setRemediationLoading(false);
  };

  // Batch apply department/assignee
  const [batchApplyLoading, setBatchApplyLoading] = useState(false);

  const handleBatchApply = async () => {
    if (!run || !user) return;
    if (!batchAssigneeUserId) {
      toast({ title: '담당자를 선택하세요.', variant: 'destructive' });
      return;
    }

    setBatchApplyLoading(true);
    try {
      let targetItems: RiskItemRow[];
      if (batchScope === 'selected') {
        targetItems = activeItems.filter(i => selectedRowIds.has(i.id));
      } else if (batchScope === 'empty') {
        targetItems = activeItems.filter(i => !(i as any).assignee_user_id && !(i as any).assignee);
      } else {
        targetItems = [...activeItems];
      }
      if (targetItems.length === 0) {
        toast({ title: '적용 대상이 없습니다.', description: batchScope === 'selected' ? '체크박스로 행을 선택하세요.' : '이미 모든 항목이 채워져 있습니다.', variant: 'destructive' });
        setBatchApplyLoading(false);
        return;
      }

      const member = projectMembers.find(m => m.user_id === batchAssigneeUserId);
      const base = resolveAssigneeWrite(batchAssigneeUserId, member?.assignee_name || member?.display_name || '');
      const deptId = (member as any)?.department_id;
      if (deptId) {
        const dept = departments.find(d => d.id === deptId);
        Object.assign(base, {
          responsible_department_id: deptId,
          department: dept?.name || (member as any).department_name || '',
        });
      }

      let appliedCount = 0;
      for (const item of targetItems) {
        if (!batchOverrideManual && batchScope !== 'empty' && ((item as any).assignee_user_id || (item as any).assignee)) {
          continue;
        }
        const { error } = await supabase.from('risk_items').update(base).eq('id', item.id);
        if (error) {
          toast({ title: '일괄 적용 실패', description: error.message, variant: 'destructive' });
          setBatchApplyLoading(false);
          return;
        }
        appliedCount++;
      }

      const { data: refreshed } = await supabase.from('risk_items').select('*').eq('run_id', runId).eq('is_deleted', false).order('sort_order');
      if (refreshed) setItems(refreshed);
      setShowBatchApply(false);
      setSelectedRowIds(new Set());
      toast({ title: `${appliedCount}건에 담당자 일괄 지정 완료` });
      log('일괄적용', 'assessment_run', runId!, run.project_id, { appliedCount, scope: batchScope });
    } catch (err) {
      toast({ title: '일괄 적용 중 오류 발생', description: String(err), variant: 'destructive' });
    }
    setBatchApplyLoading(false);
  };

  // Participants
  const handleAddParticipant = async () => {
    if (!runId) return;
    const name = newParticipant.user_name || participantSearch;
    if (!name) return;
    const { data } = await supabase.from('assessment_run_participants').insert([{
      run_id: runId, role: newParticipant.role, user_name: name, company: newParticipant.company,
    }]).select().single();
    if (data) setParticipants(prev => [...prev, data]);
    setNewParticipant({ role: '작성자', user_name: '', company: '' });
    setParticipantSearch('');
  };

  const handleDeleteParticipant = async (id: string) => {
    await supabase.from('assessment_run_participants').delete().eq('id', id);
    setParticipants(prev => prev.filter(p => p.id !== id));
  };

  // Force edit / archive / revision handlers
  const handleForceEditConfirm = async () => {
    if (!run || !user) return;
    await supabase.from('risk_items').update({ is_locked: false }).eq('run_id', runId);
    await supabase.from('assessment_runs').update({ status: '보완중' }).eq('id', runId);
    setRun((prev: any) => ({ ...prev, status: '보완중' }));
    setShowForceEdit(false);
    log('강제수정', 'assessment_run', runId!, run.project_id, { reason: forceEditReason });
    toast({ title: '강제 수정 모드 활성화. 수정 후 재상신하세요.' });
  };

  const handleArchive = async () => {
    if (!run || !user) return;
    await supabase.from('assessment_runs').update({
      status: '폐기', is_deleted: true, deleted_by: user.id, deleted_at: new Date().toISOString(), deleted_reason: archiveReason,
    }).eq('id', runId);
    setShowArchive(false);
    log('폐기', 'assessment_run', runId!, run.project_id, { reason: archiveReason });
    toast({ title: '회차가 폐기되었습니다.' });
    // Leave the deleted detail route — empty list is interactive after unlock.
    const { unlockBodyPointerEvents } = await import('@/lib/unlockBodyPointerEvents');
    unlockBodyPointerEvents();
    navigate('/risk-assessment', { replace: true });
  };

  // Export helpers
  const buildRiskRows = () => activeItems.map(i => ({
    ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
    existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
    likelihood_grade: i.likelihood_grade || '중', severity_grade: i.severity_grade || '중', risk_grade: i.risk_grade || '중',
    improved_likelihood_grade: i.improved_likelihood_grade || '하', improved_severity_grade: i.improved_severity_grade || '하', improved_risk_grade: i.improved_risk_grade || '하',
    ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
  }));

  const buildProjectInfo = () => ({
    name: project?.name || '', site_name: project?.site_name || '',
    period_start: project?.period_start || '', period_end: project?.period_end || '',
    client: docCompanies.clientCompanyName === '(미지정)' ? '' : docCompanies.clientCompanyName,
    contractor: docCompanies.gcCompanyName === '(미지정)' ? '' : docCompanies.gcCompanyName,
    author_company: docCompanies.authorCompanyName === '(미지정)' ? '' : docCompanies.authorCompanyName,
  });

  const handleExportPDF = async () => {
    if (!run) return;
    if (!hasAssessmentLegalAuthor(run.author_user_id)) {
      toast({ title: '인쇄 불가', description: '작성 주체(관리감독자)를 지정한 뒤에만 인쇄할 수 있습니다.', variant: 'destructive' });
      return;
    }
    toast({ title: '인쇄용 HTML 생성 중...', description: '잠시 기다려주세요.' });
    try {
      await exportToPDFServer(runId!, 'assessment', 'download', undefined, {
        previousRunId: previousRun?.id ?? null,
      });
      log('PDF다운로드', 'assessment_run', runId!, run.project_id);
      toast({ title: '인쇄용 HTML이 다운로드되었습니다.', description: '파일을 열어 브라우저 인쇄 > PDF로 저장하세요.' });
    } catch (serverErr) {
      console.error('Server PDF failed:', serverErr);
      if (!project) {
        toast({ title: 'PDF 생성 실패', description: `서버 오류: ${String(serverErr)}`, variant: 'destructive' });
        return;
      }
      try {
        exportToPDF(buildRiskRows(), buildProjectInfo(), null, participants, { type: run.type, period_label: run.period_label });
        log('PDF다운로드(클라이언트)', 'assessment_run', runId!, run.project_id);
      } catch (err) {
        toast({ title: 'PDF 다운로드 실패', description: String(err), variant: 'destructive' });
      }
    }
  };

  // Print: open server HTML in new window and trigger print dialog ONCE.
  // We open the window SYNCHRONOUSLY here so popup blockers don't block it.
  const handlePrint = async () => {
    if (!run) return;
    if (!hasAssessmentLegalAuthor(run.author_user_id)) {
      toast({ title: '인쇄 불가', description: '작성 주체(관리감독자)를 지정한 뒤에만 인쇄할 수 있습니다.', variant: 'destructive' });
      return;
    }
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
      toast({
        title: '팝업이 차단되었습니다',
        description: '주소창의 팝업 아이콘에서 허용 후 다시 시도하거나, [PDF 다운로드] 버튼을 사용해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: '인쇄용 문서 생성 중...' });
    try {
      await exportToPDFServer(runId!, 'assessment', 'print', printWindow, {
        previousRunId: previousRun?.id ?? null,
      });
    } catch (err) {
      toast({ title: '인쇄 실패', description: String(err), variant: 'destructive' });
    }
  };

  const handleExportValidationPDF = async () => {
    if (!run) return;
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
      toast({ title: '팝업이 차단되었습니다', description: '브라우저 팝업을 허용해 주세요.', variant: 'destructive' });
      return;
    }
    try {
      await exportToPDFServer(runId!, 'validation', 'print', printWindow);
    } catch {
      if (!project || !validationReport) return;
      try {
        exportToPDF(buildRiskRows(), buildProjectInfo(), null, participants, { type: run.type, period_label: run.period_label }, validationReport);
      } catch (err) {
        toast({ title: '검증 리포트 PDF 다운로드 실패', variant: 'destructive' });
      }
    }
  };

  const handleExportXLSX = async () => {
    if (!project) return;
    try {
      const signatureRows = buildAssessmentSignatureRows({
        approvals: latestApprovals,
        draftSteps: approvalLines.map((l) => ({
          label: l.step_label,
          position: l.position,
          user_id: l.user_id,
          user_name: l.user_name,
          company_id: l.company_id,
          company_name: l.company_name,
        })),
      }).map((a) => ({
        step: a.step,
        approver_name: a.approver_name,
        company_name: a.company_name,
        position_label: a.position_label,
        status: a.status,
        approved_at: a.approved_at,
      }));
      await exportToXLSX(buildRiskRows(), buildProjectInfo(), undefined, participants, { type: run?.type, period_label: run?.period_label }, signatureRows);
    } catch (err) {
      toast({ title: 'XLSX 다운로드 실패', variant: 'destructive' });
    }
  };

  // Worker participation photo upload
  const handleWorkerPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !run) return;
    setWorkerPhotoUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop();
        const path = `worker-photos/${run.project_id}/${runId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        try {
          const uploaded = await uploadAttachmentFile(path, file);
          urls.push(uploaded.publicUrl);
        } catch {
          /* skip failed file */
        }
      }
      if (urls.length > 0) {
        const existing = run.worker_participation_images || [];
        const updated = [...existing, ...urls];
        await supabase.from('assessment_runs').update({ worker_participation_images: updated } as any).eq('id', runId);
        setRun((prev: any) => ({ ...prev, worker_participation_images: updated }));
        toast({ title: `근로자 참여 사진 ${urls.length}건 업로드 완료` });
      }
    } catch (err) {
      toast({ title: '사진 업로드 실패', description: String(err), variant: 'destructive' });
    }
    setWorkerPhotoUploading(false);
    e.target.value = '';
  };

  const handleRemoveWorkerPhoto = async (index: number) => {
    if (!run) return;
    const images = [...(run.worker_participation_images || [])];
    images.splice(index, 1);
    await supabase.from('assessment_runs').update({ worker_participation_images: images } as any).eq('id', runId);
    setRun((prev: any) => ({ ...prev, worker_participation_images: images }));
  };

  // Excel upload
  // Excel upload — parse after file pick (no extra 저장 button; next step is 컬럼 매핑)
  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setExcelFileName(file.name);
    setExcelParseError(null);
    try {
      const parsed = await parseRiskAssessmentExcelFile(file);
      const headers = parsed.headers;
      const json = parsed.rows;
      setExcelHeaders(headers);
      setExcelData(json);
      const autoMap: Record<string, string> = {};
      const isImprovedGradeHeader = (h: string) =>
        h.includes('개선') || /['′'']\s*$/.test(h.trim()) || h.includes("'");
      const findHeader = (aliases: string[], excludeImproved = false) => {
        const candidates = excludeImproved
          ? headers.filter(h => !isImprovedGradeHeader(h))
          : headers;
        const exact = candidates.find(h => aliases.some(a => h.trim() === a));
        if (exact) return exact;
        return candidates.find(h => aliases.some(a => h.includes(a)));
      };
      const knownMappings: Array<{ field: string; aliases: string[]; excludeImproved?: boolean }> = [
        { field: 'process', aliases: ['공정', 'Process', '공종'] },
        { field: 'sub_task', aliases: ['세부작업', 'Sub Task', '세부공종'] },
        { field: 'hazard', aliases: ['위험요인', 'Hazard', '유해위험요인'] },
        { field: 'hazard_situation', aliases: ['위험발생상황', 'Hazard Situation', '위험상황'] },
        { field: 'existing_measure', aliases: ['기존대책', 'Existing Measure', '현재대책'] },
        { field: 'improvement_measure', aliases: ['개선대책', 'Improvement', '추가대책'] },
        { field: 'improved_likelihood_grade', aliases: ['개선후 가능성', "가능성'", '개선가능성', 'Improved Likelihood'] },
        { field: 'improved_severity_grade', aliases: ['개선후 중대성', "중대성'", '개선중대성', 'Improved Severity'] },
        { field: 'improved_risk_grade', aliases: ['개선후 위험도', "위험도'", '개선위험도', 'Improved Risk'] },
        { field: 'likelihood_grade', aliases: ['가능성', 'Likelihood', '빈도'], excludeImproved: true },
        { field: 'severity_grade', aliases: ['중대성', 'Severity', '강도'], excludeImproved: true },
        { field: 'risk_grade', aliases: ['위험도', 'Risk Level', 'Risk'], excludeImproved: true },
        { field: 'legal_basis', aliases: ['법적근거', 'Legal', '관련법령'] },
      ];
      for (const { field, aliases, excludeImproved } of knownMappings) {
        const found = findHeader(aliases, !!excludeImproved);
        if (found) autoMap[field] = found;
      }
      setExcelColumnMap(autoMap);
      setExcelStep('map');
    } catch (err: any) {
      const msg = err?.message || '파일을 읽지 못했습니다.';
      setExcelParseError(msg);
      toast({ title: '데이터가 없습니다.', description: msg, variant: 'destructive' });
    }
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
  };

  const handleExcelImport = async () => {
    if (!run || !user || !runId) return;
    const parseGrade = (raw: string, fallback: '상' | '중' | '하'): '상' | '중' | '하' => {
      const t = String(raw || '').trim();
      return (['상', '중', '하'] as const).includes(t as '상' | '중' | '하') ? (t as '상' | '중' | '하') : fallback;
    };
    const inserts = excelData.map((row, i) => {
      const get = (field: string) => row[excelColumnMap[field] || ''] || '';
      const lg = parseGrade(get('likelihood_grade'), '중');
      const sg = parseGrade(get('severity_grade'), '중');
      const rgRaw = String(get('risk_grade') || '').trim();
      const rg = (['상', '중', '하'] as const).includes(rgRaw as '상' | '중' | '하')
        ? (rgRaw as '상' | '중' | '하')
        : calculateRiskGrade(lg, sg);
      // 개선후 칸이 비면 기존처럼 하 — 값이 있으면 엑셀 반영
      const hasImprovedL = String(get('improved_likelihood_grade') || '').trim().length > 0;
      const hasImprovedS = String(get('improved_severity_grade') || '').trim().length > 0;
      const ilg = parseGrade(get('improved_likelihood_grade'), '하');
      const isg = parseGrade(get('improved_severity_grade'), '하');
      const irgRaw = String(get('improved_risk_grade') || '').trim();
      const irg = (['상', '중', '하'] as const).includes(irgRaw as '상' | '중' | '하')
        ? (irgRaw as '상' | '중' | '하')
        : (hasImprovedL || hasImprovedS)
          ? calculateRiskGrade(ilg, isg)
          : '하';
      return {
        project_id: run.project_id, run_id: runId,
        process: get('process') || '미분류', sub_task: get('sub_task'), hazard: get('hazard'),
        hazard_situation: get('hazard_situation'), existing_measure: get('existing_measure'),
        improvement_measure: get('improvement_measure'),
        likelihood_grade: lg,
        severity_grade: sg,
        risk_grade: rg,
        improved_likelihood_grade: ilg,
        improved_severity_grade: isg,
        improved_risk_grade: irg,
        legal_basis: get('legal_basis') ? get('legal_basis').split(',').map(s => s.trim()) : [],
        status: '초안', created_by: user.id, sort_order: items.length + i,
      };
    });
    const { data, error } = await supabase.from('risk_items').insert(inserts).select();
    if (error) {
      // Same RLS gate as AI auto-gen — surface instead of silent no-op
      const rls = /42501|row-level security|RLS/i.test(error.message);
      toast({
        title: rls ? '엑셀 반영 권한 없음' : '엑셀 반영 실패',
        description: rls
          ? '위험성평가 항목 저장 RLS와 동일합니다. 관리감독자(site_supervisor) 등 작성 역할인지 확인하세요.'
          : error.message,
        variant: 'destructive',
      });
      return;
    }
    if (data?.length) {
      setItems(prev => [...prev, ...data]);
      toast({ title: `${data.length}건 반영 완료` });
    } else {
      toast({ title: '반영된 행이 없습니다.', variant: 'destructive' });
      return;
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

  if (loading && !run) return <div className="py-12 text-center text-muted-foreground">로딩 중...</div>;
  if (!run) return <div className="py-12 text-center text-muted-foreground">회차를 찾을 수 없습니다.</div>;

  // Mobile: never render authoring UI — read-only print preview + summary
  if (isMobile && !isForceDesktop()) {
    return <MobileAssessmentViewer runId={runId} />;
  }

  // ===== CTA conditions (strict state machine) =====
  const hasRejectedApproval = latestApprovals.some((a) => a.status === '반려');
  const uiStatus =
    hasRejectedApproval && run.status === '결재진행' ? '반려' : run.status;
  const isDraft = uiStatus === '작성중';
  const isSubmitted = uiStatus === '제출됨';
  const isReturned = ['보완요청', '보완중', '반려'].includes(uiStatus);
  const isValidating = uiStatus === '검증중';
  const isValidated = uiStatus === '검증완료';
  const isInApproval = uiStatus === '결재진행';

  const isClientSm = !!isMaster || (
    userCompanyType === 'client'
    && (userRole === 'safety_manager' || userPosition === 'OWNER_SM' || userPosition === 'OWNER_HSE')
  );

  const canValidate = isClientSm && !isApproved && uiStatus !== '폐기' && activeItems.length > 0;
  const canSubmitApproval = !isInApproval && !isApproved && uiStatus !== '폐기' && activeItems.length > 0;
  const authorDisplayName = userDirectory.find((u) => u.user_id === run.author_user_id)?.display_name || '';
  const userCanSubmit = canSubmitAssessmentRun({ userId: user?.id, authorUserId: run.author_user_id });
  const authorGateMessage = assessmentAuthorSubmitMessage({
    authorUserId: run.author_user_id,
    authorName: authorDisplayName,
    userId: user?.id,
  });
  const canAssignAuthor = (canEdit || canForceEdit) && (
    !!isMaster
    || canAssistAssessmentWrite(userRole, !!isMaster)
    || userRole === 'site_supervisor'
    || run.created_by === user?.id
  );
  const canCancelApproval =
    isInApproval
    && !hasRejectedApproval
    && (!!isAdmin || (user && (run.created_by === user.id || run.author_user_id === user.id)));
  const canAutoRemediate = isClientSm && validationReport && validationReport.verdict !== '적정' && (canEdit || canForceEdit) && !isInApproval && !isApproved;
  const isMyApprovalPending = user && latestApprovals.some(a => a.status === '진행중' && a.approver_id === user.id);
  const statusInfo = STATUS_FLOW[uiStatus as keyof typeof STATUS_FLOW] || { label: uiStatus, color: '' };

  const statusGuide = isDraft ? '작성을 마치면 [결재 상신]하세요.'
    : isSubmitted || isValidated || isValidating ? '결재 상신으로 진행하세요.'
    : isReturned ? '수정한 뒤 [재상신]하세요.'
    : isInApproval ? '결재 진행 중입니다.'
    : isApproved ? '최종 승인 완료. 잠금 상태입니다.'
    : '';

  return (
    <div className="space-y-4 animate-fade-in print:space-y-2 print-a4-landscape">
      {(autoGenLoading || (autoGenJob.status === 'running' && autoGenJob.runId === runId)) && (
        <div className="print:hidden sticky top-0 z-30 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 shadow-sm backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent mt-0.5" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-semibold">
                위험성평가 AI {autoGenJob.phase === 'filling' ? '채움' : '초안'} 생성 중
                {autoGenJob.phase === 'draft' ? ' · 1단계 세부작업·위험요인' : ''}
                {autoGenJob.phase === 'filling' ? ' · 2단계 대책·법적근거' : ''}
                {autoGenJob.processTotal > 0
                  ? ` · 공종 ${autoGenJob.processIndex || 1}/${autoGenJob.processTotal}`
                  : ''}
                {autoGenJob.elapsedSec > 0 ? ` · ${autoGenJob.elapsedSec}초` : ''}
              </p>
              <p className="text-xs text-muted-foreground break-words">
                {autoGenJob.phase === 'draft'
                  ? (autoGenJob.message || '초안 생성 중… 보통 수 초~20초, 모델 전환 시 더 걸릴 수 있습니다.')
                  : (autoGenJob.message || autoGenPhaseLabel || '생성 대기 중…')}
              </p>
              {(() => {
                const total = Math.max(autoGenJob.insertedTotal || 0, 1);
                const filled = autoGenJob.filledTotal || 0;
                const pct = autoGenJob.phase === 'draft'
                  ? Math.min(90, 8 + Math.round((autoGenJob.elapsedSec || 0) * 2.2))
                  : Math.min(100, Math.round((filled / total) * 100));
                return (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-500"
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      초안 {autoGenJob.insertedTotal || 0}행 · 채움 {filled}행
                      {autoGenJob.pendingIds?.length ? ` · 대기 ${autoGenJob.pendingIds.length}` : ''}
                      {' · '}이 탭을 닫지 마세요. 초안은 보통 수 초~20초입니다.
                    </p>
                  </div>
                );
              })()}
              {(autoGenJob.elapsedSec || 0) >= 45 && (
                <div className="pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      cancelRiskAutoGenJob('응답이 길어 중단했습니다. 공종을 하나만 넣고 다시 시도하세요.');
                      toast({
                        title: '생성을 중단했습니다.',
                        description: '공종을 하나만 넣고 [초안 생성]을 다시 눌러주세요.',
                      });
                    }}
                  >
                    중단하고 다시 시도
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {run && !isApproved && !isArchived && autoGenJob.status === 'awaiting_review' && autoGenJob.runId === runId && (
        <div className="print:hidden sticky top-0 z-30 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold">초안 검수 중 · {autoGenJob.insertedTotal}행</p>
              <p className="text-xs text-muted-foreground">
                필요 없는 행을 지운 뒤 대책·등급·보호구·법적근거를 채우세요. 라이브러리·재사용 행의 빈칸도 대상입니다.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => {
                  const ok = continueRiskAutoGenFill(runId);
                  if (!ok) {
                    toast({
                      title: '채움을 시작할 수 없습니다.',
                      description: '다른 생성이 진행 중이거나 세션 정보가 없습니다. 페이지를 새로고침 후 다시 시도하세요.',
                      variant: 'destructive',
                    });
                    return;
                  }
                  toast({ title: '나머지 채우기를 시작했습니다.', description: '대책·등급·보호구·법적근거를 배치로 채웁니다.' });
                }}
                disabled={isRiskAutoGenRunning()}
              >
                <Wand2 className="h-3.5 w-3.5 mr-1" /> 나머지 채우기
              </Button>
              <Button size="sm" variant="outline" onClick={() => dismissRiskAutoGenReview()}>
                나중에
              </Button>
            </div>
          </div>
        </div>
      )}
      {autoGenJob.status !== 'awaiting_review' && autoGenJob.status !== 'running' && !isApproved && !isArchived && items.some((it) => isFillableRiskItem(it)) && (canEdit || canForceEdit) && (
        <div className="print:hidden sticky top-0 z-30 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">빈 개선대책·보호구·법적근거가 있습니다. [나머지 채우기]로 행별로 채우세요. (품질 점검 자동보완은 쓰지 마세요)</p>
            <Button
              size="sm"
              onClick={() => {
                const ok = continueRiskAutoGenFill(runId);
                if (!ok) {
                  toast({ title: '채움을 시작할 수 없습니다.', variant: 'destructive' });
                  return;
                }
                toast({ title: '나머지 채우기를 시작했습니다.' });
              }}
              disabled={isRiskAutoGenRunning()}
            >
              <Wand2 className="h-3.5 w-3.5 mr-1" /> 나머지 채우기
            </Button>
          </div>
        </div>
      )}
      {canSubmitApproval && (
        <div className="print:hidden sticky top-0 z-20 rounded-md border bg-background/95 px-3 py-2 text-xs backdrop-blur-sm flex items-center gap-2">
          {submitPreflight.ready
            ? <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
            : <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />}
          <span className="min-w-0 truncate">
            {submitPreflight.ready
              ? `상신 준비됨 · 의견 ${participationCounts.opinions} · 보건 ${participationCounts.healths}`
              : submitBlockedReason || '상신 전 점검을 완료하세요'}
          </span>
          <span className="ml-auto text-muted-foreground shrink-0">의견 {participationCounts.opinions} · 보건 {participationCounts.healths}</span>
        </div>
      )}
      {(!hasAssessmentLegalAuthor(run.author_user_id) || (canAssistAssessmentWrite(userRole, false) && !userCanSubmit)) && (
        <div className="print:hidden rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs space-y-2">
          <p className="font-medium">
            {hasAssessmentLegalAuthor(run.author_user_id)
              ? `보좌 입력 — 작성 주체: ${authorDisplayName || '관리감독자'}. 상신은 관리감독자만 가능합니다.`
              : '작성 주체(관리감독자)가 없습니다. 지정하기 전에는 상신·인쇄할 수 없습니다.'}
          </p>
          {canAssignAuthor && (
            <AssessmentAuthorPicker
              projectId={run.project_id}
              value={run.author_user_id || ''}
              onChange={async (id) => {
                const { error } = await supabase.from('assessment_runs').update({ author_user_id: id } as any).eq('id', runId);
                if (error) {
                  toast({ title: '작성 주체 저장 실패', description: error.message, variant: 'destructive' });
                  return;
                }
                setRun((prev: any) => (prev ? { ...prev, author_user_id: id } : prev));
                toast({ title: '작성 주체(관리감독자)를 지정했습니다.' });
              }}
              required
            />
          )}
        </div>
      )}
      {/* Company Form Header - 회사 양식 */}
      <Card className="print:border-2 print:border-foreground">
        <CardContent className="py-4 space-y-3">
          <div className="text-center border-b pb-2 print:pb-3">
            <h1 className="text-lg font-bold print:text-xl">위험성평가표</h1>
            <p className="text-sm text-muted-foreground">[{run.type}] {run.period_label || '(기간 미지정)'}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">프로젝트:</span><span>{project?.name || ''}</span></div>
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">현장명:</span><span>{project?.site_name || ''}</span></div>
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">발주처:</span><span>{docCompanies.clientCompanyName}</span></div>
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">시공사:</span><span>{docCompanies.gcCompanyName}</span></div>
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">작성 관리감독자:</span><span>{authorDisplayName || '미지정'}</span></div>
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">작성 회사:</span><span>{docCompanies.authorCompanyName}</span></div>
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">기간:</span><span>{run.start_date || project?.period_start || ''} ~ {run.end_date || project?.period_end || ''}</span></div>
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">항목 수:</span><span>{stats.total}건</span></div>
            <div className="flex gap-1"><span className="font-medium text-muted-foreground">상태:</span>
              <Badge variant="outline" className={`text-[9px] ${statusInfo.color}`}>
                {run.status} {isApproved && <Lock className="h-3 w-3 ml-0.5 inline" />}
              </Badge>
            </div>
            {run.validation_score != null && (
              <div className="flex gap-1"><span className="font-medium text-muted-foreground">검증:</span><span>{run.validation_verdict} ({run.validation_score}점)</span></div>
            )}
          </div>
          {/* Participants summary */}
          {participants.length > 0 && (
            <div className="flex items-center gap-3 text-[10px] border-t pt-2 flex-wrap">
              {['작성자','검토자','승인자','안전관리자','협력사 담당자'].map(role => {
                const ps = participants.filter(p => p.role === role);
                if (ps.length === 0) return null;
                return (
                  <span key={role} className="text-muted-foreground">
                    <span className="font-medium">{role}:</span> {ps.map(p => p.user_name).join(', ')}
                  </span>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Header - action bar (print hidden) */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/risk-assessment')}>← 목록</Button>
            {isMasterOrCreator && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowEditRun(true)}><Pencil className="h-3.5 w-3.5" /></Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            상 {stats.high} · 중 {stats.med} · 하 {stats.low}
            {stats.highRemain > 0 && <span className="text-destructive ml-2">· 개선후 상 잔존 {stats.highRemain}</span>}
            {stats.highRemain === 0 && stats.total >= 10 && (
              <span className="text-amber-600 ml-2">· 개선후 상 0건 (확인 권장)</span>
            )}
            {stats.excluded > 0 && <span className="text-muted-foreground ml-2">· 제외 {stats.excluded}</span>}
          </p>
        </div>
      </div>

      {/* Approval Status Display (SSOT) */}
      {latestApprovals.length > 0 && (() => {
        const activeApprovals = sortApprovalRows(
          latestApprovals.filter((a) => a.status !== '취소'),
        );
        const version = Math.max(
          0,
          ...latestApprovals.map((a) => Number(a.approval_version) || 1),
        );
        return (
        <div className="space-y-2 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">결재현황:</span>
            {activeApprovals.map((a: any) => {
                const displayStatus = sequentialDisplayStatus(activeApprovals, a);
                const submitter = isSubmitterApprovalStep(a);
                return (
                <Badge key={a.id} variant="outline" className={`text-[10px] gap-1 ${
                  displayStatus === '승인' ? 'bg-success/10 text-success border-success/30' :
                  displayStatus === '반려' ? 'bg-destructive/10 text-destructive border-destructive/30' :
                  displayStatus === '진행중' ? 'bg-primary/10 text-primary border-primary/30' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {displayStatus === '승인' ? <CheckCircle2 className="h-3 w-3" /> :
                   displayStatus === '반려' ? <XCircle className="h-3 w-3" /> :
                   <Clock className="h-3 w-3" />}
                  {a.step}: {a.approver_name || '미지정'}
                  {a.company_name ? ` (${a.company_name})` : ''}
                  {displayStatus === '승인' && submitter ? ' [상신완료]'
                    : displayStatus === '진행중' ? ' [결재중]'
                    : displayStatus === '대기' ? ' [순번대기]'
                    : displayStatus !== '대기' ? ` [${displayStatus}]` : ''}
                </Badge>
                );
              })}
            {version > 1 && (
              <Badge variant="outline" className="text-[9px]">재상신 {version}차</Badge>
            )}
          </div>
          {/* Signature Table - 서명란 (auto-populated from approval data) */}
          {activeApprovals.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border px-2 py-1 text-left font-medium">구분</th>
                    <th className="border px-2 py-1 text-left font-medium">성명</th>
                    <th className="border px-2 py-1 text-left font-medium">소속</th>
                    <th className="border px-2 py-1 text-left font-medium">직책</th>
                    <th className="border px-2 py-1 text-left font-medium">서명/일자</th>
                  </tr>
                </thead>
                <tbody>
                  {activeApprovals.map((a: any) => {
                      const displayStatus = sequentialDisplayStatus(activeApprovals, a);
                      const submitter = isSubmitterApprovalStep(a);
                      return (
                        <tr key={a.id} className={displayStatus === '진행중' ? 'bg-primary/5' : undefined}>
                          <td className="border px-2 py-1 font-medium">{a.step}</td>
                          <td className="border px-2 py-1">{localizePersonName(a.approver_name) || '—'}</td>
                          <td className="border px-2 py-1">{a.company_name || '—'}</td>
                          <td className="border px-2 py-1">{jobTitleLabel(a.position) || '—'}</td>
                          <td className="border px-2 py-1">
                            {displayStatus === '승인' && a.approved_at
                              ? (
                                <span>
                                  {new Date(a.approved_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                  {submitter ? <span className="text-muted-foreground"> · 상신</span> : null}
                                </span>
                              )
                              : displayStatus === '반려' ? <span className="text-destructive">반려</span>
                              : displayStatus === '진행중' ? <span className="text-primary font-medium">결재중</span>
                              : <span className="text-muted-foreground">순번대기</span>}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          {activeApprovals.length > 0
            && !activeApprovals.some((a) => {
              const p = (a.position || '').toLowerCase();
              return p === 'owner_cm' || p === 'owner_sm';
            }) && (
            <p className="text-[10px] text-warning">
              이 상신({version > 1 ? `${version}차` : '1차'}) 결재 기록에는 발주처 SM/CM이 없습니다.
              결재선에 담당자(SM)을 넣고 [저장]한 뒤, 회수 또는 반려 후 다시 상신해야 반영됩니다.
              (지금 보이는 표는 저장된 결재선이 아니라 이미 올라간 상신 버전입니다)
            </p>
          )}
        </div>
        );
      })()}

      {latestApprovals.length === 0 && approvalLines.length > 0 && (
        <div className="space-y-2 print:hidden">
          <span className="text-xs text-muted-foreground font-medium">서명란 (결재선)</span>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="border px-2 py-1 text-left font-medium">구분</th>
                  <th className="border px-2 py-1 text-left font-medium">성명</th>
                  <th className="border px-2 py-1 text-left font-medium">소속</th>
                  <th className="border px-2 py-1 text-left font-medium">직책</th>
                  <th className="border px-2 py-1 text-left font-medium">서명/일자</th>
                </tr>
              </thead>
              <tbody>
                {buildAssessmentSignatureRows({
                  draftSteps: approvalLines.map((l) => ({
                    label: l.step_label,
                    position: l.position,
                    user_id: l.user_id,
                    user_name: l.user_name,
                    company_id: l.company_id,
                    company_name: l.company_name,
                  })),
                }).map((row, i) => (
                  <tr key={`${row.position}-${i}`}>
                    <td className="border px-2 py-1 font-medium">{row.step || '—'}</td>
                    <td className="border px-2 py-1">{row.approver_name || '—'}</td>
                    <td className="border px-2 py-1">{row.company_name || '—'}</td>
                    <td className="border px-2 py-1">{row.position_label || '—'}</td>
                    <td className="border px-2 py-1 text-muted-foreground">미상신</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action Buttons — strict state machine */}
      <div className="flex items-center gap-2 print:hidden flex-wrap">
        {(canEdit || canForceEdit) && !isInApproval && !isApproved && (
          <>
            <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setShowAutoGen(true)}>
              <Wand2 className="h-3.5 w-3.5" /> 초안 생성
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleAddNew}>
              <Plus className="h-3.5 w-3.5" /> 행 추가
            </Button>
            {selectedRowIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => void handleBulkDeleteSelected()}
              >
                <Trash2 className="h-3.5 w-3.5" /> 선택 삭제
                <Badge variant="secondary" className="ml-1 text-[9px] h-4 px-1">{selectedRowIds.size}건</Badge>
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => {
              setBatchAssigneeUserId('');
              setBatchScope(selectedRowIds.size > 0 ? 'selected' : 'empty');
              setBatchOverrideManual(false);
              setShowBatchApply(true);
            }}>
              <Users className="h-3.5 w-3.5" /> 담당자 일괄 지정
              {selectedRowIds.size > 0 && <Badge variant="secondary" className="ml-1 text-[9px] h-4 px-1">{selectedRowIds.size}건</Badge>}
            </Button>
          </>
        )}
        {canSubmitApproval && userCanSubmit && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowApproval(true)}>
            <Send className="h-3.5 w-3.5" /> {isReturned ? '재상신' : '결재 상신'}
          </Button>
        )}
        {canSubmitApproval && !userCanSubmit && authorGateMessage && (
          <span className="text-[11px] text-muted-foreground max-w-[220px] leading-snug">{authorGateMessage}</span>
        )}
        {canCancelApproval && (
          <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={handleCancelApproval}>
            <RotateCcw className="h-3.5 w-3.5" /> 상신 취소
          </Button>
        )}
        {isInApproval && isMyApprovalPending && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="gap-1 text-success" onClick={() => setShowApproveConfirm(true)}>
              <CheckCircle2 className="h-3.5 w-3.5" /> 승인
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => setRejectCommentDialog(true)}>
              <XCircle className="h-3.5 w-3.5" /> 반려
            </Button>
          </div>
        )}
        {isApproved && isMaster && (
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowCloneRun(true)}>
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
        {isApproved && isMasterOrCreator && !isMaster && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowCloneRun(true)}>
            <Copy className="h-3.5 w-3.5" /> 개정 회차 생성
          </Button>
        )}
        {isClientSm && (
          <>
            {canValidate && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleValidate}>
                <ShieldCheck className="h-3.5 w-3.5" /> {validationReport ? '재점검' : '품질 점검'}
              </Button>
            )}
            {canAutoRemediate && !items.some((it) => isFillableRiskItem(it)) && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleOpenRemediationWizard} disabled={remediationLoading}>
                <Wand2 className="h-3.5 w-3.5" /> {remediationLoading ? '분석 중...' : '자동 보완'}
              </Button>
            )}
            {validationReport && (
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setShowValidation(true)}>
                <FileWarning className="h-3.5 w-3.5" /> 점검 결과
              </Button>
            )}
          </>
        )}
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <MoreHorizontal className="h-3.5 w-3.5" /> 더보기
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setShowExcelUpload(true); setExcelStep('upload'); setExcelParseError(null); setExcelFileName(''); }}>
              <Upload className="h-3.5 w-3.5 mr-2" /> 엑셀 가져오기
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5 mr-2" /> 인쇄 / PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportXLSX}>
              <Download className="h-3.5 w-3.5 mr-2" /> XLSX
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status guide */}
      {statusGuide && (
        <p className="text-xs text-muted-foreground print:hidden pl-1">
          💡 {statusGuide}
        </p>
      )}
      {/* Remediation guide for first-time users */}
      {canAutoRemediate && !items.some((it) => isFillableRiskItem(it)) && (
        <p className="text-xs text-muted-foreground print:hidden pl-1">
          💡 형식 점검 결과 부적정이면 <strong>[자동 보완]</strong>으로 라이브러리 매칭만 검토하세요. 빈 개선대책은 <strong>[나머지 채우기]</strong>를 씁니다.
        </p>
      )}

      {/* Status notices */}
      {isReturned && (
        <Card className="border-warning print:hidden">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">반려·보완 필요:</span>
              <span>수정한 뒤 [재상신]하세요. (상신 취소가 아닙니다)</span>
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
              <span>이 회차는 최종 승인되어 잠금 상태입니다.</span>
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

      {/* Main Tabs: 위평 | 금주 이행 | 차주 관리대상 */}
      <Tabs value={activeMainTab} onValueChange={(v) => setActiveMainTab(v as 'assessment' | 'execution' | 'forecast')} className="print:hidden">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="assessment">위험성평가</TabsTrigger>
          <TabsTrigger value="execution">
            금주 이행 확인
            {previousFeedback.length > 0 && (
              <Badge variant="outline" className="ml-1 text-[9px]">{previousFeedback.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="forecast">
            차주 관리대상
            {forecastItems.length > 0 && (
              <Badge variant="outline" className="ml-1 text-[9px]">{forecastItems.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="assessment" className="space-y-4 mt-4">
      {previousRun && (
        <Card className="border-primary/30 print:hidden">
          <CardContent className="py-3 space-y-1">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="text-sm">
                <span className="font-medium">전회차 = 금주 작업분</span>
                <span className="text-muted-foreground">
                  {' '}「{previousRun.period_label || '승인 회차'}」
                  {previousRun.start_date && previousRun.end_date
                    ? ` (${previousRun.start_date} ~ ${previousRun.end_date})`
                    : ''}
                </span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setActiveMainTab('execution')}>
                금주 이행 확인
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              관리대상 {previousManagedCount}건 · 미조치 {previousFeedback.length}건.
              조치 전후 사진은 전회차에 저장되며 이 회차 위험 행과 섞이지 않습니다.
            </p>
          </CardContent>
        </Card>
      )}
      {!previousRun && !isApproved && (
        <Card className="print:hidden">
          <CardContent className="py-3">
            <p className="text-[11px] text-muted-foreground">
              같은 업체·같은 종류의 전회차(승인완료)가 없습니다. 이 회차가 첫 금주 작업분이 됩니다.
            </p>
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
            <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setShowResidualCols(v => !v)}>
              {showResidualCols ? '잔여위험 숨김' : '잔여위험 보기'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Risk Table */}
      <Card id="ra-risk-items" className="scroll-mt-20">
        <CardContent className="p-0">
          <div className="overflow-x-auto overflow-y-auto scrollbar-thin max-h-[70vh]" style={{ WebkitOverflowScrolling: 'touch' }}>
            <table className="data-table text-xs" style={{ minWidth: '1600px', tableLayout: 'auto' }}>
              <thead className="sticky top-0 z-10 bg-background shadow-sm">
                <tr>
                  {(canEdit || canForceEdit) && (
                    <th className="w-8 text-center print:hidden sticky left-0 z-20 bg-background shadow-[1px_0_0_0_hsl(var(--border))]">
                      <Checkbox
                        checked={filteredItems.length > 0 && filteredItems.every(i => selectedRowIds.has(i.id))}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedRowIds(new Set(filteredItems.map(i => i.id)));
                          else setSelectedRowIds(new Set());
                        }}
                      />
                    </th>
                  )}
                  {(canEdit || canForceEdit) && (
                    <th className="w-20 text-center print:hidden sticky left-8 z-20 bg-background shadow-[1px_0_0_0_hsl(var(--border))]">
                      작업
                    </th>
                  )}
                  <th className="w-8 text-center">#</th>
                  <th style={{ minWidth: '90px' }}>공정</th>
                  <th style={{ minWidth: '110px' }}>세부작업</th>
                  <th style={{ minWidth: '130px' }}>위험요인</th>
                  <th style={{ minWidth: '160px' }}>위험발생상황</th>
                  <th style={{ minWidth: '160px' }}>기존대책</th>
                  <th style={{ minWidth: '160px' }}>개선대책</th>
                  <th className="text-center" style={{ minWidth: '48px' }}>가능성</th><th className="text-center" style={{ minWidth: '48px' }}>중대성</th><th className="text-center" style={{ minWidth: '48px' }}>위험도</th>
                  {(showResidualCols) && (
                    <>
                      <th className="text-center" style={{ minWidth: '48px' }}>가능성'</th><th className="text-center" style={{ minWidth: '48px' }}>중대성'</th><th className="text-center" style={{ minWidth: '48px' }}>위험도'</th>
                    </>
                  )}
                  <th className="text-center" style={{ minWidth: '56px' }}>상태</th>
                  <th style={{ minWidth: '90px' }}>보호구</th><th style={{ minWidth: '110px' }}>법적근거</th>
                  <th style={{ minWidth: '100px' }}>담당자</th>
                  {isClientSm && validationReport && <th className="w-16 text-center">판정</th>}
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr><td colSpan={22} className="text-center py-10 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      {autoGenJob.status === 'running' && autoGenJob.runId === runId ? (
                        <>
                          <Loader2 className="h-6 w-6 animate-spin text-accent" />
                          <div className="font-medium text-foreground">AI가 초안을 만들고 있습니다…</div>
                          <div className="text-xs">보통 수 초~20초입니다. 완료되면 여기에 행이 나타납니다.</div>
                          <div className="text-xs">{autoGenJob.elapsedSec || 0}초 경과 · {autoGenJob.message || '대기 중'}</div>
                        </>
                      ) : (
                        <>
                      <div>등록된 위험성평가 항목이 없습니다.</div>
                      {canEdit && (
                        <div className="flex gap-2 mt-1">
                          <Button size="sm" variant="outline" onClick={() => setShowAutoGen(true)}>초안 생성</Button>
                          <Button size="sm" variant="outline" onClick={handleAddNew}>수동으로 추가</Button>
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  </td></tr>
                ) : filteredItems.map((item, idx) => {
                  const itemVerdict = validationReport?.itemVerdicts?.[item.id];
                  const pending =
                    isAiPendingRiskItem(item) ||
                    (autoGenJob.status === 'running' &&
                      autoGenJob.phase === 'filling' &&
                      (autoGenJob.pendingIds || []).includes(item.id));
                  const scopeDraft = isAiScopeDraftItem(item);
                  return (
                    <tr key={item.id} className={`${itemVerdict?.verdict === '부적정' ? 'bg-destructive/5' : itemVerdict?.verdict === '조건부 적정' ? 'bg-warning/5' : ''} ${selectedRowIds.has(item.id) ? 'bg-accent/10' : ''} ${pending ? 'bg-muted/40' : ''} ${scopeDraft && !pending ? 'bg-primary/5' : ''}`}>
                      {(canEdit || canForceEdit) && (
                        <td className={`text-center print:hidden sticky left-0 z-[5] shadow-[1px_0_0_0_hsl(var(--border))] ${selectedRowIds.has(item.id) ? 'bg-accent/10' : pending ? 'bg-muted/40' : scopeDraft ? 'bg-primary/5' : 'bg-background'}`}>
                          <Checkbox
                            checked={selectedRowIds.has(item.id)}
                            onCheckedChange={(checked) => {
                              setSelectedRowIds(prev => {
                                const next = new Set(prev);
                                if (checked) next.add(item.id); else next.delete(item.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                      )}
                      {(canEdit || canForceEdit) && (
                        <td className={`text-center print:hidden sticky left-8 z-[5] shadow-[1px_0_0_0_hsl(var(--border))] ${selectedRowIds.has(item.id) ? 'bg-accent/10' : pending ? 'bg-muted/40' : scopeDraft ? 'bg-primary/5' : 'bg-background'}`}>
                          <div className="flex items-center gap-0.5 justify-center">
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="복제" onClick={() => handleDuplicate(item)}><Copy className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="삭제" onClick={() => handleDelete(item.id)}><Trash2 className="h-3 w-3" /></Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6" title="더보기"><MoreHorizontal className="h-3 w-3" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => { setExcludeDialogItem(item.id); setExcludeReason(''); }}>
                                  <Ban className="h-3 w-3 mr-2" /> 해당없음 처리
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      )}
                      <td className="text-center text-muted-foreground">{idx + 1}</td>
                      <td className="editable whitespace-nowrap">{(item.process || '').trim() ? <EditableCell item={item} field="process" /> : <span className="text-muted-foreground italic">(미분류)</span>}</td>
                      <td className="editable">
                        <div className="flex items-start gap-1">
                          {scopeDraft && !pending && (
                            <Badge variant="outline" className="text-[9px] h-4 shrink-0 mt-0.5">초안</Badge>
                          )}
                          <div className="min-w-0 flex-1"><EditableCell item={item} field="sub_task" /></div>
                        </div>
                      </td>
                      {pending ? (
                        <>
                          <td colSpan={4} className="py-2">
                            <div className="flex items-center gap-2 pr-2">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
                              <div className="flex-1 space-y-1.5">
                                <Skeleton className="h-3 w-[85%]" />
                                <Skeleton className="h-3 w-[60%]" />
                              </div>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">AI 채우는 중…</span>
                            </div>
                          </td>
                          <td className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></td>
                          <td className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></td>
                          <td className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></td>
                          {showResidualCols && (
                            <>
                              <td className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></td>
                              <td className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></td>
                              <td className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></td>
                            </>
                          )}
                          <td className="text-center"><Badge variant="outline" className="text-[9px]">생성중</Badge></td>
                          <td><Skeleton className="h-3 w-16" /></td>
                          <td><Skeleton className="h-3 w-20" /></td>
                          <td><Skeleton className="h-3 w-24" /></td>
                          {isClientSm && validationReport && <td><Skeleton className="h-3 w-10 mx-auto" /></td>}
                        </>
                      ) : (
                        <>
                      <td className="editable">
                        <div className="space-y-1">
                          <EditableCell item={item} field="hazard" />
                          {isAiFailedRiskItem(item) && (canEdit || canForceEdit) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1 border-destructive/40 text-destructive"
                              onClick={() => void handleRetryFailedRow(item)}
                            >
                              <RotateCcw className="h-3 w-3" /> 재시도
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="editable max-w-[200px]"><EditableCell item={item} field="hazard_situation" /></td>
                      <td className="editable max-w-[180px]"><EditableCell item={item} field="existing_measure" /></td>
                      <td className="editable max-w-[180px]"><EditableCell item={item} field="improvement_measure" /></td>
                      <td className="text-center editable"><GradeSelect item={item} field="likelihood_grade" /></td>
                      <td className="text-center editable"><GradeSelect item={item} field="severity_grade" /></td>
                      <td className="text-center"><span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(item.risk_grade || '중')}`}>{item.risk_grade || '중'}</span></td>
                      {(showResidualCols) && (
                        <>
                          <td className="text-center editable"><GradeSelect item={item} field="improved_likelihood_grade" /></td>
                          <td className="text-center editable"><GradeSelect item={item} field="improved_severity_grade" /></td>
                          <td className="text-center"><span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(item.improved_risk_grade || '하')}`}>{item.improved_risk_grade || '하'}</span></td>
                        </>
                      )}
                      <td className="text-center editable"><EditableCell item={item} field="status" /></td>
                      <td className="text-xs max-w-[120px] truncate">
                        {(item.ppe || []).join(', ') || '—'}
                        {item.note?.includes('[자동보완]') && (
                          <Badge variant="outline" className="text-[8px] ml-1 bg-accent/10 text-accent border-accent/30">자동보완</Badge>
                        )}
                      </td>
                      <td className="text-xs max-w-[150px] truncate">{(item.legal_basis || []).join(', ') || '—'}</td>
                      <td className="whitespace-nowrap">
                        {(canEdit || canForceEdit) ? (
                          <Select
                            value={(item as any).assignee_user_id || '__none__'}
                            onValueChange={(v) => v !== '__none__' && handleAssigneeChange(item.id, v)}
                          >
                            <SelectTrigger className="h-7 text-[11px] w-36"><SelectValue placeholder="선택" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">(미지정)</SelectItem>
                              {projectMembers.map(m => (
                                <SelectItem key={m.user_id} value={m.user_id}>
                                  {m.display_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground">{item.assignee || '—'}</span>
                        )}
                      </td>
                      {isClientSm && validationReport && (
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
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Excluded items section */}
      {excludedItems.length > 0 && (
        <Card className="print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">제외(해당없음) 항목 ({excludedItems.length}건)</CardTitle>
          </CardHeader>
          <CardContent className="max-h-40 overflow-y-auto space-y-1">
            {excludedItems.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between text-xs p-2 bg-muted/30 rounded">
                <div>
                  <span className="font-medium">{item.process} – {item.sub_task || ''}</span>
                  <span className="text-muted-foreground ml-2">사유: {item.excluded_reason || '(미입력)'}</span>
                </div>
                {(canEdit || canForceEdit) && (
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => handleRestoreItem(item.id)}>제외 해제</Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen} className="print:hidden">
        <div id="ra-worker-participation" className="scroll-mt-20 rounded-lg border">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between h-10 text-sm">
              <span>근거 · 근로자 참여 (의견 {participationCounts.opinions} · 보건 {participationCounts.healths})</span>
              {evidenceOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <WorkerParticipationPanel
              runId={runId!}
              projectId={run.project_id}
              userId={user?.id}
              canEdit={!!(canEdit || canForceEdit)}
              onChanged={refreshParticipation}
              riskItems={items as any}
              opinionRequired={run?.opinion_required ?? true}
              healthRequired={run?.health_required ?? true}
            />
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5" /> 근로자 참여 사진
                    {(run.worker_participation_images || []).length > 0 && (
                      <Badge variant="secondary" className="text-[9px] h-4 px-1">{(run.worker_participation_images || []).length}건</Badge>
                    )}
                  </h3>
                  {(canEdit || canForceEdit || isApproved) && (
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleWorkerPhotoUpload} disabled={workerPhotoUploading} />
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" asChild disabled={workerPhotoUploading}>
                        <span><Upload className="h-3 w-3" /> {workerPhotoUploading ? '업로드 중...' : '사진 추가'}</span>
                      </Button>
                    </label>
                  )}
                </div>
                {(run.worker_participation_images || []).length > 0 ? (
                  <div className="flex gap-2 flex-wrap">
                    {(run.worker_participation_images || []).map((url: string, i: number) => (
                      <div key={i} className="relative group">
                        <img src={url} alt={`참여사진${i + 1}`} className="w-20 h-20 rounded object-cover border cursor-pointer" onClick={() => window.open(url, '_blank')} />
                        {(canEdit || canForceEdit) && (
                          <button className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 text-[9px] hidden group-hover:flex items-center justify-center"
                            onClick={() => handleRemoveWorkerPhoto(i)}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">결재 상신 전 근로자 참여 사진을 업로드하세요.</p>
                )}
              </CardContent>
            </Card>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {runId && run?.project_id && !isApproved && uiStatus !== '폐기' && (
        <div id="ra-approval-line" className="print:hidden space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">참여자</CardTitle>
              <p className="text-[10px] text-muted-foreground font-normal">서명란은 위 결재 기록을 사용합니다. 여기에는 회차 참여자만 적습니다.</p>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="space-y-2">
                {participants.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                    <div><Badge variant="outline" className="text-[10px] mr-2">{p.role}</Badge>{p.user_name} {p.company && `(${p.company})`}</div>
                    {(canEdit || canForceEdit) && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteParticipant(p.id)}><Trash2 className="h-3 w-3" /></Button>
                    )}
                  </div>
                ))}
                {participants.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">참여자를 추가하세요.</p>
                )}
              </div>
              {(canEdit || canForceEdit) && (
                <div className="border-t pt-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Select value={newParticipant.role} onValueChange={v => setNewParticipant(p => ({ ...p, role: v }))}>
                      <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['작성자','검토자','승인자','협력사 담당자','안전관리자'].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="relative col-span-2">
                      <Input className="text-xs" placeholder="이름 검색..." value={participantSearch}
                        onChange={e => { setParticipantSearch(e.target.value); setShowUserSuggestions(true); }}
                        onFocus={() => setShowUserSuggestions(true)}
                      />
                      {showUserSuggestions && participantSearch.length > 0 && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {userDirectory.filter(u => u.display_name.toLowerCase().includes(participantSearch.toLowerCase())).slice(0, 8).map(u => (
                            <div key={u.user_id} className="px-3 py-2 text-xs cursor-pointer hover:bg-accent/20 flex items-center justify-between"
                              onClick={() => { setNewParticipant(p => ({ ...p, user_name: u.display_name, company: u.company || '' })); setParticipantSearch(u.display_name); setShowUserSuggestions(false); }}>
                              <span className="font-medium">{u.display_name}</span>
                              <span className="text-muted-foreground">{u.company || ''}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => { if (!profile) return; setNewParticipant({ role: '작성자', user_name: profile.display_name, company: profile.company || '' }); setParticipantSearch(profile.display_name); }}>현재 사용자</Button>
                    <Button size="sm" className="flex-1" onClick={() => { const name = newParticipant.user_name || participantSearch; if (!name) return; handleAddParticipant(); setParticipantSearch(''); }} disabled={!newParticipant.user_name && !participantSearch}>추가</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <ApprovalLineManager
            ref={approvalLineRef}
            projectId={run.project_id}
            projectMembers={approvalLineMembers}
            companies={projectCompanies}
            submitterCompanyId={userCompanyId || null}
            projectGcCompanyId={(project as any)?.gc_company_id || null}
            readOnly={isInApproval && !hasRejectedApproval}
            documentDraft={{
              entityType: 'assessment_run',
              entityId: runId,
              companyId: userCompanyId || null,
            }}
            onLinesChanged={handleApprovalLinesChanged}
            onDraftStatusChange={setApprovalDraftInfo}
          />
        </div>
      )}

        </TabsContent>
        <TabsContent value="execution" className="mt-4">
          {executionRun ? (
            <FeedbackPanel
              runId={executionRun.id}
              projectId={run.project_id}
              isApproved={!!executionApproved}
              riskItems={executionItems.map(i => ({ id: i.id, process: i.process, sub_task: i.sub_task, hazard: i.hazard, risk_grade: i.risk_grade, improved_risk_grade: i.improved_risk_grade }))}
              projectMembers={projectMembers}
              previousFeedback={executionIsPrevious ? [] : previousFeedback}
              hidePreviousUnresolved={executionIsPrevious}
              heading={executionIsPrevious
                ? `금주 이행 확인 · 전회차 ${previousRun?.period_label || ''}`
                : '금주 이행 확인'}
              helperText={executionIsPrevious
                ? '※ 이 화면의 차주 회차가 아니라, 전회차(금주 작업분)에 조치 전후 사진이 저장됩니다.'
                : '※ 이 회차가 금주 작업분입니다. 다음 회차 작성 시 전회차로 연결됩니다.'}
              feedbackStatus={executionFeedbackStatus || 'none'}
              submitterCompanyId={userCompanyId}
              onFeedbackStatusChange={(status) => {
                if (executionIsPrevious) {
                  setPreviousRun((prev) => (prev ? { ...prev, feedback_status: status } : prev));
                } else {
                  setRun((prev: any) => (prev ? { ...prev, feedback_status: status } : prev));
                }
              }}
            />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                전회차가 없어 금주 이행 확인 대상이 없습니다. 이 회차가 승인되면 다음 회차에서 연결됩니다.
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="forecast" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">차주 고위험 관리대상 (조치 사진 없음)</CardTitle>
              <p className="text-[11px] text-muted-foreground font-normal">
                이 회차에서 개선 후에도 위험도 &apos;상&apos;인 항목입니다. 조치 전후 사진은 금주(전회차) 탭에만 있습니다.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {forecastItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">차주 관리대상(개선 후 상) 항목이 없습니다.</p>
              ) : (
                forecastItems.map((item, idx) => (
                  <div key={item.id} className="rounded border p-2 text-xs space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{idx + 1}.</span>
                      <Badge variant="outline" className="text-[9px] text-destructive">상</Badge>
                      <span className="font-medium">{item.process}</span>
                    </div>
                    <p className="text-muted-foreground">{item.sub_task || ''} {item.hazard ? `· ${item.hazard}` : ''}</p>
                    {item.improvement_measure && (
                      <p>개선대책: {item.improvement_measure}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Auto Generate Dialog — compact field-card layout */}
      <Dialog open={showAutoGen} onOpenChange={(open) => {
        // Allow closing during generation — job continues in background with banner
        setShowAutoGen(open);
      }}>
        <DialogContent
          className="max-w-md sm:max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-5 gap-3"
          onPointerDownOutside={(e) => {
            if (autoGenLoading) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (autoGenLoading) e.preventDefault();
          }}
          onFocusOutside={(e) => {
            if (autoGenLoading) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            // Escape closes dialog but does not cancel the background job
            if (autoGenLoading) setShowAutoGen(false);
          }}
        >
          <DialogHeader className="space-y-1 pb-1">
            <DialogTitle className="text-base">초안 생성</DialogTitle>
            <p className="text-[11px] text-muted-foreground leading-snug">
              작업 순서로 쪼갠 뒤 단계별 위험요인·대책을 촘촘히 도출합니다. (산안법 위험성평가 지침)
            </p>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <Switch checked={autoGenUseAI} onCheckedChange={setAutoGenUseAI} />
              <Label className="text-xs font-medium">
                {autoGenUseAI ? '이전 평가 재사용 + 부족분 AI' : '표준 라이브러리 전용'}
              </Label>
            </div>
            {autoGenUseAI && (
              <p className="text-[10px] text-muted-foreground -mt-1 px-1 leading-snug">
                회사·프로젝트에서 승인된 같은 공종 항목을 먼저 가져오고, 부족한 세부작업만 AI로 보완합니다.
              </p>
            )}

            <div className="rounded-lg border bg-card p-3 space-y-2">
              <Label className="text-xs font-semibold">공종명 <span className="font-normal text-muted-foreground">(다중 · 쉼표/Enter)</span></Label>
              <div className="flex gap-2">
                <Input
                  className="h-9"
                  value={autoGenProcessInput}
                  onChange={e => setAutoGenProcessInput(e.target.value)}
                  placeholder="예: 굴착, 배관, 용접..."
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddProcessTag(); } }}
                />
                <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={handleAddProcessTag}>추가</Button>
              </div>
              {autoGenProcesses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {autoGenProcesses.map(p => (
                    <Badge key={p} variant="default" className="cursor-pointer text-[11px] h-7 gap-1" onClick={() => setAutoGenProcesses(prev => prev.filter(x => x !== p))}>
                      {p} ×
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {autoGenUseAI && (
              <div className="rounded-lg border bg-card p-3 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">작업위치</Label>
                  <Select value={autoGenWorkLocation || '__none__'} onValueChange={v => setAutoGenWorkLocation(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="선택 (미선택 시 일반)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">일반</SelectItem>
                      <SelectItem value="고소">고소작업</SelectItem>
                      <SelectItem value="지상">지상작업</SelectItem>
                      <SelectItem value="밀폐">밀폐공간</SelectItem>
                      <SelectItem value="지하">지하작업</SelectItem>
                      <SelectItem value="해상">해상작업</SelectItem>
                      <SelectItem value="기타">기타</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <ConditionTagPicker
                  value={autoGenConditionTags}
                  onChange={setAutoGenConditionTags}
                  suggestions={conditionTagSuggestions}
                />

                <SmartEquipmentTagInput
                  value={autoGenEquipmentTags}
                  onChange={setAutoGenEquipmentTags}
                  suggestions={equipmentSuggestions}
                />

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">현장 특이사항 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                  <Input
                    className="h-9 text-sm"
                    value={autoGenConditionText}
                    onChange={e => setAutoGenConditionText(e.target.value)}
                    placeholder="동시작업, 야간 교대, 인접 공사 등"
                  />
                </div>
              </div>
            )}

            {!autoGenUseAI && (
              <div className="rounded-lg border bg-card p-3">
                <ConditionTagPicker
                  value={autoGenConditionTags}
                  onChange={setAutoGenConditionTags}
                  suggestions={conditionTagSuggestions}
                />
              </div>
            )}

            <div className="rounded-lg border bg-card p-3 space-y-2">
              <Label className="text-xs font-semibold">평가 수준</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={autoGenDetailLevel === 'core' ? 'default' : 'outline'} size="sm" className="h-10 text-xs"
                  onClick={() => setAutoGenDetailLevel('core')}>핵심 항목만</Button>
                <Button type="button" variant={autoGenDetailLevel === 'comprehensive' ? 'default' : 'outline'} size="sm" className="h-10 text-xs"
                  onClick={() => setAutoGenDetailLevel('comprehensive')}>상세 항목까지</Button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                ① 이전 승인 평가 재사용 → 부족분 AI 초안 → 검수 → ② [나머지 채우기] · 사고사례는 별도 버튼
              </p>
            </div>

            <Button
              type="button"
              onClick={() => {
                console.log('[AutoGen] submit button clicked');
                void handleAutoGenerate();
              }}
              disabled={
                autoGenLoading ||
                (autoGenProcesses.length === 0 && !autoGenProcessInput.trim())
              }
              className="w-full h-11"
            >
              {autoGenLoading
                ? `생성 중… ${autoGenJob.elapsedSec || 0}초 · ${autoGenJob.message || autoGenPhaseLabel || '대기'}`
                : `초안 생성 · ${
                    autoGenProcesses.length ||
                    (autoGenProcessInput.trim() ? autoGenProcessInput.split(/[,，]/).filter((s) => s.trim()).length : 0)
                  }개 공종`}
            </Button>
            {autoGenLoading && (
              <p className="text-[11px] text-center text-muted-foreground">
                이 창을 닫아도 생성은 계속됩니다. 상단 진행 바에서 상태를 확인하세요.
              </p>
            )}
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
                  <TabsTrigger value="issues" className="flex-1">지적사항 ({validationReport.totalIssues})</TabsTrigger>
                  <TabsTrigger value="coverage" className="flex-1">누락 검증 ({validationReport.coverageGaps.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="max-h-60 overflow-y-auto space-y-1">
                  {activeItems.map((item, idx) => {
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
                    const item = activeItems.find(it => it.id === issue.riskItemId);
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
                  {excludedItems.length > 0 && (
                    <div className="mt-3 border-t pt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-1">의도적 제외 항목 ({excludedItems.length}건)</p>
                      {excludedItems.map((item: any) => (
                        <div key={item.id} className="text-[10px] p-1.5 rounded bg-muted/30 mb-0.5">
                          {item.process} – {item.sub_task || ''}: <span className="italic">{item.excluded_reason || '(사유 미입력)'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5" onClick={handleExportValidationPDF}>
                  <FileText className="h-3.5 w-3.5" /> 검증 리포트 PDF
                </Button>
                {items.some((it) => isFillableRiskItem(it)) && (canEdit || canForceEdit) ? (
                  <Button className="flex-1 gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => {
                    setShowValidation(false);
                    const ok = continueRiskAutoGenFill(runId);
                    toast({
                      title: ok ? '나머지 채우기를 시작했습니다.' : '채움을 시작할 수 없습니다.',
                      description: ok ? '행별 위험요인에 맞춰 개선대책·PPE·법규를 채웁니다.' : undefined,
                      variant: ok ? 'default' : 'destructive',
                    });
                  }} disabled={isRiskAutoGenRunning()}>
                    <Wand2 className="h-3.5 w-3.5" /> 나머지 채우기 (AI)
                  </Button>
                ) : canAutoRemediate && (
                  <Button className="flex-1 gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => { setShowValidation(false); handleOpenRemediationWizard(); }} disabled={remediationLoading}>
                    <Wand2 className="h-3.5 w-3.5" /> 자동 보완
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approval Dialog */}
      <Dialog open={showApproval} onOpenChange={setShowApproval}>
        <DialogContent className="max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>결재 상신 · {run.period_label}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            <p className="text-sm text-muted-foreground">이 회차 전체({activeItems.length}건)를 결재 상신합니다.</p>

            <div className={`rounded-lg border p-3 space-y-2 ${submitPreflight.ready ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">
                  상신 전 점검 {submitPreflight.ready ? '· 준비됨' : `· 미완료 ${submitPreflight.items.filter(i => !i.ok).length}건`}
                </p>
                <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => void refreshApprovalPreflightMeta()}>
                  새로고침
                </Button>
              </div>
              <ul className="space-y-1.5">
                {submitPreflight.items.map((it) => (
                  <li key={it.id} className="flex items-start gap-2 text-xs">
                    {it.ok
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                      : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <p className={it.ok ? 'text-muted-foreground' : 'font-medium text-foreground'}>{it.label}</p>
                      {it.detail && <p className="text-[10px] text-muted-foreground">{it.detail}</p>}
                    </div>
                    {!it.ok && it.jump && (
                      <button
                        type="button"
                        className="text-[10px] text-primary underline shrink-0"
                        onClick={() => jumpFromPreflight(it.jump)}
                      >
                        바로가기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* 결재선은 본문에서만 편집 — 상신 Dialog 는 읽기 전용 요약 */}
            <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">결재선 (임시 저장본)</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px]"
                  onClick={() => jumpFromPreflight('approval')}
                >
                  결재선 수정
                </Button>
              </div>
              {approvalDraftInfo.ready && approvalLines.length > 0 ? (
                <ol className="space-y-1 text-xs">
                  {approvalLines.map((l, i) => (
                    <li key={`${l.position}-${i}`} className="flex gap-2">
                      <span className="text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                      <span className="font-medium">{l.step_label || l.position}</span>
                      <span>{l.user_name || '—'}</span>
                      <span className="text-muted-foreground">{l.company_name || ''}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[11px] text-destructive">
                  저장된 결재선이 없습니다. 본문 [결재선 설정]에서 저장하세요.
                </p>
              )}
            </div>

            {run.validation_verdict && run.validation_verdict !== '적정' && (
              <div className={`p-2 rounded text-sm flex items-start gap-2 ${run.validation_verdict === '부적정' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{run.validation_verdict === '부적정' ? '부적정 항목이 있습니다.' : `검증 결과: ${run.validation_verdict}`} ({run.validation_score}점)</p>
                  <p className="text-xs mt-0.5 opacity-80">검증 결과는 참고용입니다. 그래도 진행하시겠습니까?</p>
                </div>
              </div>
            )}
            {run.validation_verdict === '적정' && (
              <div className="p-2 rounded text-sm bg-success/10 text-success">
                ✅ 검증 결과: 적정 ({run.validation_score}점)
              </div>
            )}
            {!run.validation_verdict && (
              <div className="p-2 rounded text-sm bg-muted text-muted-foreground flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>검증이 아직 실행되지 않았습니다. 검증 없이 결재를 진행합니다.</p>
              </div>
            )}
            {(() => {
              const residual = evaluateResidualHigh({
                total: stats.total,
                highInitial: stats.high,
                highRemain: stats.highRemain,
              });
              if (residual.level === 'ok' && !residual.message) return null;
              return (
                <div
                  className={`p-2 rounded text-sm flex items-start gap-2 ${
                    residual.level === 'ok'
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-warning/10 text-warning'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">개선후 위험도 「상」 가드레일 (참고)</p>
                    <p className="text-xs mt-0.5 opacity-90">{residual.message}</p>
                    {residual.level !== 'ok' && (
                      <p className="text-xs mt-1 opacity-70">상신은 가능합니다. 확인 후 진행하세요.</p>
                    )}
                  </div>
                </div>
              );
            })()}
            <div className="space-y-1"><Label>코멘트 (선택)</Label><Textarea value={approvalComment} onChange={e => setApprovalComment(e.target.value)} placeholder="결재 메모..." /></div>
            {!submitPreflight.ready && submitBlockedReason && (
              <p className="text-[11px] text-destructive">{submitBlockedReason}</p>
            )}
            <Button
              onClick={handleSubmitForApproval}
              className="w-full gap-1.5"
              disabled={!submitPreflight.ready || (!approvalDraftInfo.ready && !approvalDraftInfo.dirty)}
              title={
                submitPreflight.ready && (approvalDraftInfo.ready || approvalDraftInfo.dirty)
                  ? undefined
                  : submitBlockedReason || '결재선 저장 후 상신하세요'
              }
            >
              <Send className="h-3.5 w-3.5" />
              {submitPreflight.ready && (approvalDraftInfo.ready || approvalDraftInfo.dirty)
                ? (isReturned ? '재상신' : '결재 상신')
                : '점검/결재선 미완료 — 상신 불가'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Exclude Item Dialog */}
      <Dialog open={!!excludeDialogItem} onOpenChange={() => { setExcludeDialogItem(null); setExcludeReason(''); }}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>해당없음 처리</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">이 항목을 '해당없음'으로 처리하면 검증 시 누락으로 잡히지 않습니다.</p>
            <div className="space-y-1">
              <Label>제외 사유 (필수)</Label>
              <Textarea value={excludeReason} onChange={e => setExcludeReason(e.target.value)} placeholder="예: 해당 회차 범위에 미포함, 작업 미수행, 현장 조건상 없음..." rows={2} />
            </div>
            <Button onClick={() => excludeDialogItem && handleExcludeItem(excludeDialogItem, excludeReason)} className="w-full" disabled={!excludeReason.trim()}>
              <Ban className="h-3.5 w-3.5 mr-1.5" /> 해당없음 처리
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive Dialog */}
      <Dialog open={showArchive} onOpenChange={setShowArchive}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>회차 폐기</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-destructive">⚠ 폐기된 회차는 목록에서 비활성 표시됩니다.</p>
            <div className="space-y-1"><Label>삭제 사유 (필수)</Label><Textarea value={archiveReason} onChange={e => setArchiveReason(e.target.value)} placeholder="삭제 사유를 입력하세요..." rows={3} /></div>
            <Button onClick={handleArchive} variant="destructive" className="w-full" disabled={!archiveReason.trim()}>폐기 확인</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Excel Upload Dialog */}
      <Dialog open={showExcelUpload} onOpenChange={setShowExcelUpload}>
        <DialogContent className="max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>협력사 엑셀 업로드 검증</DialogTitle></DialogHeader>
          {excelStep === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                협력사가 제공한 위험성평가 엑셀(XLSX/CSV)을 선택하면 바로 읽습니다. 별도 저장 버튼은 없습니다.
                표지/안내 시트나 제목 행이 있어도 공정·위험요인 표를 찾아 갑니다.
              </p>
              <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFileChange} />
              {excelFileName && (
                <p className="text-xs text-muted-foreground">선택됨: {excelFileName}</p>
              )}
              {excelParseError && (
                <p className="text-sm text-destructive whitespace-pre-wrap">{excelParseError}</p>
              )}
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
                  { key: 'risk_grade', label: '위험도' },
                  { key: 'improved_severity_grade', label: '개선후 중대성' },
                  { key: 'improved_likelihood_grade', label: '개선후 가능성' },
                  { key: 'improved_risk_grade', label: '개선후 위험도' },
                  { key: 'legal_basis', label: '법적근거' },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs w-28 shrink-0">{label}</span>
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
              <Button onClick={handleExcelValidate} className="w-full">검증 실행</Button>
            </div>
          )}
          {excelStep === 'result' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3 bg-muted rounded-lg"><p className="text-xl font-bold">{excelData.length}</p><p className="text-xs text-muted-foreground">총 행수</p></div>
                <div className={`p-3 rounded-lg ${excelIssues.length === 0 ? 'bg-success/10' : 'bg-warning/10'}`}><p className="text-xl font-bold">{excelIssues.length}</p><p className="text-xs text-muted-foreground">지적사항</p></div>
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
                <Button variant="outline" className="flex-1" onClick={() => setShowExcelUpload(false)}>닫기</Button>
                <Button className="flex-1 gap-1.5" onClick={handleExcelImport}><Upload className="h-3.5 w-3.5" /> 반영 ({excelData.length}건)</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Unified Remediation Wizard */}
      <Dialog open={showRemediationWizard} onOpenChange={setShowRemediationWizard}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-accent" /> 자동 보완 · {remediationActions.length}건 제안
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {remediationLoading ? (
              <div className="text-center py-8 text-muted-foreground">보완 항목 분석 중...</div>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-4 gap-3 text-center text-xs">
                  <div className="p-2 bg-muted rounded"><p className="text-lg font-bold">{remediationActions.length}</p><p className="text-muted-foreground">전체</p></div>
                  <div className="p-2 bg-accent/10 rounded"><p className="text-lg font-bold">{selectedActionIds.size}</p><p className="text-muted-foreground">선택</p></div>
                  <div className="p-2 bg-muted rounded"><p className="text-lg font-bold">{remediationActions.filter(a => a.requiresUserConfirm).length}</p><p className="text-muted-foreground">수동확인</p></div>
                  <div className="p-2 bg-muted rounded"><p className="text-lg font-bold">{remediationActions.filter(a => a.confidence === 'high').length}</p><p className="text-muted-foreground">높은 신뢰</p></div>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedActionIds(new Set(remediationActions.map(a => a.id)))}>전체 선택</Button>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedActionIds(new Set())}>전체 해제</Button>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedActionIds(new Set(remediationActions.filter(a => !a.requiresUserConfirm).map(a => a.id)))}>자동만</Button>
                  <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive" onClick={async () => {
                    if (!run || !runId || !user) return;

                    const selectedActions = remediationActions.filter(a => selectedActionIds.has(a.id));
                    const targetIds = new Set<string>();
                    const recommendationKeys = new Set<string>();

                    selectedActions.forEach((action) => {
                      action.targetRiskItemIds.forEach((id) => targetIds.add(id));
                      (action.newItems || []).forEach((ni) => recommendationKeys.add(recommendationKey(ni as any)));
                    });

                    if (targetIds.size === 0 && recommendationKeys.size === 0) {
                      toast({ title: '제외할 대상 항목이 없습니다.', variant: 'destructive' });
                      return;
                    }

                    if (targetIds.size > 0) {
                      await supabase
                        .from('risk_items')
                        .update({
                          is_excluded: true,
                          excluded_at: new Date().toISOString(),
                          excluded_by: user.id,
                          excluded_reason: '자동보완 제외 처리',
                        })
                        .in('id', [...targetIds]);
                    }

                    let dismissedCount = 0;
                    if (recommendationKeys.size > 0) {
                      const keys = [...recommendationKeys];
                      const { data: existingDismissed } = await supabase
                        .from('dismissed_recommendations')
                        .select('gap_key')
                        .eq('run_id', runId)
                        .in('gap_key', keys);

                      const existing = new Set((existingDismissed || []).map((d) => d.gap_key));
                      const inserts = keys
                        .filter((key) => !existing.has(key))
                        .map((gap_key) => ({
                          project_id: run.project_id,
                          run_id: runId,
                          gap_key,
                          dismissed_by: user.id,
                        }));

                      if (inserts.length > 0) {
                        await supabase.from('dismissed_recommendations').insert(inserts);
                      }

                      dismissedCount = keys.length;
                    }

                    const { data: refreshed } = await supabase
                      .from('risk_items')
                      .select('*')
                      .eq('run_id', runId)
                      .order('sort_order');
                    if (refreshed) setItems(refreshed);

                    setRemediationActions((prev) => prev.filter((a) => !selectedActionIds.has(a.id)));
                    setSelectedActionIds(new Set());

                    toast({
                      title: `제외 처리 완료`,
                      description: `항목 제외 ${targetIds.size}건 · 추천 무시 ${dismissedCount}건`,
                    });
                    log('제외처리', 'risk_items', runId, run.project_id, {
                      excludedItems: targetIds.size,
                      dismissedRecommendations: dismissedCount,
                    });

                    // Auto re-validate after exclusion (참고용 — 상태 전환 없음)
                    const currentItems = (refreshed || items).filter((i: any) => !i.is_excluded);
                    const reReport = await validateRiskItems(currentItems, run.project_id);
                    setValidationReport(reReport);
                    await saveValidationResults(reReport, run.project_id, user.id, runId);
                    await supabase.from('assessment_runs').update({
                      validation_score: reReport.score,
                      validation_verdict: reReport.verdict,
                    }).eq('id', runId);
                    setRun((prev: any) => ({
                      ...prev,
                      validation_score: reReport.score,
                      validation_verdict: reReport.verdict,
                    }));

                    // If no more actions remain, close wizard automatically
                    const remaining = remediationActions.filter((a) => !selectedActionIds.has(a.id));
                    if (remaining.length === 0 || remaining.every((a) => a.actionType === 'ACTION_CREATE_REMEDIATION_SUMMARY')) {
                      setShowRemediationWizard(false);
                      toast({
                        title: `재검증: ${reReport.verdict} (${reReport.score}점)`,
                        description: '검증 결과는 참고용입니다.',
                      });
                    }
                  }}>
                    <Ban className="h-3 w-3 mr-1" /> 제외
                  </Button>
                  <div className="flex-1" />
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox checked={applyAndRevalidate} onCheckedChange={(c) => setApplyAndRevalidate(!!c)} />
                    <span>적용 후 재검증</span>
                  </label>
                </div>

                {/* Action list */}
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
                        return (
                          <div key={action.id} className={`text-xs p-3 rounded border cursor-pointer transition-colors ${isSelected ? 'border-accent/50 bg-accent/5' : 'border-border hover:bg-muted/50'} ${action.requiresUserConfirm ? 'border-l-2 border-l-warning' : ''}`}
                            onClick={() => setSelectedActionIds(prev => { const next = new Set(prev); if (next.has(action.id)) next.delete(action.id); else next.add(action.id); return next; })}>
                            <div className="flex items-start gap-2">
                              <Checkbox checked={isSelected} className="mt-0.5" />
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{action.label}</span>
                                  <Badge variant="outline" className={`text-[9px] ${action.confidence === 'high' ? 'text-success' : action.confidence === 'medium' ? 'text-warning' : 'text-muted-foreground'}`}>
                                    {action.confidence === 'high' ? '높음' : action.confidence === 'medium' ? '보통' : '낮음'}
                                  </Badge>
                                  {action.requiresUserConfirm && <Badge variant="outline" className="text-[9px] text-warning">수동확인</Badge>}
                                </div>
                                <p className="text-muted-foreground">{action.description}</p>
                                <p className="text-accent text-[10px]">→ {action.expectedEffect}</p>
                                {Object.keys(action.patch).length > 0 && (
                                  <details className="mt-1">
                                    <summary className="text-[10px] text-muted-foreground cursor-pointer">변경 미리보기</summary>
                                    <div className="mt-1 p-2 bg-muted/50 rounded text-[10px] space-y-0.5">
                                      {Object.entries(action.patch).map(([field, val]) => (
                                        <div key={field}><span className="font-medium">{field}:</span> <span className="text-accent">{Array.isArray(val) ? val.join(', ') : String(val).slice(0, 100)}</span></div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                                {action.newItems && action.newItems.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="text-[10px] text-muted-foreground cursor-pointer">추가 항목 ({action.newItems.length}건)</summary>
                                    <div className="mt-1 p-2 bg-muted/50 rounded text-[10px] max-h-32 overflow-y-auto">
                                      {action.newItems.map((ni, idx) => <div key={idx}>#{idx + 1} {ni.process} – {ni.sub_task} – {ni.hazard}</div>)}
                                    </div>
                                  </details>
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

                <div className="flex gap-2 pt-2 border-t">
                  <Button variant="outline" className="flex-1" onClick={() => {
                    setShowRemediationWizard(false);
                  }}>닫기</Button>
                  <Button className="flex-1 gap-1.5" onClick={handleApplyRemediation} disabled={selectedActionIds.size === 0 || remediationLoading}>
                    <Wand2 className="h-3.5 w-3.5" />
                    {remediationLoading ? '적용 중...' : `${selectedActionIds.size}건 보완 적용${applyAndRevalidate ? ' + 재검증' : ''}`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Batch Apply Assignee Dialog */}
      <Dialog open={showBatchApply} onOpenChange={setShowBatchApply}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>담당자 일괄 지정</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>담당자</Label>
              <Select value={batchAssigneeUserId || '__none__'} onValueChange={v => setBatchAssigneeUserId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="담당자 선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(선택)</SelectItem>
                  {projectMembers.map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                {selectedRowIds.size > 0 ? `선택한 ${selectedRowIds.size}행에 적용합니다.` : '담당자가 비어 있는 행만 채웁니다.'}
              </p>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">고급</summary>
              <div className="mt-2 space-y-2">
                <Select value={batchScope} onValueChange={(v: 'empty' | 'all' | 'selected') => setBatchScope(v)}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empty">빈 칸만 채우기</SelectItem>
                    <SelectItem value="all">전체 항목 덮어쓰기</SelectItem>
                    <SelectItem value="selected" disabled={selectedRowIds.size === 0}>선택한 행만 ({selectedRowIds.size}건)</SelectItem>
                  </SelectContent>
                </Select>
                {batchScope !== 'empty' && (
                  <div className="flex items-center gap-2">
                    <Checkbox checked={batchOverrideManual} onCheckedChange={(c) => setBatchOverrideManual(!!c)} />
                    <span className="text-muted-foreground">이미 지정된 담당자도 덮어쓰기</span>
                  </div>
                )}
              </div>
            </details>
            <Button onClick={handleBatchApply} className="w-full gap-1.5" disabled={!batchAssigneeUserId || batchApplyLoading}>
              <Users className="h-3.5 w-3.5" /> {batchApplyLoading ? '적용 중...' : '일괄 적용'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showApproveConfirm} onOpenChange={setShowApproveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 단계를 승인할까요?</AlertDialogTitle>
            <AlertDialogDescription>승인하면 다음 결재자에게 넘어가거나 최종 완료됩니다. 반려가 필요하면 취소 후 반려를 누르세요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowApproveConfirm(false); void handleFinalApproval('승인'); }}>승인</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {run && (
        <CloneRunDialog
          open={showCloneRun || showRevision}
          onOpenChange={(open) => { setShowCloneRun(open); setShowRevision(open); }}
          run={run}
          onCloned={() => { setShowCloneRun(false); setShowRevision(false); }}
        />
      )}
      {run && (
        <EditRunDialog
          open={showEditRun}
          onOpenChange={setShowEditRun}
          run={run}
          onSaved={() => { setShowEditRun(false); void fetchAll(); }}
        />
      )}
    </div>
  );
};

export default function AssessmentRunDetailPage() {
  return (
    <AppErrorBoundary>
      <AssessmentRunDetail />
    </AppErrorBoundary>
  );
}
