/**
 * GPS tick worker — posts periodic "tick" so the main thread can sample GPS
 * and invoke track-location (DedicatedWorkers often lack geolocation).
 */

type StartMsg = { type: "start"; intervalMs?: number };
type StopMsg = { type: "stop" };

let timer: ReturnType<typeof setInterval> | null = null;

function clear() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function postTick() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (self as any).postMessage({ type: "tick", ts: Date.now() });
}

self.onmessage = (ev: MessageEvent<StartMsg | StopMsg>) => {
  const data = ev.data;
  if (!data) return;
  if (data.type === "stop") {
    clear();
    return;
  }
  if (data.type === "start") {
    clear();
    postTick();
    timer = setInterval(postTick, Math.max(5000, data.intervalMs || 15000));
  }
};

export {};
