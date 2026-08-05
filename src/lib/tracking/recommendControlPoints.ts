/**
 * Recommend walkable control points on a site map for N-point georef.
 * Prefers zones / GPS history; avoids extreme corners; maximizes spread.
 * Company/project-agnostic — no hardcoded site names.
 */
import type { ImageUv } from "@/lib/tracking/imageSpaceGeo";

export type ControlPointCandidate = {
  id: string;
  u: number;
  v: number;
  score: number;
  reason: string;
};

export type RecommendControlPointsOpts = {
  count?: number;
  /** Points user marked unreachable — never re-suggest nearby. */
  excluded?: ImageUv[];
  /** Already captured — keep distance from these too. */
  captured?: ImageUv[];
  /** Restricted/work zone rings in UV (latLng already projected). */
  zoneRingsUv?: ImageUv[][];
  /** Recent worker GPS projected to UV. */
  gpsHistoryUv?: ImageUv[];
  /** Margin from image edges (default 0.12). */
  inset?: number;
  /** Exclude radius in UV for rejected/captured (default 0.08). */
  excludeRadius?: number;
};

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function uvDist(a: ImageUv, b: ImageUv) {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

/** Ray-cast point-in-polygon (UV plane). */
export function pointInRing(p: ImageUv, ring: ImageUv[]): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].v;
    const yj = ring[j].v;
    const xi = ring[i].u;
    const xj = ring[j].u;
    const intersect =
      yi > p.v !== yj > p.v &&
      p.u < ((xj - xi) * (p.v - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function minDistToRing(p: ImageUv, ring: ImageUv[]): number {
  if (!ring.length) return Infinity;
  let min = Infinity;
  for (const q of ring) min = Math.min(min, uvDist(p, q));
  // Also sample edge midpoints lightly
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const mid = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
    min = Math.min(min, uvDist(p, mid));
  }
  return min;
}

function buildGrid(inset: number): ImageUv[] {
  const pts: ImageUv[] = [];
  // 5×5 interior grid
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const u = inset + ((1 - 2 * inset) * i) / 4;
      const v = inset + ((1 - 2 * inset) * j) / 4;
      pts.push({ u: clamp01(u), v: clamp01(v) });
    }
  }
  // Extra well-spread seeds (still inset)
  for (const s of [
    { u: 0.22, v: 0.22 },
    { u: 0.78, v: 0.22 },
    { u: 0.22, v: 0.78 },
    { u: 0.78, v: 0.78 },
    { u: 0.5, v: 0.35 },
    { u: 0.35, v: 0.55 },
    { u: 0.65, v: 0.55 },
  ]) {
    if (s.u >= inset && s.u <= 1 - inset && s.v >= inset && s.v <= 1 - inset) {
      pts.push(s);
    }
  }
  return pts;
}

function scorePoint(
  p: ImageUv,
  zones: ImageUv[][],
  gps: ImageUv[],
): { score: number; reason: string } {
  let score = 1;
  const reasons: string[] = [];

  let inZone = false;
  let nearZone = false;
  for (const ring of zones) {
    if (pointInRing(p, ring)) {
      inZone = true;
      break;
    }
    if (minDistToRing(p, ring) < 0.1) nearZone = true;
  }
  if (inZone) {
    score += 3;
    reasons.push("작업·위험구역 안");
  } else if (nearZone) {
    score += 1.5;
    reasons.push("구역 근처");
  }

  let nearGps = false;
  for (const g of gps) {
    if (uvDist(p, g) < 0.12) {
      nearGps = true;
      break;
    }
  }
  if (nearGps) {
    score += 2;
    reasons.push("최근 GPS 동선");
  }

  // Slight preference for mid-map (still walkable) vs extreme inset edge
  const mid = 1 - Math.hypot(p.u - 0.5, p.v - 0.5) / 0.75;
  score += Math.max(0, mid) * 0.3;

  if (reasons.length === 0) reasons.push("맵 분산 후보");
  return { score, reason: reasons.join(" · ") };
}

/**
 * Pick `count` recommended UV points: high accessibility score + geometric spread.
 */
export function recommendControlPoints(
  opts: RecommendControlPointsOpts = {},
): ControlPointCandidate[] {
  const count = Math.max(1, opts.count ?? 3);
  const inset = opts.inset ?? 0.12;
  const excludeR = opts.excludeRadius ?? 0.08;
  const zones = opts.zoneRingsUv || [];
  const gps = opts.gpsHistoryUv || [];
  const blocked = [...(opts.excluded || []), ...(opts.captured || [])];

  const raw = buildGrid(inset);
  const scored: ControlPointCandidate[] = [];
  let idx = 0;
  for (const p of raw) {
    if (blocked.some((b) => uvDist(p, b) < excludeR)) continue;
    const { score, reason } = scorePoint(p, zones, gps);
    scored.push({
      id: `c${idx++}`,
      u: p.u,
      v: p.v,
      score,
      reason,
    });
  }
  if (scored.length === 0) return [];

  // Prefer higher score; break ties later via spread
  scored.sort((a, b) => b.score - a.score);

  const picked: ControlPointCandidate[] = [];
  // Seed with best-scoring point
  picked.push(scored[0]);

  while (picked.length < count && picked.length < scored.length) {
    let best: ControlPointCandidate | null = null;
    let bestMetric = -Infinity;
    for (const c of scored) {
      if (picked.some((p) => p.id === c.id)) continue;
      if (picked.some((p) => uvDist(p, c) < excludeR)) continue;
      const minD = Math.min(...picked.map((p) => uvDist(p, c)));
      // Balance spread vs accessibility
      const metric = minD * 2.2 + c.score * 0.15;
      if (metric > bestMetric) {
        bestMetric = metric;
        best = c;
      }
    }
    if (!best) break;
    picked.push(best);
  }

  // Relabel is caller's job — keep stable unique ids so captures never collide.
  return picked;
}

/**
 * Assign fixed slot labels (A/B/C…) without changing UV.
 * Labels are stable for the session — never reassign after capture.
 */
export function withSlotLabels(
  points: ControlPointCandidate[],
  labels: string[] = ["A", "B", "C"],
): ControlPointCandidate[] {
  return points.map((p, i) => ({
    ...p,
    id: labels[i] || `P${i + 1}`,
  }));
}
