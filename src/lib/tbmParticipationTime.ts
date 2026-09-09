import { isRenderableSignature } from "@/lib/permitCrewSignatures";

/** Roster-sync rows have participated_at = insert time, not a real TBM sign. */
export function tbmParticipationTimeLabel(
  p: { signature_data?: string | null; participated_at?: string | null },
  locale = "ko-KR",
): string {
  if (!isRenderableSignature(p.signature_data)) return "미서명";
  const at = p.participated_at ? new Date(p.participated_at) : null;
  if (!at || Number.isNaN(at.getTime())) return "서명됨";
  return at.toLocaleString(locale);
}
