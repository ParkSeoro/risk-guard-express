import { createRoot } from "react-dom/client";
import "./index.css";

// Canonical domain redirect: Always redirect default Vercel domain to safenex.org
if (typeof window !== "undefined" && window.location.hostname === "risk-guard-express.vercel.app") {
  window.location.replace("https://safenex.org" + window.location.pathname + window.location.search + window.location.hash);
}
import { registerSWSafely } from "./lib/registerServiceWorker";
import { initOtaUpdater } from "./lib/native/otaUpdater";
import { runBootOtaGate } from "./lib/native/bootOtaGate";
import { runBootStoreGate } from "./lib/native/bootStoreGate";
import { runPreLoginOta } from "./lib/native/preLoginOta";
import { isNativeApp } from "./lib/native/platform";
import { installStaleChunkAutoReload } from "./lib/staleChunkError";
import { installIosShareableGuard } from "./lib/iosShareableGuard";
import { installKoreanToasts } from "./lib/installKoreanToasts";
import { toKoreanWarning } from "./lib/errors";

installKoreanToasts();
installIosShareableGuard();
installStaleChunkAutoReload();

const rootEl = document.getElementById("root");

function showBootError(err: unknown) {
  const message = toKoreanWarning(err);
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
    // 네이티브: 준비 신호 후 스토어 앱 번호를 조용히 확인한다.
    // 앱이 오래됐을 때만 안내가 뜬다. 통과하면 화면 묶음을 확인하고, 새 화면일 때만 "업데이트 중".
    // 확인이 실패하거나 시간을 넘기면 로그인으로 간다. 스토어로 이동한 뒤에는 화면을 받지 않는다.
    if (isNativeApp()) {
      await runBootOtaGate({ paint: false });
      await runBootStoreGate();
      await runPreLoginOta();
    }

    const { default: App } = await import("./App.tsx");
    createRoot(rootEl!).render(<App />);
    registerSWSafely();
    // OTA download/apply after UI is up
    initOtaUpdater();
  } catch (err) {
    console.error("[boot]", err);
    showBootError(err);
  }
}

void boot();
