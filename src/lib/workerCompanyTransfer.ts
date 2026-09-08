export type ForeignRosterWorker = {
  worker_id: string;
  name: string;
  phone: string;
  job_type: string | null;
  is_active: boolean | null;
  source_company_id: string | null;
  source_company_name: string | null;
  login_company_id: string | null;
  login_company_name: string | null;
};

export function foreignRosterBadgeLabel(sourceCompanyName?: string | null): string {
  const name = String(sourceCompanyName || "").trim();
  return name ? `타사 소속 · ${name}` : "타사 소속";
}

export function foreignRosterTransferPrompt(row: {
  name: string;
  source_company_name?: string | null;
  dest_company_name?: string | null;
  is_active?: boolean | null;
}): string {
  const who = String(row.name || "이 근로자").trim() || "이 근로자";
  const from = String(row.source_company_name || "다른 회사").trim() || "다른 회사";
  const to = String(row.dest_company_name || "우리 회사").trim() || "우리 회사";
  const sourceLine =
    row.is_active === false
      ? `${who}님은 현재 「${from}」 명단(비활성)입니다.`
      : `${who}님은 현재 「${from}」 명단입니다.`;
  const aftermath =
    row.is_active === false
      ? "이관하면 원래 회사 명단에서는 빠지고, 우리 명단에 활성으로 올라갑니다."
      : "이관하면 원래 회사 명단에서는 빠집니다.";
  return [sourceLine, `「${to}」으로 이관할까요?`, aftermath].join("\n");
}
