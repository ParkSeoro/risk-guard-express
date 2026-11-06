/**
 * SafeNex Windows Desktop Preload Bridge (`window.safenexDesktop`)
 * Exposes safe IPC channels between the web app and the Electron Windows `.exe` shell.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("safenexDesktop", {
  isDesktopApp: true,
  platform: process.platform,
  appVersion: "1.2.0",

  resizeWindow: (w, h) => ipcRenderer.invoke("safenex:resize-window", w, h),
  openExternal: (url) => ipcRenderer.invoke("safenex:open-external", url),
  setAutoStart: (enabled) => ipcRenderer.invoke("safenex:set-auto-start", Boolean(enabled)),
  getAutoStart: () => ipcRenderer.invoke("safenex:get-auto-start"),

  setMinimizeToTray: (enabled) =>
    ipcRenderer.invoke("safenex:set-minimize-to-tray", Boolean(enabled)),

  setAlwaysOnTop: (enabled) =>
    ipcRenderer.invoke("safenex:set-always-on-top", Boolean(enabled)),

  setWindowMode: (mode) => ipcRenderer.invoke("safenex:set-window-mode", mode),

  openPopoutWindow: (opts) => ipcRenderer.invoke("safenex:open-popout", opts),

  setBadgeCount: (count) => ipcRenderer.invoke("safenex:set-badge-count", Number(count) || 0),

  flashFrame: (flash) => ipcRenderer.invoke("safenex:flash-frame", Boolean(flash)),

  minimizeWindow: () => ipcRenderer.send("safenex:window-minimize"),
  maximizeOrRestoreWindow: () => ipcRenderer.send("safenex:window-maximize"),
  hideToTray: () => ipcRenderer.send("safenex:window-hide-to-tray"),

  saveLoginMemory: (data) => ipcRenderer.invoke("safenex:save-login-memory", data),
  loadLoginMemory: () => ipcRenderer.invoke("safenex:load-login-memory"),
});
