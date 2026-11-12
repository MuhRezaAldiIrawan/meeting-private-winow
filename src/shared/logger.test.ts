import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLogger } from './logger'

afterEach(() => {
  vi.restoreAllMocks()
})

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
})
