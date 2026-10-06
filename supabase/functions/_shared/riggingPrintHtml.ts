/**
 * Work-plan 리깅플랜 인쇄 HTML.
 * 작업지휘자(lifting_method)와 인양 방식(sling_method)은 다른 칸.
 * 검토 시트: 저장된 값만 보여 주고, 재료에 안 맞는 칸과 0은 숨긴다.
 */

import {
  classifyRiggingLoad,
  riggingLoadBanner,
  riggingLoadHint,
} from "./riggingLoadBand.ts";

export const RIGGING_PRINT_LABELS = {
  lifting_method: "작업지휘자",
  sling_method: "인양 방식",
  outrigger_setup: "작업 장소",
  notes: "작업 기간",
} as const;

const MATERIAL_LABELS: Record<string, string> = {
  wire_rope: "와이어로프",
  sling_belt: "슬링벨트 (웹슬링)",
  round_sling: "라운드슬링",
  chain_sling: "체인슬링",
};

const SLING_HITCH_PRINT_LABELS: Record<string, string> = {
  straight: "straight (수직 1줄)",
  choke: "choke (올가미)",
  basket: "basket (바구니)",
  "2-leg": "2-leg (2줄)",
  "3-leg": "3-leg (3줄)",
  "4-leg": "4-leg (4줄)",
};

const ROUND_SLING_PRINT_LABELS: Record<string, string> = {
  purple: "보라 1t",
  green: "녹색 2t",
  yellow: "노랑 3t",
  gray: "회색 4t",
  red: "빨강 5t",
  brown: "갈색 6t",
  blue: "파랑 8t",
  orange: "주황 10t",
  "orange-12": "주황 12t",
  "orange-15": "주황 15t",
  "orange-20": "주황 20t",
  "orange-25": "주황 25t",
  "orange-30": "주황 30t",
  "orange-40": "주황 40t",
  "orange-50": "주황 50t",
  "orange-60": "주황 60t",
  "orange-80": "주황 80t",
  "orange-100": "주황 100t",
};

function formatTon(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pos(v: unknown): number | null {
  const n = num(v);
  return n > 0 ? n : null;
}

function txt(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function withUnit(value: number | null, unit: string): string {
  if (value == null) return "";
  return `${formatTon(value)}${unit}`;
}

function judgmentText(raw: unknown): string {
  const s = txt(raw);
  if (!s) return "";
  if (/^(o\.?k|ok|적합)$/i.test(s)) return "O.K";
  if (/^(n\.?g|부적합)$/i.test(s)) return "N.G";
  return s;
}

function slingMaterialKey(rigging: Record<string, unknown>): string {
  return txt(rigging.sling_material_type) || txt(rigging.sling_type);
}

function slingMaterialLabel(rigging: Record<string, unknown>): string {
  const material = txt(rigging.sling_material_type);
  const type = txt(rigging.sling_type);
  if (MATERIAL_LABELS[material]) return MATERIAL_LABELS[material];
  if (MATERIAL_LABELS[type]) return MATERIAL_LABELS[type];
  return type;
}

function roundSlingLabel(color: string): string {
  if (!color) return "";
  return ROUND_SLING_PRINT_LABELS[color] || color;
}

function isDerated(v: unknown): boolean {
  const n = num(v);
  return Number.isFinite(n) && n > 0 && n < 0.999;
}

type Pair = { label: string; value: string };

function pair(label: string, value: string): Pair | null {
  return value ? { label, value } : null;
}

function infoTable(pairs: Array<Pair | null>): string {
  const filled = pairs.filter((p): p is Pair => !!p && !!p.value);
  if (!filled.length) return "";
  const rows: string[] = [];
  for (let i = 0; i < filled.length; i += 2) {
    const a = filled[i];
    const b = filled[i + 1];
    if (b) {
      rows.push(
        `<tr><td class="label">${a.label}</td><td>${a.value}</td><td class="label">${b.label}</td><td>${b.value}</td></tr>`,
      );
    } else {
      rows.push(`<tr><td class="label">${a.label}</td><td colspan="3">${a.value}</td></tr>`);
    }
  }
  return `<table class="info-table"><tbody>${rows.join("")}</tbody></table>`;
}

function reviewBlock(title: string, body: string): string {
  if (!body) return "";
  return `<div class="section-header" style="font-size:10pt;margin:8pt 0 4pt;">${title}</div>${body}`;
}

function compareTable(headers: string[], cells: string[]): string {
  if (cells.every((c) => !c)) return "";
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = cells.map((c) => `<td class="center">${c || "-"}</td>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody><tr>${body}</tr></tbody></table>`;
}

/** 인쇄·검토에 적는 와이어 안전하중 출처. 와이어가 아니면 빈 문자열. */
export function wireSafeLoadPrintNote(rigging: Record<string, unknown> | null | undefined): string {
  if (!rigging) return "";
  const material = String(rigging.sling_material_type || "wire_rope");
  if (material !== "wire_rope") return "";
  const manufacturer = Number(rigging.wire_manufacturer_safe_load);
  if (Number.isFinite(manufacturer) && manufacturer > 0) {
    return `제조사 안전하중 ${formatTon(manufacturer)}t`;
  }
  const catalog = Number(rigging.wire_safe_load);
  const table = Number.isFinite(catalog) && catalog > 0 ? catalog : Number(rigging.sling_safe_load);
  if (Number.isFinite(table) && table > 0) {
    return `지름 표 계산 ${formatTon(table)}t`;
  }
  return "";
}

/** 인쇄에 적는 줄걸이 방법. 없으면 빈 문자열. */
export function slingHitchPrintNote(rigging: Record<string, unknown> | null | undefined): string {
  if (!rigging) return "";
  const hitch = SLING_HITCH_PRINT_LABELS[String(rigging.sling_hitch || "")] || "";
  const combination = String(rigging.sling_combination || "");
  const parts: string[] = [];
  if (hitch) parts.push(hitch);
  if (combination === "series") parts.push("디바이스 한 줄 연결");
  if (combination === "parallel") parts.push("디바이스 나란히");
  const assembly = Number(rigging.sling_assembly_safe_load);
  if (combination === "parallel" && Number.isFinite(assembly) && assembly > 0) {
    parts.push(`조합 사용하중 ${assembly}t`);
  }
  return parts.join(" · ");
}

function slingSpecPairs(rigging: Record<string, unknown>, escapeHtml: (s: string) => string): Array<Pair | null> {
  const material = slingMaterialKey(rigging);
  const pairs: Array<Pair | null> = [
    pair("슬링 종류", escapeHtml(slingMaterialLabel(rigging))),
    pair(RIGGING_PRINT_LABELS.sling_method, escapeHtml(txt(rigging.sling_method))),
    pair("줄걸이 방법", escapeHtml(slingHitchPrintNote(rigging))),
    pair("슬링 각도", withUnit(pos(rigging.sling_angle_deg), "°")),
    pair("슬링 본수", pos(rigging.sling_count) != null ? String(pos(rigging.sling_count)) : ""),
  ];

  if (material === "wire_rope" || (!material && pos(rigging.wire_diameter_mm))) {
    pairs.push(pair("와이어 직경", withUnit(pos(rigging.wire_diameter_mm), "mm")));
    const wireNote = wireSafeLoadPrintNote(rigging);
    if (wireNote) pairs.push(pair("와이어 안전하중", escapeHtml(wireNote)));
    if (txt(rigging.wire_terminal_method)) {
      pairs.push(pair("단말 가공", escapeHtml(txt(rigging.wire_terminal_method))));
    }
  } else if (material === "sling_belt") {
    pairs.push(pair("벨트 폭", withUnit(pos(rigging.sling_belt_width_mm), "mm")));
    pairs.push(pair("벨트 정격", withUnit(pos(rigging.sling_belt_rated_load), "t")));
  } else if (material === "round_sling") {
    pairs.push(pair("라운드슬링", escapeHtml(roundSlingLabel(txt(rigging.sling_belt_color)))));
    pairs.push(pair("정격하중", withUnit(pos(rigging.round_sling_rated_load), "t")));
  } else if (material === "chain_sling") {
    pairs.push(pair("체인 규격", withUnit(pos(rigging.chain_diameter_mm), "mm")));
    pairs.push(pair("체인 정격", withUnit(pos(rigging.chain_rated_load), "t")));
    pairs.push(pair("체인 줄 수", pos(rigging.chain_leg_count) != null ? String(pos(rigging.chain_leg_count)) : ""));
  }

  pairs.push(pair("줄 안전하중", withUnit(pos(rigging.sling_safe_load) ?? pos(rigging.sling_working_load), "t")));
  pairs.push(pair("1줄 장력", withUnit(pos(rigging.tension_per_leg), "t")));
  pairs.push(pair("줄걸이 판정", escapeHtml(judgmentText(rigging.sling_ok))));
  return pairs;
}

export function renderRiggingPrintHtml(
  rigging: Record<string, unknown> | null | undefined,
  escapeHtml: (s: string) => string,
): string {
  if (!rigging) return "";

  const sf = Number(rigging.safety_factor) || 0;
  const util = Number(rigging.calculated_utilization) || 0;
  const band = classifyRiggingLoad({ utilizationPct: util, safetyFactor: sf });
  const banner = riggingLoadBanner(band);
  const hint = riggingLoadHint(util);
  const commander = txt(rigging.lifting_method);

  const load = pos(rigging.load_weight);
  const hook = pos(rigging.hook_weight);
  const shackleWt = pos(rigging.shackle_weight_val);
  const slingWt = pos(rigging.sling_rigging_weight);
  const totalStored = pos(rigging.total_weight_max);
  const total = totalStored ?? (load != null || hook || shackleWt || slingWt
    ? (load || 0) + (hook || 0) + (shackleWt || 0) + (slingWt || 0)
    : null);
  const rated = pos(rigging.crane_capacity) ?? pos(rigging.rated_capacity);
  const applied = pos(rigging.equipment_working_load);
  const slingSwl = pos(rigging.sling_safe_load) ?? pos(rigging.sling_working_load);
  const tension = pos(rigging.tension_per_leg);
  const shackleSwl = pos(rigging.shackle_safe_load) ?? pos(rigging.shackle_working_load);

  const loadHtml = infoTable([
    pair("인양물 중량", withUnit(load, "t")),
    pair("인양물 설명", escapeHtml(txt(rigging.load_description))),
    pair("훅 무게", withUnit(hook, "t")),
    pair("샤클 무게", withUnit(shackleWt, "t")),
    pair("줄걸이 무게", withUnit(slingWt, "t")),
    pair("총중량", withUnit(total && total > 0 ? total : null, "t")),
  ]);

  const craneHtml = infoTable([
    pair("크레인 기종", escapeHtml(txt(rigging.crane_model) || txt(rigging.equipment_name))),
    pair("정격하중", withUnit(rated, "t")),
    pair("작업 반경", withUnit(pos(rigging.working_radius), "m")),
    pair("붐 길이", withUnit(pos(rigging.boom_length), "m")),
    pair(RIGGING_PRINT_LABELS.outrigger_setup, escapeHtml(txt(rigging.outrigger_setup))),
    pair("적용 정격", withUnit(applied, "t")),
    pair("여유율", sf > 0 ? sf.toFixed(2) : ""),
    pair("부하율", util > 0 ? `${util.toFixed(1)}%` : ""),
    pair("장비 판정", escapeHtml(judgmentText(rigging.equipment_ok))),
  ]);

  const slingHtml = infoTable(slingSpecPairs(rigging, escapeHtml));

  const shackleHtml = infoTable([
    pair("샤클", escapeHtml(txt(rigging.shackle_inch) ? `${txt(rigging.shackle_inch)}"` : "") || withUnit(pos(rigging.shackle_diameter_mm), "mm")),
    pair("사용 갯수", pos(rigging.shackle_qty) != null ? String(pos(rigging.shackle_qty)) : ""),
    pair("샤클 안전하중", withUnit(shackleSwl, "t")),
    pair("1줄 장력", withUnit(tension, "t")),
    pair("샤클 판정", escapeHtml(judgmentText(rigging.shackle_ok))),
  ]);

  const derates: string[] = [];
  if (isDerated(rigging.boom_rotation_factor)) derates.push("선회 인양 중 ×0.8");
  if (isDerated(rigging.ground_inspection_factor)) derates.push("지반 경사 ×0.8");
  if (isDerated(rigging.load_protrusion_factor) || isDerated(rigging.travel_load_factor)) {
    derates.push("하중 주행 ×0.8");
  }
  const condHtml = infoTable([
    pair("풍속 등급", escapeHtml(txt(rigging.wind_speed_grade))),
    pair("정격 감률", derates.length ? escapeHtml(derates.join(" · ")) : ""),
    pair("지반 지지력", withUnit(pos(rigging.ground_bearing_capacity), " t/㎡")),
  ]);

  const reasons: string[] = [];
  if (applied != null && total != null && total > 0) {
    reasons.push(`장비: 적용 정격 ${formatTon(applied)}t ${applied >= total ? "≥" : "<"} 총중량 ${formatTon(total)}t (규칙 제146조)`);
  }
  if (slingSwl != null && tension != null) {
    reasons.push(`줄걸이: 1줄 안전하중 ${formatTon(slingSwl)}t ${slingSwl >= tension ? "≥" : "<"} 1줄 장력 ${formatTon(tension)}t`);
  }
  if (shackleSwl != null && tension != null) {
    reasons.push(`샤클: 1개 SWL ${formatTon(shackleSwl)}t ${shackleSwl >= tension ? "≥" : "<"} 1줄 장력 ${formatTon(tension)}t`);
  }

  const compareHtml = [
    compareTable(
      ["적용 정격", "총중량", "여유율", "부하율"],
      [
        applied != null ? `${formatTon(applied)}t` : "",
        total != null && total > 0 ? `${formatTon(total)}t` : "",
        sf > 0 ? sf.toFixed(2) : "",
        util > 0 ? `${util.toFixed(1)}%` : "",
      ],
    ),
    compareTable(
      ["줄 안전하중", "1줄 장력", "줄걸이 판정"],
      [
        slingSwl != null ? `${formatTon(slingSwl)}t` : "",
        tension != null ? `${formatTon(tension)}t` : "",
        escapeHtml(judgmentText(rigging.sling_ok)),
      ],
    ),
    compareTable(
      ["샤클 안전하중", "1줄 장력", "샤클 판정"],
      [
        shackleSwl != null ? `${formatTon(shackleSwl)}t` : "",
        tension != null ? `${formatTon(tension)}t` : "",
        escapeHtml(judgmentText(rigging.shackle_ok)),
      ],
    ),
  ].join("");

  const footerBits = [
    commander ? `${RIGGING_PRINT_LABELS.lifting_method}: ${escapeHtml(commander)}` : "",
    txt(rigging.notes) ? `${RIGGING_PRINT_LABELS.notes}: ${escapeHtml(txt(rigging.notes))}` : "",
  ].filter(Boolean);

  return `
        <div class="section-header">리깅플랜 (양중계획)</div>
        <div style="margin-top:4pt;padding:8pt;border:2pt solid ${banner.color};border-radius:4pt;text-align:center;">
          <span style="font-size:12pt;font-weight:700;color:${banner.color};">${banner.emoji} ${banner.label} — 안전율: ${sf.toFixed(2)} | 부하율: ${util.toFixed(1)}% (${hint})</span>
        </div>
        ${reviewBlock("인양물", loadHtml)}
        ${reviewBlock("장비", craneHtml)}
        ${reviewBlock("줄걸이", slingHtml)}
        ${reviewBlock("샤클", shackleHtml)}
        ${reviewBlock("작업 조건", condHtml)}
        ${compareHtml || (rigging.equipment_ok || rigging.sling_ok || rigging.shackle_ok ? `
        <table class="info-table" style="margin-top:8pt;"><tbody>
          <tr><td class="label">장비 판정</td><td>${escapeHtml(judgmentText(rigging.equipment_ok))}</td><td class="label">슬링 판정</td><td>${escapeHtml(judgmentText(rigging.sling_ok))}</td></tr>
          <tr><td class="label">샤클 판정</td><td colspan="3">${escapeHtml(judgmentText(rigging.shackle_ok))}</td></tr>
        </tbody></table>` : "")}
        ${reasons.length ? `<p style="font-size:8pt;margin-top:6pt;color:#334155;">${reasons.map((r) => escapeHtml(r)).join("<br/>")}</p>` : ""}
        ${footerBits.length ? `<p style="font-size:8pt;margin-top:6pt;color:#475569;">${footerBits.join(" · ")}</p>` : ""}`;
}
