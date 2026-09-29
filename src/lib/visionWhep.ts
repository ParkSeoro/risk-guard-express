type WhepSession = {
  close: () => void;
  closed: Promise<void>;
};

function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onState);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timer = window.setTimeout(finish, 2500);
    pc.addEventListener("icegatheringstatechange", onState);
  });
}

/** Open one recvonly video call. The browser already speaks WebRTC. */
export async function attachVisionWhep(video: HTMLVideoElement, whepUrl: string): Promise<WhepSession> {
  const pc = new globalThis.RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  const stream = new globalThis.MediaStream();
  pc.ontrack = (event) => {
    stream.addTrack(event.track);
    video.srcObject = stream;
  };
  let closed = false;
  let resolveClosed = () => undefined;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        resolve();
      }
    });
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);
  const response = await globalThis.fetch(whepUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp ?? "",
  });
  if (!response.ok) {
    pc.close();
    throw new Error(`whep ${response.status}`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
  return {
    closed: closedPromise,
    close: () => {
      if (closed) return;
      closed = true;
      pc.close();
      resolveClosed();
    },
  };
}
