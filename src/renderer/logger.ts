const prefix = "[vibe-sampler:renderer]";

export function logInfo(message: string, detail?: unknown): void {
  write("info", message, detail);
}

export function logWarn(message: string, detail?: unknown): void {
  write("warn", message, detail);
}

export function logError(message: string, detail?: unknown): void {
  write("error", message, detail);
}

export function installRendererErrorLogging(): void {
  window.addEventListener("error", (event) => {
    logError("Unhandled window error", {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: serializeError(event.error)
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    logError("Unhandled promise rejection", serializeError(event.reason));
  });

  logInfo("Renderer error logging installed", {
    location: window.location.href,
    userAgent: navigator.userAgent
  });
}

function write(level: "info" | "warn" | "error", message: string, detail?: unknown): void {
  const args = [`${prefix} ${message}`];
  if (detail !== undefined) {
    args.push(formatDetail(detail));
  }

  if (level === "error") {
    console.error(...args);
    return;
  }

  if (level === "warn") {
    console.warn(...args);
    return;
  }

  console.info(...args);
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return JSON.stringify(serializeError(detail));
  }

  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return error;
}
