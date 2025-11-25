import type { LogLevel } from "./Types";

const LOG_LEVELS: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

/**
 * Basic Logger that allows logging messages based on log level.
 */
export class Logger {
  private logLevel: LogLevel;

  constructor(logLevel: LogLevel = "WARN") {
    this.logLevel = logLevel;
  }

  setLevel(level: LogLevel) {
    this.logLevel = level;
  }

  error(...args: unknown[]) {
    if (LOG_LEVELS[this.logLevel] >= LOG_LEVELS.ERROR) {
      console.error(...args);
    }
  }

  warn(...args: unknown[]) {
    if (LOG_LEVELS[this.logLevel] >= LOG_LEVELS.WARN) {
      console.warn(...args);
    }
  }

  info(...args: unknown[]) {
    if (LOG_LEVELS[this.logLevel] >= LOG_LEVELS.INFO) {
      console.info(...args);
    }
  }

  debug(...args: unknown[]) {
    if (LOG_LEVELS[this.logLevel] >= LOG_LEVELS.DEBUG) {
      if (console.debug) {
        console.debug(...args);
      } else {
        console.log(...args);
      }
    }
  }
}
