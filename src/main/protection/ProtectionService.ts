import type { ProtectionSnapshot, ProtectionStatus } from '@shared/types'

export class ProtectionService {
  private status: ProtectionStatus = 'off'
  private reason: string | null = null
  private updatedAt: number

  constructor(
    private readonly adapter: { apply(enabled: boolean): Promise<void> },
    private readonly now: () => number = () => Date.now()
  ) {
    this.updatedAt = this.now()
  }

  getSnapshot(): ProtectionSnapshot {
    return { status: this.status, reason: this.reason, updatedAt: this.updatedAt }
  }

  async toggle(): Promise<ProtectionSnapshot> {
    return this.setEnabled(this.status !== 'on')
  }

  async setEnabled(enabled: boolean): Promise<ProtectionSnapshot> {
    try {
      await this.adapter.apply(enabled)
      this.status = enabled ? 'on' : 'off'
      this.reason = null
    } catch (error) {
      // Fail-visible: a failed apply must never leave the status as 'on'.
      this.status = 'error'
      this.reason = error instanceof Error ? error.message : String(error)
    }
    this.updatedAt = this.now()
    return this.getSnapshot()
  }
}
