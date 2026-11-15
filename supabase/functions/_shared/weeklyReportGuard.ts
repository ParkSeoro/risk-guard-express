export type WeeklySourceGroup = {
  heading?: string;
  items?: string[];
};

export type WeeklySourceCompany = {
  name?: string;
  groups?: WeeklySourceGroup[];
};

export type WeeklySource = {
  project_name?: string;
  companies?: WeeklySourceCompany[];
};

export function companyNames(source: unknown): string[] {
  const companies = (source as WeeklySource | null)?.companies;
  if (!Array.isArray(companies)) return [];
  return companies
    .map((company) => String(company?.name || "").trim())
    .filter((name) => name.length > 0);
}

/** Company headings the saved narrative dropped. */
export function omittedCompanies(source: unknown, body: string): string[] {
  const text = body || "";
  return companyNames(source).filter((name) => !text.includes(`(${name})`));
}

/** The permit list, without model text, so a short answer cannot hide a company. */
export function digestFromSource(source: unknown): string {
  const src = (source || {}) as WeeklySource;
  const project = String(src.project_name || "").trim() || "현장";
  const blocks = (src.companies || []).map((company) => {
    const name = String(company?.name || "").trim() || "업체 미지정";
    const lines = (company.groups || []).map((group) => {
      const heading = String(group?.heading || "").trim() || "작업";
      const items = (group.items || []).map((item) => String(item || "").trim()).filter(Boolean);
      const bullets = items.length ? `\n* ${items.join("\n* ")}` : "";
      return `■ ${heading}${bullets}`;
    });
    return `(${name})\n${lines.join("\n")}`;
  });
  return [`[${project} 현장 주간 안전보고]`, ...blocks].join("\n\n").trim();
}
