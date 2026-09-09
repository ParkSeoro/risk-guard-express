import { isRenderableSignature } from "@/lib/permitCrewSignatures";

/** Unsigned roster rows keep participated_at = insert time — never show that as attendance. */
export function formatTbmParticipationTime(p: {
  participated_at?: string | null;
  signature_data?: string | null;
}, locale = "ko-KR"): string {
  if (!isRenderableSignature(p.signature_data)) return "미서명";
  if (!p.participated_at) return "미서명";
  const d = new Date(p.participated_at);
  if (Number.isNaN(d.getTime())) return "미서명";
  return d.toLocaleString(locale, { timeZone: "Asia/Seoul" });
}
