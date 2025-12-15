export type LogLevel = "debug" | "info" | "warn" | "error";

const isDev = process.env.NODE_ENV === "development";
const debugEnabled = process.env.DEBUG === "true";

const sensitiveKeys = [
  "password",
  "token",
  "secret",
  "key",
  "authorization",
  "signature",
  "bearer",
];

function shouldLog(level: LogLevel): boolean {
  if (level === "error" || level === "warn") {
    return true;
  }
  return isDev || debugEnabled;
}

function sanitize(data: unknown, depth = 0): unknown {
  if (depth > 10) {
    return "[MAX_DEPTH]";
  }

  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== "object") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).map(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
        return [key, "[REDACTED]"];
      }
      return [key, sanitize(value, depth + 1)];
    })
  );
}

function formatLog(level: LogLevel, message: string) {
  const prefix = `[${level.toUpperCase()}]`;
  return `${prefix} ${message}`;
}

function sanitizeMeta(level: LogLevel, meta: unknown[]) {
  return meta.map((item) => {
    if (level === "error" && isDev) {
      return item;
    }
    return sanitize(item);
  });
}

function log(level: LogLevel, message: string, ...meta: unknown[]) {
  if (!shouldLog(level)) {
    return;
  }
  const sanitizedArgs = sanitizeMeta(level, meta).filter((item) => item !== undefined);
  const formatted = formatLog(level, message);
  const target =
    level === "warn"
      ? console.warn
      : level === "error"
      ? console.error
      : console.log;

  if (sanitizedArgs.length) {
    target(formatted, ...sanitizedArgs);
  } else {
    target(formatted);
  }
}

export const logger = {
  debug(message: string, ...meta: unknown[]) {
    log("debug", message, ...meta);
  },
  info(message: string, ...meta: unknown[]) {
    log("info", message, ...meta);
  },
  warn(message: string, ...meta: unknown[]) {
    log("warn", message, ...meta);
  },
  error(message: string, ...meta: unknown[]) {
    log("error", message, ...meta);
  },
};
