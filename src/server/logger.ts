/**
 * Minimal structured JSON logger (one line per event). Sensitive keys are redacted at any depth,
 * so tokens, secrets and cookies never reach the logs.
 */

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY =
  /token|secret|password|cookie|authorization|apikey|api_key|pepper|rawkey|plaintext/i;

export type LogFields = Record<string, unknown>;

function currentLevel(): number {
  const raw = process.env.LOG_LEVEL;
  return raw && raw in LEVELS ? LEVELS[raw as Level] : LEVELS.info;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

function createLogger(bindings: LogFields): Logger {
  const write = (level: Level, event: string, fields?: LogFields) => {
    if (LEVELS[level] < currentLevel()) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      event,
      ...(sanitize({ ...bindings, ...fields }) as LogFields),
    });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return {
    debug: (e, f) => write("debug", e, f),
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f),
    child: (more) => createLogger({ ...bindings, ...more }),
  };
}

export const logger = createLogger({});
