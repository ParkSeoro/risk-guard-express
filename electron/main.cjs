/**
 * SafeNex Windows Desktop Shell (`electron/main.cjs`)
 * - KakaoTalk / Naver Works PC-style Windows `.exe` launcher
 * - Single-instance lock, Windows Boot Auto-Start (`app.setLoginItemSettings`),
 *   System Tray resident mode, Compact (420x740) vs Expanded (1440x900) window resizing,
 *   Multi-window pop-out chat/module windows, and Taskbar unread badge / flashFrame.
 */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  shell,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");

const APP_URL =
  process.env.SAFENEX_DESKTOP_URL || "https://safenex.kr/app/admin/desktop-workspace";

let mainWindow = null;
let tray = null;
let isQuitting = false;
let minimizeToTrayOnClose = true;

// Prevent multiple instances of SafeNex Desktop
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
    path.join(__dirname, "../public/favicon.ico"),
    path.join(__dirname, "../dist/favicon.ico"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
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
        label: "SafeNex 워크스페이스 열기",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: "카톡 미니모드 (420px)로 보기",
        click: () => {
          if (mainWindow) {
            mainWindow.setSize(420, 740, true);
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: "통합 워크스페이스 (1440px)로 보기",
        click: () => {
          if (mainWindow) {
            mainWindow.setSize(1440, 900, true);
            mainWindow.center();
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
        label: "SafeNex 완전 종료",
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

function createMainWindow() {
  const { screen } = require("electron");
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const width = 410;
  const height = 740;
  const posX = Math.max(0, workArea.x + workArea.width - width - 16);
  const posY = Math.max(0, workArea.y + workArea.height - height - 16);

  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width,
    height,
    x: posX,
    y: posY,
    minWidth: 360,
    minHeight: 560,
    title: "SafeNex PC 메신저",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Append custom User-Agent token so `isWindowsDesktopApp()` detects native shell
  const defaultUA = mainWindow.webContents.getUserAgent();
  mainWindow.webContents.setUserAgent(`${defaultUA} SafeNexDesktop/1.0.0`);

  const localIndex = path.join(__dirname, "../dist/index.html");
  if (!process.env.SAFENEX_DESKTOP_URL && fs.existsSync(localIndex)) {
    mainWindow.loadFile(localIndex, { hash: "/app/admin/desktop-workspace" });
  } else {
    mainWindow.loadURL(APP_URL);
  }

  // Intercept window close (X) -> hide to system tray like KakaoTalk PC
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
    if (url.startsWith("http") && !url.includes("safenex") && !url.includes("localhost")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 460,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
        },
      },
    };
  });
}

// IPC Handlers
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
    mainWindow.setSize(420, 740, true);
  } else {
    mainWindow.setSize(1440, 900, true);
    mainWindow.center();
  }
});

ipcMain.handle("safenex:open-popout", (_event, opts) => {
  const popout = new BrowserWindow({
    width: (opts && opts.width) || 460,
    height: (opts && opts.height) || 720,
    title: (opts && opts.title) || "SafeNex",
    icon: getAppIconPath(),
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
  // Enable Windows Auto-Start by default on first install
  const currentLogin = app.getLoginItemSettings();
  if (currentLogin.openAtLogin === undefined) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
  createMainWindow();
  createTray();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});
