/**
 * Work-plan 법정계산 스냅샷 → 미리보기/인쇄용 HTML.
 * JSON 원문을 그대로 찍지 않는다.
 */

export type LegalCalcPrintEntry = {
  id?: string;
  label?: string;
  verdict?: string;
  conclusion?: string;
  legalBasis?: string;
};

function parseEntries(content: unknown): LegalCalcPrintEntry[] {
  let obj = content;
  if (typeof content === "string") {
    try {
      obj = JSON.parse(content);
    } catch {
      return [];
    }
  }
  const entries = (obj as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter((e) => e && typeof e === "object") as LegalCalcPrintEntry[];
}

export function legalCalcVerdictKo(verdict?: string): string {
  if (verdict === "pass") return "적합";
  if (verdict === "fail") return "부적합";
  if (verdict === "warn") return "주의";
  return verdict || "";
}

export function formatLegalCalcPrintHtml(
  content: unknown,
  escapeHtml: (s: string) => string,
): string {
  const entries = parseEntries(content);
  if (entries.length === 0) return "";
  const rows = entries.map((e) => {
    const verdict = legalCalcVerdictKo(e.verdict);
    const basis = e.legalBasis
      ? `<div style="font-size:7.5pt;color:#64748b;margin-top:2pt;">${escapeHtml(e.legalBasis)}</div>`
      : "";
    return `<tr>
      <td>${escapeHtml(e.label || "")}</td>
      <td class="center">${escapeHtml(verdict)}</td>
      <td>${escapeHtml(e.conclusion || "")}${basis}</td>
    </tr>`;
  }).join("");
  return `<table><thead><tr><th>항목</th><th>판정</th><th>결론</th></tr></thead><tbody>${rows}</tbody></table>`;
}
