import { supabase } from "@/integrations/supabase/client";
import {
  remoteSupportChannelName,
  type RemoteControlEvent,
  type RemoteSignalPayload,
} from "@/lib/remoteSupport";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type RemoteSupportRtcRole = "requester" | "agent";

export type RemoteSupportRtcHandles = {
  pc: RTCPeerConnection;
  channel: ReturnType<typeof supabase.channel>;
  localStream: MediaStream | null;
  cleanup: () => Promise<void>;
  sendControl: (event: RemoteControlEvent) => Promise<void>;
};

type StartOpts = {
  sessionId: string;
  role: RemoteSupportRtcRole;
  onRemoteStream?: (stream: MediaStream) => void;
  onControl?: (event: RemoteControlEvent) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
};

async function waitSubscribed(channel: ReturnType<typeof supabase.channel>, ms = 8_000) {
  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("realtime subscribe timeout")), ms);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        window.clearTimeout(t);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        window.clearTimeout(t);
        reject(new Error(status));
      }
    });
  });
}

async function sendSignal(
  channel: ReturnType<typeof supabase.channel>,
  payload: RemoteSignalPayload,
) {
  await channel.send({ type: "broadcast", event: "signal", payload });
}

export async function startRemoteSupportRtc(opts: StartOpts): Promise<RemoteSupportRtcHandles> {
  const channel = supabase.channel(remoteSupportChannelName(opts.sessionId), {
    config: { broadcast: { self: false } },
  });
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let localStream: MediaStream | null = null;
  let closed = false;

  pc.onconnectionstatechange = () => {
    opts.onConnectionState?.(pc.connectionState);
  };

  pc.ontrack = (ev) => {
    const stream = ev.streams[0] || new MediaStream([ev.track]);
    opts.onRemoteStream?.(stream);
  };

  pc.onicecandidate = (ev) => {
    void sendSignal(channel, {
      kind: "ice",
      candidate: ev.candidate ? ev.candidate.toJSON() : null,
    });
  };

  channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
    const msg = payload as RemoteSignalPayload;
    if (!msg || closed) return;
    try {
      if (msg.kind === "offer" && opts.role === "agent") {
        await pc.setRemoteDescription(msg.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(channel, { kind: "answer", sdp: answer });
      } else if (msg.kind === "answer" && opts.role === "requester") {
        if (!pc.currentRemoteDescription) {
          await pc.setRemoteDescription(msg.sdp);
        }
      } else if (msg.kind === "ice" && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {
          /* ignore late candidates */
        }
      } else if (msg.kind === "ready" && opts.role === "requester") {
        // Agent joined — renegotiate if we already have local tracks.
        if (pc.signalingState === "stable" && localStream) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendSignal(channel, { kind: "offer", sdp: offer });
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn("[remote-support] signal error", err);
    }
  });

  channel.on("broadcast", { event: "control" }, ({ payload }) => {
    if (closed) return;
    opts.onControl?.(payload as RemoteControlEvent);
  });

  await waitSubscribed(channel);

  if (opts.role === "requester") {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
      track.onended = () => {
        void sendControl({ kind: "end" });
      };
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal(channel, { kind: "offer", sdp: offer });
  } else {
    await sendSignal(channel, { kind: "ready" });
  }

  async function sendControl(event: RemoteControlEvent) {
    if (closed) return;
    await channel.send({ type: "broadcast", event: "control", payload: event });
  }

  async function cleanup() {
    if (closed) return;
    closed = true;
    try {
      localStream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    localStream = null;
    try {
      pc.close();
    } catch {
      /* ignore */
    }
    await supabase.removeChannel(channel);
  }

  return { pc, channel, localStream, cleanup, sendControl };
}
