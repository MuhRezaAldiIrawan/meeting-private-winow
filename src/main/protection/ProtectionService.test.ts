import { describe, it, expect, vi } from 'vitest'
import { ProtectionService } from './ProtectionService'
import type { ContentProtectionAdapter } from './types'

function adapter(impl?: (enabled: boolean) => Promise<void>): ContentProtectionAdapter {
  return { apply: impl ?? vi.fn(async () => undefined) }
}

describe('ProtectionService', () => {
  it('starts OFF by default', () => {
    const service = new ProtectionService(adapter())
    expect(service.getSnapshot().status).toBe('off')
    expect(service.getSnapshot().reason).toBeNull()
  })

  it('turns ON when the adapter resolves', async () => {
    const apply = vi.fn(async () => undefined)
    const service = new ProtectionService(adapter(apply))
    const snapshot = await service.toggle()
    expect(apply).toHaveBeenCalledWith(true)
    expect(snapshot.status).toBe('on')
    expect(snapshot.reason).toBeNull()
  })

  it('turns OFF when toggling from ON', async () => {
    const apply = vi.fn(async () => undefined)
    const service = new ProtectionService(adapter(apply))
    await service.toggle()
    const snapshot = await service.toggle()
    expect(apply).toHaveBeenLastCalledWith(false)
    expect(snapshot.status).toBe('off')
  })

  it('NEVER reports ON when the adapter throws', async () => {
    const apply = vi.fn(async () => {
      throw new Error('SetWindowDisplayAffinity failed')
    })
    const service = new ProtectionService(adapter(apply))
    const snapshot = await service.toggle()
    expect(snapshot.status).toBe('error')
    expect(snapshot.status).not.toBe('on')
    expect(snapshot.reason).toContain('SetWindowDisplayAffinity failed')
  })

  it('stays in error when a retry also fails', async () => {
    const apply = vi.fn(async () => {
      throw new Error('still failing')
    })
    const service = new ProtectionService(adapter(apply))
    await service.toggle()
    const snapshot = await service.toggle()
    expect(snapshot.status).toBe('error')
    expect(snapshot.reason).toContain('still failing')
  })

  it('recovers to ON when a retry succeeds', async () => {
    let shouldFail = true
    const apply = vi.fn(async () => {
      if (shouldFail) throw new Error('boom')
    })
    const service = new ProtectionService(adapter(apply))
    await service.toggle()
    shouldFail = false
    const snapshot = await service.toggle()
    expect(snapshot.status).toBe('on')
    expect(snapshot.reason).toBeNull()
  })

  it('records the time of the last transition', async () => {
    const service = new ProtectionService(adapter(), () => 1_700_000_000_000)
    const snapshot = await service.toggle()
    expect(snapshot.updatedAt).toBe(1_700_000_000_000)
  })

  it('setEnabled(true) and setEnabled(false) are explicit', async () => {
    const apply = vi.fn(async () => undefined)
    const service = new ProtectionService(adapter(apply))
    await service.setEnabled(true)
    expect(service.getSnapshot().status).toBe('on')
    await service.setEnabled(false)
    expect(service.getSnapshot().status).toBe('off')
  })
})
