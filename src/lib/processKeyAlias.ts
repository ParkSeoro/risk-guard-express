/**
 * DB normalize_process_key 와 같은 별칭.
 * 화면은 이 함수만 쓴다. 철근공사는 다른 공종일 수 있어 합치지 않는다.
 */
const PROCESS_KEY_ALIASES: Record<string, string> = {
  철근배근: "철근 배근",
};

export function normalizeProcessKey(raw: string): string {
  const cleaned = (raw || "").trim().replace(/\s+/g, " ").toLowerCase();
  const compact = cleaned.replace(/ /g, "");
  return PROCESS_KEY_ALIASES[compact] || cleaned;
}
