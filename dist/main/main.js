import { app, session, BrowserWindow } from "electron";
import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const rendererDevServerUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(rendererDevServerUrl);
let logFilePath = null;
app.commandLine.appendSwitch("audio-buffer-size", "64");
function log(level, message, detail) {
  const line = `[vibe-sampler:main] ${(/* @__PURE__ */ new Date()).toISOString()} ${level.toUpperCase()} ${message}${detail === void 0 ? "" : ` ${formatDetail(detail)}`}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, `${line}
`);
    } catch (error) {
      console.error("[vibe-sampler:main] Could not write log file", error);
    }
  }
}
function formatDetail(detail) {
  if (detail instanceof Error) {
    return JSON.stringify({
      name: detail.name,
      message: detail.message,
      stack: detail.stack
    });
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}
function resolvePreloadPath() {
  const candidates = [join(__dirname, "../preload/preload.js"), join(__dirname, "../preload/preload.mjs")];
  const preloadPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  log("info", "Resolved preload path", {
    preloadPath,
    exists: existsSync(preloadPath),
    candidates: candidates.map((candidate) => ({ path: candidate, exists: existsSync(candidate) }))
  });
  return preloadPath;
}
function createWindow() {
  const preloadPath = resolvePreloadPath();
  log("info", "Creating browser window", {
    isDev,
    devServerUrl: rendererDevServerUrl ?? null,
    preloadPath
  });
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "Vibe Sampler",
    backgroundColor: "#101114",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (isDev && rendererDevServerUrl) {
    log("info", "Loading renderer dev server", { url: rendererDevServerUrl });
    void mainWindow.loadURL(rendererDevServerUrl).catch((error) => {
      log("error", "Failed to load renderer dev server", error);
    });
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const rendererPath = join(__dirname, "../renderer/index.html");
    log("info", "Loading renderer file", { rendererPath, exists: existsSync(rendererPath) });
    void mainWindow.loadFile(rendererPath).catch((error) => {
      log("error", "Failed to load renderer file", error);
    });
  }
  mainWindow.webContents.on("did-finish-load", () => {
    log("info", "Renderer finished loading", { url: mainWindow.webContents.getURL() });
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    log("error", "Renderer failed to load", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPathWithError, error) => {
    log("error", "Preload failed", { preloadPath: preloadPathWithError, error: formatDetail(error) });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log("error", "Renderer process gone", details);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const mappedLevel = level >= 3 ? "error" : level === 2 ? "warn" : "info";
    log(mappedLevel, "Renderer console", { message, line, sourceId });
  });
}
app.whenReady().then(async () => {
  const logDir = join(app.getPath("userData"), "logs");
  mkdirSync(logDir, { recursive: true });
  logFilePath = join(logDir, "vibe-sampler.log");
  log("info", "Application starting", {
    logFilePath,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    cwd: process.cwd(),
    dirname: __dirname,
    rendererDevServerUrl: rendererDevServerUrl ?? null
  });
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === "media" || permission === "midi" || permission === "midiSysex"
  );
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    log("info", "Permission requested", { permission });
    callback(permission === "media" || permission === "midi" || permission === "midiSysex");
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("child-process-gone", (_event, details) => {
  log("error", "Child process gone", details);
});
process.on("uncaughtException", (error) => {
  log("error", "Uncaught exception", error);
});
process.on("unhandledRejection", (reason) => {
  log("error", "Unhandled rejection", reason);
});
app.on("window-all-closed", () => {
  log("info", "All windows closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
