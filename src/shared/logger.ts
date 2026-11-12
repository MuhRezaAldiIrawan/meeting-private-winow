const SENSITIVE_KEYS = new Set(['apikey', 'authorization', 'token', 'bearer', 'password', 'secret'])

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redact(val)
    }
    return out
  }
  return value
}

export function createLogger(scope: string): Logger {
  const emit = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => {
    const payload = meta === undefined ? '' : ` ${JSON.stringify(redact(meta))}`
    console.log(`[${scope}] ${level}: ${message}${payload}`)
  }
  return {
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta)
  }
}

export const logger = createLogger('app')
