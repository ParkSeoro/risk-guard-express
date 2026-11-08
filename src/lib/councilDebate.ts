export const COUNCIL_MAX_ROUNDS = 3;
export const COUNCIL_MAX_CURSOR_TURNS = 2;

export type CouncilVerdict = "된다" | "안된다" | "합의가능" | "계속";

const VERDICT_LINE = /^판정\s*[:：]\s*(된다|안\s*된다|합의\s*가능|계속)\s*$/;

/** The last verdict line is the seat's decision. The paragraphs above stay their real opinions. */
export function readVerdict(text: string): CouncilVerdict | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = Math.max(0, lines.length - 6);
  for (let i = lines.length - 1; i >= start; i--) {
    const matched = lines[i].match(VERDICT_LINE);
    if (!matched) continue;
    const raw = matched[1].replace(/\s/g, "");
    if (raw === "된다") return "된다";
    if (raw === "안된다") return "안된다";
    if (raw === "합의가능") return "합의가능";
    return "계속";
  }
  return null;
}

/** Close only when Cursor allows the current proposal and every other seat has no remaining objection. */
export function councilCanClose(opinions: string[], cursor: string): boolean {
  if (readVerdict(cursor) !== "된다") return false;
  if (opinions.length < 3) return false;
  return opinions.every((text) => readVerdict(text) === "합의가능");
}
