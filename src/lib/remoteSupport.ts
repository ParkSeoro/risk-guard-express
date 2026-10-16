import { supabase } from "@/integrations/supabase/client";

export type RemoteSupportStatus = "pending" | "active" | "ended" | "rejected" | "expired";

export type RemoteSupportAgent = {
  id: string;
  user_id: string;
  display_label: string;
  sort_order: number;
  active: boolean;
};

export type RemoteSupportSession = {
  id: string;
  requester_id: string;
  agent_id: string;
  project_id: string | null;
  status: RemoteSupportStatus;
  requester_path: string | null;
  control_state: Record<string, unknown>;
  created_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  updated_at: string;
};

/** Normalized 0..1 coords over the shared SafeNex viewport (not OS desktop). */
export type RemoteControlEvent =
  | { kind: "navigate"; path: string }
  | { kind: "setProject"; projectId: string }
  /** Live agent cursor position (move). */
  | { kind: "pointer"; x: number; y: number; visible?: boolean }
  /** Synthetic click / dblclick at normalized coords. */
  | {
      kind: "click";
      x: number;
      y: number;
      button?: number;
      detail?: number;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      metaKey?: boolean;
    }
  | { kind: "scroll"; x: number; y: number; deltaX: number; deltaY: number }
  | {
      kind: "key";
      type: "keydown" | "keyup";
      key: string;
      code: string;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      metaKey?: boolean;
    }
  | { kind: "end" };

export type RemoteSignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit | null }
  | { kind: "ready" };

// Tables are live; generated Database types may lag until regenerate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agentsTable = () => (supabase as any).from("remote_support_agents");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionsTable = () => (supabase as any).from("remote_support_sessions");

/** Field users only: not master, not an active support agent. */
export function canRequestRemoteSupport(opts: {
  userId?: string | null;
  isMaster?: boolean;
  isAgent?: boolean;
}): boolean {
  if (!opts.userId) return false;
  if (opts.isMaster) return false;
  if (opts.isAgent) return false;
  return true;
}

export function isTerminalStatus(status: RemoteSupportStatus | string | null | undefined): boolean {
  return status === "ended" || status === "rejected" || status === "expired";
}

export function canTransitionStatus(
  from: RemoteSupportStatus,
  to: RemoteSupportStatus,
): boolean {
  if (from === to) return true;
  if (isTerminalStatus(from)) return false;
  if (from === "pending") {
    return to === "active" || to === "rejected" || to === "ended" || to === "expired";
  }
  if (from === "active") {
    return to === "ended";
  }
  return false;
}

export function remoteSupportChannelName(sessionId: string): string {
  return `remote-support:${sessionId}`;
}

export function remoteSupportDeepLink(sessionId: string): string {
  return `/app/admin/remote-support?session=${encodeURIComponent(sessionId)}`;
}

export async function fetchActiveAgents(): Promise<RemoteSupportAgent[]> {
  const { data, error } = await agentsTable()
    .select("id, user_id, display_label, sort_order, active")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as RemoteSupportAgent[];
}

export async function fetchAllAgents(): Promise<RemoteSupportAgent[]> {
  const { data, error } = await agentsTable()
    .select("id, user_id, display_label, sort_order, active")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as RemoteSupportAgent[];
}

export async function isUserRemoteSupportAgent(userId: string): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await agentsTable()
    .select("id")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function createRemoteSupportSession(params: {
  requesterId: string;
  agentId: string;
  projectId?: string | null;
  requesterPath?: string | null;
}): Promise<RemoteSupportSession> {
  const { data, error } = await sessionsTable()
    .insert({
      requester_id: params.requesterId,
      agent_id: params.agentId,
      project_id: params.projectId || null,
      status: "pending",
      requester_path: params.requesterPath || null,
      control_state: {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as RemoteSupportSession;
}

export async function fetchRemoteSupportSession(sessionId: string): Promise<RemoteSupportSession | null> {
  const { data, error } = await sessionsTable().select("*").eq("id", sessionId).maybeSingle();
  if (error) throw error;
  return (data as unknown as RemoteSupportSession) || null;
}

export async function listOpenSessionsForUser(userId: string): Promise<RemoteSupportSession[]> {
  const { data, error } = await sessionsTable()
    .select("*")
    .or(`requester_id.eq.${userId},agent_id.eq.${userId}`)
    .in("status", ["pending", "active"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as RemoteSupportSession[];
}

export async function updateSessionStatus(
  sessionId: string,
  status: RemoteSupportStatus,
  patch?: Partial<Pick<RemoteSupportSession, "accepted_at" | "ended_at" | "control_state" | "requester_path">>,
): Promise<RemoteSupportSession> {
  const body: Record<string, unknown> = { status, ...(patch || {}) };
  if (status === "active" && !body.accepted_at) {
    body.accepted_at = new Date().toISOString();
  }
  if ((status === "ended" || status === "rejected" || status === "expired") && !body.ended_at) {
    body.ended_at = new Date().toISOString();
  }
  const { data, error } = await sessionsTable()
    .update(body)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error) throw error;
  return data as RemoteSupportSession;
}

export async function acceptRemoteSupportSession(sessionId: string): Promise<RemoteSupportSession> {
  return updateSessionStatus(sessionId, "active");
}

export async function rejectRemoteSupportSession(sessionId: string): Promise<RemoteSupportSession> {
  return updateSessionStatus(sessionId, "rejected");
}

export async function endRemoteSupportSession(sessionId: string): Promise<RemoteSupportSession> {
  return updateSessionStatus(sessionId, "ended");
}

export async function searchProfilesForAgent(query: string, limit = 12): Promise<
  Array<{ user_id: string; display_name: string | null }>
> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .ilike("display_name", `%${q}%`)
    .not("user_id", "is", null)
    .limit(limit);
  if (error) throw error;
  return ((data || []) as Array<{ user_id: string; display_name: string | null }>).filter(
    (r) => !!r.user_id,
  );
}

export async function upsertRemoteSupportAgent(params: {
  userId: string;
  displayLabel: string;
  sortOrder?: number;
  active?: boolean;
}): Promise<void> {
  const { error } = await agentsTable().upsert(
    {
      user_id: params.userId,
      display_label: params.displayLabel,
      sort_order: params.sortOrder ?? 10,
      active: params.active ?? true,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function setRemoteSupportAgentActive(agentId: string, active: boolean): Promise<void> {
  const { error } = await agentsTable().update({ active }).eq("id", agentId);
  if (error) throw error;
}

export function agentLabelFromSession(
  session: RemoteSupportSession,
  agents: RemoteSupportAgent[],
): string {
  return agents.find((a) => a.user_id === session.agent_id)?.display_label || "담당자";
}
