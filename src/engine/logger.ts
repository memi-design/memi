/**
 * Structured logger for Mémoire engine.
 */

import pino from "pino";

let prettyTransport: ReturnType<typeof pino.transport> | undefined;

export function shouldUsePrettyTransport(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.VITEST === "true") return false;
  if (process.env.MEMOIRE_STUDIO_MANAGED_BY === "tauri") return false;
  if (import.meta.url.includes("$bunfs") || import.meta.url.startsWith("embedded:") || import.meta.url.startsWith("compiled:")) {
    return false;
  }
  return true;
}

function getPrettyTransport() {
  if (!shouldUsePrettyTransport()) return undefined;
  if (!prettyTransport) {
    try {
      prettyTransport = pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      });
    } catch {
      return undefined;
    }
  }
  return prettyTransport;
}

export function createLogger(name: string) {
  const options = {
    name,
    level: process.env.MEMOIRE_LOG_LEVEL ?? process.env.NOCHE_LOG_LEVEL ?? "warn",
  };
  const transport = getPrettyTransport();
  return transport ? pino(options, transport) : pino(options);
}
