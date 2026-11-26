import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Users, Building2, KeyRound, Plus, Trash2, Copy, Check, UserPlus, Settings2, Search, Link2, ArrowRight,
} from 'lucide-react';
import { useAuditLog } from '@/hooks/useAuditLog';
import {
  COMPANY_TYPE_LABELS,
  COMPANY_TYPE_OPTIONS,
  companyTypeLabel,
  normalizeCompanyType,
  resolveProjectCompanyType,
} from '@/lib/companyTypes';
import { POSITION_LABELS, positionsForCompanyType, syncMembershipRolePosition } from '@/lib/projectPositions';
import ProjectSiteSpotsCard from '@/components/project/ProjectSiteSpotsCard';
import { geocodeKoreanAddress } from '@/lib/koreanLocationService';
import ConstructionFields from '@/components/company/ConstructionFields';
import { constructionFormFromRow, emptyConstructionForm, upsertProjectConstruction, type ConstructionForm } from '@/lib/companyConstruction';
import { submitCompanyRegistration } from '@/lib/companyRegistration';
import { formatKRW } from '@/lib/safetyCost';
import { ConstructionInfoMissingBanner } from '@/components/ConstructionInfoMissingBanner';
import ProjectMemberMultiPickerDialog from '@/components/project/ProjectMemberMultiPickerDialog';
import TradeTagSelector from '@/components/project/TradeTagSelector';
import ProjectOverviewChecklist from '@/components/project/ProjectOverviewChecklist';
import ProjectIntegrationsTab from '@/components/project/ProjectIntegrationsTab';
import { syncProjectCompanyColumns } from '@/lib/projectCompanies';
import {
  collectSuggestedTagsFromCompanies,
  mapLegacyProjectTab,
  normalizeTradeTags,
  type ProjectDetailTabId,
} from '@/lib/projectTradeTags';
import {
  pickPermitDisplayTemplateWithSource,
  type PermitTemplateRow,
} from '@/lib/permitDisplayTemplate';

const roleLabels: Record<string, string> = {
  master: '마스터', project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자', site_manager: '현장대리인',
  supervisor: '감리', site_supervisor: '관리감독자',
  worker: '작업자', viewer: '열람자',
};

const positionLabels: Record<string, string> = { ...POSITION_LABELS };
const companyTypes: Record<string, string> = { ...COMPANY_TYPE_LABELS };
const companyTypeOrder: Record<string, number> = { client: 0, gc: 1, contractor: 2, vendor: 3 };

const ProjectDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<ProjectDetailTabId>(() => mapLegacyProjectTab(requestedTab, 'basic-info'));

  useEffect(() => {
    if (requestedTab) setTab(mapLegacyProjectTab(requestedTab, 'basic-info'));
  }, [requestedTab]);

  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const isMaster = hasRole('master');
  const { log } = useAuditLog();

  const [project, setProject] = useState<any>(null);
  const [projectRole, setProjectRole] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [allProfiles, setAllProfiles] = useState<{ user_id: string; display_name: string; company: string; phone?: string | null; position: string }[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [permitTemplates, setPermitTemplates] = useState<PermitTemplateRow[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);

  // Dialogs & Filters
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ role: 'worker' as string, company_id: '' as string, max_uses: 50, expires_days: 7 });
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberCompanyFilter, setMemberCompanyFilter] = useState('__all__');
  const [memberRoleFilter, setMemberRoleFilter] = useState('__all__');

  const [showAddCompany, setShowAddCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    name: '', type: 'gc', business_no: '', contact: '', parent_company_id: '', source_company_id: '',
    client_safety_service: false, requester_name: '', memo: '', ...emptyConstructionForm(),
  });
  const [globalCompanies, setGlobalCompanies] = useState<any[]>([]);
  const [copiedCode, setCopiedCode] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: '', site_name: '', site_address: '', period_start: '', period_end: '',
    tags: [] as string[], status: '진행중',
  });

  const [editingCompany, setEditingCompany] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', type: 'gc', parent_company_id: '', client_safety_service: false, ...emptyConstructionForm(),
  });

  const canManage = isMaster || projectRole === 'project_admin';

  useEffect(() => {
    if (!projectId || !user) return;
    void fetchAll();
  }, [projectId, user]);

  useEffect(() => {
    if (!project) return;
    setProjectForm({
      name: project.name || '',
      site_name: project.site_name || '',
      site_address: project.site_address || '',
      period_start: project.period_start || '',
      period_end: project.period_end || '',
      tags: normalizeTradeTags(project.tags),
      status: project.status || '진행중',
    });
  }, [project]);

  const fetchAll = async () => {
    if (!projectId || !user) return;

    const [projRes, membersRes, profilesRes, projCompaniesRes, invitesRes, requestsRes, tplRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('project_members').select('*').eq('project_id', projectId),
      supabase.from('profiles').select('user_id, display_name, company, phone, position'),
      (supabase as any).from('project_companies')
        .select('company_id, role_in_project, parent_company_id, client_safety_service, companies:company_id(*)')
        .eq('project_id', projectId).eq('is_deleted', false),
      supabase.from('project_invites').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_join_requests').select('*, profiles:user_id(display_name, company)').eq('project_id', projectId).eq('status', 'pending'),
      supabase.from('permit_form_templates')
        .select('id, project_id, company_id, code, name, version, layout_json, is_default, is_active, permit_type')
        .eq('is_deleted', false)
        .eq('is_active', true)
        .or(`project_id.eq.${projectId},project_id.is.null`),
    ]);

    setProject(projRes.data);
    setMembers(membersRes.data || []);
    setProfiles(profilesRes.data || []);
    setAllProfiles((profilesRes.data || []) as any);
    setPermitTemplates(((tplRes.data || []) as unknown) as PermitTemplateRow[]);

    const projCompanies = (projCompaniesRes.data || [])
      .map((l: any) => l.companies ? {
        ...l.companies,
        type: resolveProjectCompanyType(l.role_in_project, l.companies.type),
        parent_company_id: l.parent_company_id ?? null,
        client_safety_service: l.client_safety_service === true,
      } : null)
      .filter((c: any) => c && c.is_deleted === false);

    const companyIds = projCompanies.map((c: any) => c.id);
    const constructionByCompany = new Map<string, any>();
    if (companyIds.length > 0) {
      const { data: constructionRows } = await (supabase as any)
        .from('company_construction_info')
        .select('company_id, construction_name, construction_type, construction_period_start, construction_period_end, construction_amount')
        .eq('project_id', projectId)
        .in('company_id', companyIds);
      (constructionRows || []).forEach((row: any) => constructionByCompany.set(row.company_id, row));
    }
    setCompanies(projCompanies.map((c: any) => ({
      ...c,
      ...(constructionByCompany.get(c.id) || {}),
      id: c.id,
    })));

    setInvites(invitesRes.data || []);
    setJoinRequests(requestsRes.data || []);

    if (isMaster) {
      setProjectRole('master');
    } else {
      const myMembership = (membersRes.data || []).find((m: any) => m.user_id === user.id);
      setProjectRole(myMembership?.role_new || null);
    }
  };

  // Load global company directory (system-wide, deduped by name) for search-based registration
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('companies')
        .select('id, name, type, business_no, contact, address')
        .eq('is_deleted', false)
        .order('name');
      const seen = new Set<string>();
      const deduped: any[] = [];
      (data || []).forEach((c: any) => {
        const key = (c.name || '').trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        deduped.push({ ...c, type: normalizeCompanyType(c.type) || c.type });
      });
      setGlobalCompanies(deduped);
    })();
  }, [showAddCompany, editingCompany]);

  const parentTypesFor = (childType: string): string[] => {
    const t = normalizeCompanyType(childType) || childType;
    if (t === 'gc') return ['client'];
    if (t === 'contractor') return ['gc'];
    if (t === 'vendor') return ['client', 'gc'];
    return [];
  };

  const getParentCandidates = (childType: string, excludeId?: string) => {
    const allowed = new Set(parentTypesFor(childType));
    if (allowed.size === 0) return [] as { id: string; name: string; type: string; inProject: boolean }[];
    const projectIds = new Set(companies.map((c) => c.id));
    const byId = new Map<string, { id: string; name: string; type: string; inProject: boolean }>();
    companies.forEach((c) => {
      const t = normalizeCompanyType(c.type) || c.type;
      if (!allowed.has(t) || c.id === excludeId) return;
      byId.set(c.id, { id: c.id, name: c.name, type: t, inProject: true });
    });
    globalCompanies.forEach((g) => {
      const t = normalizeCompanyType(g.type) || g.type;
      if (!allowed.has(t) || g.id === excludeId || byId.has(g.id)) return;
      byId.set(g.id, { id: g.id, name: g.name, type: t, inProject: projectIds.has(g.id) });
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  };

  const ensureParentLinkedToProject = async (parentId: string | null | undefined, childType: string) => {
    if (!projectId || !parentId) return null as string | null;
    if (companies.some((c) => c.id === parentId)) return null;
    const g = globalCompanies.find((c) => c.id === parentId);
    const role = normalizeCompanyType(g?.type) || parentTypesFor(childType)[0] || 'client';
    const { error } = await (supabase as any).from('project_companies').upsert({
      project_id: projectId,
      company_id: parentId,
      role_in_project: role,
      is_deleted: false,
      parent_company_id: null,
    }, { onConflict: 'project_id,company_id' });
    if (error) return error.message as string;
    return null;
  };

  /** Sync legacy projects.client column from project_companies client link */
  const syncProjectClientName = async () => {
    if (!projectId) return;
    const { data: links } = await (supabase as any)
      .from('project_companies')
      .select('role_in_project, companies:company_id(name)')
      .eq('project_id', projectId)
      .eq('is_deleted', false);
    const clientLink = ((links || []) as any[]).find(
      (l) => normalizeCompanyType(l.role_in_project) === 'client' && l.companies?.name,
    );
    if (clientLink?.companies?.name) {
      await supabase.from('projects').update({ client: clientLink.companies.name }).eq('id', projectId);
    }
  };

  const filteredGlobalCompanies = useMemo(() => {
    const q = (companyForm.name || '').trim().toLowerCase();
    const list = globalCompanies;
    if (!q) return list.slice(0, 30);
    return list
      .filter((g) => {
        const name = (g.name || '').toLowerCase();
        const biz = (g.business_no || '').toLowerCase();
        return name.includes(q) || biz.includes(q);
      })
      .slice(0, 30);
  }, [globalCompanies, companyForm.name]);

  const pickGlobalCompany = (g: any) => {
    const pickedType = normalizeCompanyType(g.type) || 'gc';
    setCompanyForm({
      ...companyForm,
      name: g.name,
      business_no: g.business_no || '',
      contact: g.contact || '',
      source_company_id: g.id,
      type: pickedType,
      parent_company_id: '',
    });
  };

  const getProfileName = (userId: string) => {
    const p = profiles.find((pr) => pr.user_id === userId);
    return p?.display_name || userId.slice(0, 8);
  };

  const getProfilePhone = (userId: string) => {
    const p = profiles.find((pr) => pr.user_id === userId);
    return p?.phone || '';
  };

  const handleUpdateProjectInfo = async () => {
    if (!projectId || !canManage) return;
    if (!projectForm.name.trim()) {
      toast({ title: '프로젝트명을 입력해주세요.', variant: 'destructive' });
      return;
    }

    setSavingProject(true);
    let geocodeFailed = false;

    try {
      const updateData: any = {
        name: projectForm.name.trim(),
        site_name: projectForm.site_name.trim(),
        site_address: projectForm.site_address.trim() || null,
        period_start: projectForm.period_start || null,
        period_end: projectForm.period_end || null,
        tags: normalizeTradeTags(projectForm.tags),
        status: projectForm.status,
      };

      if (projectForm.site_address.trim()) {
        try {
          const geoData = await geocodeKoreanAddress(projectForm.site_address.trim());
          if (geoData?.lat && geoData?.lng) {
            updateData.site_lat = geoData.lat;
            updateData.site_lng = geoData.lng;
          } else {
            geocodeFailed = true;
          }
        } catch {
          geocodeFailed = true;
        }
      } else {
        updateData.site_lat = null;
        updateData.site_lng = null;
      }

      const { error } = await supabase.from('projects').update(updateData).eq('id', projectId);
      if (error) throw error;

      toast({
        title: '프로젝트 기본정보가 저장되었습니다.',
        description: geocodeFailed ? '주소는 저장되었으나 좌표 변환에 실패했습니다. 도시명 또는 도로명을 확인해주세요.' : undefined,
      });
      await fetchAll();
    } catch (error: any) {
      toast({ title: '저장 실패', description: error.message || String(error), variant: 'destructive' });
    } finally {
      setSavingProject(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    const admins = members.filter((m) => m.role_new === 'project_admin');
    const target = members.find((m) => m.id === memberId);
    if (target?.role_new === 'project_admin' && admins.length <= 1) {
      toast({ title: '프로젝트 관리자가 최소 1명 필요합니다.', variant: 'destructive' });
      return;
    }
    const reason = prompt('멤버 제거 사유를 입력하세요. (필수)');
    if (!reason || !reason.trim()) return;
    await supabase.from('project_members').delete().eq('id', memberId);
    await log('멤버 제거', 'project_member', memberId, projectId || undefined, { reason, removed_user_id: target?.user_id, role: target?.role_new });
    toast({ title: '멤버가 제거되었습니다.' });
    await fetchAll();
  };

  const handleChangeRole = async (memberId: string, newRole: string) => {
    const target = members.find((m) => m.id === memberId);
    if (target?.role_new === 'project_admin' && newRole !== 'project_admin') {
      const admins = members.filter((m) => m.role_new === 'project_admin');
      if (admins.length <= 1) {
        toast({ title: '프로젝트 관리자가 최소 1명 필요합니다.', variant: 'destructive' });
        return;
      }
    }
    const companyType = companies.find((c) => c.id === target?.company_id)?.type;
    const updateData = syncMembershipRolePosition({
      field: 'role_new',
      value: newRole,
      companyType,
      currentPosition: target?.position_new || null,
    });
    await supabase.from('project_members').update(updateData as any).eq('id', memberId);
    await fetchAll();
  };

  const handleChangePosition = async (memberId: string, newPosition: string | null) => {
    const updateData = syncMembershipRolePosition({
      field: 'position_new',
      value: newPosition,
    });
    const { error } = await supabase
      .from('project_members')
      .update(updateData as any)
      .eq('id', memberId);
    if (error) {
      toast({ title: '직책 저장 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '직책이 저장되었습니다.' });
    await log('직책변경', 'project_member', memberId, projectId || undefined, { position: newPosition, updateData });
    await fetchAll();
  };

  const handleChangeMemberCompany = async (memberId: string, nextCompanyId: string | null) => {
    const co = nextCompanyId ? companies.find((c) => c.id === nextCompanyId) : null;
    const { error } = await supabase
      .from('project_members')
      .update({
        company_id: nextCompanyId,
        company: co?.name || null,
      } as any)
      .eq('id', memberId);
    if (error) {
      toast({ title: '소속 업체 변경 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '소속 업체가 변경되었습니다.' });
    await fetchAll();
  };

  const handleCreateInvite = async () => {
    if (!projectId || !user) return;
    const code = crypto.randomUUID().split('-')[0].toUpperCase();
    const insertData: any = {
      project_id: projectId,
      code,
      default_role: inviteForm.role as any,
      created_by: user.id,
      expires_at: new Date(Date.now() + inviteForm.expires_days * 24 * 60 * 60 * 1000).toISOString(),
      max_uses: inviteForm.max_uses,
    };
    if (inviteForm.company_id) insertData.company_id = inviteForm.company_id;
    const { error } = await supabase.from('project_invites').insert([insertData]);
    if (error) {
      toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '초대코드가 생성되었습니다.', description: `코드: ${code}` });
      await fetchAll();
    }
  };

  const handleDeleteInvite = async (id: string) => {
    await supabase.from('project_invites').delete().eq('id', id);
    await log('초대코드 삭제', 'project_invite', id, projectId || undefined);
    await fetchAll();
  };

  const handleApproveRequest = async (reqId: string, userId: string, role: string) => {
    await supabase.from('project_members').insert([{
      project_id: projectId!, user_id: userId, role_new: role as any,
    }]);
    await supabase.from('project_join_requests').update({
      status: 'approved', reviewed_by: user!.id, reviewed_at: new Date().toISOString(),
    }).eq('id', reqId);
    toast({ title: '가입 요청을 승인했습니다.' });
    await fetchAll();
  };

  const handleRejectRequest = async (reqId: string) => {
    await supabase.from('project_join_requests').update({
      status: 'rejected', reviewed_by: user!.id, reviewed_at: new Date().toISOString(),
    }).eq('id', reqId);
    toast({ title: '가입 요청을 거절했습니다.' });
    await fetchAll();
  };

  const blankCompanyForm = () => ({
    name: '', type: 'gc', business_no: '', contact: '', parent_company_id: '', source_company_id: '',
    client_safety_service: false, requester_name: '', memo: '', ...emptyConstructionForm(),
  });

  const constructionOf = (form: ConstructionForm): ConstructionForm => ({
    construction_name: form.construction_name,
    construction_type: form.construction_type,
    construction_period_start: form.construction_period_start,
    construction_period_end: form.construction_period_end,
    construction_amount: form.construction_amount,
  });

  const handleAddCompany = async () => {
    if (!projectId) return;
    if (companyForm.type === 'contractor' && !companyForm.parent_company_id) {
      const gcParents = getParentCandidates('contractor').filter((c) => companyForm.source_company_id || isMaster || c.inProject);
      if (gcParents.length > 0 || (!companyForm.source_company_id && !isMaster)) {
        toast({ title: '협력사는 이 현장에 연결된 시공사를 상위 업체로 고르세요.', variant: 'destructive' });
        return;
      }
    }

    let targetCompanyId = companyForm.source_company_id;

    if (!targetCompanyId) {
      if (!companyForm.name.trim()) {
        toast({ title: '업체명을 입력하거나 목록에서 고르세요.', variant: 'destructive' });
        return;
      }

      if (isMaster) {
        // Master creates global company record directly and links immediately
        const { data: createdCo, error: createErr } = await supabase
          .from('companies')
          .insert([{
            name: companyForm.name.trim(),
            type: companyForm.type,
            business_no: companyForm.business_no.trim() || null,
            contact: companyForm.contact.trim() || null,
            project_id: projectId,
          } as any])
          .select('id')
          .single();
        if (createErr || !createdCo?.id) {
          toast({ title: '신규 업체 생성 실패', description: createErr?.message || '', variant: 'destructive' });
          return;
        }
        targetCompanyId = createdCo.id;
      } else {
        const requester = companyForm.requester_name.trim() || getProfileName(user?.id || '') || user?.email || '';
        const res = await submitCompanyRegistration({
          name: companyForm.name.trim(),
          businessNo: companyForm.business_no,
          type: companyForm.type,
          contact: companyForm.contact,
          projectId,
          parentCompanyId: companyForm.parent_company_id || null,
          requesterName: requester,
          requesterEmail: user?.email || '',
          memo: companyForm.memo,
        });
        if (res.result === 'already_linked') {
          toast({ title: '이미 이 현장에 연결된 업체입니다. 목록에서 고르세요.' });
          return;
        }
        if (res.result === 'already_pending') {
          toast({ title: '같은 업체 요청이 이미 접수되어 있습니다.' });
          return;
        }
        if (res.result !== 'submitted') {
          toast({ title: '등록 요청 실패', description: res.message || res.result, variant: 'destructive' });
          return;
        }
        toast({ title: res.request_kind === 'link' ? '현장 연결 요청을 보냈습니다.' : '업체 등록 요청을 보냈습니다. 마스터 승인 후 연결됩니다.' });
        setShowAddCompany(false);
        setCompanyForm(blankCompanyForm());
        return;
      }
    }

    const parentLinkErr = await ensureParentLinkedToProject(companyForm.parent_company_id, companyForm.type);
    if (parentLinkErr) {
      toast({ title: '상위 업체 연결 실패', description: parentLinkErr, variant: 'destructive' });
      return;
    }

    const linkPayload: any = {
      project_id: projectId,
      company_id: targetCompanyId,
      role_in_project: companyForm.type,
      parent_company_id: companyForm.parent_company_id || null,
      client_safety_service: companyForm.client_safety_service === true,
      is_deleted: false,
    };
    const { error: linkErr } = await (supabase as any).from('project_companies').upsert(
      linkPayload,
      { onConflict: 'project_id,company_id' },
    );
    if (linkErr) {
      toast({ title: '프로젝트 연결 실패', description: linkErr.message, variant: 'destructive' });
      return;
    }
    const constructionErr = await upsertProjectConstruction(targetCompanyId, projectId, constructionOf(companyForm));
    if (constructionErr) {
      toast({ title: '공사정보 저장 실패', description: constructionErr, variant: 'destructive' });
      return;
    }
    await syncProjectCompanyColumns(projectId);
    if (companyForm.type === 'client') await syncProjectClientName();

    toast({ title: companyForm.source_company_id ? '업체가 프로젝트에 연결되었습니다.' : '신규 업체를 생성하고 프로젝트에 연결했습니다.' });
    setShowAddCompany(false);
    setCompanyForm(blankCompanyForm());
    await fetchAll();
  };

  const handleUnlinkCompany = async (id: string) => {
    if (!projectId) return;
    const target = companies.find((c) => c.id === id);
    if (!confirm(`"${target?.name || ''}" 업체를 이 프로젝트에서 제외하시겠습니까?\n\n※ 설정 > 업체 관리의 전역 마스터 목록에서는 삭제되지 않습니다.`)) return;
    await (supabase as any).from('project_companies')
      .update({ parent_company_id: null })
      .eq('project_id', projectId).eq('parent_company_id', id);
    const { error } = await (supabase as any).from('project_companies')
      .delete().eq('project_id', projectId).eq('company_id', id);
    if (error) {
      toast({ title: '제외 실패', description: error.message, variant: 'destructive' });
      return;
    }
    await syncProjectCompanyColumns(projectId);
    toast({ title: '프로젝트에서 제외되었습니다.' });
    await log('업체 프로젝트 제외', 'project_company', id, projectId);
    await fetchAll();
  };

  const openEditCompany = async (c: any) => {
    setEditingCompany(c);
    setEditForm({
      name: c.name || '',
      type: normalizeCompanyType(c.type) || 'gc',
      parent_company_id: c.parent_company_id || '',
      client_safety_service: c.client_safety_service === true,
      ...constructionFormFromRow(c),
    });
    if (!projectId) return;
    const { data } = await (supabase as any)
      .from('company_construction_info')
      .select('*')
      .eq('company_id', c.id)
      .eq('project_id', projectId)
      .maybeSingle();
    setEditForm((prev) => ({ ...prev, ...constructionFormFromRow(data) }));
  };

  const handleUpdateCompany = async () => {
    if (!editingCompany || !projectId) return;
    const parentLinkErr = await ensureParentLinkedToProject(editForm.parent_company_id, editForm.type);
    if (parentLinkErr) {
      toast({ title: '상위 업체 연결 실패', description: parentLinkErr, variant: 'destructive' });
      return;
    }
    const { error: linkErr } = await (supabase as any).from('project_companies')
      .update({
        role_in_project: editForm.type,
        parent_company_id: editForm.parent_company_id || null,
        client_safety_service: editForm.client_safety_service === true,
      })
      .eq('project_id', projectId)
      .eq('company_id', editingCompany.id);
    if (linkErr) {
      toast({ title: '수정 실패', description: linkErr.message, variant: 'destructive' });
      return;
    }
    const constructionErr = await upsertProjectConstruction(editingCompany.id, projectId, constructionOf(editForm));
    if (constructionErr) {
      toast({ title: '공사정보 저장 실패', description: constructionErr, variant: 'destructive' });
      return;
    }
    await syncProjectCompanyColumns(projectId);
    if (editForm.type === 'client') await syncProjectClientName();
    toast({ title: '이 현장의 업체 정보를 저장했습니다.' });
    await log('업체 수정', 'project_company', editingCompany.id, projectId);
    setEditingCompany(null);
    await fetchAll();
  };

  // Derived summaries
  const clientCompanies = useMemo(() => companies.filter((c) => c.type === 'client'), [companies]);
  const gcCompanies = useMemo(() => companies.filter((c) => c.type === 'gc'), [companies]);
  const missingConstructionCount = useMemo(
    () =>
      companies.filter(
        (c) =>
          c.type !== 'client' &&
          !(c.construction_period_start || c.construction_period_end || Number(c.construction_amount) > 0),
      ).length,
    [companies],
  );
  const memberCountByCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members) {
      if (m.company_id) map.set(m.company_id, (map.get(m.company_id) || 0) + 1);
    }
    return map;
  }, [members]);

  const suggestedTags = useMemo(
    () => collectSuggestedTagsFromCompanies(companies, projectForm.tags),
    [companies, projectForm.tags],
  );

  const projectPermitMatch = useMemo(
    () =>
      projectId
        ? pickPermitDisplayTemplateWithSource({
            templates: permitTemplates,
            projectId,
            permitCompanyId: gcCompanies[0]?.id || null,
            gcCompanyId: gcCompanies[0]?.id || null,
            permitType: 'general',
          })
        : null,
    [permitTemplates, projectId, gcCompanies],
  );

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return members.filter((m) => {
      if (memberCompanyFilter !== '__all__') {
        if (memberCompanyFilter === '__none__' && m.company_id) return false;
        if (memberCompanyFilter !== '__none__' && m.company_id !== memberCompanyFilter) return false;
      }
      if (memberRoleFilter !== '__all__' && m.role_new !== memberRoleFilter) return false;
      if (!q) return true;
      const name = getProfileName(m.user_id).toLowerCase();
      const phone = getProfilePhone(m.user_id).toLowerCase();
      const coName = (companies.find((c) => c.id === m.company_id)?.name || m.company || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || coName.includes(q);
    });
  }, [members, memberSearch, memberCompanyFilter, memberRoleFilter, profiles, companies]);

  if (!project) return <div className="p-8 text-center text-muted-foreground">로딩 중...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{project.name}</h1>
            <Badge
              variant={project.status === '진행중' ? 'default' : 'secondary'}
              className="text-[10px]"
            >
              {project.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {project.site_name || '현장명 미지정'}
            {project.period_start || project.period_end
              ? ` · ${project.period_start || '미정'} ~ ${project.period_end || '미정'}`
              : ''}
          </p>
        </div>
      </div>

      {/* Onboarding & Live Setup Checklist */}
      <ProjectOverviewChecklist
        hasLocationCoords={typeof project.site_lat === 'number' && typeof project.site_lng === 'number'}
        companyCount={companies.length}
        gcCount={gcCompanies.length}
        missingConstructionCount={missingConstructionCount}
        memberCount={members.length}
        permitFormLabel={projectPermitMatch?.template.name || '기본 표준'}
        onJumpTab={setTab}
      />

      <ConstructionInfoMissingBanner projectId={projectId} contextLabel="현장 업체별 공사금액·기간" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as ProjectDetailTabId)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="basic-info" className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" /> 개요 · 기본정보
          </TabsTrigger>
          <TabsTrigger value="companies" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> 참여 업체 ({companies.length})
          </TabsTrigger>
          <TabsTrigger value="members" className="gap-1.5">
            <Users className="h-3.5 w-3.5" /> 멤버 · 권한 ({members.length})
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1.5">
            <Link2 className="h-3.5 w-3.5" /> 연동 설정 현황
          </TabsTrigger>
        </TabsList>

        {/* 1. Overview & Basic Info Tab */}
        <TabsContent value="basic-info" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm">프로젝트 기본정보</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  현장 기본정보와 공종을 관리합니다. 발주처·시공사는 「참여 업체」 탭에서 자동 연동됩니다.
                </p>
              </div>
              {canManage && (
                <Button size="sm" className="text-xs" onClick={handleUpdateProjectInfo} disabled={savingProject || !projectForm.name.trim()}>
                  {savingProject ? '저장 중...' : '저장'}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Auto-synced Client & GC Summary (Read-only from project_companies SSOT) */}
              <div className="rounded-lg border bg-muted/20 p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground font-medium">발주처:</span>
                    {clientCompanies.length > 0 ? (
                      clientCompanies.map((c) => (
                        <Badge key={c.id} variant="outline" className="text-[11px] border-primary/40 text-primary">
                          {c.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">{project.client || '미지정'}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground font-medium">시공사:</span>
                    {gcCompanies.length > 0 ? (
                      gcCompanies.map((c) => (
                        <Badge key={c.id} variant="secondary" className="text-[11px]">
                          {c.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-amber-700 dark:text-amber-300">미지정 — 참여 업체 탭에서 시공사를 연결하세요</span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setTab('companies')}
                >
                  참여 업체 관리 <ArrowRight className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>프로젝트명 *</Label>
                  <Input value={projectForm.name} onChange={(e) => setProjectForm((prev) => ({ ...prev, name: e.target.value }))} disabled={!canManage} />
                </div>
                <div className="space-y-1.5">
                  <Label>현장명</Label>
                  <Input value={projectForm.site_name} onChange={(e) => setProjectForm((prev) => ({ ...prev, site_name: e.target.value }))} disabled={!canManage} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>현장주소 (저장 시 좌표·날씨 자동 연동)</Label>
                  <Input
                    value={projectForm.site_address}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, site_address: e.target.value }))}
                    placeholder="예: 전라남도 여수시 화학단지로 123"
                    disabled={!canManage}
                  />
                  {typeof project.site_lat === 'number' && typeof project.site_lng === 'number' && (
                    <p className="text-[11px] text-muted-foreground">
                      연동된 좌표: {project.site_lat.toFixed(6)}, {project.site_lng.toFixed(6)}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>공사 시작일</Label>
                  <Input type="date" value={projectForm.period_start} onChange={(e) => setProjectForm((prev) => ({ ...prev, period_start: e.target.value }))} disabled={!canManage} />
                </div>
                <div className="space-y-1.5">
                  <Label>공사 종료일</Label>
                  <Input type="date" value={projectForm.period_end} onChange={(e) => setProjectForm((prev) => ({ ...prev, period_end: e.target.value }))} disabled={!canManage} />
                </div>
              </div>

              <TradeTagSelector
                value={projectForm.tags}
                onChange={(next) => setProjectForm((prev) => ({ ...prev, tags: next }))}
                suggestedFromCompanies={suggestedTags}
                disabled={!canManage}
              />

              <div className="space-y-1.5 max-w-xs">
                <Label>진행 상태</Label>
                <Select value={projectForm.status} onValueChange={(v) => setProjectForm((prev) => ({ ...prev, status: v }))} disabled={!canManage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="진행중">진행중</SelectItem>
                    <SelectItem value="완료">완료</SelectItem>
                    <SelectItem value="보류">보류</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <ProjectSiteSpotsCard
            projectId={projectId || project.id}
            pinLat={typeof project.site_lat === 'number' ? project.site_lat : null}
            pinLng={typeof project.site_lng === 'number' ? project.site_lng : null}
            canEdit={canManage || projectRole === 'safety_manager'}
            onToast={(opts) => toast(opts)}
          />
        </TabsContent>

        {/* 2. Participating Companies & Contract Info Tab */}
        <TabsContent value="companies" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="space-y-0.5">
                <CardTitle className="text-sm">참여 업체 · 공사정보 (발주처 → 시공사 → 협력사)</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  이 프로젝트에만 독립 적용됩니다. 동일 업체가 다른 프로젝트에서 다른 역할(시공사/협력사)로 참여해도 서로 영향을 주지 않습니다.
                </p>
              </div>
              {canManage && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0" onClick={() => setShowAddCompany(true)}>
                  <Plus className="h-3.5 w-3.5" /> 업체 연결 · 등록
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {companies.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">등록된 업체가 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {(() => {
                    const idSet = new Set(companies.map((c) => c.id));
                    const topLevel = companies
                      .filter((c) => !c.parent_company_id || !idSet.has(c.parent_company_id))
                      .sort((a, b) => (companyTypeOrder[a.type] ?? 99) - (companyTypeOrder[b.type] ?? 99));
                    const getChildren = (parentId: string) =>
                      companies
                        .filter((c) => c.parent_company_id === parentId)
                        .sort((a, b) => (companyTypeOrder[a.type] ?? 99) - (companyTypeOrder[b.type] ?? 99));

                    const renderCompany = (c: any, depth: number) => {
                      const mCount = memberCountByCompany.get(c.id) || 0;
                      const hasConstruction =
                        Boolean(c.construction_type) ||
                        Boolean(c.construction_period_start) ||
                        Boolean(c.construction_period_end) ||
                        Number(c.construction_amount) > 0;
                      const gcPermitMatch =
                        c.type === 'gc' && projectId
                          ? pickPermitDisplayTemplateWithSource({
                              templates: permitTemplates,
                              projectId,
                              permitCompanyId: c.id,
                              gcCompanyId: c.id,
                              permitType: 'general',
                            })
                          : null;

                      return (
                        <div key={c.id}>
                          <div
                            className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border ${
                              depth === 0 ? '' : depth === 1 ? 'ml-6 border-l-2 border-l-primary/30' : 'ml-12 border-l-2 border-l-accent/30'
                            }`}
                          >
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {depth > 0 && <span className="text-muted-foreground text-xs">└</span>}
                                <span className="text-sm font-medium">{c.name}</span>
                                <Badge variant="outline" className={`text-[10px] ${c.type === 'client' ? 'border-primary/50 text-primary' : c.type === 'gc' ? 'border-accent/50 text-accent' : ''}`}>
                                  {companyTypes[c.type] || c.type}
                                </Badge>
                                <Badge variant="secondary" className="text-[10px]">
                                  멤버 {mCount}명
                                </Badge>
                                {gcPermitMatch && (
                                  <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-700 dark:text-blue-300">
                                    허가서: {gcPermitMatch.template.name}
                                  </Badge>
                                )}
                                {c.client_safety_service && (
                                  <Badge variant="secondary" className="text-[10px]">발주처 안전용역</Badge>
                                )}
                              </div>
                              {c.type !== 'client' && (
                                <p className={`text-xs ${hasConstruction ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}`}>
                                  {hasConstruction
                                    ? [
                                        c.construction_type,
                                        (c.construction_period_start || c.construction_period_end)
                                          ? `${c.construction_period_start || '미정'} ~ ${c.construction_period_end || '미정'}`
                                          : '',
                                        Number(c.construction_amount) > 0 ? formatKRW(c.construction_amount) : '',
                                      ].filter(Boolean).join(' · ')
                                    : '공사금액·기간 미등록 (우측 ⚙ 버튼에서 입력)'}
                                </p>
                              )}
                            </div>
                            {canManage && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditCompany(c)} title="역할·공사정보 수정">
                                  <Settings2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleUnlinkCompany(c.id)} title="프로젝트에서 제외">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                          {getChildren(c.id).map((child) => renderCompany(child, depth + 1))}
                        </div>
                      );
                    };

                    return topLevel.map((c) => renderCompany(c, 0));
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3. Members & Permissions Tab (with Invites integrated) */}
        <TabsContent value="members" className="space-y-4">
          {canManage && joinRequests.length > 0 && (
            <Card className="border-warning/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-warning">가입 요청 ({joinRequests.length}건)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {joinRequests.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between p-2 rounded bg-warning/5 border border-warning/20">
                    <div className="text-sm">
                      <span className="font-medium">{r.profiles?.display_name || r.user_id.slice(0, 8)}</span>
                      <span className="text-muted-foreground ml-2">{r.company_name}</span>
                      <Badge variant="outline" className="text-[10px] ml-2">{roleLabels[r.requested_role]}</Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleApproveRequest(r.id, r.user_id, r.requested_role)}>
                        승인
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleRejectRequest(r.id)}>
                        거절
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 flex-wrap">
              <CardTitle className="text-sm">
                프로젝트 멤버 ({filteredMembers.length}/{members.length}명)
              </CardTitle>
              {canManage && (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowInviteModal(true)}>
                    <KeyRound className="h-3.5 w-3.5" /> 초대코드 ({invites.length})
                  </Button>
                  <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowAddMember(true)}>
                    <UserPlus className="h-3.5 w-3.5" /> 멤버 추가
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Search & Filter Bar */}
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="이름 · 업체 · 연락처 검색..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Select value={memberCompanyFilter} onValueChange={setMemberCompanyFilter}>
                  <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="소속 업체" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">전체 업체</SelectItem>
                    <SelectItem value="__none__">업체 미지정</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={memberRoleFilter} onValueChange={setMemberRoleFilter}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="전체 권한" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">전체 권한</SelectItem>
                    {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                {filteredMembers.map((m) => {
                  const co = companies.find((c) => c.id === m.company_id);
                  return (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border">
                      <div className="text-sm min-w-[140px]">
                        <span className="font-medium">{getProfileName(m.user_id)}</span>
                        {(co?.name || m.company) && (
                          <span className="text-xs text-muted-foreground ml-1.5">({co?.name || m.company})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {canManage ? (
                          <>
                            <Select
                              value={m.company_id || '__none__'}
                              onValueChange={(v) => handleChangeMemberCompany(m.id, v === '__none__' ? null : v)}
                            >
                              <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="소속 업체" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">업체 미지정</SelectItem>
                                {companies.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select value={m.role_new || 'viewer'} onValueChange={(v) => handleChangeRole(m.id, v)}>
                              <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="역할" /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                                  <SelectItem key={k} value={k}>{v}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={m.position_new || '_none'}
                              onValueChange={(v) => handleChangePosition(m.id, v === '_none' ? null : v)}
                            >
                              <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="직책" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_none">직책 미지정</SelectItem>
                                {(() => {
                                  const allowed = positionsForCompanyType(co?.type);
                                  const keys = [...allowed];
                                  if (m.position_new && !keys.includes(m.position_new)) keys.unshift(m.position_new);
                                  return keys.map((k) => (
                                    <SelectItem key={k} value={k}>{positionLabels[k] || k}</SelectItem>
                                  ));
                                })()}
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveMember(m.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Badge variant="secondary" className="text-[10px]">{roleLabels[m.role_new] || '열람자'}</Badge>
                            {m.position_new && (
                              <Badge variant="outline" className="text-[10px]">{positionLabels[m.position_new] || m.position_new}</Badge>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">조건에 맞는 멤버가 없습니다.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 4. Integrations Hub Tab */}
        <TabsContent value="integrations">
          {projectId && (
            <ProjectIntegrationsTab
              projectId={projectId}
              companies={companies}
              isMaster={isMaster}
              canManage={canManage}
              canEditSafetyRules={canManage || projectRole === 'safety_manager'}
              initialWeatherStopRules={(project as any)?.weather_stop_rules}
              onWeatherRulesSaved={() => void fetchAll()}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Add Member Dialog — Searchable Multi-Select Picker */}
      <ProjectMemberMultiPickerDialog
        open={showAddMember}
        onOpenChange={setShowAddMember}
        projectId={projectId || ''}
        allProfiles={allProfiles}
        existingMemberUserIds={members.map((m) => m.user_id)}
        companies={companies}
        onAdded={fetchAll}
        onToast={(opts) => toast(opts)}
      />

      {/* Add Company Dialog */}
      <Dialog open={showAddCompany} onOpenChange={setShowAddCompany}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          onPointerDownOutside={(e) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest('[data-radix-select-content]')) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest('[data-radix-select-content]')) e.preventDefault();
          }}
        >
          <DialogHeader><DialogTitle>업체 연결 · 등록</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">업체명 <span className="text-muted-foreground font-normal">(전체 업체에서 검색 또는 신규 입력)</span></Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-8"
                  placeholder="회사명·사업자번호로 검색 또는 신규 입력..."
                  value={companyForm.name}
                  onChange={(e) => setCompanyForm({
                    ...companyForm,
                    name: e.target.value,
                    source_company_id: '',
                  })}
                  autoComplete="off"
                />
              </div>
              <div className="rounded-md border max-h-44 overflow-y-auto">
                {filteredGlobalCompanies.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">
                    {companyForm.name.trim()
                      ? isMaster
                        ? <>일치하는 업체가 없습니다. 아래 정보로 <b>즉시 신규 생성 후 연결</b>됩니다.</>
                        : <>일치하는 업체가 없습니다. 아래 정보로 <b>등록 요청</b>을 보내세요.</>
                      : '설정에 등록된 업체가 여기에 표시됩니다.'}
                  </div>
                ) : (
                  <ul className="py-1">
                    {filteredGlobalCompanies.map((g) => {
                      const selected = companyForm.source_company_id === g.id;
                      return (
                        <li key={g.id}>
                          <button
                            type="button"
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 ${selected ? 'bg-primary/10' : ''}`}
                            onClick={() => pickGlobalCompany(g)}
                          >
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="flex-1 truncate">{g.name}</span>
                            {g.business_no && <span className="text-[10px] text-muted-foreground shrink-0">{g.business_no}</span>}
                            <Badge variant="outline" className="text-[9px] shrink-0">{companyTypeLabel(g.type)}</Badge>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {companyForm.source_company_id ? (
                <p className="text-[10px] text-primary">시스템 업체에서 선택됨. 이 현장 역할과 공사정보를 저장합니다.</p>
              ) : companyForm.name.trim() ? (
                <p className="text-[10px] text-muted-foreground">
                  {isMaster
                    ? '마스터 권한으로 신규 업체를 바로 생성하고 이 현장에 연결합니다.'
                    : '목록에 없으면 등록 요청만 보냅니다. 마스터가 승인한 뒤 이 현장에 연결됩니다.'}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">업체 구분 (이 프로젝트 기준)</Label>
              <Select value={companyForm.type} onValueChange={(v) => setCompanyForm({ ...companyForm, type: v, parent_company_id: '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPANY_TYPE_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {companyForm.type === 'contractor' && (
              <div className="space-y-1.5">
                <Label className="text-xs">상위 시공사 <span className="text-destructive">*필수</span></Label>
                <Select value={companyForm.parent_company_id || '__none__'} onValueChange={(v) => setCompanyForm({ ...companyForm, parent_company_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="상위 업체 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(선택 안 함)</SelectItem>
                    {(companyForm.source_company_id || isMaster
                      ? getParentCandidates('contractor')
                      : getParentCandidates('contractor').filter((c) => c.inProject)
                    ).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} (시공사){!c.inProject ? ' · 설정에서 연결' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {companyForm.type === 'gc' && (
              <div className="space-y-1.5">
                <Label className="text-xs">상위 발주처 (선택)</Label>
                <Select value={companyForm.parent_company_id || '__none__'} onValueChange={(v) => setCompanyForm({ ...companyForm, parent_company_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="상위 업체 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(선택 안 함)</SelectItem>
                    {getParentCandidates('gc').map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} (발주처){!c.inProject ? ' · 설정에서 연결' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!companyForm.source_company_id && (
              <>
                <Input placeholder="사업자등록번호 (선택)" value={companyForm.business_no} onChange={(e) => setCompanyForm({ ...companyForm, business_no: e.target.value })} />
                <Input placeholder="연락처 (선택)" value={companyForm.contact} onChange={(e) => setCompanyForm({ ...companyForm, contact: e.target.value })} />
                {!isMaster && (
                  <>
                    <Input placeholder="신청자 이름" value={companyForm.requester_name} onChange={(e) => setCompanyForm({ ...companyForm, requester_name: e.target.value })} />
                    <Textarea placeholder="메모 (선택)" value={companyForm.memo} onChange={(e) => setCompanyForm({ ...companyForm, memo: e.target.value })} />
                  </>
                )}
              </>
            )}
            {(companyForm.source_company_id || isMaster) && (
              <>
                <ConstructionFields
                  value={constructionOf(companyForm)}
                  onChange={(next) => setCompanyForm({ ...companyForm, ...next })}
                />
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={companyForm.client_safety_service}
                    onCheckedChange={(v) => setCompanyForm({ ...companyForm, client_safety_service: v === true })}
                  />
                  <span>
                    발주처 안전용역
                    <span className="block text-[10px] text-muted-foreground">이 회사의 열람자는 현장 전체를 읽기만 합니다. 저장과 결재는 되지 않습니다.</span>
                  </span>
                </label>
              </>
            )}
            <Button onClick={handleAddCompany} className="w-full">
              {companyForm.source_company_id
                ? '이 현장에 연결'
                : isMaster
                  ? '신규 업체 생성 및 연결'
                  : '등록 요청'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Company Dialog */}
      <Dialog open={!!editingCompany} onOpenChange={(o) => !o && setEditingCompany(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>이 현장 업체 정보</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">업체명</Label>
              <Input value={editForm.name} disabled />
              <p className="text-[10px] text-muted-foreground mt-1">이름·사업자번호·연락처는 설정 &gt; 업체 관리에서 수정합니다.</p>
            </div>
            <div>
              <Label className="text-xs">유형 (이 프로젝트 기준)</Label>
              <Select value={editForm.type} onValueChange={(v) => setEditForm({ ...editForm, type: v, parent_company_id: '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPANY_TYPE_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(editForm.type === 'gc' || editForm.type === 'contractor' || editForm.type === 'vendor') && (
              <div>
                <Label className="text-xs">상위 업체 (선택)</Label>
                <Select value={editForm.parent_company_id || '__none__'} onValueChange={(v) => setEditForm({ ...editForm, parent_company_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="없음" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">없음 (최상위)</SelectItem>
                    {getParentCandidates(editForm.type, editingCompany?.id).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({companyTypes[c.type] || c.type}){!c.inProject ? ' · 설정에서 연결' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <ConstructionFields
              value={constructionOf(editForm)}
              onChange={(next) => setEditForm({ ...editForm, ...next })}
            />
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={editForm.client_safety_service}
                onCheckedChange={(v) => setEditForm({ ...editForm, client_safety_service: v === true })}
              />
              <span>
                발주처 안전용역
                <span className="block text-[10px] text-muted-foreground">이 회사의 열람자는 현장 전체를 읽기만 합니다. 저장과 결재는 되지 않습니다.</span>
              </span>
            </label>
            <Button onClick={handleUpdateCompany} className="w-full">저장</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invites Modal (integrated from former standalone tab) */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>초대코드 관리</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <p className="text-xs font-semibold">새 초대코드 생성</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">권한</Label>
                  <Select value={inviteForm.role} onValueChange={(v) => setInviteForm({ ...inviteForm, role: v, company_id: '' })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(roleLabels).filter(([k]) => k !== 'master').map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">연결 업체</Label>
                  <Select value={inviteForm.company_id || '__none__'} onValueChange={(v) => setInviteForm({ ...inviteForm, company_id: v === '__none__' ? '' : v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="업체 선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(업체 연결 안 함)</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({companyTypes[c.type] || c.type})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">최대 사용 횟수</Label>
                  <Input className="h-8 text-xs" type="number" min={1} value={inviteForm.max_uses} onChange={(e) => setInviteForm({ ...inviteForm, max_uses: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">유효기간 (일)</Label>
                  <Input className="h-8 text-xs" type="number" min={1} value={inviteForm.expires_days} onChange={(e) => setInviteForm({ ...inviteForm, expires_days: parseInt(e.target.value) || 7 })} />
                </div>
              </div>
              <Button size="sm" onClick={handleCreateInvite} className="w-full h-8 text-xs">초대코드 생성</Button>
            </div>

            <div className="space-y-2">
              {invites.map((inv: any) => {
                const linkedCompany = companies.find((c) => c.id === inv.company_id);
                const inviteLink = `${window.location.origin}/auth?invite=${inv.code}`;
                return (
                  <div key={inv.id} className="p-2.5 rounded-lg border space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-sm">{inv.code}</span>
                        <Badge variant="outline" className="text-[10px]">{roleLabels[inv.default_role]}</Badge>
                        {linkedCompany && <Badge variant="secondary" className="text-[10px]">{linkedCompany.name}</Badge>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            navigator.clipboard.writeText(inviteLink);
                            setCopiedCode(inv.code);
                            setTimeout(() => setCopiedCode(''), 2000);
                            toast({ title: '초대 링크가 복사되었습니다.' });
                          }}
                        >
                          {copiedCode === inv.code ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleDeleteInvite(inv.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      사용 {inv.use_count}/{inv.max_uses} · 만료: {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('ko-KR') : '없음'}
                    </div>
                  </div>
                );
              })}
              {invites.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">생성된 초대코드가 없습니다.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectDetail;
