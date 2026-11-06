/**
 * SafeNex Windows Desktop Shell (`electron/main.cjs`)
 * - Native Electron wrapper for SafeNex PC Messenger & Groupware.
 * - Single-instance lock, System Tray resident mode (KakaoTalk PC style).
 * - Responsive dynamic window resizing (fits any DPI / laptop display without clipping).
 * - Zero Edge browser dependency, zero white gap, dark theme native background.
 * - Local zero-collision embedded static server (port 0) with SPA client routing.
 */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  shell,
  nativeImage,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const { unzipBuffer, isHttpsDownloadUrl } = require("./desktopOtaFiles.cjs");

let mainWindow = null;
let tray = null;
let isQuitting = false;
let minimizeToTrayOnClose = true;
let localServer = null;
let localPort = 0;
let activeDistDir = null;

// Test-only: run a second copy with its own data folder (does not touch the installed program).
if (process.env.SAFENEX_USER_DATA) {
  app.setPath("userData", process.env.SAFENEX_USER_DATA);
}

/**
 * Fixed local ports. The page origin (127.0.0.1:PORT) decides where the login session
 * and settings are stored. A random port every launch meant a new origin every launch,
 * so the user was logged out each time. Port 0 is only the last resort.
 */
const PREFERRED_PORTS = [38471, 38472, 38473, 38474, 0];

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, "../release-desktop/safenex.ico"),
    path.join(__dirname, "../public/favicon.ico"),
    path.join(__dirname, "../dist/favicon.ico"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function getDistDir() {
  const candidates = [
    path.join(__dirname, "../dist"),
    path.join(process.resourcesPath || "", "dist"),
    path.join(process.resourcesPath || "", "app/dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(__dirname, "../dist");
}

function userWwwDir() {
  return path.join(app.getPath("userData"), "www");
}

function pendingWwwDir() {
  return path.join(app.getPath("userData"), "www_pending");
}

/** Numeric compare of "1.1.7" / "1.1.6-202611060228". Positive when a is newer. */
function cmpVersion(a, b) {
  const pa = String(a || "0").split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b || "0").split(/[^0-9]+/).filter(Boolean).map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** A bundle received while running is swapped in here, before the window opens. */
function applyPendingBundle() {
  const pending = pendingWwwDir();
  if (!fs.existsSync(path.join(pending, "index.html"))) return;
  const dest = userWwwDir();
  const old = dest + "_old";
  try {
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(dest)) fs.renameSync(dest, old);
    fs.renameSync(pending, dest);
    fs.rmSync(old, { recursive: true, force: true });
  } catch {
    if (!fs.existsSync(dest) && fs.existsSync(old)) {
      try { fs.renameSync(old, dest); } catch { /* ignore */ }
    }
  }
}

function chooseServeDir(packagedDir) {
  applyPendingBundle();
  const userWww = userWwwDir();
  if (fs.existsSync(path.join(userWww, "index.html"))) {
    // A newer installer must win over an older downloaded bundle.
    if (cmpVersion(readBundleVersion(userWww), readBundleVersion(packagedDir)) >= 0) return userWww;
  }
  return packagedDir;
}

function readPackageVersion() {
  try {
    return String(app.getVersion() || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function readBundleVersion(dir) {
  try {
    const file = path.join(dir, "bundle-version.txt");
    if (fs.existsSync(file)) {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    }
  } catch {
    /* ignore */
  }
  return readPackageVersion();
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function downloadHttps(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    if (!isHttpsDownloadUrl(url)) {
      reject(new Error("https 주소만 받을 수 있습니다."));
      return;
    }
    const req = https.get(url, { headers: { "User-Agent": "SafeNexDesktop" } }, (incoming) => {
      const code = incoming.statusCode || 0;
      if (code >= 300 && code < 400 && incoming.headers.location) {
        incoming.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("리다이렉트가 너무 많습니다."));
          return;
        }
        downloadHttps(new URL(incoming.headers.location, url).href, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (code !== 200) {
        incoming.resume();
        reject(new Error("다운로드 실패 HTTP " + code));
        return;
      }
      const chunks = [];
      let size = 0;
      incoming.on("data", (chunk) => {
        size += chunk.length;
        if (size > 50 * 1024 * 1024) {
          req.destroy(new Error("번들이 너무 큽니다."));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
  });
}

function bundleSourceDir(dir) {
  if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (subs.length === 1 && fs.existsSync(path.join(dir, subs[0].name, "index.html"))) {
    return path.join(dir, subs[0].name);
  }
  return null;
}

async function applyDesktopOta(version, downloadUrl) {
  let staging = null;
  try {
    if (!version || !downloadUrl) {
      return { ok: false, error: "version 또는 url 파라미터가 누락되었습니다." };
    }
    const buf = await downloadHttps(downloadUrl);
    if (!buf || buf.length < 512) {
      return { ok: false, error: "다운로드된 업데이트 파일이 유효하지 않습니다." };
    }
    staging = fs.mkdtempSync(path.join(os.tmpdir(), "safenex-ota-"));
    unzipBuffer(buf, staging);
    const source = bundleSourceDir(staging);
    if (!source) {
      return { ok: false, error: "업데이트 번들에 index.html이 포함되어 있지 않습니다." };
    }
    fs.writeFileSync(path.join(source, "bundle-version.txt"), version, "utf8");
    const dest = userWwwDir();
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(source, dest, { recursive: true, force: true });
    activeDistDir = dest;
    return { ok: true, version };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "로컬 업데이트 교체 중 오류가 발생했습니다." };
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
  }
}

function startLocalServer(distDir) {
  activeDistDir = chooseServeDir(distDir);
  return new Promise((resolve) => {
    const initialDir = activeDistDir;
    if (!fs.existsSync(initialDir) || !fs.existsSync(path.join(initialDir, "index.html"))) {
      resolve(0);
      return;
    }

    const mimeTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".wav": "audio/wav",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
    };

    const server = http.createServer((req, res) => {
      try {
        const [rawPath, rawQuery] = (req.url || "/").split("?");
        const urlPath = decodeURIComponent(rawPath);
        const root = activeDistDir || initialDir;

        if (urlPath === "/__desktop/version") {
          const pendingVersion = fs.existsSync(path.join(pendingWwwDir(), "index.html"))
            ? readBundleVersion(pendingWwwDir())
            : null;
          const running = readBundleVersion(root);
          sendJson(res, 200, {
            ok: true,
            appVersion: readPackageVersion(),
            // Report the stored bundle so the page does not download it again before restart.
            bundleVersion: pendingVersion && cmpVersion(pendingVersion, running) > 0 ? pendingVersion : running,
            runningBundleVersion: running,
            pendingVersion,
          });
          return;
        }

        if (urlPath === "/__desktop/apply-ota") {
          const searchParams = new URLSearchParams(rawQuery || "");
          void applyDesktopOta(searchParams.get("version") || "", searchParams.get("url") || "")
            .then((result) => sendJson(res, 200, result));
          return;
        }

        if (urlPath === "/__desktop/stage-ota") {
          if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "POST로 보내야 합니다." });
            return;
          }
          const version = new URLSearchParams(rawQuery || "").get("version") || "";
          const chunks = [];
          let size = 0;
          let tooBig = false;
          req.on("data", (chunk) => {
            size += chunk.length;
            if (size > 80 * 1024 * 1024) {
              tooBig = true;
              return;
            }
            chunks.push(chunk);
          });
          req.on("end", () => {
            let staging = null;
            try {
              if (tooBig) {
                sendJson(res, 413, { ok: false, error: "업데이트 파일이 너무 큽니다." });
                return;
              }
              const buf = Buffer.concat(chunks);
              if (!version || buf.length < 512) {
                sendJson(res, 400, { ok: false, error: "업데이트 파일이 올바르지 않습니다." });
                return;
              }
              staging = fs.mkdtempSync(path.join(os.tmpdir(), "safenex-stage-"));
              unzipBuffer(buf, staging);
              const source = bundleSourceDir(staging);
              if (!source) {
                sendJson(res, 400, { ok: false, error: "업데이트 파일에 화면 시작 파일이 없습니다." });
                return;
              }
              fs.writeFileSync(path.join(source, "bundle-version.txt"), version, "utf8");
              // Never overwrite files that the open window is using. Swap at next start.
              const pending = pendingWwwDir();
              fs.rmSync(pending, { recursive: true, force: true });
              fs.mkdirSync(pending, { recursive: true });
              fs.cpSync(source, pending, { recursive: true, force: true });
              sendJson(res, 200, { ok: true, pending: true, version });
            } catch (err) {
              sendJson(res, 500, { ok: false, error: "업데이트 파일을 저장하지 못했습니다." });
            } finally {
              if (staging) {
                try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
              }
            }
          });
          return;
        }

        if (urlPath === "/__desktop/restart") {
          sendJson(res, 200, { ok: true });
          setTimeout(() => {
            isQuitting = true;
            app.relaunch();
            app.exit(0);
          }, 300);
          return;
        }

        // Native open-external bridge for legacy endpoints & direct fetch
        if (urlPath === "/__desktop/open-external") {
          const searchParams = new URLSearchParams(rawQuery || "");
          const targetUrl = searchParams.get("url");
          if (targetUrl && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
            void shell.openExternal(targetUrl);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
        }

        let filePath = path.normalize(path.join(root, urlPath));

        if (!filePath.startsWith(path.normalize(root))) {
          res.writeHead(403);
          res.end();
          return;
        }

        fs.stat(filePath, (err, stats) => {
          if (!err && stats.isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = mimeTypes[ext] || "application/octet-stream";
            res.writeHead(200, {
              "Content-Type": contentType,
              "Cache-Control": "no-cache",
            });
            fs.createReadStream(filePath).pipe(res);
          } else {
            // SPA Fallback: serve index.html for all client routes (/app/admin/...)
            const indexPath = path.join(root, "index.html");
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
            });
            fs.createReadStream(indexPath).pipe(res);
          }
        });
      } catch {
        res.writeHead(500);
        res.end();
      }
    });

    function tryNextPort(idx) {
      if (idx >= PREFERRED_PORTS.length) {
        resolve(0);
        return;
      }
      const p = PREFERRED_PORTS[idx];
      const onError = () => {
        server.removeListener("listening", onListening);
        tryNextPort(idx + 1);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const addr = server.address();
        const actualPort = addr && typeof addr === "object" ? addr.port : p;
        localServer = server;
        localPort = actualPort;
        resolve(actualPort);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, "127.0.0.1");
    }

    tryNextPort(0);
  });
}

function createTray() {
  const iconPath = getAppIconPath();
  const trayIcon = iconPath
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
  tray.setToolTip("SafeNex PC 안전관리 메신저");

  const rebuildTrayMenu = () => {
    const loginSettings = app.getLoginItemSettings();
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "SafeNex 열기",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: "메신저 콤팩트 모드 (520px)",
        click: () => {
          if (mainWindow) {
            resizeWindowSmart(520, 780);
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: "업무 모드 (전체)",
        click: () => {
          if (mainWindow) {
            resizeWindowSmart(1260, 820);
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: "separator" },
      {
        label: "윈도우 시작 시 자동 실행",
        type: "checkbox",
        checked: Boolean(loginSettings.openAtLogin),
        click: (menuItem) => {
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked,
            openAsHidden: false,
          });
        },
      },
      { type: "separator" },
      {
        label: "SafeNex 종료",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  rebuildTrayMenu();
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function loginMemoryFile() {
  return path.join(app.getPath("userData"), "saved_account.json");
}

function windowStateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadSavedWindowState() {
  try {
    const f = windowStateFile();
    if (fs.existsSync(f)) {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return null;
}

let saveBoundsTimer = null;
function saveWindowStateDebounced() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const isMax = mainWindow.isMaximized();
      const bounds = mainWindow.getNormalBounds();
      fs.writeFileSync(
        windowStateFile(),
        JSON.stringify({ ...bounds, isMaximized: isMax }),
        "utf8",
      );
    } catch {
      /* ignore */
    }
  }, 400);
}

function resizeWindowSmart(reqWidth, reqHeight) {
  if (!mainWindow) return;
  const curBounds = mainWindow.getBounds();
  // 듀얼/트리플 모니터 지원: 창이 현재 위치해 있는 모니터를 정확히 감지
  const currentDisplay = screen.getDisplayMatching(curBounds);
  const workArea = currentDisplay ? currentDisplay.workArea : screen.getPrimaryDisplay().workArea;

  // 메신저 콤팩트 모드도 최소 480px 이상을 보장하여 버튼/텍스트 잘림 방지
  const targetW = Math.min(Math.max(480, reqWidth), workArea.width - 20);
  const targetH = Math.min(Math.max(520, reqHeight), workArea.height - 20);

  const curRight = curBounds.x + curBounds.width;
  let nextX = curRight - targetW;
  if (nextX + targetW > workArea.x + workArea.width - 12) {
    nextX = workArea.x + workArea.width - targetW - 16;
  }
  if (nextX < workArea.x + 12) {
    nextX = workArea.x + 16;
  }

  let nextY = curBounds.y;
  if (nextY + targetH > workArea.y + workArea.height - 12) {
    nextY = Math.max(workArea.y + 16, workArea.y + workArea.height - targetH - 16);
  }
  if (nextY < workArea.y + 12) {
    nextY = workArea.y + 16;
  }

  mainWindow.setBounds({ x: nextX, y: nextY, width: targetW, height: targetH }, true);
  saveWindowStateDebounced();
}

async function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const savedState = loadSavedWindowState();

  // 기본 메신저 모드: 520 × 780 (상단 셀렉트 + 버튼이 넉넉하게 들어가는 최적 사이즈)
  let width = 520;
  let height = Math.min(780, workArea.height - 30);
  let posX = Math.max(workArea.x + 16, workArea.x + workArea.width - width - 20);
  let posY = Math.max(workArea.y + 16, workArea.y + workArea.height - height - 20);

  if (savedState && typeof savedState.width === "number" && typeof savedState.height === "number") {
    const legacyMessenger = savedState.width === 420 && savedState.height === 680;
    const savedWidth = legacyMessenger ? 520 : savedState.width;
    const savedHeight = legacyMessenger ? 780 : savedState.height;
    width = Math.min(Math.max(480, savedWidth), workArea.width - 20);
    height = Math.min(Math.max(520, savedHeight), workArea.height - 20);
    if (typeof savedState.x === "number" && typeof savedState.y === "number") {
      posX = Math.min(Math.max(workArea.x + 10, savedState.x), workArea.x + workArea.width - width - 10);
      posY = Math.min(Math.max(workArea.y + 10, savedState.y), workArea.y + workArea.height - height - 10);
    }
  }

  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width,
    height,
    x: posX,
    y: posY,
    minWidth: 460,
    minHeight: 520,
    title: "SafeNex PC 메신저",
    icon: iconPath,
    backgroundColor: "#1e2229", // Seamless dark background (no white flash/gap!)
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (savedState && savedState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on("resize", saveWindowStateDebounced);
  mainWindow.on("move", saveWindowStateDebounced);

  const defaultUA = mainWindow.webContents.getUserAgent();
  mainWindow.webContents.setUserAgent(`${defaultUA} SafeNexDesktop/1.2.0`);

  // Start local ephemeral static server
  const distDir = getDistDir();
  const port = await startLocalServer(distDir);

  // 패키지에 번들된 최신 로컬 에셋(127.0.0.1:port)을 1순위로 로드하여 지연 없이 최신 기능 100% 보장
  const startUrl =
    process.env.SAFENEX_DESKTOP_URL ||
    (port > 0
      ? `http://127.0.0.1:${port}/app/admin/desktop-workspace`
      : "https://safenex.org/app/admin/desktop-workspace");

  void mainWindow.loadURL(startUrl);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && minimizeToTrayOnClose) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("focus", () => {
    mainWindow.flashFrame(false);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 내부 팝아웃 창 요청(popout=1)만 별도 Electron 창으로 생성
    if (url.includes("popout=1")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 460,
          height: 720,
          backgroundColor: "#1e2229",
          autoHideMenuBar: true,
          webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
          },
        },
      };
    }

    // 그 외 모든 링크(웹 사이트 바로가기, 외부 링크 등)는 OS 기본 브라우저(Edge, Chrome 등) 전체 창으로 열림
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

// IPC Handlers
ipcMain.handle("safenex:open-external", async (_event, targetUrl) => {
  if (typeof targetUrl === "string" && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
    await shell.openExternal(targetUrl);
    return true;
  }
  return false;
});
ipcMain.handle("safenex:resize-window", (_event, width, height) => {
  resizeWindowSmart(width, height);
});

ipcMain.handle("safenex:set-auto-start", (_event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: false,
  });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("safenex:get-auto-start", () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("safenex:set-minimize-to-tray", (_event, enabled) => {
  minimizeToTrayOnClose = Boolean(enabled);
  return minimizeToTrayOnClose;
});

ipcMain.handle("safenex:set-always-on-top", (_event, enabled) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(Boolean(enabled));
  }
  return Boolean(enabled);
});

ipcMain.handle("safenex:set-window-mode", (_event, mode) => {
  if (!mainWindow) return;
  if (mode === "compact") {
    resizeWindowSmart(520, 780);
  } else {
    resizeWindowSmart(1260, 820);
  }
});

ipcMain.handle("safenex:save-login-memory", (_event, data) => {
  try {
    fs.writeFileSync(loginMemoryFile(), JSON.stringify(data || {}), "utf8");
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("safenex:load-login-memory", () => {
  try {
    const f = loginMemoryFile();
    if (fs.existsSync(f)) {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return null;
});

ipcMain.handle("safenex:open-popout", (_event, opts) => {
  const popout = new BrowserWindow({
    width: (opts && opts.width) || 460,
    height: (opts && opts.height) || 720,
    title: (opts && opts.title) || "SafeNex",
    icon: getAppIconPath(),
    backgroundColor: "#1e2229",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (opts && opts.url) {
    popout.loadURL(opts.url);
  }
});

ipcMain.handle("safenex:set-badge-count", (_event, count) => {
  const num = Math.max(0, Number(count) || 0);
  if (typeof app.setBadgeCount === "function") {
    app.setBadgeCount(num);
  }
  if (tray) {
    tray.setToolTip(
      num > 0
        ? `SafeNex PC 안전관리 메신저 (미확인 알림 ${num}건)`
        : "SafeNex PC 안전관리 메신저",
    );
  }
});

ipcMain.handle("safenex:flash-frame", (_event, flash) => {
  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(Boolean(flash));
  }
});

ipcMain.on("safenex:window-minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on("safenex:window-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on("safenex:window-hide-to-tray", () => {
  if (mainWindow) mainWindow.hide();
});

app.whenReady().then(() => {
  const currentLogin = app.getLoginItemSettings();
  if (currentLogin.openAtLogin === undefined) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
  void createMainWindow();
  createTray();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (localServer) {
    try {
      localServer.close();
    } catch {}
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});
