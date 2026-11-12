export const IPC_CHANNELS = {
  protectionGet: 'protection:get',
  protectionToggle: 'protection:toggle',
  notesGet: 'notes:get',
  notesSave: 'notes:save',
  aiAsk: 'ai:ask',
  settingsGet: 'settings:get',
  settingsSetApiKey: 'settings:set-api-key',
  settingsSetModel: 'settings:set-model',
  settingsAcknowledgeNotice: 'settings:acknowledge-notice'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/**
 * Channels the main process pushes to the renderer (not invoke/handle pairs).
 * Kept separate from IPC_CHANNELS so the handler-registration test can assert
 * that every invoke channel has exactly one handler.
 */
export const IPC_EVENTS = {
  protectionChanged: 'protection:changed'
} as const

export type IpcEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
