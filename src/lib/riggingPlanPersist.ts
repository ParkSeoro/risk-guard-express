/**
 * Persist helpers for work_plans.rigging_plans (1:1 with work plan).
 */
export type RiggingPlanRow = Record<string, unknown> & {
  id?: string;
  work_plan_id?: string;
};

/** Minimum fields required before 결재 상신 for crane/steel plans. */
export function isRiggingPlanReady(rigging: RiggingPlanRow | null | undefined): boolean {
  if (!rigging) return false;
  const load = Number(rigging.load_weight) || 0;
  const radius = Number(rigging.working_radius) || 0;
  const crane = String(rigging.crane_model || rigging.equipment_name || "").trim();
  return load > 0 && radius > 0 && crane.length > 0;
}

export function buildRiggingPlanPayload(
  planId: string,
  rigging: RiggingPlanRow,
): Record<string, unknown> {
  const n = (v: unknown, fallback = 0) => Number(v) || fallback;
  const s = (v: unknown, fallback = "") => (v == null || v === "" ? fallback : String(v));

  return {
    work_plan_id: planId,
    load_weight: n(rigging.load_weight),
    load_description: s(rigging.load_description),
    crane_model: s(rigging.crane_model),
    crane_capacity: n(rigging.crane_capacity),
    working_radius: n(rigging.working_radius),
    boom_length: n(rigging.boom_length),
    lifting_method: s(rigging.lifting_method),
    sling_type: s(rigging.sling_type),
    sling_capacity: n(rigging.sling_capacity),
    ground_bearing_capacity: n(rigging.ground_bearing_capacity),
    outrigger_setup: s(rigging.outrigger_setup),
    safety_factor: n(rigging.safety_factor),
    calculated_utilization: n(rigging.calculated_utilization),
    notes: s(rigging.notes),
    equipment_name: s(rigging.equipment_name),
    rated_capacity: n(rigging.rated_capacity),
    outrigger_distance: n(rigging.outrigger_distance),
    wire_diameter_mm: n(rigging.wire_diameter_mm),
    sling_count: n(rigging.sling_count, 2),
    sling_method: s(rigging.sling_method),
    sling_strand_count: n(rigging.sling_strand_count, 1),
    sling_angle_deg: n(rigging.sling_angle_deg, 60),
    wire_terminal_method: s(rigging.wire_terminal_method, "탐블(24mm 이하)"),
    wire_safety_coefficient: n(rigging.wire_safety_coefficient, 5),
    wire_lift_count: n(rigging.wire_lift_count, 5),
    wire_breaking_load: n(rigging.wire_breaking_load),
    wire_diameter_inch: n(rigging.wire_diameter_inch),
    wire_safe_load: n(rigging.wire_safe_load),
    shackle_diameter_mm: n(rigging.shackle_diameter_mm),
    shackle_safe_load: n(rigging.shackle_safe_load),
    shackle_angle_deg: n(rigging.shackle_angle_deg, 45),
    shackle_count: n(rigging.shackle_count, 0.7),
    shackle_qty: n(rigging.shackle_qty, 2),
    load_name_max: s(rigging.load_name_max),
    hook_weight: n(rigging.hook_weight),
    shackle_weight_val: n(rigging.shackle_weight_val),
    sling_rigging_weight: n(rigging.sling_rigging_weight),
    total_weight_max: n(rigging.total_weight_max),
    load_name_min: s(rigging.load_name_min),
    load_weight_min: n(rigging.load_weight_min),
    hook_weight_min: n(rigging.hook_weight_min),
    shackle_weight_min: n(rigging.shackle_weight_min),
    sling_rigging_weight_min: n(rigging.sling_rigging_weight_min),
    total_weight_min: n(rigging.total_weight_min),
    wind_speed_grade: s(rigging.wind_speed_grade, "0~5"),
    wind_speed_factor: n(rigging.wind_speed_factor, 1),
    boom_rotation_factor: n(rigging.boom_rotation_factor, 0.8),
    ground_inspection_factor: n(rigging.ground_inspection_factor, 0.8),
    load_protrusion_factor: n(rigging.load_protrusion_factor, 0.8),
    travel_load_factor: n(rigging.travel_load_factor, 1),
    equipment_working_load: n(rigging.equipment_working_load),
    equipment_ok: s(rigging.equipment_ok),
    sling_working_load: n(rigging.sling_working_load),
    sling_ok: s(rigging.sling_ok),
    shackle_working_load: n(rigging.shackle_working_load),
    shackle_ok: s(rigging.shackle_ok),
    safety_factor_passenger: n(rigging.safety_factor_passenger, 10),
    safety_factor_cargo: n(rigging.safety_factor_cargo, 5),
    input_method: s(rigging.input_method, "자동계산"),
    sling_material_type: s(rigging.sling_material_type, "wire_rope"),
    sling_belt_color: s(rigging.sling_belt_color),
    sling_belt_width_mm: n(rigging.sling_belt_width_mm),
    sling_belt_rated_load: n(rigging.sling_belt_rated_load),
    round_sling_rated_load: n(rigging.round_sling_rated_load),
    chain_diameter_mm: n(rigging.chain_diameter_mm),
    chain_rated_load: n(rigging.chain_rated_load),
    chain_leg_count: n(rigging.chain_leg_count, 4),
    shackle_inch: s(rigging.shackle_inch),
    sling_safe_load: n(rigging.sling_safe_load),
    tension_per_leg: n(rigging.tension_per_leg),
  };
}

/** Short preview lines for work plan preview tab / tests. */
export function summarizeRiggingPlan(rigging: RiggingPlanRow | null | undefined): string[] {
  if (!rigging || !isRiggingPlanReady(rigging)) return [];
  const lines: string[] = [];
  lines.push(
    `인양물 ${Number(rigging.load_weight) || 0}t` +
      (rigging.load_description ? ` (${rigging.load_description})` : ""),
  );
  const crane = String(rigging.crane_model || rigging.equipment_name || "").trim();
  lines.push(
    `장비 ${crane}` +
      (rigging.crane_capacity || rigging.rated_capacity
        ? ` / 정격 ${Number(rigging.crane_capacity || rigging.rated_capacity)}t`
        : ""),
  );
  lines.push(
    `반경 ${Number(rigging.working_radius) || 0}m` +
      (rigging.boom_length ? ` · 붐 ${Number(rigging.boom_length)}m` : ""),
  );
  if (rigging.safety_factor != null && Number(rigging.safety_factor) > 0) {
    lines.push(
      `안전율 ${Number(rigging.safety_factor).toFixed(2)}` +
        (rigging.calculated_utilization != null
          ? ` · 가동률 ${Number(rigging.calculated_utilization).toFixed(1)}%`
          : ""),
    );
  }
  if (rigging.sling_type || rigging.sling_material_type) {
    lines.push(`슬링 ${String(rigging.sling_type || rigging.sling_material_type)}`);
  }
  if (rigging.wind_speed_grade) {
    lines.push(`풍속등급 ${String(rigging.wind_speed_grade)}`);
  }
  return lines;
}
