import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, MapPin, Search, Star, Users, X, Loader2, Shield,
} from 'lucide-react';
import { geocodeKoreanAddress } from '@/lib/koreanLocationService';
import { syncProjectCompanyColumns } from '@/lib/projectCompanies';
import { companyTypeLabel, normalizeCompanyType } from '@/lib/companyTypes';
import { upsertProjectConstruction } from '@/lib/companyConstruction';
import {
  POSITION_LABELS,
  positionsForCompanyType,
  syncMembershipRolePosition,
} from '@/lib/projectPositions';
import {
  filterAndSortMemberCandidates,
  matchCompanyIdByName,
  type MemberCandidateProfile,
  type MemberDraftAssignment,
} from '@/components/project/ProjectMemberMultiPickerDialog';

type GlobalCompany = {
  id: string;
  name: string;
  type: string | null;
  business_no?: string | null;
};

type GcSelection = {
  company_id: string;
  name: string;
  construction_amount: string;
  construction_type: string;
  construction_period_start: string;
  construction_period_end: string;
};

type SubSelection = {
  company_id: string;
  name: string;
  parent_company_id: string;
};

const ROLE_LABELS: Record<string, string> = {
  project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자',
  site_manager: '현장대리인',
  supervisor: '감리',
  site_supervisor: '관리감독자',
  worker: '작업자',
  viewer: '열람자',
};

const STEPS = [
  { num: 1, label: '기본정보 · 위치' },
  { num: 2, label: '업체 트리 · 계약' },
  { num: 3, label: '핵심 멤버 배정' },
  { num: 4, label: '가동 준비 완료' },
] as const;

export default function ProjectCreationWizardDialog({
  open,
  onOpenChange,
  userId,
  onCreated,
  onLog,
  onToast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | undefined;
  onCreated: () => void;
  onLog: (action: string, entity: string, entityId: string) => void;
  onToast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [creating, setCreating] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  // Step 1: Basic Info & Geocoding
  const [name, setName] = useState('');
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [geoResult, setGeoResult] = useState<{ lat: number; lng: number } | null>(null);
  const [geoChecking, setGeoChecking] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('진행중');

  // Step 2: Client → GC → Subcontractor Tree
  const [globalCompanies, setGlobalCompanies] = useState<GlobalCompany[]>([]);
  const [clientCompanyId, setClientCompanyId] = useState('');
  const [clientText, setClientText] = useState('');
  const [gcQuery, setGcQuery] = useState('');
  const [selectedGcs, setSelectedGcs] = useState<GcSelection[]>([]);
  const [primaryGcId, setPrimaryGcId] = useState('');
  const [subQuery, setSubQuery] = useState('');
  const [selectedSubs, setSelectedSubs] = useState<SubSelection[]>([]);

  // Step 3: Batch Member Assignment
  const [allProfiles, setAllProfiles] = useState<MemberCandidateProfile[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberScope, setMemberScope] = useState<'all' | 'project_companies'>('project_companies');
  const [memberDrafts, setMemberDrafts] = useState<Record<string, MemberDraftAssignment>>({});
  const [autoCreateApprovalTemplate, setAutoCreateApprovalTemplate] = useState(true);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setCreating(false);
      setCreatedProjectId(null);
      setName('');
      setSiteName('');
      setSiteAddress('');
      setGeoResult(null);
      setGeoError(null);
      setPeriodStart('');
      setPeriodEnd('');
      setTags('');
      setStatus('진행중');
      setClientCompanyId('');
      setClientText('');
      setGcQuery('');
      setSelectedGcs([]);
      setPrimaryGcId('');
      setSubQuery('');
      setSelectedSubs([]);
      setMemberQuery('');
      setMemberScope('project_companies');
      setMemberDrafts({});
      setAutoCreateApprovalTemplate(true);
      return;
    }

    (async () => {
      const [{ data: compRows }, { data: profRows }] = await Promise.all([
        (supabase as any)
          .from('companies')
          .select('id, name, type, business_no')
          .eq('is_deleted', false)
          .order('name'),
        supabase
          .from('profiles')
          .select('user_id, display_name, company, phone, position'),
      ]);

      const seen = new Set<string>();
      const deduped: GlobalCompany[] = [];
      ((compRows || []) as GlobalCompany[]).forEach((c) => {
        const key = (c.name || '').trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        deduped.push({ ...c, type: normalizeCompanyType(c.type) || c.type });
      });
      setGlobalCompanies(deduped);
      setAllProfiles((profRows || []) as MemberCandidateProfile[]);
    })();
  }, [open]);

  const clientCandidates = useMemo(
    () => globalCompanies.filter((c) => normalizeCompanyType(c.type) === 'client'),
    [globalCompanies],
  );

  const gcSearchResults = useMemo(() => {
    const q = gcQuery.trim().toLowerCase();
    const picked = new Set(selectedGcs.map((g) => g.company_id));
    return globalCompanies
      .filter((c) => {
        if (picked.has(c.id)) return false;
        if (!q) return normalizeCompanyType(c.type) === 'gc';
        return (
          (c.name || '').toLowerCase().includes(q) ||
          (c.business_no || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 20);
  }, [globalCompanies, gcQuery, selectedGcs]);

  const subSearchResults = useMemo(() => {
    const q = subQuery.trim().toLowerCase();
    const picked = new Set([
      ...selectedGcs.map((g) => g.company_id),
      ...selectedSubs.map((s) => s.company_id),
    ]);
    return globalCompanies
      .filter((c) => {
        if (picked.has(c.id)) return false;
        if (!q) {
          const t = normalizeCompanyType(c.type);
          return t === 'contractor' || t === 'vendor';
        }
        return (
          (c.name || '').toLowerCase().includes(q) ||
          (c.business_no || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 20);
  }, [globalCompanies, subQuery, selectedGcs, selectedSubs]);

  const plannedCompanies = useMemo(() => {
    const list: Array<{ id: string; name: string; type: string }> = [];
    if (clientCompanyId) {
      const c = globalCompanies.find((x) => x.id === clientCompanyId);
      if (c) list.push({ id: c.id, name: c.name, type: 'client' });
    }
    selectedGcs.forEach((g) => list.push({ id: g.company_id, name: g.name, type: 'gc' }));
    selectedSubs.forEach((s) => list.push({ id: s.company_id, name: s.name, type: 'contractor' }));
    return list;
  }, [clientCompanyId, globalCompanies, selectedGcs, selectedSubs]);

  const plannedCompanyNames = useMemo(
    () => new Set(plannedCompanies.map((c) => c.name.trim().toLowerCase())),
    [plannedCompanies],
  );

  const memberCandidates = useMemo(() => {
    const existing = new Set<string>(userId ? [userId] : []);
    return filterAndSortMemberCandidates(allProfiles, existing, {
      query: memberQuery,
      scope: plannedCompanies.length > 0 ? memberScope : 'all',
      projectCompanyNames: plannedCompanyNames,
    });
  }, [allProfiles, userId, memberQuery, memberScope, plannedCompanies.length, plannedCompanyNames]);

  const handleCheckGeocode = async () => {
    if (!siteAddress.trim()) return;
    setGeoChecking(true);
    setGeoError(null);
    try {
      const geo = await geocodeKoreanAddress(siteAddress.trim());
      if (geo?.lat && geo?.lng) {
        setGeoResult({ lat: geo.lat, lng: geo.lng });
      } else {
        setGeoResult(null);
        setGeoError('좌표를 찾지 못했습니다. 도로명 또는 지번 주소를 확인해 주세요.');
      }
    } catch {
      setGeoResult(null);
      setGeoError('주소 변환 중 오류가 발생했습니다.');
    } finally {
      setGeoChecking(false);
    }
  };

  const addGc = (c: GlobalCompany) => {
    setSelectedGcs((prev) => {
      if (prev.some((g) => g.company_id === c.id)) return prev;
      return [
        ...prev,
        {
          company_id: c.id,
          name: c.name,
          construction_amount: '',
          construction_type: '',
          construction_period_start: periodStart,
          construction_period_end: periodEnd,
        },
      ];
    });
    if (!primaryGcId) setPrimaryGcId(c.id);
    setGcQuery('');
  };

  const removeGc = (companyId: string) => {
    setSelectedGcs((prev) => {
      const next = prev.filter((g) => g.company_id !== companyId);
      if (primaryGcId === companyId) setPrimaryGcId(next[0]?.company_id || '');
      return next;
    });
    setSelectedSubs((prev) =>
      prev.map((s) => (s.parent_company_id === companyId ? { ...s, parent_company_id: '' } : s)),
    );
  };

  const addSub = (c: GlobalCompany) => {
    const defaultParent = primaryGcId || selectedGcs[0]?.company_id || '';
    setSelectedSubs((prev) => {
      if (prev.some((s) => s.company_id === c.id)) return prev;
      return [...prev, { company_id: c.id, name: c.name, parent_company_id: defaultParent }];
    });
    setSubQuery('');
  };

  const toggleMember = (p: MemberCandidateProfile) => {
    setMemberDrafts((prev) => {
      if (prev[p.user_id]) {
        const next = { ...prev };
        delete next[p.user_id];
        return next;
      }
      const compId = matchCompanyIdByName(p.company, plannedCompanies);
      const compType = plannedCompanies.find((c) => c.id === compId)?.type;
      const synced = syncMembershipRolePosition({
        field: 'role_new',
        value: 'safety_manager',
        companyType: compType,
        currentPosition: null,
      });
      return {
        ...prev,
        [p.user_id]: {
          user_id: p.user_id,
          company_id: compId,
          role_new: synced.role_new || 'safety_manager',
          position_new: synced.position_new ?? null,
        },
      };
    });
  };

  const handleFinishCreate = async () => {
    if (!userId) {
      onToast({ title: '로그인이 필요합니다.', variant: 'destructive' });
      return;
    }
    if (!name.trim()) {
      onToast({ title: '프로젝트명을 입력하세요.', variant: 'destructive' });
      setStep(1);
      return;
    }
    setCreating(true);
    try {
      let coords = geoResult;
      if (!coords && siteAddress.trim()) {
        try {
          const geo = await geocodeKoreanAddress(siteAddress.trim());
          if (geo?.lat && geo?.lng) coords = { lat: geo.lat, lng: geo.lng };
        } catch { /* best-effort */ }
      }

      const clientCompanyObj = globalCompanies.find((c) => c.id === clientCompanyId);
      const resolvedClientName = clientCompanyObj?.name || clientText.trim();
      const gcIds = selectedGcs.map((g) => g.company_id);
      const subIds = selectedSubs.map((s) => s.company_id);
      const resolvedPrimaryGc = primaryGcId && gcIds.includes(primaryGcId) ? primaryGcId : gcIds[0] || null;

      const insertData: any = {
        name: name.trim(),
        site_name: siteName.trim(),
        site_address: siteAddress.trim() || null,
        site_lat: coords?.lat ?? null,
        site_lng: coords?.lng ?? null,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        client: resolvedClientName,
        gc_company_id: resolvedPrimaryGc,
        gc_company_ids: gcIds,
        sub_company_ids: subIds,
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
        status,
        created_by: userId,
      };

      const { data: created, error } = await supabase.from('projects').insert([insertData]).select().single();
      if (error || !created) {
        onToast({ title: '프로젝트 생성 실패', description: error?.message || '', variant: 'destructive' });
        return;
      }

      // 1) Upsert project_companies SSOT (client -> gc -> contractor with parent_company_id)
      const linkRows: any[] = [];
      if (clientCompanyId) {
        linkRows.push({
          project_id: created.id,
          company_id: clientCompanyId,
          role_in_project: 'client',
          parent_company_id: null,
          is_deleted: false,
        });
      }
      selectedGcs.forEach((g) => {
        linkRows.push({
          project_id: created.id,
          company_id: g.company_id,
          role_in_project: 'gc',
          parent_company_id: clientCompanyId || null,
          is_deleted: false,
        });
      });
      selectedSubs.forEach((s) => {
        linkRows.push({
          project_id: created.id,
          company_id: s.company_id,
          role_in_project: 'contractor',
          parent_company_id: s.parent_company_id || resolvedPrimaryGc || null,
          is_deleted: false,
        });
      });
      if (linkRows.length > 0) {
        await (supabase as any).from('project_companies').upsert(linkRows, {
          onConflict: 'project_id,company_id',
        });
      }
      await syncProjectCompanyColumns(created.id, resolvedPrimaryGc);

      // 2) Save optional construction contract info for GCs
      for (const g of selectedGcs) {
        if (g.construction_amount || g.construction_type || g.construction_period_start || g.construction_period_end) {
          await upsertProjectConstruction(g.company_id, created.id, {
            construction_name: name.trim(),
            construction_type: g.construction_type,
            construction_period_start: g.construction_period_start,
            construction_period_end: g.construction_period_end,
            construction_amount: g.construction_amount,
          });
        }
      }

      // 3) Add creator (with auto-matched company) + selected batch members
      const myProfile = allProfiles.find((p) => p.user_id === userId);
      const myMatchedCompanyId =
        matchCompanyIdByName(myProfile?.company, plannedCompanies) || clientCompanyId || null;
      const myCompName = plannedCompanies.find((c) => c.id === myMatchedCompanyId)?.name || myProfile?.company || null;

      const memberRows: any[] = [
        {
          project_id: created.id,
          user_id: userId,
          role_new: 'project_admin',
          company_id: myMatchedCompanyId,
          company: myCompName,
        },
        ...Object.values(memberDrafts).map((d) => {
          const comp = plannedCompanies.find((c) => c.id === d.company_id);
          return {
            project_id: created.id,
            user_id: d.user_id,
            role_new: d.role_new,
            position_new: d.position_new || null,
            company_id: d.company_id || null,
            company: comp?.name || null,
          };
        }),
      ];
      await supabase.from('project_members').insert(memberRows);

      // 4) Optional default shared approval route template
      if (autoCreateApprovalTemplate) {
        const steps = [
          {
            step_order: 0,
            step_label: '작성',
            position: 'site_supervisor',
            user_id: '',
            user_name: '',
            company_name: '',
          },
          {
            step_order: 1,
            step_label: '안전관리자 검토',
            position: 'safety_manager',
            user_id: '',
            user_name: '',
            company_name: '',
          },
          {
            step_order: 2,
            step_label: '최종승인',
            position: 'project_admin',
            user_id: userId,
            user_name: myProfile?.display_name || '',
            company_name: myCompName || '',
          },
        ];
        await supabase.from('approval_route_templates').insert([
          {
            project_id: created.id,
            name: '기본 결재라인',
            assessment_type: '정기',
            is_default: true,
            steps,
            created_by: userId,
            owner_user_id: null,
            company_id: null,
          } as any,
        ]);
      }

      onLog('생성', 'project', created.id);
      onCreated();
      setCreatedProjectId(created.id);
      setStep(4);
      onToast({ title: '프로젝트가 생성되었습니다.' });
    } catch (err) {
      onToast({ title: '프로젝트 생성 중 오류', description: String(err), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>새 프로젝트 개설</DialogTitle>
          {/* Step Indicator */}
          <div className="grid grid-cols-4 gap-1.5 pt-2">
            {STEPS.map((s) => {
              const active = step === s.num;
              const done = step > s.num;
              return (
                <div
                  key={s.num}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                    active
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : done
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                        : 'border-border text-muted-foreground'
                  }`}
                >
                  <span className="h-4 w-4 rounded-full bg-background border flex items-center justify-center text-[10px] shrink-0">
                    {done ? <Check className="h-3 w-3" /> : s.num}
                  </span>
                  <span className="truncate">{s.label}</span>
                </div>
              );
            })}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2 pr-1 space-y-4">
          {/* STEP 1: Basic Info & Geocoding */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>프로젝트명 *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 여수 배관망 증설(UG)"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <Label>현장명</Label>
                  <Input
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    placeholder="예: 여수 산단 3공구"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>현장주소 (날씨 · GPS 출근 좌표 자동 연동)</Label>
                <div className="flex gap-2">
                  <Input
                    value={siteAddress}
                    onChange={(e) => {
                      setSiteAddress(e.target.value);
                      setGeoResult(null);
                      setGeoError(null);
                    }}
                    placeholder="예: 전라남도 여수시 화학단지로 123"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 gap-1"
                    disabled={!siteAddress.trim() || geoChecking}
                    onClick={() => void handleCheckGeocode()}
                  >
                    {geoChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                    좌표 확인
                  </Button>
                </div>
                {geoResult && (
                  <p className="text-xs text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    좌표 확인 완료 ({geoResult.lat.toFixed(5)}, {geoResult.lng.toFixed(5)}) — 날씨·출근 연동 준비됨
                  </p>
                )}
                {geoError && <p className="text-xs text-destructive">{geoError}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>시작일</Label>
                  <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>종료일</Label>
                  <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>상태</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="진행중">진행중</SelectItem>
                      <SelectItem value="완료">완료</SelectItem>
                      <SelectItem value="보류">보류</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>주요 공종 태그 (쉼표 구분)</Label>
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="배관, 용접, 고소작업, 굴착"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Company Hierarchy Tree + Contract Info */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Client */}
              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" /> 1. 발주처 (업체 트리 최상위 자동 연결)
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Select
                    value={clientCompanyId || '__none__'}
                    onValueChange={(v) => {
                      const nextId = v === '__none__' ? '' : v;
                      setClientCompanyId(nextId);
                      const found = globalCompanies.find((c) => c.id === nextId);
                      if (found) setClientText(found.name);
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="등록된 발주처 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(직접 입력 / 미선택)</SelectItem>
                      {clientCandidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-9 text-xs"
                    value={clientText}
                    onChange={(e) => {
                      setClientText(e.target.value);
                      setClientCompanyId('');
                    }}
                    placeholder="또는 발주사명 직접 입력"
                  />
                </div>
              </div>

              {/* GC Selection */}
              <div className="rounded-lg border p-3 space-y-2.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-accent" /> 2. 시공사(GC) 검색 및 추가 (전역 업체 검색 · 대표 시공사 지정)
                </Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-8 h-9 text-xs"
                    value={gcQuery}
                    onChange={(e) => setGcQuery(e.target.value)}
                    placeholder="시공사명 또는 사업자번호 검색..."
                  />
                </div>
                {gcSearchResults.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 rounded bg-muted/30 border">
                    {gcSearchResults.map((c) => (
                      <Button
                        key={c.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2 gap-1"
                        onClick={() => addGc(c)}
                      >
                        + {c.name}
                        <span className="text-[10px] text-muted-foreground">({companyTypeLabel(c.type)})</span>
                      </Button>
                    ))}
                  </div>
                )}

                {selectedGcs.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {selectedGcs.map((g) => {
                      const isPrimary = primaryGcId === g.company_id;
                      return (
                        <div key={g.company_id} className="rounded-md border bg-muted/20 p-2.5 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold">{g.name}</span>
                              <Badge variant={isPrimary ? 'default' : 'outline'} className="text-[10px]">
                                {isPrimary ? '대표 시공사' : '시공사'}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              {!isPrimary && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[11px] gap-1"
                                  onClick={() => setPrimaryGcId(g.company_id)}
                                >
                                  <Star className="h-3 w-3" /> 대표로 지정
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-destructive"
                                onClick={() => removeGc(g.company_id)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <Input
                              className="h-8 text-xs"
                              type="number"
                              placeholder="공사금액 (원, 선택)"
                              value={g.construction_amount}
                              onChange={(e) =>
                                setSelectedGcs((prev) =>
                                  prev.map((x) =>
                                    x.company_id === g.company_id
                                      ? { ...x, construction_amount: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <Input
                              className="h-8 text-xs"
                              placeholder="공사유형 (예: 기계/배관)"
                              value={g.construction_type}
                              onChange={(e) =>
                                setSelectedGcs((prev) =>
                                  prev.map((x) =>
                                    x.company_id === g.company_id
                                      ? { ...x, construction_type: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <div className="flex items-center gap-1">
                              <Input
                                className="h-8 text-[11px]"
                                type="date"
                                value={g.construction_period_start}
                                onChange={(e) =>
                                  setSelectedGcs((prev) =>
                                    prev.map((x) =>
                                      x.company_id === g.company_id
                                        ? { ...x, construction_period_start: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                              <span className="text-xs">~</span>
                              <Input
                                className="h-8 text-[11px]"
                                type="date"
                                value={g.construction_period_end}
                                onChange={(e) =>
                                  setSelectedGcs((prev) =>
                                    prev.map((x) =>
                                      x.company_id === g.company_id
                                        ? { ...x, construction_period_end: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Subcontractors under GC */}
              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> 3. 협력사 추가 (상위 시공사 자동 연결 · 선택)
                </Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-8 h-9 text-xs"
                    value={subQuery}
                    onChange={(e) => setSubQuery(e.target.value)}
                    placeholder="협력사명 또는 사업자번호 검색..."
                  />
                </div>
                {subSearchResults.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 rounded bg-muted/30 border">
                    {subSearchResults.map((c) => (
                      <Button
                        key={c.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => addSub(c)}
                      >
                        + {c.name}
                      </Button>
                    ))}
                  </div>
                )}
                {selectedSubs.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {selectedSubs.map((s) => (
                      <div key={s.company_id} className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs">
                        <span className="font-medium flex-1 truncate">{s.name}</span>
                        <Select
                          value={s.parent_company_id || '__none__'}
                          onValueChange={(v) =>
                            setSelectedSubs((prev) =>
                              prev.map((x) =>
                                x.company_id === s.company_id
                                  ? { ...x, parent_company_id: v === '__none__' ? '' : v }
                                  : x,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="h-7 w-44 text-xs">
                            <SelectValue placeholder="상위 시공사" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(상위 시공사 미지정)</SelectItem>
                            {selectedGcs.map((g) => (
                              <SelectItem key={g.company_id} value={g.company_id}>
                                {g.name} (시공사)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive"
                          onClick={() =>
                            setSelectedSubs((prev) => prev.filter((x) => x.company_id !== s.company_id))
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Batch Member Assignment */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-9 h-9 text-xs"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="이름, 업체명 또는 전화번호 뒤 4자리 검색..."
                  />
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={memberScope === 'project_companies' ? 'default' : 'outline'}
                    className="h-9 text-xs"
                    disabled={plannedCompanies.length === 0}
                    onClick={() => setMemberScope('project_companies')}
                  >
                    선택한 업체 소속만
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={memberScope === 'all' ? 'default' : 'outline'}
                    className="h-9 text-xs"
                    onClick={() => setMemberScope('all')}
                  >
                    전체
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="px-3 py-1.5 bg-muted/40 border-b text-xs text-muted-foreground flex justify-between">
                  <span>검색 결과 {memberCandidates.length}명</span>
                  <span>선택됨 {Object.keys(memberDrafts).length}명 (+ 본인 자동 포함)</span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y">
                  {memberCandidates.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      일치하는 사용자가 없습니다. 「전체」 필터로 전환하거나 생성 후 추가할 수 있습니다.
                    </div>
                  ) : (
                    memberCandidates.slice(0, 80).map((p) => {
                      const checked = !!memberDrafts[p.user_id];
                      return (
                        <label
                          key={p.user_id}
                          className={`flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-muted/50 ${
                            checked ? 'bg-primary/5' : ''
                          }`}
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggleMember(p)} />
                          <span className="font-medium">{p.display_name || p.user_id.slice(0, 8)}</span>
                          {p.company && <Badge variant="outline" className="text-[10px]">{p.company}</Badge>}
                          <span className="flex-1" />
                          {p.phone && <span className="text-muted-foreground font-mono">{p.phone}</span>}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {Object.values(memberDrafts).length > 0 && (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {Object.values(memberDrafts).map((d) => {
                    const p = allProfiles.find((x) => x.user_id === d.user_id);
                    const co = plannedCompanies.find((c) => c.id === d.company_id);
                    const allowedPos = positionsForCompanyType(co?.type);
                    return (
                      <div key={d.user_id} className="grid grid-cols-1 sm:grid-cols-4 gap-1.5 items-center rounded border p-2 text-xs">
                        <span className="font-medium truncate">{p?.display_name}</span>
                        <Select
                          value={d.company_id || '__none__'}
                          onValueChange={(v) =>
                            setMemberDrafts((prev) => ({
                              ...prev,
                              [d.user_id]: { ...d, company_id: v === '__none__' ? '' : v },
                            }))
                          }
                        >
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="업체" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(미지정)</SelectItem>
                            {plannedCompanies.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={d.role_new}
                          onValueChange={(v) =>
                            setMemberDrafts((prev) => ({
                              ...prev,
                              [d.user_id]: { ...d, role_new: v },
                            }))
                          }
                        >
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(ROLE_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={d.position_new || '_none'}
                          onValueChange={(v) =>
                            setMemberDrafts((prev) => ({
                              ...prev,
                              [d.user_id]: { ...d, position_new: v === '_none' ? null : v },
                            }))
                          }
                        >
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="직책" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">직책 미지정</SelectItem>
                            {allowedPos.map((k) => (
                              <SelectItem key={k} value={k}>{POSITION_LABELS[k] || k}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              )}

              <label className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs cursor-pointer">
                <Checkbox
                  checked={autoCreateApprovalTemplate}
                  onCheckedChange={(v) => setAutoCreateApprovalTemplate(v === true)}
                />
                <span>기본 공용 결재라인 템플릿(작성 → 안전관리자 검토 → 최종승인) 함께 자동 생성</span>
              </label>
            </div>
          )}

          {/* STEP 4: Completion & Readiness Shortcuts */}
          {step === 4 && createdProjectId && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-semibold text-base">「{name}」 프로젝트 개설 완료</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    업체 {plannedCompanies.length}곳 · 멤버 {Object.keys(memberDrafts).length + 1}명이 연결되었습니다.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-start gap-1 text-left"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/project/${createdProjectId}?tab=basic-info`);
                  }}
                >
                  <span className="font-semibold text-xs flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-primary" /> 기본정보 · GPS 출근개소
                  </span>
                  <span className="text-[11px] text-muted-foreground font-normal">현장 개소 및 상세 설정 확인</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-start gap-1 text-left"
                  onClick={() => {
                    onOpenChange(false);
                    navigate('/site-control-map');
                  }}
                >
                  <span className="font-semibold text-xs flex items-center gap-1">
                    <Shield className="h-3.5 w-3.5 text-primary" /> 관제맵 · 도면/위험구역
                  </span>
                  <span className="text-[11px] text-muted-foreground font-normal">드론 도면 업로드 및 위험구역 등록</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-start gap-1 text-left"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/project/${createdProjectId}?tab=invites`);
                  }}
                >
                  <span className="font-semibold text-xs flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-primary" /> 초대코드 · 멤버 관리
                  </span>
                  <span className="text-[11px] text-muted-foreground font-normal">관리자 초대링크 및 추가 배정</span>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="pt-3 border-t flex items-center justify-between gap-2">
          {step < 4 ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => (step === 1 ? onOpenChange(false) : setStep((step - 1) as 1 | 2 | 3))}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                {step === 1 ? '취소' : '이전'}
              </Button>
              <div className="flex items-center gap-2">
                {step < 3 ? (
                  <Button
                    type="button"
                    disabled={step === 1 && !name.trim()}
                    onClick={() => setStep((step + 1) as 2 | 3)}
                    className="gap-1"
                  >
                    다음 <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={creating || !name.trim()}
                    onClick={() => void handleFinishCreate()}
                    className="gap-1.5"
                  >
                    {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                    {creating ? '프로젝트 생성 중...' : '프로젝트 개설 완료'}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                if (createdProjectId) navigate(`/project/${createdProjectId}?tab=basic-info`);
              }}
            >
              프로젝트 상세 화면으로 이동
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
