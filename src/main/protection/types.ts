export interface ContentProtectionAdapter {
  apply(enabled: boolean): Promise<void>
}
