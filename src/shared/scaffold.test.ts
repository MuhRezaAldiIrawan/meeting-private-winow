import { describe, it, expect } from 'vitest'
import { IPC_CHANNELS } from './channels'

describe('scaffold', () => {
  it('exposes IPC channel constants', () => {
    expect(IPC_CHANNELS.protectionToggle).toBe('protection:toggle')
  })
})
