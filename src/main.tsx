import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSWSafely } from "./lib/registerServiceWorker";
import { initOtaUpdater } from "./lib/native/otaUpdater";

createRoot(document.getElementById("root")!).render(<App />);

// 푸시 알림용 Service Worker 등록 (preview/dev에서는 자동 차단)
registerSWSafely();

// 네이티브 앱일 때만 OTA 자동 업데이트 체크 (웹/프리뷰에서는 no-op)
initOtaUpdater();
