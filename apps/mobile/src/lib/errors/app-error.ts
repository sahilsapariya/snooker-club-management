/**
 * A single error shape for the whole app.
 *
 * The split that matters: `message` is written for the person holding the
 * phone, `technicalMessage` is written for us and never reaches the screen.
 * Raw Postgres text ("new row violates row-level security policy for table
 * \"sessions\"") tells an attacker about the schema and tells a receptionist
 * nothing useful.
 */
export type AppErrorCode =
  | 'network'
  | 'timeout'
  | 'auth/invalid-credentials'
  | 'auth/session-expired'
  | 'auth/email-not-confirmed'
  | 'auth/rate-limited'
  | 'auth/account-disabled'
  | 'auth/no-tenant'
  | 'permission-denied'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'config'
  | 'unknown';

export interface AppErrorOptions {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly technicalMessage?: string;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
  /** Whether retrying the same action could plausibly succeed. */
  readonly retryable?: boolean;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly technicalMessage: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.technicalMessage = options.technicalMessage ?? options.message;
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(options.code);
  }

  /** Safe to render. Never includes `technicalMessage`. */
  get userMessage(): string {
    return this.message;
  }
}

const RETRYABLE_CODES = new Set<AppErrorCode>(['network', 'timeout', 'unknown']);

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
