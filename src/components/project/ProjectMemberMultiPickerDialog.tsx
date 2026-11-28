import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Check, Search, UserPlus, X } from 'lucide-react';
import {
  POSITION_LABELS,
  positionsForCompanyType,
  syncMembershipRolePosition,
} from '@/lib/projectPositions';
import { companyTypeLabel } from '@/lib/companyTypes';

export type MemberCandidateProfile = {
  user_id: string;
  display_name: string | null;
  company: string | null;
  phone?: string | null;
  position?: string | null;
};

export type ProjectCompanyOption = {
  id: string;
  name: string;
  type: string | null;
};

export type MemberDraftAssignment = {
  user_id: string;
  role_new: string;
  position_new: string | null;
  company_id: string;
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

const ROLES_REQUIRING_COMPANY = new Set([
  'site_manager',
  'supervisor',
  'site_supervisor',
  'worker',
  'contractor',
]);

/**
 * Pure filter & Korean alphabetical sort for member candidates.
 * Matches display_name, company, or phone digits.
 */
export function filterAndSortMemberCandidates(
  allProfiles: MemberCandidateProfile[],
  existingMemberUserIds: Set<string>,
  opts: {
    query: string;
    scope: 'all' | 'project_companies' | string;
    projectCompanyNames: Set<string>;
  },
): MemberCandidateProfile[] {
  const q = opts.query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');

  return allProfiles
    .filter((p) => {
      if (!p?.user_id || existingMemberUserIds.has(p.user_id)) return false;

      const compName = (p.company || '').trim();
      if (opts.scope === 'project_companies') {
        if (!compName || !opts.projectCompanyNames.has(compName.toLowerCase())) return false;
      } else if (opts.scope !== 'all') {
        if (compName.toLowerCase() !== opts.scope.toLowerCase()) return false;
      }

      if (!q) return true;
      const name = (p.display_name || '').toLowerCase();
      const comp = compName.toLowerCase();
      const phone = (p.phone || '').toLowerCase();
      const phoneDigits = phone.replace(/\D/g, '');
      return (
        name.includes(q) ||
        comp.includes(q) ||
        phone.includes(q) ||
        (qDigits.length >= 3 && phoneDigits.includes(qDigits))
      );
    })
    .sort((a, b) => {
      const nameA = (a.display_name || '').trim() || a.user_id;
      const nameB = (b.display_name || '').trim() || b.user_id;
      return nameA.localeCompare(nameB, 'ko');
    });
}

export function matchCompanyIdByName(
  companyName: string | null | undefined,
  companies: ProjectCompanyOption[],
): string {
  const needle = (companyName || '').trim().toLowerCase();
  if (!needle) return '';
  const exact = companies.find((c) => (c.name || '').trim().toLowerCase() === needle);
  if (exact) return exact.id;
  const partial = companies.find((c) => {
    const cname = (c.name || '').trim().toLowerCase();
    return cname && (cname.includes(needle) || needle.includes(cname));
  });
  return partial?.id || '';
}

export default function ProjectMemberMultiPickerDialog({
  open,
  onOpenChange,
  projectId,
  allProfiles,
  existingMemberUserIds,
  companies,
  onAdded,
  onToast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  allProfiles: MemberCandidateProfile[];
  existingMemberUserIds: string[];
  companies: ProjectCompanyOption[];
  onAdded: () => void;
  onToast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'project_companies' | string>('all');
  const [defaultRole, setDefaultRole] = useState('safety_manager');
  const [drafts, setDrafts] = useState<Record<string, MemberDraftAssignment>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setScope('all');
      setDrafts({});
    }
  }, [open]);

  const existingSet = useMemo(() => new Set(existingMemberUserIds), [existingMemberUserIds]);
  const projectCompanyNames = useMemo(
    () => new Set(companies.map((c) => (c.name || '').trim().toLowerCase()).filter(Boolean)),
    [companies],
  );

  const candidates = useMemo(
    () =>
      filterAndSortMemberCandidates(allProfiles, existingSet, {
        query,
        scope,
        projectCompanyNames,
      }),
    [allProfiles, existingSet, query, scope, projectCompanyNames],
  );

  const selectedList = useMemo(() => Object.values(drafts), [drafts]);

  const toggleCandidate = (profile: MemberCandidateProfile) => {
    setDrafts((prev) => {
      if (prev[profile.user_id]) {
        const next = { ...prev };
        delete next[profile.user_id];
        return next;
      }
      const matchedCompanyId = matchCompanyIdByName(profile.company, companies);
      const companyType = companies.find((c) => c.id === matchedCompanyId)?.type;
      const synced = syncMembershipRolePosition({
        field: 'role_new',
        value: defaultRole,
        companyType,
        currentPosition: null,
      });
      return {
        ...prev,
        [profile.user_id]: {
          user_id: profile.user_id,
          role_new: synced.role_new || defaultRole,
          position_new: synced.position_new ?? null,
          company_id: matchedCompanyId,
        },
      };
    });
  };

  const updateDraft = (userId: string, patch: Partial<MemberDraftAssignment>) => {
    setDrafts((prev) => {
      const cur = prev[userId];
      if (!cur) return prev;
      const next = { ...cur, ...patch };
      if (patch.role_new !== undefined) {
        const companyType = companies.find((c) => c.id === next.company_id)?.type;
        const synced = syncMembershipRolePosition({
          field: 'role_new',
          value: patch.role_new,
          companyType,
          currentPosition: next.position_new,
        });
        next.role_new = synced.role_new || patch.role_new;
        if (synced.position_new !== undefined) next.position_new = synced.position_new;
      } else if (patch.position_new !== undefined) {
        const synced = syncMembershipRolePosition({
          field: 'position_new',
          value: patch.position_new,
          currentRole: cur.role_new || null,
        });
        if (synced.role_new) next.role_new = synced.role_new;
        next.position_new = synced.position_new ?? patch.position_new;
      }
      return { ...prev, [userId]: next };
    });
  };

  const applyDefaultRoleToAllSelected = (role: string) => {
    setDefaultRole(role);
    setDrafts((prev) => {
      const next: Record<string, MemberDraftAssignment> = {};
      for (const [uid, item] of Object.entries(prev)) {
        const companyType = companies.find((c) => c.id === item.company_id)?.type;
        const synced = syncMembershipRolePosition({
          field: 'role_new',
          value: role,
          companyType,
          currentPosition: item.position_new,
        });
        next[uid] = {
          ...item,
          role_new: synced.role_new || role,
          position_new: synced.position_new ?? item.position_new,
        };
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!projectId || selectedList.length === 0) {
      onToast({ title: '추가할 사용자를 1명 이상 선택하세요.', variant: 'destructive' });
      return;
    }

    const missingCompany = selectedList.find(
      (d) => ROLES_REQUIRING_COMPANY.has(d.role_new) && !d.company_id,
    );
    if (missingCompany) {
      const p = allProfiles.find((x) => x.user_id === missingCompany.user_id);
      onToast({
        title: `${p?.display_name || '선택 사용자'}의 소속 업체를 선택해 주세요.`,
        description: '현장대리인·감리·관리감독자·작업자 역할은 소속 업체가 필수입니다.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const rows = selectedList.map((d) => {
        const comp = companies.find((c) => c.id === d.company_id);
        return {
          project_id: projectId,
          user_id: d.user_id,
          role_new: d.role_new as any,
          position_new: d.position_new || null,
          company_id: d.company_id || null,
          company: comp?.name || null,
        };
      });
      const { error } = await supabase.from('project_members').insert(rows as any);
      if (error) {
        onToast({ title: '멤버 추가 실패', description: error.message, variant: 'destructive' });
        return;
      }
      onToast({ title: `멤버 ${rows.length}명이 프로젝트에 추가되었습니다.` });
      onOpenChange(false);
      onAdded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] flex flex-col"
        onPointerDownOutside={(e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest('[data-radix-select-content]')) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest('[data-radix-select-content]')) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            멤버 추가 (이름 · 업체 검색 및 다중 선택)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-y-auto pr-1">
          {/* Search + Default Role Bar */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름, 업체명 또는 전화번호 뒤 4자리 검색..."
                autoFocus
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">기본 권한</Label>
              <Select value={defaultRole} onValueChange={applyDefaultRoleToAllSelected}>
                <SelectTrigger className="w-36 h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Quick Filter Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={scope === 'all' ? 'default' : 'outline'}
              className="h-7 text-xs px-2.5"
              onClick={() => setScope('all')}
            >
              전체
            </Button>
            {companies.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant={scope === 'project_companies' ? 'default' : 'outline'}
                className="h-7 text-xs px-2.5 gap-1"
                onClick={() => setScope('project_companies')}
              >
                <Building2 className="h-3 w-3" />이 현장 업체 소속만
              </Button>
            )}
            {companies.slice(0, 6).map((c) => (
              <Button
                key={c.id}
                type="button"
                size="sm"
                variant={scope === c.name ? 'secondary' : 'ghost'}
                className="h-7 text-xs px-2 border border-border/60"
                onClick={() => setScope(scope === c.name ? 'all' : c.name)}
              >
                {c.name}
              </Button>
            ))}
          </div>

          {/* Searchable Candidate List */}
          <div className="rounded-lg border">
            <div className="px-3 py-1.5 bg-muted/40 border-b flex items-center justify-between text-xs text-muted-foreground">
              <span>검색 결과 {candidates.length}명</span>
              <span>체크박스로 여러 명 한 번에 선택 가능</span>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y">
              {candidates.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  일치하는 미등록 사용자가 없습니다.
                </div>
              ) : (
                candidates.slice(0, 120).map((p) => {
                  const checked = !!drafts[p.user_id];
                  return (
                    <label
                      key={p.user_id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm hover:bg-muted/50 ${
                        checked ? 'bg-primary/5' : ''
                      }`}
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggleCandidate(p)} />
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="font-medium truncate">{p.display_name || p.user_id.slice(0, 8)}</span>
                        {p.company && (
                          <Badge variant="outline" className="text-[10px] font-normal shrink-0">
                            {p.company}
                          </Badge>
                        )}
                        {p.position && (
                          <span className="text-xs text-muted-foreground truncate">{p.position}</span>
                        )}
                      </div>
                      {p.phone && (
                        <span className="text-xs text-muted-foreground font-mono shrink-0">
                          {p.phone}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Selected Members Assignment Table */}
          {selectedList.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  선택된 멤버 ({selectedList.length}명) — 소속 업체 · 권한 · 직책 지정
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground"
                  onClick={() => setDrafts({})}
                >
                  선택 전체 해제
                </Button>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {selectedList.map((item) => {
                  const p = allProfiles.find((x) => x.user_id === item.user_id);
                  const co = companies.find((c) => c.id === item.company_id);
                  const allowedPositions = positionsForCompanyType(co?.type);
                  const needsCompany = ROLES_REQUIRING_COMPANY.has(item.role_new);
                  return (
                    <div
                      key={item.user_id}
                      className="rounded-lg border bg-muted/20 p-2.5 flex flex-col sm:flex-row sm:items-center gap-2"
                    >
                      <div className="min-w-0 sm:w-36 shrink-0">
                        <div className="text-sm font-medium truncate">
                          {p?.display_name || item.user_id.slice(0, 8)}
                        </div>
                        {p?.company && (
                          <div className="text-[11px] text-muted-foreground truncate">{p.company}</div>
                        )}
                      </div>

                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                        <Select
                          value={item.company_id || '__none__'}
                          onValueChange={(v) =>
                            updateDraft(item.user_id, { company_id: v === '__none__' ? '' : v })
                          }
                        >
                          <SelectTrigger
                            className={`h-8 text-xs ${needsCompany && !item.company_id ? 'border-destructive' : ''}`}
                          >
                            <SelectValue placeholder={needsCompany ? '소속 업체 *' : '소속 업체 (선택)'} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(업체 미지정)</SelectItem>
                            {companies.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name} ({companyTypeLabel(c.type)})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={item.role_new}
                          onValueChange={(v) => updateDraft(item.user_id, { role_new: v })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="권한" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ROLE_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={item.position_new || '_none'}
                          onValueChange={(v) =>
                            updateDraft(item.user_id, { position_new: v === '_none' ? null : v })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="직책" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">직책 미지정</SelectItem>
                            {allowedPositions.map((k) => (
                              <SelectItem key={k} value={k}>
                                {POSITION_LABELS[k] || k}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => p && toggleCandidate(p)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="pt-3 border-t flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="button"
            disabled={selectedList.length === 0 || submitting}
            onClick={() => void handleSubmit()}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" />
            {submitting ? '추가 중...' : `${selectedList.length}명 일괄 추가`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
