export type WeeklySourceGroup = {
  heading?: string;
  items?: string[];
  hazards?: string[];
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

export function omittedCompanies(source: unknown, body: string): string[] {
  const text = body || "";
  return companyNames(source).filter((name) => !text.includes(`(${name})`));
}

/** Fill empty group items with the group heading so every section has at least one work bullet. */
export function normalizeCompanySource(company: WeeklySourceCompany): WeeklySourceCompany {
  const groups = (company.groups || []).map((group) => {
    const heading = String(group?.heading || "").trim() || "작업";
    const items = Array.isArray(group?.items)
      ? group.items.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    return {
      ...group,
      heading,
      items: items.length > 0 ? items : [heading],
    };
  });
  return { ...company, groups };
}

export function keepPairedWork(text: string): string {
  const lines = String(text || "").split("\n");
  const kept: string[] = [];
  let bucket: string[] = [];
  let sawBullet = false;
  let risk = false;
  let action = false;
  const flush = () => {
    if (bucket.length === 0) return;
    if (!sawBullet || (risk && action)) kept.push(...bucket);
    bucket = [];
    sawBullet = false;
    risk = false;
    action = false;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("*")) {
      flush();
      sawBullet = true;
      bucket = [line];
      continue;
    }
    if (sawBullet) {
      if (trimmed.startsWith("- 위험:")) risk = true;
      if (trimmed.startsWith("- 대책:")) action = true;
      bucket.push(line);
      continue;
    }
    flush();
    kept.push(line);
  }
  flush();
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function everyWorkPaired(text: string): boolean {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let bullet = false;
  let risk = false;
  let action = false;
  let count = 0;
  const close = () => !bullet || (risk && action);
  for (const line of lines) {
    if (line.startsWith("*")) {
      if (!close()) return false;
      bullet = true;
      risk = false;
      action = false;
      count += 1;
      continue;
    }
    if (line.startsWith("- 위험:")) risk = true;
    if (line.startsWith("- 대책:")) action = true;
  }
  return count > 0 && close();
}

export function companiesHavePairedWork(source: unknown, body: string): boolean {
  const text = body || "";
  const names = companyNames(source);
  if (names.length === 0) return false;
  for (const name of names) {
    const start = text.indexOf(`(${name})`);
    if (start < 0) return false;
    let end = text.length;
    for (const other of names) {
      if (other === name) continue;
      const at = text.indexOf(`(${other})`, start + name.length + 2);
      if (at > start && at < end) end = at;
    }
    if (!everyWorkPaired(text.slice(start, end))) return false;
  }
  return true;
}

export function digestFromSource(source: unknown): string {
  const src = (source || {}) as WeeklySource;
  const project = String(src.project_name || "").trim() || "현장";
  const blocks = (src.companies || []).map((company) => {
    const name = String(company?.name || "").trim() || "업체 미지정";
    const lines = (company.groups || []).map((group) => {
      const heading = String(group?.heading || "").trim() || "작업";
      const items = (group.items || []).map((item) => String(item || "").trim()).filter(Boolean);
      const bullets = items.length ? `\n* ${items.join("\n* ")}` : "";
      return `\u25a0 ${heading}${bullets}`;
    });
    return `(${name})\n${lines.join("\n")}`;
  });
  return [`[${project} 현장 주간 안전보고]`, ...blocks].join("\n\n").trim();
}
