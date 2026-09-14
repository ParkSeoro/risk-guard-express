/**
 * Work-plan 리깅플랜 인쇄 HTML.
 * DB 컬럼명(lifting_method, outrigger_setup, notes)은 유지하고
 * 화면(RiggingPlanForm)과 같은 한국어 제목만 쓴다.
 */

export const RIGGING_PRINT_LABELS = {
  lifting_method: "작업지휘자",
  outrigger_setup: "작업 장소",
  notes: "작업 기간",
} as const;

export function renderRiggingPrintHtml(
  rigging: Record<string, unknown> | null | undefined,
  escapeHtml: (s: string) => string,
): string {
  if (!rigging) return "";

  const sf = Number(rigging.safety_factor) || 0;
  const util = Number(rigging.calculated_utilization) || 0;
  const sfColor = sf < 1.0 ? "#dc2626" : sf < 1.25 ? "#d97706" : "#16a34a";
  const sfLabel = sf < 1.0 ? "🚫 작업금지" : sf < 1.25 ? "⚠️ 경고" : "✅ 안전";
  const text = (key: string) => escapeHtml(String(rigging[key] ?? ""));
  const raw = (key: string) => (rigging[key] == null ? "" : String(rigging[key]));

  return `
        <div class="section-header">리깅플랜 (양중계획)</div>
        <table class="info-table"><tbody>
          <tr><td class="label">인양물 중량</td><td>${raw("load_weight")}t</td><td class="label">인양물 설명</td><td>${text("load_description")}</td></tr>
          <tr><td class="label">크레인 기종</td><td>${escapeHtml(String(rigging.crane_model || rigging.equipment_name || ""))}</td><td class="label">정격하중</td><td>${raw("crane_capacity") || raw("rated_capacity")}t</td></tr>
          <tr><td class="label">작업 반경</td><td>${raw("working_radius")}m</td><td class="label">붐 길이</td><td>${raw("boom_length")}m</td></tr>
          <tr><td class="label">슬링 종류</td><td>${escapeHtml(String(rigging.sling_type || rigging.sling_material_type || ""))}</td><td class="label">${RIGGING_PRINT_LABELS.lifting_method}</td><td>${text("lifting_method")}</td></tr>
          <tr><td class="label">슬링 각도</td><td>${raw("sling_angle_deg")}°</td><td class="label">슬링 본수</td><td>${raw("sling_count")}</td></tr>
          <tr><td class="label">와이어 직경</td><td>${raw("wire_diameter_mm")}mm</td><td class="label">샤클</td><td>${escapeHtml(String(rigging.shackle_inch || rigging.shackle_diameter_mm || ""))}</td></tr>
          <tr><td class="label">지반 지지력</td><td>${raw("ground_bearing_capacity")} t/㎡</td><td class="label">${RIGGING_PRINT_LABELS.outrigger_setup}</td><td>${text("outrigger_setup")}</td></tr>
          <tr><td class="label">풍속 등급</td><td>${text("wind_speed_grade")}</td><td class="label">풍속 계수</td><td>${raw("wind_speed_factor")}</td></tr>
        </tbody></table>
        <div style="margin-top:8pt;padding:8pt;border:2pt solid ${sfColor};border-radius:4pt;text-align:center;">
          <span style="font-size:12pt;font-weight:700;color:${sfColor};">${sfLabel} — 안전율: ${sf.toFixed(2)} | 가동률: ${util.toFixed(1)}%</span>
        </div>
        ${rigging.equipment_ok || rigging.sling_ok || rigging.shackle_ok ? `
        <table class="info-table" style="margin-top:8pt;"><tbody>
          <tr><td class="label">장비 판정</td><td>${text("equipment_ok")}</td><td class="label">슬링 판정</td><td>${text("sling_ok")}</td></tr>
          <tr><td class="label">샤클 판정</td><td colspan="3">${text("shackle_ok")}</td></tr>
        </tbody></table>` : ""}
        ${rigging.notes ? `<p style="font-size:8pt;margin-top:6pt;color:#475569;">${RIGGING_PRINT_LABELS.notes}: ${text("notes")}</p>` : ""}`;
}
