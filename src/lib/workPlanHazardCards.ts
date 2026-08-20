export type WorkPlanHazardCard = {
  key: string;
  hazard: string;
  measure: string;
  process?: string;
};

/** Pull large-type hazard cards from a work-plan `sections` payload (any status). */
export function extractWorkPlanHazardCards(sections: any[]): WorkPlanHazardCard[] {
  const cards: WorkPlanHazardCard[] = [];
  const ra = (sections || []).find((s: any) => s.key === "_ra_high_risks");
  if (ra?.content && typeof ra.content === "string") {
    const blocks = ra.content.split(/\n• /).map((b: string, i: number) => (i === 0 ? b.replace(/^• /, "") : b));
    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const head = lines[0];
      const measureLine = lines.find((l) => l.startsWith("→")) || lines[1] || "";
      const m = head.match(/^\[(.+?)\]\s*(.*)$/);
      cards.push({
        key: `ra-${cards.length}`,
        process: m?.[1],
        hazard: (m?.[2] || head).trim() || "(위험요인)",
        measure: measureLine.replace(/^→\s*/, "").trim() || "안전조치 미기재",
      });
    }
  }

  for (const s of sections || []) {
    if (!s || s.key === "_ra_high_risks" || s.key === "_checklist") continue;
    const title = String(s.title || s.key || "");
    const content = typeof s.content === "string" ? s.content.trim() : "";
    if (!content) continue;
    const isHazard =
      /위험|hazard|안전조치|대책|예방|주의/i.test(title) ||
      s.key === "risk" ||
      s.key === "safety" ||
      s.key === "measures";
    if (isHazard) {
      cards.push({
        key: `sec-${s.key}`,
        hazard: title,
        measure: content,
      });
    }
  }
  return cards;
}
