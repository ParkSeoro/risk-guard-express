import { isClientType, normalizeCompanyType } from '@/lib/companyTypes';

export type SafetyCostCompanyLike = {
  id: string;
  name?: string | null;
  type?: string | null;
};

export type SafetyCostConstructionLike = {
  id: string;
  company_id?: string | null;
  construction_name?: string | null;
};

export type SafetyCostCompanyGroup<T extends SafetyCostConstructionLike = SafetyCostConstructionLike> = {
  companyId: string;
  companyName: string;
  companyType: string | null;
  constructions: T[];
};

/** 시공사·협력사·공급사 — 안관비 집행 주체. 발주처는 목록에서 제외(공사 있는 경우만 포함). */
export function isSafetyCostExecCompany(type?: string | null): boolean {
  const t = normalizeCompanyType(type);
  return t === 'gc' || t === 'contractor' || t === 'vendor';
}

/**
 * 마스터 / 발주처 프로젝트 관리자·안전관리자: 공사 미등록 시공사도 보여 준다.
 * 시공사 SM은 tree, 협력사는 own — 빈 타사는 넣지 않는다.
 */
export function groupSafetyCostByCompany<T extends SafetyCostConstructionLike>(
  companies: SafetyCostCompanyLike[],
  constructions: T[],
  opts: { includeEmptyExecCompanies: boolean },
): SafetyCostCompanyGroup<T>[] {
  const byCompany = new Map<string, T[]>();
  for (const row of constructions) {
    const id = row.company_id;
    if (!id) continue;
    const list = byCompany.get(id) || [];
    list.push(row);
    byCompany.set(id, list);
  }

  const companiesById = new Map(companies.map((c) => [c.id, c]));
  const ids: string[] = [];
  const pushId = (id: string) => {
    if (id && !ids.includes(id)) ids.push(id);
  };

  if (opts.includeEmptyExecCompanies) {
    for (const company of companies) {
      const hasRows = byCompany.has(company.id);
      if (hasRows) {
        pushId(company.id);
        continue;
      }
      if (isClientType(company.type)) continue;
      if (isSafetyCostExecCompany(company.type) || !normalizeCompanyType(company.type)) {
        pushId(company.id);
      }
    }
    for (const id of byCompany.keys()) pushId(id);
  } else {
    for (const row of constructions) {
      if (row.company_id) pushId(row.company_id);
    }
  }

  return ids
    .map((id) => {
      const company = companiesById.get(id);
      return {
        companyId: id,
        companyName: company?.name || '회사 미지정',
        companyType: company?.type ?? null,
        constructions: byCompany.get(id) || [],
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}
