import { app, BrowserWindow, ipcMain, session } from "electron";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

const rendererDevServerUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(rendererDevServerUrl);
let logFilePath: string | null = null;

type LibraryPitch = { frequency: number; note: string; cents: number } | null;
type LibrarySample = {
  slot: number;
  name: string;
  fileName: string;
  detectedPitch: LibraryPitch;
  pitchSemitones: number;
  trimStart?: number;
  trimEnd?: number;
  envelope?: {
    attack: number;
    release: number;
    attackLevel?: number;
    releaseLevel?: number;
  };
};
type LibraryBankManifest = { id: string; name: string; samples: LibrarySample[] };
type CloudCatalogSample = Omit<LibrarySample, "fileName"> & { object: string };
type CloudCatalog = {
  version: 1;
  banks: Array<{ id: string; name: string; samples: CloudCatalogSample[] }>;
};

const cloudSampleCatalogUrl = "https://storage.googleapis.com/vibe-sampler-samples/catalog.json";

app.commandLine.appendSwitch("audio-buffer-size", "64");

function log(level: "info" | "warn" | "error", message: string, detail?: unknown): void {
  const line = `[vibe-sampler:main] ${new Date().toISOString()} ${level.toUpperCase()} ${message}${
    detail === undefined ? "" : ` ${formatDetail(detail)}`
  }`;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }

  if (logFilePath) {
    try {
      appendFileSync(logFilePath, `${line}\n`);
    } catch (error) {
      console.error("[vibe-sampler:main] Could not write log file", error);
    }
  }
}

function formatDetail(detail: unknown): string {
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

function resolvePreloadPath(): string {
  const candidates = [join(__dirname, "../preload/preload.js"), join(__dirname, "../preload/preload.mjs")];
  const preloadPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  log("info", "Resolved preload path", {
    preloadPath,
    exists: existsSync(preloadPath),
    candidates: candidates.map((candidate) => ({ path: candidate, exists: existsSync(candidate) }))
  });
  return preloadPath;
}

function getSampleLibraryRoot(): string {
  const root = join(app.getPath("userData"), "samples");
  mkdirSync(root, { recursive: true });
  return root;
}

function safeId(value: string): string {
  const id = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/[ _]+/g, "-")
    .toLowerCase();
  if (!id) {
    throw new Error("A bank or sample name is required");
  }
  return id;
}

function bankDirectory(bankId: string): string {
  return join(getSampleLibraryRoot(), safeId(bankId));
}

function readBankManifest(bankId: string): LibraryBankManifest {
  const directory = bankDirectory(bankId);
  const manifestPath = join(directory, "bank.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Unknown user bank: ${bankId}`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as LibraryBankManifest;
}

function writeBankManifest(manifest: LibraryBankManifest): void {
  const directory = bankDirectory(manifest.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "bank.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function listUserBanks(): LibraryBankManifest[] {
  const root = getSampleLibraryRoot();
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [readBankManifest(entry.name)];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function onboardingPreferencePath(): string {
  return join(app.getPath("userData"), "cloud-samples.json");
}

function readOnboardingDecision(): "accepted" | "declined" | null {
  try {
    const stored = JSON.parse(readFileSync(onboardingPreferencePath(), "utf8")) as { decision?: unknown };
    return stored.decision === "accepted" || stored.decision === "declined" ? stored.decision : null;
  } catch {
    return null;
  }
}

function writeOnboardingDecision(decision: "accepted" | "declined"): void {
  writeFileSync(onboardingPreferencePath(), JSON.stringify({ decision }, null, 2), "utf8");
}

async function fetchCloudCatalog(): Promise<CloudCatalog> {
  const response = await fetch(cloudSampleCatalogUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Starter sample catalog returned HTTP ${response.status}`);
  }
  const catalog = (await response.json()) as CloudCatalog;
  if (catalog.version !== 1 || !Array.isArray(catalog.banks) || catalog.banks.length > 32) {
    throw new Error("Starter sample catalog is invalid");
  }
  for (const bank of catalog.banks) {
    safeId(bank.id);
    if (!bank.name?.trim() || !Array.isArray(bank.samples) || bank.samples.length > 8) {
      throw new Error("Starter sample bank is invalid");
    }
    for (const sample of bank.samples) {
      if (!Number.isInteger(sample.slot) || sample.slot < 0 || sample.slot > 7 || !sample.name?.trim()) {
        throw new Error("Starter sample entry is invalid");
      }
      const objectUrl = new URL(sample.object, cloudSampleCatalogUrl);
      if (objectUrl.origin !== new URL(cloudSampleCatalogUrl).origin || !objectUrl.pathname.toLowerCase().endsWith(".wav")) {
        throw new Error("Starter sample URL is invalid");
      }
    }
  }
  return catalog;
}

async function importCloudSamples(): Promise<LibraryBankManifest[]> {
  const catalog = await fetchCloudCatalog();
  const imported: LibraryBankManifest[] = [];
  try {
    for (const cloudBank of catalog.banks) {
      const baseId = `starter-${safeId(cloudBank.id)}`;
      let id = baseId;
      let suffix = 2;
      while (existsSync(bankDirectory(id))) {
        id = `${baseId}-${suffix++}`;
      }
      const temporaryDirectory = join(getSampleLibraryRoot(), `.${id}-${Date.now()}`);
      mkdirSync(temporaryDirectory, { recursive: true });
      try {
      const samples: LibrarySample[] = [];
      for (const cloudSample of cloudBank.samples) {
        const objectUrl = new URL(cloudSample.object, cloudSampleCatalogUrl);
        const response = await fetch(objectUrl, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) {
          throw new Error(`Could not download ${cloudSample.name} (HTTP ${response.status})`);
        }
        const wavData = new Uint8Array(await response.arrayBuffer());
        const isWav = wavData.byteLength >= 12 &&
          new TextDecoder("ascii").decode(wavData.slice(0, 4)) === "RIFF" &&
          new TextDecoder("ascii").decode(wavData.slice(8, 12)) === "WAVE";
        if (!isWav || wavData.byteLength > 50 * 1024 * 1024) {
          throw new Error(`Invalid WAV data for ${cloudSample.name}`);
        }
        const fileName = `${String(cloudSample.slot + 1).padStart(2, "0")}-${safeId(cloudSample.name)}.wav`;
        writeFileSync(join(temporaryDirectory, fileName), wavData);
        samples.push({
          slot: cloudSample.slot,
          name: cloudSample.name.trim(),
          fileName,
          detectedPitch: cloudSample.detectedPitch ?? null,
          pitchSemitones: cloudSample.pitchSemitones ?? 0,
          trimStart: cloudSample.trimStart,
          trimEnd: cloudSample.trimEnd,
          envelope: cloudSample.envelope
        });
      }
        const manifest: LibraryBankManifest = { id, name: cloudBank.name.trim(), samples };
        writeFileSync(join(temporaryDirectory, "bank.json"), JSON.stringify(manifest, null, 2), "utf8");
        renameSync(temporaryDirectory, bankDirectory(id));
        imported.push(manifest);
      } catch (error) {
        rmSync(temporaryDirectory, { recursive: true, force: true });
        throw error;
      }
    }
    writeOnboardingDecision("accepted");
    return imported;
  } catch (error) {
    imported.forEach((bank) => rmSync(bankDirectory(bank.id), { recursive: true, force: true }));
    throw error;
  }
}

function registerSampleLibraryIpc(): void {
  ipcMain.handle("sample-library:list", () => ({ root: getSampleLibraryRoot(), banks: listUserBanks() }));
  ipcMain.handle("sample-library:create-bank", (_event, requestedName: string) => {
    const name = requestedName.trim();
    const baseId = safeId(name);
    let id = baseId;
    let suffix = 2;
    while (existsSync(bankDirectory(id))) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const manifest: LibraryBankManifest = { id, name, samples: [] };
    writeBankManifest(manifest);
    return manifest;
  });
  ipcMain.handle("cloud-samples:onboarding", async () => {
    if (readOnboardingDecision()) {
      return { shouldPrompt: false, banks: [] };
    }
    const catalog = await fetchCloudCatalog();
    return {
      shouldPrompt: true,
      banks: catalog.banks.map((bank) => ({ name: bank.name, sampleCount: bank.samples.length }))
    };
  });
  ipcMain.handle("cloud-samples:decline", () => writeOnboardingDecision("declined"));
  ipcMain.handle("cloud-samples:import", () => importCloudSamples());
  ipcMain.handle("sample-library:load-bank", (_event, bankId: string) => {
    const manifest = readBankManifest(bankId);
    const directory = bankDirectory(bankId);
    return {
      ...manifest,
      samples: manifest.samples.map((sample) => ({
        ...sample,
        data: new Uint8Array(readFileSync(join(directory, sample.fileName)))
      }))
    };
  });
  ipcMain.handle(
    "sample-library:save-sample",
    (
      _event,
      input: {
        bankId: string;
        slot: number;
        name: string;
        wavData: Uint8Array;
        detectedPitch: LibraryPitch;
        pitchSemitones: number;
        trimStart?: number;
        trimEnd?: number;
        envelope?: LibrarySample["envelope"];
      }
    ) => {
      const manifest = readBankManifest(input.bankId);
      if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot > 7) {
        throw new Error("Sample slot must be between 0 and 7");
      }
      const baseFileName = `${safeId(input.name)}.wav`;
      const collidesWithAnotherSlot = manifest.samples.some(
        (item) => item.slot !== input.slot && item.fileName.toLowerCase() === baseFileName.toLowerCase()
      );
      const fileName = collidesWithAnotherSlot ? `${safeId(input.name)}-${input.slot + 1}.wav` : baseFileName;
      writeFileSync(join(bankDirectory(manifest.id), fileName), Buffer.from(input.wavData));
      const sample: LibrarySample = {
        slot: input.slot,
        name: input.name.trim(),
        fileName,
        detectedPitch: input.detectedPitch,
        pitchSemitones: input.pitchSemitones,
        trimStart: input.trimStart,
        trimEnd: input.trimEnd,
        envelope: input.envelope
      };
      manifest.samples = [...manifest.samples.filter((item) => item.slot !== input.slot), sample].sort(
        (left, right) => left.slot - right.slot
      );
      writeBankManifest(manifest);
      return manifest;
    }
  );
  ipcMain.handle(
    "sample-library:set-pitch",
    (_event, input: { bankId: string; slot: number; pitchSemitones: number }) => {
      const manifest = readBankManifest(input.bankId);
      const sample = manifest.samples.find((item) => item.slot === input.slot);
      if (!sample) {
        throw new Error("No library sample in this slot");
      }
      sample.pitchSemitones = Math.max(-24, Math.min(24, input.pitchSemitones));
      writeBankManifest(manifest);
      return manifest;
    }
  );
  ipcMain.handle(
    "sample-library:set-edit",
    (
      _event,
      input: {
        bankId: string;
        slot: number;
        trimStart: number;
        trimEnd: number;
        envelope: NonNullable<LibrarySample["envelope"]>;
      }
    ) => {
      const manifest = readBankManifest(input.bankId);
      const sample = manifest.samples.find((item) => item.slot === input.slot);
      if (!sample) {
        throw new Error("No library sample in this slot");
      }
      sample.trimStart = Math.max(0, input.trimStart);
      sample.trimEnd = Math.max(sample.trimStart + 0.001, input.trimEnd);
      sample.envelope = {
        attack: Math.max(0, input.envelope.attack),
        release: Math.max(0, input.envelope.release),
        attackLevel: Math.max(0, Math.min(1, input.envelope.attackLevel ?? 1)),
        releaseLevel: Math.max(0, Math.min(1, input.envelope.releaseLevel ?? 0))
      };
      writeBankManifest(manifest);
      return manifest;
    }
  );
}

function createWindow(): void {
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
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url !== currentUrl) {
      event.preventDefault();
      log("warn", "Blocked renderer navigation", { url });
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

  mainWindow.webContents.on("console-message", (details) => {
    const mappedLevel = details.level === "error" ? "error" : details.level === "warning" ? "warn" : "info";
    log(mappedLevel, "Renderer console", {
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId
    });
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

  registerSampleLibraryIpc();

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    permission === "media" || permission === "midi" ||
  permission === "midiSysex"
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
