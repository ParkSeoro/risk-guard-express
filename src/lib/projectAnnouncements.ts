/**
 * Field announcements (현장 공지) — targeting SSOT shared by UI tests and publish RPC.
 * DB still re-validates; this is the client preview + unit-test contract.
 */
import { ADMIN_PROJECT_ROLES } from "@/lib/permissions";
import { collectDescendants } from "@/lib/companyDocScope";
import { isClientType, isContractorType, isGcType } from "@/lib/companyTypes";

export type AnnouncementCompanyMode = "own_tree" | "one_gc" | "one_company" | "project_all";
export type AnnouncementPeople = "managers" | "workers" | "all";

export type AnnouncementAudience = {
  companyMode: AnnouncementCompanyMode;
  companyIds: string[];
  includeDescendants: boolean;
  people: AnnouncementPeople;
};

export type AnnouncementAuthor = {
  isMaster: boolean;
  role: string | null;
  companyId: string | null;
  companyType: string | null;
};

export type AnnouncementCompanyNode = {
  id: string;
  name?: string | null;
  type?: string | null;
  parent_company_id?: string | null;
};

export type AnnouncementMember = {
  user_id: string | null;
  role_new?: string | null;
  company_id?: string | null;
};

const ADMIN = new Set<string>(ADMIN_PROJECT_ROLES);

export function canComposeAnnouncement(author: AnnouncementAuthor): boolean {
  if (author.isMaster) return true;
  return ADMIN.has(String(author.role || "").toLowerCase());
}

/** GC managers may target the whole site (현장 전체). Contractors stay own-company. */
export function allowedCompanyModes(author: AnnouncementAuthor): AnnouncementCompanyMode[] {
  if (author.isMaster || isClientType(author.companyType)) {
    return ["project_all", "own_tree", "one_gc", "one_company"];
  }
  if (isGcType(author.companyType)) {
    return ["project_all", "own_tree", "one_gc", "one_company"];
  }
  return ["own_tree", "one_company"];
}

export function authorAllowedCompanyIds(
  author: AnnouncementAuthor,
  companies: AnnouncementCompanyNode[],
): string[] | "all" {
  if (author.isMaster || isClientType(author.companyType)) return "all";
  if (!author.companyId) return [];
  const graph = companies.map((c) => ({ id: c.id, parent_id: c.parent_company_id || null }));
  if (isGcType(author.companyType)) return collectDescendants(graph, author.companyId);
  return [author.companyId];
}

export function resolveAudienceCompanyIds(
  audience: AnnouncementAudience,
  author: AnnouncementAuthor,
  companies: AnnouncementCompanyNode[],
): string[] | "all" {
  if (audience.companyMode === "project_all") return "all";
  const graph = companies.map((c) => ({ id: c.id, parent_id: c.parent_company_id || null }));
  if (audience.companyMode === "own_tree") {
    if (!author.companyId) return "all";
    return collectDescendants(graph, author.companyId);
  }
  const root = String(audience.companyIds?.[0] || "").trim();
  if (!root) return [];
  const withKids =
    audience.includeDescendants || audience.companyMode === "one_gc" || audience.companyMode === "own_tree";
  if (withKids) return collectDescendants(graph, root);
  return [root];
}

export function filterAnnouncementRecipients(
  members: AnnouncementMember[],
  companyIds: string[] | "all",
  people: AnnouncementPeople,
): string[] {
  const ids = new Set<string>();
  for (const m of members) {
    const uid = String(m.user_id || "").trim();
    if (!uid) continue;
    if (companyIds !== "all" && !companyIds.includes(String(m.company_id || ""))) continue;
    const role = String(m.role_new || "").toLowerCase();
    if (people === "managers" && !ADMIN.has(role)) continue;
    if (people === "workers" && role !== "worker") continue;
    ids.add(uid);
  }
  return [...ids];
}

export function validateAnnouncementAudience(
  author: AnnouncementAuthor,
  audience: AnnouncementAudience,
  companies: AnnouncementCompanyNode[],
): { ok: true } | { ok: false; error: string } {
  if (!canComposeAnnouncement(author)) {
    return { ok: false, error: "관리자만 공지를 작성할 수 있습니다." };
  }
  const modes = allowedCompanyModes(author);
  if (!modes.includes(audience.companyMode)) {
    return { ok: false, error: "이 대상 범위는 권한이 없습니다." };
  }
  if (audience.companyMode === "project_all") return { ok: true };
  if (audience.companyMode === "own_tree") {
    if (!author.isMaster && !author.companyId) {
      return { ok: false, error: "소속 회사가 없어 내 회사 범위를 쓸 수 없습니다." };
    }
    return { ok: true };
  }

  const target = String(audience.companyIds?.[0] || "").trim();
  if (!target) return { ok: false, error: "회사를 선택하세요." };

  if (audience.companyMode === "one_gc") {
    const node = companies.find((c) => c.id === target);
    if (!node || !isGcType(node.type)) {
      return { ok: false, error: "시공사를 선택하세요." };
    }
  }

  const allowed = authorAllowedCompanyIds(author, companies);
  if (allowed !== "all") {
    const graph = companies.map((c) => ({ id: c.id, parent_id: c.parent_company_id || null }));
    const targetTree =
      audience.includeDescendants || audience.companyMode === "one_gc"
        ? collectDescendants(graph, target)
        : [target];
    const extra = targetTree.filter((id) => !allowed.includes(id));
    if (extra.length > 0 && !isGcType(author.companyType)) {
      return { ok: false, error: "다른 회사 범위는 권한이 없습니다." };
    }
    if (isContractorType(author.companyType) && (target !== author.companyId || extra.length > 0)) {
      return { ok: false, error: "협력사는 자사 공지만 보낼 수 있습니다." };
    }
    if (isGcType(author.companyType) && audience.companyMode !== "project_all") {
      if (!allowed.includes(target)) {
        return { ok: false, error: "다른 시공사에는 공지할 수 없습니다. 현장 전체를 선택하세요." };
      }
    }
  }
  return { ok: true };
}

export function summarizeAudience(audience: AnnouncementAudience): string {
  const people =
    audience.people === "managers" ? "관리자" : audience.people === "workers" ? "근로자" : "전원";
  const company =
    audience.companyMode === "project_all"
      ? "현장 전체"
      : audience.companyMode === "own_tree"
        ? "내 회사(하위 포함)"
        : audience.companyMode === "one_gc"
          ? "특정 시공사(하위 포함)"
          : "특정 회사";
  return `${company} · ${people}`;
}

export function isPendingAnnouncementActive(opts: {
  is_withdrawn?: boolean | null;
  expires_at?: string | null;
  acked?: boolean;
  now?: Date;
}): boolean {
  if (opts.acked) return false;
  if (opts.is_withdrawn) return false;
  if (opts.expires_at) {
    const exp = new Date(opts.expires_at).getTime();
    if (Number.isFinite(exp) && exp <= (opts.now || new Date()).getTime()) return false;
  }
  return true;
}

export const ANNOUNCEMENT_ADMIN_ROLES = [...ADMIN_PROJECT_ROLES];
