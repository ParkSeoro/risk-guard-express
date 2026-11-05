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

let mainWindow = null;
let tray = null;
let isQuitting = false;
let minimizeToTrayOnClose = true;
let localServer = null;
let localPort = 0;

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

function startLocalServer(distDir) {
  return new Promise((resolve) => {
    if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, "index.html"))) {
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

        let filePath = path.normalize(path.join(distDir, urlPath));

        if (!filePath.startsWith(path.normalize(distDir))) {
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
            const indexPath = path.join(distDir, "index.html");
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

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      localServer = server;
      localPort = port;
      resolve(port);
    });

    server.on("error", () => {
      resolve(0);
    });
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
        label: "카톡 미니모드 (420px)",
        click: () => {
          if (mainWindow) {
            resizeWindowSmart(420, 680);
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

function resizeWindowSmart(reqWidth, reqHeight) {
  if (!mainWindow) return;
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  // Constrain requested size to fit comfortably within the monitor work area
  const targetW = Math.min(Math.max(360, reqWidth), workArea.width - 20);
  const targetH = Math.min(Math.max(520, reqHeight), workArea.height - 20);

  const curBounds = mainWindow.getBounds();
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
}

async function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const width = 420;
  const height = Math.min(680, workArea.height - 30);
  const posX = Math.max(workArea.x + 16, workArea.x + workArea.width - width - 20);
  const posY = Math.max(workArea.y + 16, workArea.y + workArea.height - height - 20);

  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width,
    height,
    x: posX,
    y: posY,
    minWidth: 360,
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
    resizeWindowSmart(420, 680);
  } else {
    resizeWindowSmart(1260, 820);
  }
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
