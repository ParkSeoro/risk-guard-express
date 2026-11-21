/** Splits an array into fixed-size chunks to keep PostgREST `.in(...)` queries well under URL and row limits. */
export function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
