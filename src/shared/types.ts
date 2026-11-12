export type ProtectionStatus = 'off' | 'on' | 'error'

/** Default DataByte model name. The PRD specifies the plan model with no `provider/` prefix. */
export const DEFAULT_MODEL = 'MiniMax-M3'

export interface ProtectionSnapshot {
  status: ProtectionStatus
  reason: string | null
  updatedAt: number
}

export type AiErrorCode =
  | 'unauthorized'
  | 'payment_required'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'no_api_key'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'unknown'

export interface AiResult {
  ok: boolean
  answer: string
  errorCode: AiErrorCode | null
  message: string
}

export interface PublicSettings {
  hasApiKey: boolean
  model: string
  hasAcknowledgedNotice: boolean
}

export interface SettingsData {
  hasAcknowledgedNotice: boolean
  apiKey: string
  model: string
}
