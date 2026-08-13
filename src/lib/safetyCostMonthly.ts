/** YYYY-MM or YYYY-MM-DD → first-of-month date string used by safety_cost_monthly_reports.report_month */
export function toSafetyCostMonthStart(value: string): string {
  const raw = String(value || '').trim();
  const ym = raw.match(/^(\d{4}-\d{2})/);
  if (!ym) return raw;
  return `${ym[1]}-01`;
}

export function isPostgresUniqueViolation(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  return error.code === '23505' || /duplicate key value violates unique constraint/i.test(error.message || '');
}

export type MonthlyReportRow = {
  id: string;
  is_deleted?: boolean | null;
  created_at?: string | null;
  approval_version?: number | null;
  status?: string | null;
};

export type CreateMonthlyPlan =
  | { action: 'open'; row: MonthlyReportRow }
  | { action: 'restore'; row: MonthlyReportRow }
  | { action: 'insert' };

function sortNewest(a: MonthlyReportRow, b: MonthlyReportRow) {
  const version = (b.approval_version ?? 1) - (a.approval_version ?? 1);
  if (version !== 0) return version;
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

/** Decide whether to open, restore, or insert a monthly usage statement. */
export function planCreateMonthlyReport(rows: MonthlyReportRow[]): CreateMonthlyPlan {
  const live = rows.filter((row) => !row.is_deleted);
  if (live.length > 0) {
    return { action: 'open', row: [...live].sort(sortNewest)[0] };
  }
  const deleted = rows.filter((row) => row.is_deleted);
  if (deleted.length > 0) {
    return { action: 'restore', row: [...deleted].sort(sortNewest)[0] };
  }
  return { action: 'insert' };
}

export function monthlyReportExistsCopy(kind: 'create' | 'update' = 'create') {
  if (kind === 'update') {
    return {
      title: '해당 월 내역서가 이미 있습니다',
      description: '같은 공사의 같은 월로 수정할 수 없습니다. 기존 내역서를 선택하세요.',
    };
  }
  return {
    title: '해당 월 내역서가 이미 있습니다',
    description: '기존 내역서를 열었습니다. 항목을 이어서 입력하세요.',
  };
}
