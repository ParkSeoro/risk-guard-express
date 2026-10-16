import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import {
  agentLabelFromSession,
  canRequestRemoteSupport,
  endRemoteSupportSession,
  fetchActiveAgents,
  isUserRemoteSupportAgent,
  listOpenSessionsForUser,
  type RemoteControlEvent,
  type RemoteSupportAgent,
  type RemoteSupportSession,
} from "@/lib/remoteSupport";
import {
  applyRemoteClick,
  applyRemoteKey,
  applyRemoteScroll,
  isSafeNexAppPath,
  normalizedToViewport,
} from "@/lib/remoteSupportControl";
import { startRemoteSupportRtc, type RemoteSupportRtcHandles } from "@/lib/remoteSupportWebrtc";
import { RemoteSupportRequestDialog } from "@/components/remote-support/RequestDialog";
import { RemoteSupportAgentPrompt } from "@/components/remote-support/AgentPrompt";
import { RemoteSupportSessionBanner } from "@/components/remote-support/SessionBanner";
import { RemoteSupportConsole } from "@/components/remote-support/SupportConsole";
import { toast } from "sonner";

type Ctx = {
  canRequest: boolean;
  isAgent: boolean;
  openRequestDialog: () => void;
  openSessions: RemoteSupportSession[];
  agents: RemoteSupportAgent[];
  requesterSession: RemoteSupportSession | null;
  controlling: boolean;
  endRequesterSession: () => void;
  agentLabel: string;
};

const RemoteSupportContext = createContext<Ctx | null>(null);

export function useRemoteSupport() {
  const ctx = useContext(RemoteSupportContext);
  if (!ctx) throw new Error("useRemoteSupport must be used within RemoteSupportHost");
  return ctx;
}

export function useRemoteSupportOptional() {
  return useContext(RemoteSupportContext);
}

/** Place under the admin header so the support strip sits above page content. */
export function RemoteSupportBannerSlot() {
  const rs = useRemoteSupportOptional();
  if (!rs?.requesterSession) return null;
  const status = rs.requesterSession.status === "active" ? "active" : "pending";
  return (
    <RemoteSupportSessionBanner
      agentLabel={rs.agentLabel}
      status={status}
      controlling={rs.controlling}
      onEnd={rs.endRequesterSession}
    />
  );
}

export function RemoteSupportHost({ children }: { children: React.ReactNode }) {
  const { user, hasRole } = useAuth();
  const isMaster = hasRole("master");
  const access = useGlobalProjectAccessOptional();
  const navigate = useNavigate();
  const location = useLocation();

  const [isAgent, setIsAgent] = useState(false);
  const [agents, setAgents] = useState<RemoteSupportAgent[]>([]);
  const [sessions, setSessions] = useState<RemoteSupportSession[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [controlling, setControlling] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number; visible: boolean } | null>(null);

  const rtcRef = useRef<RemoteSupportRtcHandles | null>(null);
  const startedForRef = useRef<string | null>(null);
  const requesterNamesRef = useRef<Record<string, string>>({});
  const controllingTimerRef = useRef<number | null>(null);

  const markControlling = useCallback((ms = 2000) => {
    setControlling(true);
    if (controllingTimerRef.current) window.clearTimeout(controllingTimerRef.current);
    controllingTimerRef.current = window.setTimeout(() => setControlling(false), ms);
  }, []);

  const canRequest = canRequestRemoteSupport({
    userId: user?.id,
    isMaster,
    isAgent,
  });

  const myRequesterSession = useMemo(
    () => sessions.find((s) => s.requester_id === user?.id && (s.status === "pending" || s.status === "active")),
    [sessions, user?.id],
  );
  const myAgentPending = useMemo(
    () => sessions.find((s) => s.agent_id === user?.id && s.status === "pending"),
    [sessions, user?.id],
  );
  const myAgentActive = useMemo(
    () => sessions.find((s) => s.agent_id === user?.id && s.status === "active"),
    [sessions, user?.id],
  );

  const refresh = useCallback(async () => {
    if (!user) {
      setSessions([]);
      setIsAgent(false);
      return;
    }
    const [agentFlag, agentRows, open] = await Promise.all([
      isUserRemoteSupportAgent(user.id),
      fetchActiveAgents().catch(() => [] as RemoteSupportAgent[]),
      listOpenSessionsForUser(user.id),
    ]);
    setIsAgent(agentFlag);
    setAgents(agentRows);
    setSessions(open);

    const requesterIds = [...new Set(open.map((s) => s.requester_id))];
    if (requesterIds.length) {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", requesterIds);
      const map: Record<string, string> = {};
      for (const row of data || []) {
        if (row.user_id) map[row.user_id] = row.display_name || "현장 사용자";
      }
      requesterNamesRef.current = { ...requesterNamesRef.current, ...map };
    }
  }, [user]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`remote-support-sessions-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "remote_support_sessions" },
        () => {
          void refresh().catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  useEffect(() => {
    if (myAgentPending) setPromptOpen(true);
  }, [myAgentPending?.id]);

  const stopRtc = useCallback(async () => {
    startedForRef.current = null;
    setRemoteStream(null);
    setControlling(false);
    setPointer(null);
    const h = rtcRef.current;
    rtcRef.current = null;
    if (h) await h.cleanup();
  }, []);

  const applyControl = useCallback(
    (event: RemoteControlEvent) => {
      if (event.kind === "navigate" && event.path) {
        if (!isSafeNexAppPath(event.path)) return;
        navigate(event.path);
        markControlling(2500);
      } else if (event.kind === "setProject" && event.projectId) {
        access?.setSelectedProject(event.projectId);
        markControlling(2500);
      } else if (event.kind === "pointer") {
        if (event.visible === false) {
          setPointer((prev) => (prev ? { ...prev, visible: false } : null));
          return;
        }
        setPointer({ x: event.x, y: event.y, visible: true });
        markControlling(1200);
      } else if (event.kind === "click") {
        setPointer({ x: event.x, y: event.y, visible: true });
        applyRemoteClick(event);
        markControlling(2000);
      } else if (event.kind === "scroll") {
        setPointer({ x: event.x, y: event.y, visible: true });
        applyRemoteScroll(event);
        markControlling(1200);
      } else if (event.kind === "key") {
        applyRemoteKey(event);
        markControlling(1200);
      } else if (event.kind === "end") {
        void stopRtc();
      }
    },
    [access, markControlling, navigate, stopRtc],
  );

  // Requester: start screen share when session becomes active
  useEffect(() => {
    if (!user || !myRequesterSession || myRequesterSession.status !== "active") return;
    if (startedForRef.current === myRequesterSession.id) return;
    let cancelled = false;
    (async () => {
      try {
        await stopRtc();
        if (cancelled) return;
        startedForRef.current = myRequesterSession.id;
        const handles = await startRemoteSupportRtc({
          sessionId: myRequesterSession.id,
          role: "requester",
          onControl: applyControl,
        });
        if (cancelled) {
          await handles.cleanup();
          return;
        }
        rtcRef.current = handles;
        toast.message("화면공유가 시작되었습니다.", {
          description: "가능하면 ‘Chrome 탭’만 공유하세요. 상담자 커서·클릭이 SafeNex 안에서만 동작합니다.",
        });
      } catch (err: unknown) {
        startedForRef.current = null;
        toast.error(
          err instanceof Error
            ? err.message
            : "화면공유를 시작하지 못했습니다. 브라우저에서 공유를 허용해 주세요.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, myRequesterSession?.id, myRequesterSession?.status, applyControl, stopRtc]);

  // Agent: join WebRTC when active
  useEffect(() => {
    if (!user || !myAgentActive) return;
    if (startedForRef.current === myAgentActive.id) return;
    let cancelled = false;
    (async () => {
      try {
        await stopRtc();
        if (cancelled) return;
        startedForRef.current = myAgentActive.id;
        const handles = await startRemoteSupportRtc({
          sessionId: myAgentActive.id,
          role: "agent",
          onRemoteStream: (stream) => setRemoteStream(stream),
          onControl: (ev) => {
            if (ev.kind === "end") void stopRtc();
          },
        });
        if (cancelled) {
          await handles.cleanup();
          return;
        }
        rtcRef.current = handles;
      } catch (err: unknown) {
        startedForRef.current = null;
        toast.error(err instanceof Error ? err.message : "원격 연결에 실패했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, myAgentActive?.id, stopRtc]);

  // Cleanup when no open session for me
  useEffect(() => {
    if (!myRequesterSession && !myAgentActive) {
      void stopRtc();
    }
  }, [myRequesterSession, myAgentActive, stopRtc]);

  useEffect(() => {
    return () => {
      void stopRtc();
    };
  }, [stopRtc]);

  const endMine = async (session: RemoteSupportSession | undefined) => {
    if (!session) return;
    try {
      await rtcRef.current?.sendControl({ kind: "end" });
      await endRemoteSupportSession(session.id);
      await stopRtc();
      toast.message("원격지원을 종료했습니다.");
      void refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "종료에 실패했습니다.");
    }
  };

  const bannerAgentLabel = myRequesterSession
    ? agentLabelFromSession(myRequesterSession, agents)
    : "담당자";

  const ctx: Ctx = {
    canRequest,
    isAgent,
    openRequestDialog: () => setRequestOpen(true),
    openSessions: sessions,
    agents,
    requesterSession: myRequesterSession || null,
    controlling,
    endRequesterSession: () => void endMine(myRequesterSession),
    agentLabel: bannerAgentLabel,
  };

  return (
    <RemoteSupportContext.Provider value={ctx}>
      {children}
      {pointer?.visible && (
        <div
          className="pointer-events-none fixed z-[90] print:hidden flex items-start"
          style={{
            left: normalizedToViewport({ x: pointer.x, y: pointer.y }).x,
            top: normalizedToViewport({ x: pointer.x, y: pointer.y }).y,
          }}
          aria-hidden
        >
          <svg width="24" height="24" viewBox="0 0 24 24" className="drop-shadow shrink-0">
            <path
              d="M4 3l12 8.5-5.2 1.3L8.5 20 4 3z"
              fill="#f59e0b"
              stroke="#78350f"
              strokeWidth="1"
            />
          </svg>
          <span className="mt-3 -ml-0.5 rounded bg-amber-500/90 px-1 py-0.5 text-[10px] font-medium text-amber-950 whitespace-nowrap">
            상담자
          </span>
        </div>
      )}
      <RemoteSupportRequestDialog open={requestOpen} onOpenChange={setRequestOpen} onCreated={() => void refresh()} />
      <RemoteSupportAgentPrompt
        session={myAgentPending || null}
        requesterName={
          myAgentPending ? requesterNamesRef.current[myAgentPending.requester_id] : undefined
        }
        open={promptOpen && !!myAgentPending}
        onOpenChange={setPromptOpen}
        onAccepted={() => {
          void refresh();
          if (!location.pathname.includes("/remote-support")) {
            navigate(`/app/admin/remote-support?session=${myAgentPending?.id || ""}`);
          }
        }}
        onRejected={() => void refresh()}
      />
      {myAgentActive && (
        <RemoteSupportConsole
          requesterName={requesterNamesRef.current[myAgentActive.requester_id]}
          remoteStream={remoteStream}
          onSendControl={(ev) => {
            void rtcRef.current?.sendControl(ev);
            setControlling(true);
            window.setTimeout(() => setControlling(false), 1500);
          }}
          onEnd={() => void endMine(myAgentActive)}
        />
      )}
    </RemoteSupportContext.Provider>
  );
}
