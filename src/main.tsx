import { createRoot } from "react-dom/client";
import "./index.css";
import { registerSWSafely } from "./lib/registerServiceWorker";
import { initOtaUpdater } from "./lib/native/otaUpdater";
import { runBootOtaGate } from "./lib/native/bootOtaGate";
import { runBootStoreGate } from "./lib/native/bootStoreGate";
import { isNativeApp } from "./lib/native/platform";

const rootEl = document.getElementById("root");

function showBootError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (!rootEl) return;
  rootEl.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">
      <div style="max-width:420px">
        <h1 style="font-size:20px;margin:0 0 12px">SafeNex 시작 오류</h1>
        <p style="margin:0 0 16px;line-height:1.5;color:#cbd5e1">앱 설정이 불완전합니다. 관리자에게 새 버전 설치를 요청하세요.</p>
        <pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;background:#1e293b;padding:12px;border-radius:8px">${message.replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c] as string))}</pre>
      </div>
    </div>
  `;
}

async function boot() {
  try {
    // Native: OTA before login UI. Web: skip.
    if (isNativeApp()) {
      const gate = await runBootOtaGate({ preferImmediate: true, paint: true });
      if (gate.phase === "applying") {
        // Capgo set() should reload; if it didn't, fall through to app after splash wait.
        console.warn("[boot] OTA apply did not reload — continuing to app");
      }
      await runBootStoreGate();
    }

    const { default: App } = await import("./App.tsx");
    createRoot(rootEl!).render(<App />);
    registerSWSafely();
    // Resume / foreground checks only (boot already handled above)
    initOtaUpdater();
  } catch (err) {
    console.error("[boot]", err);
    showBootError(err);
  }
}

void boot();
