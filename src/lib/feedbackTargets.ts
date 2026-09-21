/** Weekly 이행 확인 targets. Auto = 개선후 상. Exclude does not change the 위평 row. */

export const FEEDBACK_EXCLUDE_REASONS = ["해당없음", "작업 미실시", "공정 변경"] as const;

export type FeedbackExcludeReason = (typeof FEEDBACK_EXCLUDE_REASONS)[number];

export type FeedbackOverrideKind = "manual_include" | "exclude";

export type FeedbackOverrideRow = {
  risk_item_id: string;
  kind: FeedbackOverrideKind;
  reason: string | null;
};

export function isAutoManagedTarget(item: { improved_risk_grade?: string | null }): boolean {
  return item.improved_risk_grade === "상";
}

export function isFeedbackExcludeReason(value: string): value is FeedbackExcludeReason {
  return (FEEDBACK_EXCLUDE_REASONS as readonly string[]).includes(value);
}

export function splitFeedbackOverrides(rows: FeedbackOverrideRow[]): {
  manualIds: Set<string>;
  excludedIds: Set<string>;
  excludeReasons: Record<string, string>;
} {
  const manualIds = new Set<string>();
  const excludedIds = new Set<string>();
  const excludeReasons: Record<string, string> = {};
  for (const row of rows) {
    if (row.kind === "exclude") {
      excludedIds.add(row.risk_item_id);
      if (row.reason) excludeReasons[row.risk_item_id] = row.reason;
    } else if (row.kind === "manual_include") {
      manualIds.add(row.risk_item_id);
    }
  }
  return { manualIds, excludedIds, excludeReasons };
}

export function isCheckedFeedbackTarget(
  item: { id: string; improved_risk_grade?: string | null },
  overrides: { manualIds: Set<string>; excludedIds: Set<string> },
): boolean {
  if (overrides.excludedIds.has(item.id)) return false;
  return isAutoManagedTarget(item) || overrides.manualIds.has(item.id);
}

export function getFeedbackTargetItems<T extends { id: string; improved_risk_grade?: string | null }>(
  riskItems: T[],
  overrides: { manualIds: Set<string>; excludedIds: Set<string> },
): T[] {
  return riskItems.filter((item) => isCheckedFeedbackTarget(item, overrides));
}

export function missingHighFeedbackCount(
  highItems: Array<{ id: string }>,
  coveredIds: Set<string>,
  excludedIds: Set<string>,
): number {
  return highItems.filter((item) => !excludedIds.has(item.id) && !coveredIds.has(item.id)).length;
}

export function canAssignFeedbackToItem(
  item: { id: string; improved_risk_grade?: string | null } | undefined,
  overrides: { manualIds: Set<string>; excludedIds: Set<string> },
): boolean {
  if (!item) return true;
  return isCheckedFeedbackTarget(item, overrides);
}
