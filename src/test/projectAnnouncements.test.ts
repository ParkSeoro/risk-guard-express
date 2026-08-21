import { describe, expect, it } from "vitest";
import {
  allowedCompanyModes,
  authorAllowedCompanyIds,
  canComposeAnnouncement,
  filterAnnouncementRecipients,
  isPendingAnnouncementActive,
  resolveAudienceCompanyIds,
  summarizeAudience,
  validateAnnouncementAudience,
  type AnnouncementAuthor,
  type AnnouncementCompanyNode,
  type AnnouncementMember,
} from "@/lib/projectAnnouncements";

const gc: AnnouncementAuthor = {
  isMaster: false,
  role: "site_manager",
  companyId: "gc-a",
  companyType: "gc",
};
const gcPeer: AnnouncementAuthor = {
  isMaster: false,
  role: "safety_manager",
  companyId: "gc-b",
  companyType: "시공사",
};
const contractor: AnnouncementAuthor = {
  isMaster: false,
  role: "safety_manager",
  companyId: "co-1",
  companyType: "contractor",
};
const client: AnnouncementAuthor = {
  isMaster: false,
  role: "project_admin",
  companyId: "client-1",
  companyType: "client",
};
const worker: AnnouncementAuthor = {
  isMaster: false,
  role: "worker",
  companyId: "co-1",
  companyType: "contractor",
};

const companies: AnnouncementCompanyNode[] = [
  { id: "client-1", type: "client", parent_company_id: null },
  { id: "gc-a", type: "gc", parent_company_id: "client-1" },
  { id: "gc-b", type: "gc", parent_company_id: "client-1" },
  { id: "co-1", type: "contractor", parent_company_id: "gc-a" },
  { id: "co-2", type: "contractor", parent_company_id: "gc-b" },
];

const members: AnnouncementMember[] = [
  { user_id: "u-gc-a", role_new: "site_manager", company_id: "gc-a" },
  { user_id: "u-gc-b", role_new: "site_manager", company_id: "gc-b" },
  { user_id: "u-co-sm", role_new: "safety_manager", company_id: "co-1" },
  { user_id: "u-co-w", role_new: "worker", company_id: "co-1" },
  { user_id: "u-co2-w", role_new: "worker", company_id: "co-2" },
  { user_id: "u-no-account", role_new: "worker", company_id: "co-1" },
];

describe("canComposeAnnouncement", () => {
  it("allows all manager roles and master, not workers", () => {
    expect(canComposeAnnouncement(gc)).toBe(true);
    expect(canComposeAnnouncement({ ...gc, role: "site_supervisor" })).toBe(true);
    expect(canComposeAnnouncement({ isMaster: true, role: null, companyId: null, companyType: null })).toBe(true);
    expect(canComposeAnnouncement(worker)).toBe(false);
    expect(canComposeAnnouncement({ ...worker, role: "viewer" })).toBe(false);
  });
});

describe("allowedCompanyModes", () => {
  it("lets GC managers use 현장 전체", () => {
    expect(allowedCompanyModes(gc)).toContain("project_all");
    expect(allowedCompanyModes(client)).toContain("project_all");
  });
  it("keeps contractors on own company", () => {
    expect(allowedCompanyModes(contractor)).toEqual(["own_tree", "one_company"]);
  });
});

describe("authorAllowedCompanyIds", () => {
  it("blocks peer GC trees for a GC author", () => {
    const ids = authorAllowedCompanyIds(gc, companies);
    expect(ids).toEqual(expect.arrayContaining(["gc-a", "co-1"]));
    expect(ids).not.toEqual(expect.arrayContaining(["gc-b", "co-2"]));
  });
});

describe("validateAnnouncementAudience", () => {
  it("rejects contractor blasting another company", () => {
    const r = validateAnnouncementAudience(
      contractor,
      { companyMode: "one_company", companyIds: ["gc-a"], includeDescendants: false, people: "all" },
      companies,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects GC targeting a peer GC unless 현장 전체", () => {
    const peer = validateAnnouncementAudience(
      gc,
      { companyMode: "one_gc", companyIds: ["gc-b"], includeDescendants: true, people: "all" },
      companies,
    );
    expect(peer.ok).toBe(false);

    const whole = validateAnnouncementAudience(
      gc,
      { companyMode: "project_all", companyIds: [], includeDescendants: true, people: "all" },
      companies,
    );
    expect(whole.ok).toBe(true);
  });

  it("allows GC own tree", () => {
    const r = validateAnnouncementAudience(
      gc,
      { companyMode: "own_tree", companyIds: [], includeDescendants: true, people: "workers" },
      companies,
    );
    expect(r.ok).toBe(true);
  });
});

describe("filterAnnouncementRecipients", () => {
  it("only includes members with user accounts in the company set", () => {
    const ids = filterAnnouncementRecipients(
      members.filter((m) => m.user_id !== "u-no-account").concat([{ user_id: null, role_new: "worker", company_id: "co-1" }]),
      ["gc-a", "co-1"],
      "workers",
    );
    expect(ids.sort()).toEqual(["u-co-w"]);
  });

  it("현장 전체 + 전원 includes every account on the project", () => {
    const ids = filterAnnouncementRecipients(members, "all", "all");
    expect(ids).toContain("u-gc-b");
    expect(ids).toContain("u-co2-w");
  });

  it("managers excludes workers", () => {
    const ids = filterAnnouncementRecipients(members, "all", "managers");
    expect(ids).not.toContain("u-co-w");
    expect(ids).toContain("u-gc-a");
  });
});

describe("resolveAudienceCompanyIds", () => {
  it("expands one_gc to descendants", () => {
    const ids = resolveAudienceCompanyIds(
      { companyMode: "one_gc", companyIds: ["gc-a"], includeDescendants: true, people: "all" },
      gcPeer,
      companies,
    );
    expect(ids).toEqual(expect.arrayContaining(["gc-a", "co-1"]));
    expect(ids).not.toEqual(expect.arrayContaining(["gc-b"]));
  });
});

describe("isPendingAnnouncementActive", () => {
  it("hides after ack, withdraw, or expiry", () => {
    expect(isPendingAnnouncementActive({ acked: true })).toBe(false);
    expect(isPendingAnnouncementActive({ is_withdrawn: true })).toBe(false);
    expect(isPendingAnnouncementActive({ expires_at: "2000-01-01T00:00:00Z" })).toBe(false);
    expect(isPendingAnnouncementActive({ expires_at: "2099-01-01T00:00:00Z" })).toBe(true);
  });
});

describe("summarizeAudience", () => {
  it("labels company + people", () => {
    expect(summarizeAudience({ companyMode: "project_all", companyIds: [], includeDescendants: true, people: "workers" })).toBe(
      "현장 전체 · 근로자",
    );
  });
});
