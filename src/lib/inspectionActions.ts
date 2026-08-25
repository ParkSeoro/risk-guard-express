/**
 * Safety inspection corrective-action status helpers.
 * Mobile historically wrote `completed`; desktop used `done`.
 */

export const OPEN_INSPECTION_ACTION_STATUSES = new Set([
  'pending',
  'in_progress',
  '미완료',
]);

export const CLOSED_INSPECTION_ACTION_STATUSES = new Set([
  'done',
  'completed',
  '완료',
]);

export function isOpenInspectionAction(status?: string | null): boolean {
  const s = String(status || '').trim();
  if (!s) return true;
  if (CLOSED_INSPECTION_ACTION_STATUSES.has(s)) return false;
  if (OPEN_INSPECTION_ACTION_STATUSES.has(s)) return true;
  // Unknown legacy values: treat as open so they stay visible until closed.
  return true;
}

export function isClosedInspectionAction(status?: string | null): boolean {
  return !isOpenInspectionAction(status);
}

/** Canonical closed status written by both desktop and mobile. */
export const INSPECTION_ACTION_DONE_STATUS = 'done';

/**
 * Keep only actions whose parent inspection is visible and not soft-deleted.
 * Missing embed (RLS hid parent) is treated as orphan → drop.
 */
export function filterVisibleInspectionActions<
  T extends { inspection?: { id?: string; is_deleted?: boolean | null } | null },
>(rows: T[]): T[] {
  return rows.filter((a) => {
    const parent = a.inspection;
    if (!parent || !parent.id) return false;
    if (parent.is_deleted) return false;
    return true;
  });
}
