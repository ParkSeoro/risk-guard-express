/** Seoul calendar half that contains the given YYYY-MM-DD. Matches education_hour_window in SQL. */
export function halfYearBounds(isoDate: string): { start: string; end: string } {
  const [yearText, monthText] = isoDate.slice(0, 10).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (month <= 6) return { start: `${year}-01-01`, end: `${year}-06-30` };
  return { start: `${year}-07-01`, end: `${year}-12-31` };
}

export function daysUntilHalfEnd(isoDate: string): number {
  const end = halfYearBounds(isoDate).end;
  const a = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}
