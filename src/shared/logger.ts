/**
 * Substrings that mark a metadata key as holding a credential. Keys are normalized by
 * lowercasing and dropping every non-alphanumeric character first, so `apiKey`, `api_key`,
 * `api-key`, `DATABYTE_API_KEY` and `accessToken` are all matched by containment rather
 * than by exact lookup.
 */
const SENSITIVE_KEY_FRAGMENTS = ['apikey', 'authorization', 'token', 'bearer', 'password', 'secret']

/**
 * Keys that collide with the fragments above but whose BOOLEAN value is legitimate public
 * diagnostics — `PublicSettings.hasApiKey` is part of the IPC contract. Only booleans are
 * preserved; a string smuggled under the same name is still redacted.
 */
const BOOLEAN_SAFE_KEYS = new Set(['hasapikey'])

const REDACTED = '[REDACTED]'

/** `DATABYTE_API_KEY` -> `databyteapikey`, `api-key` -> `apikey`, `ApiKey` -> `apikey`. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
}

function isBooleanCarveOut(key: string, value: unknown): boolean {
  return typeof value === 'boolean' && BOOLEAN_SAFE_KEYS.has(normalizeKey(key))
}

/** Provider API keys: `sk-...`, plus the Stripe-style `sk_live_...` / `sk_test_...` shapes. */
const PROVIDER_KEY_PATTERN = /\bsk[-_][A-Za-z0-9_-]+/g

/**
 * `Bearer <credential>` / `Basic <credential>` — keeps the scheme word, drops the credential.
 * Case-insensitive. Covers the standalone form, where no secret-shaped name precedes the
 * scheme; `ASSIGNED_SECRET_PATTERN` below covers the `Authorization: Bearer …` form.
 */
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi

/**
 * `key=value` / `key: value` for secret-shaped names, e.g. `api_key=xyz`, `token: xyz`.
 * The value class has a dedicated `<scheme> <credential>` branch, tried BEFORE the generic
 * token branch, so `Authorization: Bearer eyJ…` is consumed as one unit. Without it the
 * generic branch would stop at the scheme word and leave the credential standing.
 */
const ASSIGNED_SECRET_PATTERN =
  /\b(api[_-]?key|authorization|token|secret|password)(\s*[=:]\s*)("(?:[^"]*)"|'(?:[^']*)'|(Bearer|Basic)\s+[^\s,;]+|[^\s,;]+)/gi

/**
 * Removes secret-shaped substrings from free text. Used for string metadata values, for
 * `Error` messages/stacks, and for the log message argument — all places where diagnostic
 * text we cannot key-match might carry a credential.
 */
function scrubSecrets(text: string): string {
  return text
    .replace(
      ASSIGNED_SECRET_PATTERN,
      (_match: string, name: string, separator: string, _value: string, scheme: string | undefined) =>
        scheme === undefined
          ? `${name}${separator}${REDACTED}`
          : `${name}${separator}${scheme} ${REDACTED}`
    )
    .replace(AUTH_SCHEME_PATTERN, `$1 ${REDACTED}`)
    .replace(PROVIDER_KEY_PATTERN, REDACTED)
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

/**
 * Rebuilds `value` with sensitive data replaced. `seen` holds only the objects on the
 * current recursion path, so a shared object reached twice by different properties is
 * expanded both times and only a real back-edge is reported as `[Circular]`.
 */
function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubSecrets(value)
  if (value instanceof Date) {
    // An invalid Date throws on toISOString(); never let the logger itself throw and mask
    // the error the caller was trying to report.
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString()
  }
  if (value instanceof Error) {
    return {
      name: scrubSecrets(value.name),
      message: scrubSecrets(value.message),
      stack: value.stack === undefined ? null : scrubSecrets(value.stack)
    }
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    let out: unknown
    if (Array.isArray(value)) {
      out = (value as unknown[]).map((item) => walk(item, seen))
    } else {
      const source = value as Record<string, unknown>
      const rebuilt: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(source)) {
        rebuilt[key] = isBooleanCarveOut(key, val)
          ? val
          : isSensitiveKey(key)
            ? REDACTED
            : walk(val, seen)
      }
      out = rebuilt
    }
    seen.delete(value)
    return out
  }
  return value
}

function redact(value: unknown): unknown {
  return walk(value, new WeakSet<object>())
}

export function createLogger(scope: string): Logger {
  const emit = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => {
    const payload = meta === undefined ? '' : ` ${JSON.stringify(redact(meta))}`
    console.log(`[${scope}] ${level}: ${scrubSecrets(message)}${payload}`)
  }
  return {
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta)
  }
}

export const logger = createLogger('app')
