/**
 * Apply calculateFullRigging results onto a rigging_plans row (single patch).
 * Used by the form AND by save/submit so safety_factor is never stale/0.
 */
import {
  calculateFullRigging,
  type RiggingInput,
  type RiggingResult,
  type SlingMaterialType,
} from "@/lib/riggingCalculator";
import type { RiggingPlanRow } from "@/lib/riggingPlanPersist";

const n = (v: unknown, fallback = 0) => Number(v) || fallback;

export function buildRiggingInputFromRow(rigging: RiggingPlanRow): RiggingInput {
  const materialType = (rigging.sling_material_type || "wire_rope") as SlingMaterialType;
  return {
    equipmentName: String(rigging.equipment_name || rigging.crane_model || ""),
    ratedCapacity: n(rigging.rated_capacity) || n(rigging.crane_capacity),
    boomLength: n(rigging.boom_length),
    workingRadius: n(rigging.working_radius),
    liftingCapacity: n(rigging.crane_capacity) || n(rigging.rated_capacity),
    outriggerDistance: n(rigging.outrigger_distance),
    slingMaterialType: materialType,
    wireDiameterMm: n(rigging.wire_diameter_mm),
    slingCount: n(rigging.sling_count) || 2,
    slingAngleDeg: n(rigging.sling_angle_deg) || 60,
    wireTerminalMethod: String(rigging.wire_terminal_method || "탐블(24mm 이하)"),
    wireSafetyCoefficient: n(rigging.wire_safety_coefficient) || 5,
    slingBeltWidthMm: n(rigging.sling_belt_width_mm),
    slingBeltRatedLoad: n(rigging.sling_belt_rated_load),
    roundSlingColor: String(rigging.sling_belt_color || ""),
    roundSlingRatedLoad: n(rigging.round_sling_rated_load),
    chainDiameterMm: n(rigging.chain_diameter_mm),
    chainLegCount: n(rigging.chain_leg_count) || 4,
    shackleInch: String(rigging.shackle_inch || ""),
    shackleQty: n(rigging.shackle_qty) || 2,
    loadWeight: n(rigging.load_weight),
    hookWeight: n(rigging.hook_weight),
    shackleWeightVal: n(rigging.shackle_weight_val),
    slingRiggingWeight: n(rigging.sling_rigging_weight),
    loadWeightMin: n(rigging.load_weight_min),
    hookWeightMin: n(rigging.hook_weight_min),
    shackleWeightMin: n(rigging.shackle_weight_min),
    slingRiggingWeightMin: n(rigging.sling_rigging_weight_min),
    windSpeedFactor: n(rigging.wind_speed_factor) || 1,
    windSpeedGrade: rigging.wind_speed_grade == null ? "0~5" : String(rigging.wind_speed_grade),
    windSpeedMs: (() => {
      const g = String(rigging.wind_speed_grade || "");
      const m = g.match(/^(\d+(?:\.\d+)?)\s*m\/s/i);
      return m ? Number(m[1]) : null;
    })(),
    boomRotationFactor: n(rigging.boom_rotation_factor, 1) || 1,
    groundInspectionFactor: n(rigging.ground_inspection_factor, 1) || 1,
    loadProtrusionFactor: n(rigging.load_protrusion_factor, 1) || 1,
  };
}

export function riggingResultToPatch(r: RiggingResult): Record<string, unknown> {
  return {
    total_weight_max: r.totalWeightMax,
    total_weight_min: r.totalWeightMin,
    equipment_working_load: r.equipmentWorkingLoad,
    equipment_ok: r.equipmentOk ? "O.K" : "N.G",
    sling_working_load: r.slingSafeLoad,
    sling_ok: r.slingOk ? "O.K" : "N.G",
    shackle_working_load: r.shackleSafeLoad,
    shackle_ok: r.shackleOk ? "O.K" : "N.G",
    wire_breaking_load: r.wireBreakingLoad,
    wire_safe_load: r.wireSafeLoad,
    safety_factor: r.equipmentSafetyFactor,
    sling_safe_load: r.slingSafeLoad,
    tension_per_leg: r.tensionPerLeg,
    calculated_utilization:
      r.totalWeightMax > 0 && r.equipmentWorkingLoad > 0
        ? (r.totalWeightMax / r.equipmentWorkingLoad) * 100
        : 0,
  };
}

/** Fresh calc merged into row — call before persist / approval gate. */
export function refreshRiggingDerivedFields(rigging: RiggingPlanRow): RiggingPlanRow {
  const r = calculateFullRigging(buildRiggingInputFromRow(rigging));
  return { ...rigging, ...riggingResultToPatch(r) };
}
