export type CouncilMemoryTurn = {
  seat: string;
  body: string;
};

export type CouncilMemoryMeeting = {
  agenda: string;
  status: string;
  turns: CouncilMemoryTurn[];
};

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

function lineFor(meeting: CouncilMemoryMeeting) {
  const gemini = [...meeting.turns].reverse().find((turn) => turn.seat === "gemini");
  const cursor = [...meeting.turns].reverse().find((turn) => turn.seat === "cursor");
  const chair = [...meeting.turns].reverse().find((turn) => turn.seat === "chair");
  const parts = [`[${meeting.status}] ${clip(meeting.agenda, 180)}`];
  if (gemini?.body.trim()) parts.push(`Gemini: ${clip(gemini.body, 220)}`);
  if (cursor?.body.trim()) parts.push(`Cursor: ${clip(cursor.body, 320)}`);
  if (chair?.body.trim()) parts.push(`의장: ${clip(chair.body, 180)}`);
  return parts.join("\n");
}

/** A short record of finished meetings. The current debate stays outside this text. */
export function councilMemoryBrief(meetings: CouncilMemoryMeeting[], maxChars = 2800): string {
  const rows = meetings
    .filter((meeting) => meeting.agenda.trim() && meeting.turns.length > 0)
    .slice(-6);
  if (!rows.length) return "";
  const text = [
    "지난 이야기입니다. 이번 말의 배경으로만 참고합니다.",
    "",
    rows.map(lineFor).join("\n\n"),
  ].join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
