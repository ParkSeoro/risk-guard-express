/**
 * 허가서 표시 양식 (마스터)
 * - 기본 표준(company_id null): 복제 안 한 회사 전체 기본
 * - 회사별 복제: 해당 회사 문서만 오버라이드
 *
 * 절대 하지 않음: 결재 규칙/RPC, form_data 키, DigPermitForm 구조 변경.
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSignature, Trash2, Save, Eye, Copy, Info } from 'lucide-react';
import DigPermitForm, {
  type PermitFormData,
  type PermitSignatures,
  type PermitType,
} from '@/components/permits/DigPermitForm';
import StandardPermitSheet from '@/components/permits/StandardPermitSheet';
import StandardStyleEditor from '@/components/permit-designer/StandardStyleEditor';
import type { StandardStyle, StandardLabels } from '@/lib/permitStandardStyle';
import {
  DEFAULT_STANDARD_LABELS,
  DEFAULT_STANDARD_STYLE,
  PERMIT_TYPE_LABEL,
} from '@/lib/permitStandardStyle';
import {
  buildCloneLayoutJson,
  emptyDisplayTemplate,
  GLOBAL_STANDARD_COMPANY_KEY,
  normalizeDisplayTemplate,
  parseLayoutJson,
  PERMIT_KIND_CLONE_META,
  pickPermitDisplayTemplateWithSource,
  resolvePermitFormGcCompanyId,
  sectionsForKind,
  type PermitDisplaySectionId,
  type PermitDisplayTemplate,
  type PermitLayoutJson,
  type PermitTemplateSourceScope,
  type ProjectCompanyLink,
} from '@/lib/permitDisplayTemplate';

type CompanyOpt = { id: string; name: string; type: string | null };
type ProjectOpt = {
  id: string;
  name: string;
  gc_company_id?: string | null;
  gc_company_ids?: string[] | null;
};
const GLOBAL_PROJECT_KEY = '__global_project__';
const PROJECT_ALL_COMPANIES_KEY = '__project_all_companies__';

type Tpl = {
  id: string;
  project_id: string | null;
  company_id: string | null;
  code: string;
  name: string;
  version: string;
  layout_json: PermitLayoutJson;
  is_default: boolean;
  is_active: boolean;
  permit_type: PermitType;
  updated_at: string;
};

type EffectiveTplItem = {
  permitType: PermitType;
  template: Tpl;
  sourceScope: PermitTemplateSourceScope;
  sourceLabel: string;
  isDirect: boolean;
};

type SelectedSourceInfo = {
  sourceScope: PermitTemplateSourceScope;
  sourceLabel: string;
  isDirect: boolean;
};

/** 설정 화면용 — 키 옆에 한글 설명 (찾기 쉽게) */
const LABEL_KEY_TITLE: Record<string, string> = {
  approverCompany: '승인업체명',
  docNoPrefix: '문서번호 접두사',
  'general.title': '일반 — 제목',
  'general.contractor': '일반 — 공사업체',
  'general.approverCompany': '일반 — 승인업체 라벨',
  'general.cooperationDept': '일반 — 협조부서',
  'general.reviewDate': '일반 — 검토일',
  'general.approveDate': '일반 — 승인일',
  'general.workDatetime': '일반 — 작업일시',
  'general.workName': '일반 — 작업명',
  'general.workDescription': '일반 — 작업내용',
  'general.workLocation': '일반 — 작업장소',
  'general.personnel': '일반 — 투입인원',
  'general.attachments': '일반 — 첨부서류',
  'general.safetyChecklist': '일반 — 안전조치',
  'general.hazardConfirm': '일반 — 위험작업 확인',
  'general.gasMeasurement': '일반 — 가스측정',
  'general.siteConfirm': '일반 — 작업완료 확인',
  'general.extension': '일반 — 연장 작업',
  'general.footerNote': '일반 — 하단 안내',
  'confined_space.title': '밀폐 — 제목',
  'hot_work.title': '화기 — 제목',
  'excavation.title': '굴착 — 제목',
};

const PREVIEW_DATA: PermitFormData = {
  contractor_company: '(주)샘플건설',
  work_name: '배관 용접 작업',
  work_description: '냉각탑 상부 배관 T-이음 용접',
  work_location: '냉각탑 3F 배관 랙',
  personnel_count: 4,
  applicant_company: '(주)샘플건설',
  applicant_name: '홍길동',
};

const PREVIEW_SIGS: PermitSignatures = {
  contractor_pic: { name: '김시공', signature: '', signed_at: '2026-07-21T09:00:00.000Z' },
  safety_pic: { name: '박안전', signature: '', signed_at: '2026-07-21T10:00:00.000Z' },
  site_director: { name: '이소장', signature: '', signed_at: '2026-07-22T08:30:00.000Z' },
  cm: { name: '최CM', signature: '', signed_at: '2026-07-22T09:10:00.000Z' },
  sm: { name: '정SM', signature: '', signed_at: '2026-07-22T09:30:00.000Z' },
  approved_at: '2026-07-22T09:30:00.000Z',
  reviewed_at: '2026-07-21T09:30:00.000Z',
};

export default function SettingsPermitForms() {
  const { hasRole, user } = useAuth();
  const { toast } = useToast();
  const isMaster = hasRole('master');

  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(GLOBAL_PROJECT_KEY);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState<string>(GLOBAL_STANDARD_COMPANY_KEY);
  const [globalStandards, setGlobalStandards] = useState<Tpl[]>([]);
  const [cloneSourceId, setCloneSourceId] = useState<string>('__default__');
  const [rows, setRows] = useState<Tpl[]>([]);
  const [effectiveRows, setEffectiveRows] = useState<EffectiveTplItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Tpl | null>(null);
  const [selectedSource, setSelectedSource] = useState<SelectedSourceInfo | null>(null);
  const [style, setStyle] = useState<Partial<StandardStyle>>(DEFAULT_STANDARD_STYLE);
  const [stdLabels, setStdLabels] = useState<Partial<StandardLabels>>(DEFAULT_STANDARD_LABELS);
  const [display, setDisplay] = useState<PermitDisplayTemplate>(emptyDisplayTemplate());
  const [tab, setTab] = useState('labels');
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);

  const isGlobalProject = selectedProjectId === GLOBAL_PROJECT_KEY;
  const dbProjectId = isGlobalProject ? null : selectedProjectId;
  const isGlobalScope = isGlobalProject && companyId === GLOBAL_STANDARD_COMPANY_KEY;
  const isProjectAllScope = !isGlobalProject && companyId === PROJECT_ALL_COMPANIES_KEY;
  const dbCompanyId = isGlobalScope || isProjectAllScope ? null : companyId;
  const isReadOnlyInherited = Boolean(selected && selectedSource && !selectedSource.isDirect);

  const loadProjectsAndGlobalStandards = async () => {
    const [{ data: projRows }, { data: stdRows }] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, gc_company_id, gc_company_ids')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false }),
      supabase
        .from('permit_form_templates')
        .select('id, project_id, company_id, code, name, version, layout_json, is_default, is_active, permit_type, updated_at')
        .eq('is_deleted', false)
        .eq('is_active', true)
        .is('company_id', null)
        .is('project_id', null)
        .order('is_default', { ascending: false })
        .order('name'),
    ]);
    setProjects((projRows || []) as ProjectOpt[]);
    setGlobalStandards(
      (stdRows || []).map((r: any) => ({
        ...r,
        project_id: null,
        company_id: null,
        permit_type: (r.permit_type || 'general') as PermitType,
        layout_json: parseLayoutJson(r.layout_json),
      })),
    );
  };

  const loadCompanies = async (projKey: string) => {
    if (projKey !== GLOBAL_PROJECT_KEY) {
      const { data, error } = await (supabase as any)
        .from('project_companies')
        .select('company_id, role_in_project, companies:company_id(id, name, type, is_deleted)')
        .eq('project_id', projKey)
        .eq('is_deleted', false);
      if (error) {
        toast({ title: '현장 업체 목록 실패', description: error.message, variant: 'destructive' });
        setCompanies([]);
        return;
      }
      const list: CompanyOpt[] = ((data || []) as any[])
        .filter((l) => l.companies && l.companies.is_deleted !== true)
        .map((l) => ({
          id: l.companies.id,
          name: l.companies.name,
          type: l.role_in_project || l.companies.type || null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      setCompanies(list);
      return;
    }

    const { data, error } = await supabase
      .from('companies')
      .select('id, name, type')
      .eq('is_deleted', false)
      .order('name');
    if (error) {
      toast({ title: '회사 목록 실패', description: error.message, variant: 'destructive' });
      return;
    }
    const all = (data || []) as CompanyOpt[];
    const preferred = all.filter((c) => c.type === 'client' || c.type === 'gc');
    setCompanies(preferred.length > 0 ? preferred : all);
  };

  const openEdit = (
    t: Tpl,
    source: SelectedSourceInfo | null = null,
    initialTab: 'labels' | 'preview' = 'labels',
  ) => {
    const layout = parseLayoutJson(t.layout_json);
    setSelected(t);
    setSelectedSource(source);
    setStyle(layout.standard_style || DEFAULT_STANDARD_STYLE);
    setStdLabels(layout.standard_labels || DEFAULT_STANDARD_LABELS);
    setDisplay(normalizeDisplayTemplate(layout.display_template || emptyDisplayTemplate()));
    setTab(initialTab);
  };

  const loadTemplates = async (projKey: string, cid: string) => {
    if (!cid) {
      setRows([]);
      setEffectiveRows([]);
      setSelected(null);
      setSelectedSource(null);
      setLoading(false);
      return;
    }
    const globalProj = projKey === GLOBAL_PROJECT_KEY;
    const globalStd = globalProj && cid === GLOBAL_STANDARD_COMPANY_KEY;
    const projAll = !globalProj && cid === PROJECT_ALL_COMPANIES_KEY;

    // Guard against mismatched sentinel keys during project switching
    if (globalProj && cid === PROJECT_ALL_COMPANIES_KEY) {
      setLoading(false);
      return;
    }
    if (!globalProj && cid === GLOBAL_STANDARD_COMPANY_KEY) {
      setLoading(false);
      return;
    }

    setLoading(true);

    let directQuery = supabase
      .from('permit_form_templates')
      .select('id, project_id, company_id, code, name, version, layout_json, is_default, is_active, permit_type, updated_at')
      .eq('is_deleted', false)
      .order('permit_type')
      .order('updated_at', { ascending: false });

    if (globalStd) {
      directQuery = directQuery.is('company_id', null).is('project_id', null);
    } else if (globalProj) {
      directQuery = directQuery.is('project_id', null).eq('company_id', cid);
    } else if (projAll) {
      directQuery = directQuery.eq('project_id', projKey).is('company_id', null);
    } else {
      directQuery = directQuery.eq('project_id', projKey).eq('company_id', cid);
    }

    const candidateQuery = globalStd
      ? Promise.resolve({ data: [] as any[], error: null })
      : (() => {
          let cq = supabase
            .from('permit_form_templates')
            .select('id, project_id, company_id, code, name, version, layout_json, is_default, is_active, permit_type, updated_at')
            .eq('is_deleted', false)
            .eq('is_active', true);
          if (globalProj) {
            cq = cq.is('project_id', null);
          } else {
            cq = cq.or(`project_id.eq.${projKey},project_id.is.null`);
          }
          return cq;
        })();

    const linksQuery = !globalProj
      ? (supabase as any)
          .from('project_companies')
          .select('company_id, parent_company_id, role_in_project')
          .eq('project_id', projKey)
          .eq('is_deleted', false)
      : Promise.resolve({ data: [] as any[], error: null });

    const [directRes, candidateRes, linksRes] = await Promise.all([
      directQuery,
      candidateQuery,
      linksQuery,
    ]);

    if (directRes.error) {
      toast({ title: '불러오기 실패', description: directRes.error.message, variant: 'destructive' });
      setRows([]);
      setEffectiveRows([]);
      setSelected(null);
      setSelectedSource(null);
      setLoading(false);
      return;
    }

    const toTpl = (r: any): Tpl => ({
      ...r,
      project_id: r.project_id || null,
      company_id: r.company_id || null,
      permit_type: (r.permit_type || 'general') as PermitType,
      layout_json: parseLayoutJson(r.layout_json),
    });

    const nextRows: Tpl[] = (directRes.data || []).map(toTpl);
    setRows(nextRows);

    const directIds = new Set(nextRows.map((r) => r.id));
    let nextEffective: EffectiveTplItem[] = [];

    if (!globalStd && !candidateRes.error) {
      const candidates: Tpl[] = (candidateRes.data || []).map(toTpl);
      const targetProjectId = globalProj ? null : projKey;
      const targetCompanyId = projAll ? null : cid;
      const projObj = targetProjectId ? projects.find((p) => p.id === targetProjectId) || null : null;
      const links: ProjectCompanyLink[] = (linksRes.data || []) as ProjectCompanyLink[];
      const gcId = targetCompanyId
        ? resolvePermitFormGcCompanyId({
            permitCompanyId: targetCompanyId,
            projectCompanyLinks: links,
            project: projObj,
          })
        : null;

      for (const meta of PERMIT_KIND_CLONE_META) {
        const match = pickPermitDisplayTemplateWithSource({
          templates: candidates,
          projectId: targetProjectId,
          permitCompanyId: targetCompanyId,
          gcCompanyId: gcId,
          permitType: meta.permit_type,
        });
        if (match) {
          const tpl = candidates.find((c) => c.id === match.template.id) || toTpl(match.template);
          nextEffective.push({
            permitType: meta.permit_type,
            template: tpl,
            sourceScope: match.sourceScope,
            sourceLabel: match.sourceLabel,
            isDirect: directIds.has(tpl.id),
          });
        }
      }
    }

    setEffectiveRows(nextEffective);

    // Auto-select first direct template (edit mode), or first effective inherited template (read-only preview)
    if (nextRows.length > 0) {
      const first = nextRows[0];
      const matchedEff = nextEffective.find((e) => e.template.id === first.id);
      openEdit(
        first,
        matchedEff
          ? { sourceScope: matchedEff.sourceScope, sourceLabel: matchedEff.sourceLabel, isDirect: true }
          : {
              sourceScope: globalStd
                ? 'global_standard'
                : projAll
                  ? 'project_all'
                  : globalProj
                    ? 'global_company'
                    : 'project_company',
              sourceLabel: globalStd
                ? '전체 기본 표준'
                : projAll
                  ? '이 프로젝트 전체 기본'
                  : globalProj
                    ? '전역 회사 양식'
                    : '이 프로젝트 · 이 업체 전용',
              isDirect: true,
            },
        'labels',
      );
    } else if (nextEffective.length > 0) {
      const firstEff = nextEffective[0];
      openEdit(
        firstEff.template,
        {
          sourceScope: firstEff.sourceScope,
          sourceLabel: firstEff.sourceLabel,
          isDirect: false,
        },
        'preview',
      );
    } else {
      setSelected(null);
      setSelectedSource(null);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (isMaster) void loadProjectsAndGlobalStandards();
  }, [isMaster]);

  const handleProjectChange = (nextProjId: string) => {
    setSelectedProjectId(nextProjId);
    setCompanyId(
      nextProjId === GLOBAL_PROJECT_KEY
        ? GLOBAL_STANDARD_COMPANY_KEY
        : PROJECT_ALL_COMPANIES_KEY,
    );
  };

  useEffect(() => {
    if (!isMaster) return;
    void loadCompanies(selectedProjectId);
  }, [isMaster, selectedProjectId]);

  useEffect(() => {
    if (isMaster && companyId) {
      setSelected(null);
      void loadTemplates(selectedProjectId, companyId);
    }
  }, [isMaster, selectedProjectId, companyId]);

  if (!isMaster) return <Navigate to="/settings" replace />;

  const buildLayoutPayload = (): PermitLayoutJson => ({
    standard_style: style,
    standard_labels: {
      ...stdLabels,
      approverCompany: display.labels.approverCompany || stdLabels.approverCompany,
      docNoPrefix: display.labels.docNoPrefix || stdLabels.docNoPrefix,
    },
    display_template: normalizeDisplayTemplate(display),
  });

  const save = async () => {
    if (!selected || isReadOnlyInherited) return;
    setSaving(true);
    const layout = buildLayoutPayload();
    const { error } = await supabase
      .from('permit_form_templates')
      .update({
        code: selected.code.trim(),
        name: selected.name.trim(),
        version: selected.version.trim() || '1',
        is_default: selected.is_default,
        is_active: selected.is_active,
        permit_type: selected.permit_type,
        project_id: dbProjectId,
        company_id: dbCompanyId,
        layout_json: layout as any,
        // 레거시 오버레이/AI 필드 정리 (기능 삭제)
        print_overlay: { pages: [] } as any,
        original_pdf_url: null,
        signature_slots: [] as any,
        suggested_approval_steps: null,
        ai_analysis_json: null,
        ai_analyzed_at: null,
      })
      .eq('id', selected.id);
    setSaving(false);
    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '저장되었습니다.', description: '결재 규칙·허가서 데이터 구조는 변경되지 않습니다.' });
    await loadTemplates(selectedProjectId, companyId);
    if (isGlobalScope) void loadProjectsAndGlobalStandards();
    setSelected((prev) =>
      prev
        ? {
            ...prev,
            layout_json: layout,
            name: selected.name,
            code: selected.code,
            version: selected.version,
            is_default: selected.is_default,
            is_active: selected.is_active,
          }
        : prev,
    );
  };

  const softDelete = async (t: Tpl) => {
    if (!confirm(`「${t.name}」을(를) 삭제할까요? (허가서 본문·결재는 영향 없음)`)) return;
    const { error } = await supabase
      .from('permit_form_templates')
      .update({ is_deleted: true, is_active: false })
      .eq('id', t.id);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    if (selected?.id === t.id) setSelected(null);
    toast({ title: '삭제되었습니다.' });
    await loadTemplates(selectedProjectId, companyId);
    if (isGlobalScope) void loadProjectsAndGlobalStandards();
  };

  /** Layout source for clone: picked global standard if chosen, else DB default standard, else code defaults. */
  const resolveCloneLayoutByType = async (): Promise<Record<string, PermitLayoutJson>> => {
    const map: Record<string, PermitLayoutJson> = {};
    const fallback = buildCloneLayoutJson();
    for (const m of PERMIT_KIND_CLONE_META) {
      map[m.permit_type] = fallback;
    }
    const picked = cloneSourceId !== '__default__'
      ? globalStandards.find((s) => s.id === cloneSourceId)
      : null;
    if (picked?.layout_json) {
      for (const m of PERMIT_KIND_CLONE_META) {
        map[m.permit_type] = parseLayoutJson(picked.layout_json);
      }
      return map;
    }
    const { data } = await supabase
      .from('permit_form_templates')
      .select('permit_type, layout_json, is_default')
      .eq('is_deleted', false)
      .eq('is_active', true)
      .is('company_id', null)
      .is('project_id', null)
      .order('is_default', { ascending: false });
    for (const row of (data || []) as any[]) {
      if (row.permit_type && row.layout_json && map[row.permit_type] === fallback) {
        map[row.permit_type] = parseLayoutJson(row.layout_json);
      }
    }
    return map;
  };

  const cloneFromStandard = async () => {
    if (!companyId) {
      toast({ title: '대상을 선택하세요.', variant: 'destructive' });
      return;
    }
    setCloning(true);

    // If non-global scope already has templates, allow 1-click replacement with the newly picked standard
    const isReplacing = !isGlobalScope && rows.length > 0;
    if (isReplacing) {
      if (!confirm('기존에 지정된 이 대상의 허가서 양식을 선택한 기준 양식으로 교체할까요?')) {
        setCloning(false);
        return;
      }
      const existingIds = rows.map((r) => r.id);
      const { error: delErr } = await supabase
        .from('permit_form_templates')
        .update({ is_deleted: true, is_active: false })
        .in('id', existingIds);
      if (delErr) {
        setCloning(false);
        toast({ title: '기존 양식 교체 실패', description: delErr.message, variant: 'destructive' });
        return;
      }
      setSelected(null);
    }

    const existingTypes = isReplacing ? new Set<PermitType>() : new Set(rows.map((r) => r.permit_type));
    const toCreate = PERMIT_KIND_CLONE_META.filter((m) => !existingTypes.has(m.permit_type));
    if (toCreate.length === 0) {
      setCloning(false);
      toast({
        title: isGlobalScope ? '기본 표준 양식이 이미 있습니다.' : '이미 복제본이 있습니다.',
        description: '종류별로 하나씩 있으면 됩니다. 왼쪽에서 열어 수정하세요.',
      });
      return;
    }

    // Unique short suffix prevents unique-key (project_id, code, version) collisions with soft-deleted rows
    const uniqSuffix = Date.now().toString(36).slice(-4).toUpperCase();

    let inserts: any[];
    if (isGlobalScope) {
      const layout = buildCloneLayoutJson();
      inserts = toCreate.map((m) => ({
        project_id: null,
        company_id: null,
        code: `STANDARD-${m.codeSuffix}-${uniqSuffix}`,
        name: `기본 표준 · ${m.name}`,
        version: '1',
        permit_type: m.permit_type,
        is_default: true,
        is_active: true,
        layout_json: layout as any,
        print_overlay: { pages: [] } as any,
        original_pdf_url: null,
        signature_slots: [] as any,
        suggested_approval_steps: null,
        created_by: user?.id || null,
      }));
    } else {
      const layouts = await resolveCloneLayoutByType();
      const projName = projects.find((p) => p.id === dbProjectId)?.name || '';
      const companyName = companies.find((c) => c.id === dbCompanyId)?.name || '';
      const prefix = (companyName || projName || 'PRJ').slice(0, 10).replace(/\s+/g, '');
      const pickedSource = cloneSourceId !== '__default__'
        ? globalStandards.find((s) => s.id === cloneSourceId)
        : null;
      inserts = toCreate.map((m) => ({
        project_id: dbProjectId,
        company_id: dbCompanyId,
        code: `${prefix}-${m.codeSuffix}-${uniqSuffix}`.slice(0, 40),
        name: pickedSource ? `${pickedSource.name} (${m.permit_type === 'general' ? '일반' : PERMIT_TYPE_LABEL[m.permit_type]})` : m.name,
        version: '1',
        permit_type: m.permit_type,
        is_default: true,
        is_active: true,
        layout_json: (layouts[m.permit_type] || buildCloneLayoutJson()) as any,
        print_overlay: { pages: [] } as any,
        original_pdf_url: null,
        signature_slots: [] as any,
        suggested_approval_steps: null,
        created_by: user?.id || null,
      }));
    }

    const { error } = await supabase.from('permit_form_templates').insert(inserts);
    setCloning(false);
    if (error) {
      toast({ title: isGlobalScope ? '표준 생성 실패' : '복제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: isGlobalScope
        ? `기본 표준 허가서 ${inserts.length}종을 만들었습니다.`
        : isReplacing
          ? `허가서 양식 ${inserts.length}종을 선택한 기준 양식으로 교체했습니다.`
          : `허가서 양식 ${inserts.length}종을 복제·지정했습니다.`,
      description: isGlobalScope
        ? '복제하지 않은 모든 현장·회사 허가서에 적용됩니다.'
        : dbProjectId
          ? '이 프로젝트에만 적용되며 다른 프로젝트의 동일 업체에는 영향을 주지 않습니다.'
          : '전역 회사 양식으로 저장되었습니다. 프로젝트별로 다르게 쓰려면 위에서 프로젝트를 먼저 선택하세요.',
    });
    await loadTemplates(selectedProjectId, companyId);
    if (isGlobalScope) void loadProjectsAndGlobalStandards();
  };

  const kindSections = useMemo(
    () => (selected ? sectionsForKind(selected.permit_type) : []),
    [selected],
  );

  const editableLabelEntries = useMemo(() => {
    if (!selected) return [];
    const kind = selected.permit_type;
    return Object.entries(display.labels).filter(([k]) => {
      if (k === 'approverCompany' || k === 'docNoPrefix') return true;
      if (k.startsWith(`${kind}.`)) return true;
      if (kind === 'general' && k.startsWith('general.')) return true;
      return false;
    });
  }, [display.labels, selected]);

  const toggleHidden = (id: PermitDisplaySectionId, checked: boolean) => {
    const def = kindSections.find((s) => s.id === id);
    if (def?.locked) return;
    setDisplay((prev) => {
      const set = new Set(prev.hiddenSections);
      if (checked) set.add(id);
      else set.delete(id);
      return { ...prev, hiddenSections: Array.from(set) };
    });
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FileSignature className="h-5 w-5" />
          허가서 표시 양식
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          <strong>기본 표준</strong>을 먼저 수정하면, 회사별 복제를 안 한 업체의 허가서에 공통 적용됩니다.
          회사별로 복제하면 그 회사 문서만 따로 덮어씁니다. 결재·연장·종료 구조는 바꾸지 않습니다.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[240px]">
            <Label>1. 프로젝트 (현장별 독립 격리)</Label>
            <Select value={selectedProjectId} onValueChange={handleProjectChange}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="프로젝트 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL_PROJECT_KEY}>
                  전체 공통 (기본 표준 / 전역 회사)
                </SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 min-w-[240px]">
            <Label>2. 적용 대상</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="대상 선택" />
              </SelectTrigger>
              <SelectContent>
                {isGlobalProject ? (
                  <SelectItem value={GLOBAL_STANDARD_COMPANY_KEY}>
                    기본 표준 허가서 (전체 기본)
                  </SelectItem>
                ) : (
                  <SelectItem value={PROJECT_ALL_COMPANIES_KEY}>
                    이 프로젝트 전체 기본 (모든 참여 업체)
                  </SelectItem>
                )}
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.type ? ` · ${c.type}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isGlobalScope && globalStandards.length > 0 && (
            <div className="space-y-1 min-w-[220px]">
              <Label>3. 복제할 기준 양식</Label>
              <Select value={cloneSourceId} onValueChange={setCloneSourceId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="기준 양식 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">기본 표준 자동 선택</SelectItem>
                  {globalStandards.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button onClick={cloneFromStandard} disabled={!companyId || cloning} className="gap-1.5">
            <Copy className="h-4 w-4" />
            {cloning
              ? (isGlobalScope ? '생성 중…' : '적용 중…')
              : isGlobalScope
                ? '기본 표준 양식 만들기'
                : rows.length > 0
                  ? '선택 양식으로 교체'
                  : '선택 양식으로 복제 · 지정'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-[300px_1fr] gap-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">
              {isGlobalScope
                ? '기본 표준 양식'
                : isProjectAllScope
                  ? '이 프로젝트 전체 양식'
                  : dbProjectId
                    ? '이 프로젝트 · 선택 업체 양식'
                    : '전역 회사 양식'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 space-y-2">
            {loading && <p className="text-xs text-muted-foreground p-2">불러오는 중…</p>}

            {!loading && rows.length > 0 && (
              <div className="space-y-1">
                {!isGlobalScope && (
                  <p className="text-[11px] font-medium text-muted-foreground px-2 pt-0.5">
                    직접 지정된 양식 (편집 가능)
                  </p>
                )}
                {rows.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      openEdit(
                        t,
                        {
                          sourceScope: isGlobalScope
                            ? 'global_standard'
                            : isProjectAllScope
                              ? 'project_all'
                              : dbProjectId
                                ? 'project_company'
                                : 'global_company',
                          sourceLabel: isGlobalScope
                            ? '전체 기본 표준'
                            : isProjectAllScope
                              ? '이 프로젝트 전체 기본'
                              : dbProjectId
                                ? '이 프로젝트 · 이 업체 전용'
                                : '전역 회사 양식',
                          isDirect: true,
                        },
                        'labels',
                      )
                    }
                    className={`w-full text-left rounded-md px-2 py-2 text-sm border ${
                      selected?.id === t.id && !isReadOnlyInherited
                        ? 'border-primary bg-primary/5'
                        : 'border-transparent hover:bg-muted/50'
                    }`}
                  >
                    <div className="font-medium truncate">{t.name}</div>
                    <div className="text-[11px] text-muted-foreground flex gap-1 flex-wrap mt-0.5">
                      <Badge variant="outline" className="text-[10px] h-4">
                        {PERMIT_TYPE_LABEL[t.permit_type] || t.permit_type}
                      </Badge>
                      {t.is_default && <Badge variant="secondary" className="text-[10px] h-4">기본</Badge>}
                      {!t.is_active && <Badge variant="destructive" className="text-[10px] h-4">비활성</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!loading && !isGlobalScope && effectiveRows.some((e) => !e.isDirect) && (
              <div className="space-y-1 pt-1 border-t first:border-t-0 first:pt-0">
                <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300 px-2 pt-0.5">
                  {rows.length === 0
                    ? '현재 적용 중인 양식 (상속 · 기본)'
                    : '나머지 종류 적용 양식 (상속 · 기본)'}
                </p>
                {effectiveRows
                  .filter((e) => !e.isDirect)
                  .map((item) => {
                    const isPicked =
                      selected?.id === item.template.id &&
                      isReadOnlyInherited &&
                      selected?.permit_type === item.permitType;
                    return (
                      <button
                        key={`${item.permitType}-${item.template.id}`}
                        type="button"
                        onClick={() =>
                          openEdit(
                            { ...item.template, permit_type: item.permitType },
                            {
                              sourceScope: item.sourceScope,
                              sourceLabel: item.sourceLabel,
                              isDirect: false,
                            },
                            'preview',
                          )
                        }
                        className={`w-full text-left rounded-md px-2 py-2 text-sm border ${
                          isPicked
                            ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                            : 'border-transparent hover:bg-muted/50'
                        }`}
                      >
                        <div className="font-medium truncate">{item.template.name}</div>
                        <div className="text-[11px] text-muted-foreground flex gap-1 flex-wrap mt-0.5">
                          <Badge variant="outline" className="text-[10px] h-4">
                            {PERMIT_TYPE_LABEL[item.permitType] || item.permitType}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px] h-4 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                            {item.sourceLabel}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}

            {!loading && rows.length === 0 && effectiveRows.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">
                {isGlobalScope
                  ? '아직 없습니다. 「기본 표준 양식 만들기」를 누른 뒤 로고·라벨을 수정하세요.'
                  : '등록된 양식이 없어 내장 기본 양식이 그대로 쓰입니다. 위에서 「선택 양식으로 복제 · 지정」을 눌러 지정할 수 있습니다.'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          {!selected ? (
            <CardContent className="p-8 text-sm text-muted-foreground">
              왼쪽에서 양식을 선택하거나, {isGlobalScope ? '기본 표준을 만드세요.' : '표준에서 복제하세요.'}
            </CardContent>
          ) : (
            <>
              <CardHeader className="py-3 px-4 space-y-3">
                {isReadOnlyInherited && selectedSource && (
                  <div className="rounded-md border border-blue-200 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/40 px-3 py-2 text-xs text-blue-900 dark:text-blue-100 flex items-start gap-2">
                    <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                    <div className="space-y-0.5">
                      <div className="font-medium">
                        현재 「{selectedSource.sourceLabel}」 양식이 이 대상에 적용 중입니다 (읽기 전용)
                      </div>
                      <div className="text-blue-800/90 dark:text-blue-200/80">
                        기존 다른 프로젝트·업체에 영향 없이 이 대상만 따로 지정·수정하려면, 위에서 <strong>3. 복제할 기준 양식</strong>을 고른 뒤 <strong>「선택 양식으로 복제 · 지정」</strong>을 눌러주세요.
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 items-end justify-between">
                  <div className="grid grid-cols-2 gap-2 flex-1 min-w-[240px]">
                    <div className="space-y-1">
                      <Label className="text-xs">이름</Label>
                      <Input
                        value={selected.name}
                        disabled={isReadOnlyInherited}
                        onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">코드</Label>
                      <Input
                        value={selected.code}
                        disabled={isReadOnlyInherited}
                        onChange={(e) => setSelected({ ...selected, code: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">버전</Label>
                      <Input
                        value={selected.version}
                        disabled={isReadOnlyInherited}
                        onChange={(e) => setSelected({ ...selected, version: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="flex items-center gap-4 pt-5">
                      <label className="flex items-center gap-1.5 text-xs">
                        <Switch
                          checked={selected.is_default}
                          disabled={isReadOnlyInherited}
                          onCheckedChange={(v) => setSelected({ ...selected, is_default: v })}
                        />
                        기본
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Switch
                          checked={selected.is_active}
                          disabled={isReadOnlyInherited}
                          onCheckedChange={(v) => setSelected({ ...selected, is_active: v })}
                        />
                        사용
                      </label>
                    </div>
                  </div>
                  {!isReadOnlyInherited && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => softDelete(selected)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> 삭제
                      </Button>
                      <Button size="sm" onClick={save} disabled={saving}>
                        <Save className="h-3.5 w-3.5 mr-1" /> {saving ? '저장 중…' : '저장'}
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList>
                    <TabsTrigger value="labels">문구(라벨)</TabsTrigger>
                    <TabsTrigger value="hide">항목 숨기기</TabsTrigger>
                    <TabsTrigger value="style">스타일</TabsTrigger>
                    <TabsTrigger value="preview">미리보기</TabsTrigger>
                  </TabsList>

                  <TabsContent value="labels" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      비워 두지 마세요. 저장 키는 그대로이고, 화면에 보이는 글자만 바뀝니다.
                    </p>
                    <div className="grid gap-2 max-h-[420px] overflow-y-auto pr-1">
                      {editableLabelEntries.map(([key, val]) => (
                        <div key={key} className="grid grid-cols-[200px_1fr] gap-2 items-center">
                          <div className="min-w-0">
                            <Label className="text-xs font-medium truncate block">
                              {LABEL_KEY_TITLE[key] || key}
                            </Label>
                            <span className="text-[10px] text-muted-foreground truncate block" title={key}>{key}</span>
                          </div>
                          <Input
                            value={val}
                            disabled={isReadOnlyInherited}
                            className="h-8"
                            onChange={(e) =>
                              setDisplay((prev) => ({
                                ...prev,
                                labels: { ...prev.labels, [key]: e.target.value },
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="hide" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      숨긴 항목은 화면에만 안 보입니다. 이미 저장된 값·결재 슬롯은 유지됩니다.
                      잠금 표시된 항목(결재·작업일시·핵심 요약·완료·연장)은 숨길 수 없습니다.
                    </p>
                    <div className="space-y-2">
                      {kindSections.map((s) => {
                        const checked = display.hiddenSections.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                              s.locked ? 'opacity-60 bg-muted/30' : ''
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={s.locked || isReadOnlyInherited}
                              onCheckedChange={(v) => toggleHidden(s.id, !!v)}
                              className="mt-0.5"
                            />
                            <span>
                              <span className="font-medium">{s.label}</span>
                              {s.locked && (
                                <Badge variant="outline" className="ml-2 text-[10px]">잠금</Badge>
                              )}
                              {s.description && (
                                <span className="block text-[11px] text-muted-foreground">{s.description}</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </TabsContent>

                  <TabsContent value="style" className="pt-3">
                    <StandardStyleEditor
                      style={style as StandardStyle}
                      labels={{
                        approverCompany: display.labels.approverCompany || stdLabels.approverCompany,
                        docNoPrefix: display.labels.docNoPrefix || stdLabels.docNoPrefix,
                      }}
                      onChange={(nextStyle, nextLabels) => {
                        setStyle(nextStyle);
                        setStdLabels(nextLabels);
                        setDisplay((prev) => ({
                          ...prev,
                          labels: {
                            ...prev.labels,
                            approverCompany: nextLabels.approverCompany || prev.labels.approverCompany,
                            docNoPrefix: nextLabels.docNoPrefix || prev.labels.docNoPrefix,
                          },
                        }));
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="preview" className="pt-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <Eye className="h-3.5 w-3.5" /> 실제 DigPermitForm 미리보기 (샘플 데이터)
                    </div>
                    <div className="border rounded bg-white p-3 overflow-auto max-h-[640px]">
                      <StandardPermitSheet>
                        <DigPermitForm
                          permitType={selected.permit_type}
                          data={PREVIEW_DATA}
                          signatures={PREVIEW_SIGS}
                          readOnly
                          printMode
                          standardStyle={style}
                          standardLabels={{
                            approverCompany: display.labels.approverCompany,
                            docNoPrefix: display.labels.docNoPrefix,
                          }}
                          displayTemplate={display}
                        />
                      </StandardPermitSheet>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
