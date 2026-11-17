import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLogger } from './logger'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Run `emit` against a fresh logger and return everything it printed as one string. */
function captureLog(emit: (logger: ReturnType<typeof createLogger>) => void): string {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  emit(createLogger('main'))
  return spy.mock.calls.map((c) => c.join(' ')).join('\n')
}

describe('createLogger', () => {
  it('redacts apiKey from metadata', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const logger = createLogger('main')
    logger.info('loaded', { apiKey: 'sk-db-secret', model: 'MiniMax-M3' })
    const output = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).not.toContain('sk-db-secret')
    expect(output).toContain('[REDACTED]')
    expect(output).toContain('MiniMax-M3')
  })

  it('redacts authorization and token fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const logger = createLogger('ai')
    logger.info('request', { authorization: 'Bearer sk-abc', token: 'xyz' })
    const output = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).not.toContain('sk-abc')
    expect(output).not.toContain('xyz')
  })

  it('does not mutate the caller metadata object', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const logger = createLogger('main')
    const meta = { apiKey: 'sk-db-secret' }
    logger.info('x', meta)
    expect(meta.apiKey).toBe('sk-db-secret')
  })

  it('redacts bearer keys', () => {
    const output = captureLog((logger) => logger.info('request', { bearer: 'abc123' }))
    expect(output).not.toContain('abc123')
    expect(output).toContain('[REDACTED]')
  })

  it('redacts a secret nested two levels deep', () => {
    const output = captureLog((logger) =>
      logger.info('nested', { outer: { inner: { token: 'deep-secret' } } })
    )
    expect(output).not.toContain('deep-secret')
    expect(output).toContain('[REDACTED]')
  })

  it('redacts a secret inside an array element', () => {
    const output = captureLog((logger) =>
      logger.info('list', { items: [{ model: 'MiniMax-M3' }, { apiKey: 'sk-array-secret' }] })
    )
    expect(output).not.toContain('sk-array-secret')
    expect(output).toContain('MiniMax-M3')
  })

  it('redacts case variants of apiKey', () => {
    const output = captureLog((logger) =>
      logger.info('variants', { APIKEY: 'upper-secret', ApiKey: 'title-secret' })
    )
    expect(output).not.toContain('upper-secret')
    expect(output).not.toContain('title-secret')
  })

  it('redacts the DATABYTE_API_KEY env-shaped key', () => {
    const output = captureLog((logger) =>
      logger.info('env', { DATABYTE_API_KEY: 'sk-env-secret' })
    )
    expect(output).not.toContain('sk-env-secret')
    expect(output).toContain('[REDACTED]')
  })

  it('redacts compound credential key names', () => {
    const output = captureLog((logger) =>
      logger.info('tokens', {
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        idToken: 'id-secret',
        clientSecret: 'client-secret',
        api_key: 'snake-secret',
        'api-key': 'kebab-secret'
      })
    )
    for (const secret of [
      'access-secret',
      'refresh-secret',
      'id-secret',
      'client-secret',
      'snake-secret',
      'kebab-secret'
    ]) {
      expect(output).not.toContain(secret)
    }
  })

  it('keeps the hasApiKey boolean intact', () => {
    const output = captureLog((logger) => logger.info('settings', { hasApiKey: true }))
    expect(output).toContain('"hasApiKey":true')
    expect(output).not.toContain('[REDACTED]')
  })

  it('redacts hasApiKey when its value is not a boolean', () => {
    const output = captureLog((logger) => logger.info('settings', { hasApiKey: 'sk-live-xyz' }))
    expect(output).not.toContain('sk-live-xyz')
    expect(output).toContain('"hasApiKey":"[REDACTED]"')
  })

  it('scrubs secrets out of Error messages while keeping the rest', () => {
    const output = captureLog((logger) =>
      logger.error('request failed', { err: new Error('boom: sk-db-secret') })
    )
    expect(output).not.toContain('sk-db-secret')
    expect(output).toContain('boom')
    expect(output).toContain('"name":"Error"')
    expect(output).toContain('"stack"')
  })

  it('serializes a Date as its ISO 8601 string', () => {
    const date = new Date('2026-11-17T03:04:05.000Z')
    const output = captureLog((logger) => logger.info('stamp', { at: date }))
    expect(output).toContain(date.toISOString())
    expect(output).not.toContain('{}')
  })

  it('marks circular references instead of recursing forever', () => {
    const node: Record<string, unknown> = { model: 'MiniMax-M3' }
    node.self = node
    const output = captureLog((logger) => logger.info('cycle', { node }))
    expect(output).toContain('[Circular]')
    expect(output).toContain('MiniMax-M3')
  })

  it('expands a shared object at every reference and only marks real cycles', () => {
    const shared = { model: 'MiniMax-M3' }
    const output = captureLog((logger) => logger.info('shared', { a: shared, b: shared }))
    expect(output).not.toContain('[Circular]')
    expect((output.match(/MiniMax-M3/g) ?? []).length).toBe(2)
  })

  it('does not redact safe diagnostic fields', () => {
    const output = captureLog((logger) =>
      logger.info('status', {
        model: 'MiniMax-M3',
        status: 'on',
        reason: 'user',
        updatedAt: 1,
        scope: 'main',
        answer: 'ok',
        errorCode: 'timeout'
      })
    )
    for (const safe of ['MiniMax-M3', '"status":"on"', '"reason":"user"', '"errorCode":"timeout"']) {
      expect(output).toContain(safe)
    }
    expect(output).not.toContain('[REDACTED]')
  })

  it('scrubs secret-shaped substrings out of free text', () => {
    const output = captureLog((logger) =>
      logger.info('note', {
        detail: 'used Bearer abc123 with api_key=xyz789 then sk_live_topsecret'
      })
    )
    expect(output).not.toContain('abc123')
    expect(output).not.toContain('xyz789')
    expect(output).not.toContain('sk_live_topsecret')
    expect(output).toContain('Bearer [REDACTED]')
    expect(output).toContain('used')
  })

  it('redacts a Bearer credential that follows an Authorization header name', () => {
    const output = captureLog((logger) =>
      logger.info('header', { detail: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig' })
    )
    expect(output).not.toContain('eyJhbGciOiJIUzI1NiJ9.payload.sig')
    expect(output).toContain('Authorization: Bearer [REDACTED]')
  })

  it('redacts a Bearer credential assigned to an authorization field', () => {
    const output = captureLog((logger) =>
      logger.info('header', { detail: 'authorization=Bearer 9f8e7d' })
    )
    expect(output).not.toContain('9f8e7d')
    expect(output).toContain('Bearer [REDACTED]')
  })

  it('redacts a Bearer credential that follows a token name', () => {
    const output = captureLog((logger) => logger.info('header', { detail: 'token: Bearer 9f8e7d' }))
    expect(output).not.toContain('9f8e7d')
    expect(output).toContain('Bearer [REDACTED]')
  })

  it('redacts a Bearer credential inside an Error message', () => {
    const output = captureLog((logger) =>
      logger.error('request failed', { err: new Error('Authorization: Bearer jwt-payload') })
    )
    expect(output).not.toContain('jwt-payload')
    expect(output).toContain('Bearer [REDACTED]')
  })

  it('redacts a Basic credential that follows an Authorization header name', () => {
    const output = captureLog((logger) =>
      logger.info('header', { detail: 'Authorization: Basic dXNlcjpwYXNz' })
    )
    expect(output).not.toContain('dXNlcjpwYXNz')
  })

  it('scrubs secrets out of the log message argument', () => {
    const output = captureLog((logger) => logger.error('request failed with sk-db-secret'))
    expect(output).not.toContain('sk-db-secret')
    expect(output).toContain('request failed with')
  })

  it('does not throw on an invalid Date and still emits the line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const logger = createLogger('main')
    expect(() => logger.info('stamp', { at: new Date('garbage') })).not.toThrow()
    const output = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).toContain('Invalid Date')
  })
})
