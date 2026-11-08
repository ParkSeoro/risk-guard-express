import { supabase } from "@/integrations/supabase/client";

export type CouncilSeat = "user" | "gemini" | "claude" | "gpt" | "cursor" | "chair";
export type CouncilMeetingStatus = "진행중" | "합의" | "미합의";

export type CouncilLogTurn = {
  id: string;
  meeting_id: string;
  seat: CouncilSeat;
  round: number | null;
  role_label: string;
  body: string;
  created_at: string;
};

export type CouncilLogMeeting = {
  id: string;
  agenda: string;
  status: CouncilMeetingStatus;
  created_at: string;
  turns: CouncilLogTurn[];
};

function councilTable(name: "council_meetings" | "council_turns") {
  return (supabase as any).from(name);
}

export async function loadCouncilMeetings(): Promise<CouncilLogMeeting[]> {
  const { data: meetings, error } = await councilTable("council_meetings")
    .select("id, agenda, status, created_at")
    .order("created_at", { ascending: true })
    .limit(40);
  if (error) throw new Error(error.message);
  const rows = (meetings || []) as Omit<CouncilLogMeeting, "turns">[];
  if (!rows.length) return [];
  const { data: turns, error: turnError } = await councilTable("council_turns")
    .select("id, meeting_id, seat, round, role_label, body, created_at")
    .in("meeting_id", rows.map((row) => row.id))
    .order("created_at", { ascending: true });
  if (turnError) throw new Error(turnError.message);
  const byMeeting = new Map<string, CouncilLogTurn[]>();
  for (const turn of (turns || []) as CouncilLogTurn[]) {
    const list = byMeeting.get(turn.meeting_id) || [];
    list.push(turn);
    byMeeting.set(turn.meeting_id, list);
  }
  return rows.map((meeting) => ({ ...meeting, turns: byMeeting.get(meeting.id) || [] }));
}

export async function startCouncilMeeting(agenda: string): Promise<string | null> {
  const { data, error } = await councilTable("council_meetings")
    .insert({ agenda, status: "진행중" })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function appendCouncilTurn(input: {
  meetingId: string;
  seat: CouncilSeat;
  round: number | null;
  roleLabel: string;
  body: string;
}): Promise<void> {
  const { error } = await councilTable("council_turns").insert({
    meeting_id: input.meetingId,
    seat: input.seat,
    round: input.round,
    role_label: input.roleLabel,
    body: input.body,
  });
  if (error) throw new Error(error.message);
}

export async function closeCouncilMeeting(
  meetingId: string,
  status: "합의" | "미합의",
): Promise<void> {
  const { error } = await councilTable("council_meetings")
    .update({ status, closed_at: new Date().toISOString() })
    .eq("id", meetingId);
  if (error) throw new Error(error.message);
}
