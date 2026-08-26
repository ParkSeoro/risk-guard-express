/** Rows that belong in RA counts / print — matches AssessmentRunDetail `activeItems`. */
export function isActiveRiskItem(item: {
  is_deleted?: boolean | null;
  is_excluded?: boolean | null;
}): boolean {
  return !item?.is_deleted && !item?.is_excluded;
}
