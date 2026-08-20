import { env, isDevelopment } from '@/constants/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const activeLevel: LogLevel = env.logLevel ?? (isDevelopment ? 'debug' : 'warn');

export interface LogContext {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  /** A logger that prefixes every line with `scope`, e.g. `auth`, `tables`. */
  child(scope: string): Logger;
}

/**
 * A deliberately small logging seam.
 *
 * The value is not the formatting - it is that every diagnostic in the app goes
 * through one place. Swapping in Sentry, a file sink, or a remote collector
 * later is then a single edit rather than a hunt for `console.log`.
 */
function emit(level: LogLevel, scope: string | null, message: string, payload?: unknown): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[activeLevel]) return;

  const label = scope ? `[${scope}] ${message}` : message;

  // eslint-disable-next-line no-console
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (payload === undefined) {
    sink(label);
  } else {
    sink(label, payload);
  }
}

function createLogger(scope: string | null): Logger {
  return {
    debug: (message, context) => emit('debug', scope, message, context),
    info: (message, context) => emit('info', scope, message, context),
    warn: (message, context) => emit('warn', scope, message, context),
    error: (message, error, context) =>
      emit('error', scope, message, {
        ...(context ?? {}),
        ...(error === undefined ? {} : { error: serializeError(error) }),
      }),
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(isDevelopment && error.stack ? { stack: error.stack } : {}),
    };
  }
  return error;
}

export const logger: Logger = createLogger(null);
