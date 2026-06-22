import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSWSafely } from "./lib/registerServiceWorker";

createRoot(document.getElementById("root")!).render(<App />);

// 푸시 알림용 Service Worker 등록 (preview/dev에서는 자동 차단)
registerSWSafely();
