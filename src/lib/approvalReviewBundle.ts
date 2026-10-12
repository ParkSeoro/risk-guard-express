/** Body frozen at 상신. Drafts and returns keep reading live rows. */
const LIVE_BODY_STATUSES = new Set([
  "",
  "작성중",
  "제출됨",
  "검증중",
  "검증대기",
  "검토대기",
  "보완요청",
  "보완중",
  "반려",
  "검증완료",
  "임시저장",
]);

export type ReviewBundle = Record<string, unknown> & {
  bundle_version: number;
  risk_items?: unknown[];
  participants?: unknown[];
};

export function readReviewBundle(payload: unknown): ReviewBundle | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as ReviewBundle;
  if (Number(row.bundle_version) !== 2) return null;
  if (!Array.isArray(row.risk_items)) return null;
  return row;
}

/** Approvers read the submit bundle. Authors editing a draft still use live tables. */
export function reviewBundleForStatus(
  status: string | null | undefined,
  payload: unknown,
): ReviewBundle | null {
  const statusText = String(status ?? "").trim();
  if (LIVE_BODY_STATUSES.has(statusText)) return null;
  return readReviewBundle(payload);
}

export function bundleRiskItems(bundle: ReviewBundle | null): unknown[] | null {
  if (!bundle) return null;
  return (bundle.risk_items || []).filter((item) => {
    if (!item || typeof item !== "object") return false;
    return (item as { is_deleted?: boolean }).is_deleted !== true;
  });
}
