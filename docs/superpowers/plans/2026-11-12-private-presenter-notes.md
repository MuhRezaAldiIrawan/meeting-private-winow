# Private Presenter Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app that shows presenter notes on the presenter's monitor while excluded from screen capture in Zoom/Meet/Teams, with an honest ON/OFF/error indicator, local note persistence, and an opt-in AI Assist panel.

**Architecture:** Layered Electron app. Main process owns all OS access and is split per responsibility (`windows/`, `protection/`, `storage/`, `ai/`, `ipc/`, `services/`). The protection state machine is a pure module with no Electron import, receiving a `ContentProtectionAdapter` interface — this is what makes the fail-visible guarantee testable. Preload exposes one `window.presenter` bridge via `contextBridge`; renderer has no Node access and no network access (`connect-src 'none'`).

**Tech Stack:** Electron 45.3.1 · TypeScript 6.0.3 · electron-vite 6.0.0 · Vite 8.3.8 · Vitest 5.1.0 · marked 18.2.0 · DOMPurify 3.4.17 · ESLint 10.14.0 · electron-builder 26.18.0

## Global Constraints

These apply to every task. Copy them verbatim; do not re-derive.

- **No `"type": "module"` in package.json.** The preload must build to CommonJS (`out/preload/index.js`) because Electron's `sandbox: true` preload requires CJS. Adding `"type": "module"` makes electron-vite emit `.mjs` and breaks the app at runtime.
- **Renderer must never import `electron` or `node:*`.** Only path: `window.presenter` from the preload bridge. Enforced by ESLint `no-restricted-imports`.
- **Main and preload must never import renderer code.**
- **`connect-src 'none'` in production CSP.** The renderer makes zero network requests. The only outbound call (AI Assist) goes through the main process. The Vite dev server relaxes this via the `devCspPlugin` in `electron.vite.config.ts`; production keeps it strict.
- **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`** on the BrowserWindow.
- **Fail-visible:** status is exactly one of `'off' | 'on' | 'error'`. `'on'` is reachable ONLY through a successful adapter call. An adapter throw yields `'error'`, never `'on'`.
- **Protection defaults to OFF** on every launch. Default OFF is independent of the first-run notice acknowledgement flag.
- **API key never leaves the main process.** `getSettings()` returns `{ hasApiKey: boolean, model: string, hasAcknowledgedNotice: boolean }` — never the key value. The logger redacts metadata keys by containment over normalized key names (lowercased, non-alphanumerics stripped), so `apiKey`, `api_key`, `api-key`, `DATABYTE_API_KEY`, `accessToken`, `clientSecret` and any key containing `apikey`, `authorization`, `token`, `bearer`, `password` or `secret` are replaced with `[REDACTED]`. The single carve-out is a key normalizing to `hasapikey` with a boolean value (`PublicSettings.hasApiKey`); a non-boolean under that name is still redacted. The logger also serializes `Error` as `{ name, message, stack }`, `Date` as its ISO 8601 string, scrubs secret-shaped substrings out of the log message argument and out of string values and error messages, and marks circular references as `[Circular]`. Free-text scrubbing covers the `Bearer` and `Basic` auth schemes in both positions: standalone (`used Bearer abc123 alone`) and following a secret-shaped name (`Authorization: Bearer eyJ…`, `token=Bearer 9f8e7d`). The scheme word is kept and the credential is always dropped, never left standing behind the scheme word. Scheme matching is case-insensitive.
- **UI labels are in English.** AI error messages are in **Indonesian** (PRD FR-15 explicitly requires it). This is a deliberate exception, not an inconsistency.
- **AI Assist sends only the user's typed question.** Note content is never sent as context.
- **All data is local.** No telemetry, no analytics, no network calls other than the AI request.
- **TypeScript strict flags on in both projects:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`.
- **Test file naming:** `*.test.ts` for node environment; `*.dom.test.ts` for jsdom environment (selected by a `// @vitest-environment jsdom` docblock — Vitest 5 has no `environmentMatchGlobs` option).
- **Every task follows TDD:** write the failing test, run it and see it fail, implement the minimum, run it and see it pass, commit.

---

## File Structure

Files created by this plan, with the responsibility of each:

```
src/
├─ shared/                          ← imported by main, preload, AND renderer
│  ├─ channels.ts                   ← IPC channel name constants (single source of truth)
│  ├─ types.ts                      ← ProtectionStatus, ProtectionSnapshot, AiResult, PublicSettings
│  └─ logger.ts                     ← console wrapper that redacts sensitive fields
├─ main/
│  ├─ index.ts                      ← app lifecycle, wires services together
│  ├─ windows/notesWindow.ts        ← BrowserWindow factory
│  ├─ protection/
│  │  ├─ types.ts                   ← ContentProtectionAdapter interface
│  │  ├─ ProtectionService.ts       ← pure state machine, NO electron import
│  │  └─ electronAdapter.ts         ← adapter wrapping win.setContentProtection
│  ├─ storage/
│  │  ├─ atomicWrite.ts             ← atomic file write, serialized per path
│  │  ├─ NotesStore.ts              ← atomic read/write of notes.md
│  │  └─ SettingsStore.ts           ← read/write of settings.json
│  ├─ ai/
│  │  ├─ errors.ts                  ← AiErrorCode + HTTP status mapping
│  │  ├─ prompt.ts                  ← request/response shaping
│  │  └─ DataByteClient.ts          ← fetch to DataByte, timeout, error mapping
│  ├─ ipc/registerIpcHandlers.ts    ← registers every IPC channel in one place
│  └─ services/
│     ├─ hotkeys.ts                 ← global shortcut registration
│     └─ singleInstance.ts          ← single-instance lock
├─ preload/index.ts                 ← contextBridge → window.presenter
└─ renderer/
   ├─ index.html                    ← CSP meta, mount point
   └─ src/
      ├─ main.ts                    ← renderer bootstrap
      ├─ state/appStore.ts          ← subscribe/notify store
      ├─ lib/markdown.ts            ← safe markdown rendering
      ├─ lib/dom.ts                 ← small DOM helpers (no framework)
      ├─ views/StatusBar.ts         ← ON/OFF/error indicator
      ├─ views/EditorView.ts        ← notes textarea + preview tabs
      ├─ views/AiPanel.ts           ← question input + answer + permanent label
      ├─ views/NoticeDialog.ts      ← first-run notice modal
      ├─ views/SettingsDialog.ts    ← API key + model settings
      └─ styles/app.css             ← all styling
```

**Why no framework in the renderer:** the PRD targets CPU idle below 1% and memory below 200 MB, and a strict CSP with `script-src 'self'`. A hand-rolled DOM layer keeps the bundle small and the CSP simple. The app has one window and a handful of elements; a framework would be more machinery than the problem needs.

---

## Task 1: Project scaffold and toolchain verification

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `vitest.config.mts`, `eslint.config.mjs`, `.gitignore`
- Test: `src/shared/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: working `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Path aliases `@shared/*`, `@main/*`, `@renderer/*` resolvable in both TypeScript and the bundler.

- [ ] **Step 1: Write the failing test**

Create `src/shared/scaffold.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { IPC_CHANNELS } from './channels'

describe('scaffold', () => {
  it('exposes IPC channel constants', () => {
    expect(IPC_CHANNELS.protectionToggle).toBe('protection:toggle')
  })
})
```

Create `src/shared/channels.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run`
Expected: FAIL — `Cannot find module './channels'`

- [ ] **Step 3: Write minimal implementation**

Create `package.json`:

```json
{
  "name": "meeting-private-window",
  "version": "0.1.0",
  "private": true,
  "description": "Private Presenter Notes - catatan presenter yang tidak ikut tertangkap saat screen share",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc -p tsconfig.node.json && tsc -p tsconfig.web.json",
    "lint": "eslint src --no-warn-ignored",
    "test": "vitest run",
    "test:watch": "vitest",
    "dist": "electron-vite build && electron-builder"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "24.19.2",
    "electron": "45.3.1",
    "electron-builder": "26.18.0",
    "electron-vite": "6.0.0",
    "eslint": "10.14.0",
    "jsdom": "31.0.0",
    "typescript": "6.0.3",
    "typescript-eslint": "8.72.2",
    "vite": "8.3.8",
    "vitest": "5.1.0"
  },
  "dependencies": {
    "dompurify": "3.4.17",
    "marked": "18.2.0"
  }
}
```

**Do not add `"type": "module"`** — see Global Constraints.

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@main/*": ["./src/main/*"]
    }
  },
  "include": [
    "electron.vite.config.ts",
    "vitest.config.mts",
    "src/main/**/*.ts",
    "src/preload/**/*.ts",
    "src/shared/**/*.ts"
  ]
}
```

Create `tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@renderer/*": ["./src/renderer/src/*"]
    }
  },
  "include": ["src/renderer/**/*.ts", "src/shared/**/*.ts"]
}
```

**Note:** `baseUrl` is deprecated in TypeScript 6 and removed in TS 7. Do not use it. `paths` entries must be relative (`./src/...`), not bare.

Create `electron.vite.config.ts`:

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

const root = process.cwd()

const alias = {
  '@shared': resolve(root, 'src/shared'),
  '@main': resolve(root, 'src/main'),
  '@renderer': resolve(root, 'src/renderer/src')
}

/**
 * Production CSP forbids every network connection from the renderer
 * (`connect-src 'none'`). The Vite dev server needs its HMR websocket, so the
 * policy is relaxed only while the dev server is running. `ctx.server` is
 * undefined for `vite build`, so the shipped index.html keeps the strict policy.
 */
function devCspPlugin(): Plugin {
  return {
    name: 'dev-csp-relax',
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html
      return html.replace(
        "connect-src 'none';",
        "connect-src 'self' ws://localhost:* http://localhost:*;"
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { outDir: 'out/main' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [devCspPlugin()],
    resolve: { alias },
    build: { outDir: 'out/renderer' }
  }
})
```

Create `vitest.config.mts`:

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = process.cwd()

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@main': resolve(root, 'src/main'),
      '@renderer': resolve(root, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true
  }
})
```

**Note:** Vitest 5 removed `environmentMatchGlobs`. jsdom is selected per-file with a `// @vitest-environment jsdom` docblock and the `*.dom.test.ts` filename.

Create `eslint.config.mjs`:

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'release/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*.renderer*', '@renderer/*', '**/renderer/**'],
              message: 'Main/preload must not import renderer code.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'node:*'],
              message: 'Renderer must not import Electron or Node builtins. Use the preload bridge (window.presenter).'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // An await-free async body is the idiomatic shape for a `Promise<void>` mock
      // (`vi.fn(async () => undefined)`): the `async` keyword is what makes the stub return a
      // promise rather than a plain value, so the await-free body is the point, not an
      // oversight. The rule is therefore noise in test files. Scoped to `**/*.test.ts` — it
      // stays an error in production code, where an async function with no await is a
      // genuine mistake. `no-floating-promises` still applies everywhere and covers the
      // common form of the mistake this relaxation could otherwise hide.
      '@typescript-eslint/require-await': 'off'
    }
  }
)
```

Create `.gitignore`:

```
node_modules/
out/
dist/
release/
*.log
.DS_Store
.env
.env.local
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: exits 0, installs 465 packages. If it reports `ERESOLVE` for eslint, the eslint version is wrong — it must be 10.14.0 (eslint 9 is deprecated and `@eslint/js` must match eslint's major).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run`
Expected: PASS — 1 test file, 1 test passed

- [ ] **Step 6: Verify typecheck and lint are clean**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0 with no output

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json tsconfig.web.json electron.vite.config.ts vitest.config.mts eslint.config.mjs .gitignore src/shared/channels.ts src/shared/scaffold.test.ts
git commit -m "chore: scaffold Electron project with strict TypeScript toolchain"
```

---

## Task 2: Shared types and redacting logger

**Files:**
- Create: `src/shared/types.ts`, `src/shared/logger.ts`
- Test: `src/shared/logger.test.ts`

**Interfaces:**
- Consumes: `IPC_CHANNELS` from `src/shared/channels.ts` (Task 1)
- Produces:
  - `ProtectionStatus = 'off' | 'on' | 'error'`
  - `ProtectionSnapshot { status: ProtectionStatus; reason: string | null; updatedAt: number }`
  - `AiErrorCode` union, `AiResult { ok: boolean; answer: string; errorCode: AiErrorCode | null; message: string }`
  - `PublicSettings { hasApiKey: boolean; model: string; hasAcknowledgedNotice: boolean }`
  - `logger.info(message: string, meta?: Record<string, unknown>): void` — redacts sensitive keys before printing

- [ ] **Step 1: Write the failing test**

Create `src/shared/logger.test.ts`:

```ts
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
    expect(output).toContain('Authorization: Basic [REDACTED]')
  })

  it('redacts a standalone Basic credential in free text', () => {
    const output = captureLog((logger) =>
      logger.info('note', { detail: 'used Basic dXNlcjpwYXNz with nothing' })
    )
    expect(output).not.toContain('dXNlcjpwYXNz')
    expect(output).toContain('Basic [REDACTED]')
    expect(output).toContain('used')
  })

  it('redacts a lowercase bearer credential that follows a token name', () => {
    const output = captureLog((logger) => logger.info('header', { detail: 'token: bearer 9f8e7d' }))
    expect(output).not.toContain('9f8e7d')
    expect(output).toContain('bearer [REDACTED]')
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/logger.test.ts`
Expected: FAIL — `Cannot find module './logger'`

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/types.ts`:

```ts
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
```

Create `src/shared/logger.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/logger.test.ts`
Expected: PASS — 26 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/logger.ts src/shared/logger.test.ts
git commit -m "feat: add shared types and redacting logger"
```

---

## Task 3: Protection state machine (pure, no Electron)

This is the core of the fail-visible guarantee (PRD NFR: "tidak pernah ON palsu", test scenario #8).

**Files:**
- Create: `src/main/protection/types.ts`, `src/main/protection/ProtectionService.ts`
- Test: `src/main/protection/ProtectionService.test.ts`

**Interfaces:**
- Consumes: `ProtectionStatus`, `ProtectionSnapshot` from `src/shared/types.ts` (Task 2)
- Produces:
  - `interface ContentProtectionAdapter { apply(enabled: boolean): Promise<void> }`
  - `class ProtectionService`
    - `constructor(adapter: ContentProtectionAdapter, now?: () => number)`
    - `getSnapshot(): ProtectionSnapshot`
    - `async toggle(): Promise<ProtectionSnapshot>`
    - `async setEnabled(enabled: boolean): Promise<ProtectionSnapshot>`

- [ ] **Step 1: Write the failing test**

Create `src/main/protection/ProtectionService.test.ts`:

```ts
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
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenLastCalledWith(true)
    expect(snapshot.status).toBe('on')
    expect(snapshot.reason).toBeNull()
  })

  it('records the time of the last transition', async () => {
    let clock = 1_700_000_000_000
    const service = new ProtectionService(adapter(), () => clock++)
    const constructedAt = service.getSnapshot().updatedAt
    const snapshot = await service.toggle()
    expect(snapshot.updatedAt).toBeGreaterThan(constructedAt)
  })

  it('setEnabled(true) and setEnabled(false) are explicit', async () => {
    const apply = vi.fn(async () => undefined)
    const service = new ProtectionService(adapter(apply))
    await service.setEnabled(true)
    expect(service.getSnapshot().status).toBe('on')
    await service.setEnabled(false)
    expect(service.getSnapshot().status).toBe('off')
  })

  it('records the reason for a non-Error rejection', async () => {
    // Typed `unknown` so the rejection reason is not an Error, exercising the
    // `String(error)` branch of the failure path.
    const reason: unknown = 'boom'
    const service = new ProtectionService(
      adapter(async () => {
        throw reason
      })
    )
    const snapshot = await service.toggle()
    expect(snapshot.status).toBe('error')
    expect(snapshot.reason).toBe('boom')
  })

  it('never reports OFF when disabling fails', async () => {
    // Fails only on disable, so the service reaches 'on' first and the assertion
    // covers the 'on' -> 'error' transition rather than an already-errored state.
    const apply = vi.fn(async (enabled: boolean) => {
      if (!enabled) throw new Error('SetWindowDisplayAffinity failed')
    })
    const service = new ProtectionService(adapter(apply))
    await service.setEnabled(true)
    expect(service.getSnapshot().status).toBe('on')
    const snapshot = await service.setEnabled(false)
    expect(snapshot.status).toBe('error')
    expect(snapshot.status).not.toBe('off')
    expect(snapshot.reason).toContain('SetWindowDisplayAffinity failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/protection/ProtectionService.test.ts`
Expected: FAIL — `Cannot find module './ProtectionService'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/protection/types.ts`:

```ts
export interface ContentProtectionAdapter {
  apply(enabled: boolean): Promise<void>
}
```

Create `src/main/protection/ProtectionService.ts`:

```ts
import type { ProtectionSnapshot, ProtectionStatus } from '@shared/types'
import type { ContentProtectionAdapter } from './types'

export class ProtectionService {
  private status: ProtectionStatus = 'off'
  private reason: string | null = null
  private updatedAt: number

  constructor(
    private readonly adapter: ContentProtectionAdapter,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/protection/ProtectionService.test.ts`
Expected: PASS — 10 tests passed

- [ ] **Step 5: Verify the module has no Electron dependency**

Run: `grep -rn "electron" src/main/protection/ && echo "FAIL: electron dependency found" || echo "OK: no electron import"`
Expected: `OK: no electron import`

- [ ] **Step 6: Commit**

```bash
git add src/main/protection/types.ts src/main/protection/ProtectionService.ts src/main/protection/ProtectionService.test.ts
git commit -m "feat: add pure protection state machine with fail-visible semantics"
```

---

## Task 4: Notes storage with atomic write

**Files:**
- Create: `src/main/storage/atomicWrite.ts`, `src/main/storage/NotesStore.ts`
- Test: `src/main/storage/NotesStore.test.ts`

**Interfaces:**
- Consumes: nothing (pure `node:fs`)
- Produces:
  - `readFileAtomic(filePath: string): Promise<string | null>`, `writeFileAtomic(filePath: string, content: string): Promise<void>` and `updateFileAtomic(filePath: string, update: (current: string) => string): Promise<string>` in `src/main/storage/atomicWrite.ts` — shared by `NotesStore` (Task 4) and `SettingsStore` (Task 5)
  - `class NotesStore`
    - `constructor(filePath: string)`
    - `async read(): Promise<string>`
    - `async write(content: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/main/storage/NotesStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesStore } from './NotesStore'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notes-store-'))
  file = join(dir, 'notes.md')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('NotesStore', () => {
  it('returns empty string when the file does not exist', async () => {
    const store = new NotesStore(file)
    await expect(store.read()).resolves.toBe('')
  })

  it('round-trips content', async () => {
    const store = new NotesStore(file)
    await store.write('# Agenda\n- Intro')
    await expect(store.read()).resolves.toBe('# Agenda\n- Intro')
  })

  it('leaves no temporary file behind after writing', async () => {
    const store = new NotesStore(file)
    await store.write('hello')
    const entries = await readdir(dir)
    expect(entries).toEqual(['notes.md'])
  })

  it('preserves unicode content exactly', async () => {
    const store = new NotesStore(file)
    const content = '# Catatan\n\n- emoji 🚀\n- "kutip" & <tag>'
    await store.write(content)
    await expect(store.read()).resolves.toBe(content)
  })

  it('does not corrupt the previous content when the write fails', async () => {
    const store = new NotesStore(file)
    await store.write('original')
    // The parent path segment is an existing FILE, so the write genuinely fails.
    // (A path under a missing directory would NOT fail: `write` creates the
    // directory first, so the write would succeed and this test could never fail.)
    const failing = new NotesStore(join(file, 'nested.md'))
    await expect(failing.write('new content')).rejects.toThrow()
    await expect(store.read()).resolves.toBe('original')
  })

  it('leaves no temporary file behind when the write fails', async () => {
    const store = new NotesStore(file)
    await store.write('original')
    const failing = new NotesStore(join(file, 'nested.md'))
    await expect(failing.write('new content')).rejects.toThrow()
    const entries = await readdir(dir)
    expect(entries).toEqual(['notes.md'])
  })

  it('removes the temporary file when the rename fails', async () => {
    // The rename fails only when the target exists as a DIRECTORY — the one failure
    // that happens AFTER the temp file has been written. The other failing-write case
    // (a parent path segment that is a file) fails earlier, at `mkdir`, so it never
    // creates a temp file and cannot prove the cleanup works.
    const target = join(dir, 'notes.md')
    await mkdir(target)
    const store = new NotesStore(target)
    await expect(store.write('new content')).rejects.toThrow()
    const entries = await readdir(dir)
    expect(entries).toEqual(['notes.md'])
  })

  it('writes the file atomically, never exposing a partial write', async () => {
    // Atomic write = write to a temp file, then rename over the target. The rename
    // swaps the file's identity, so a reader sees either the old content or the new
    // content, never a half-written file. A direct in-place write keeps the same file
    // and can be observed mid-write.
    const store = new NotesStore(file)
    await store.write('first')
    const before = (await stat(file)).ino
    await store.write('second')
    const after = (await stat(file)).ino
    expect(after).not.toBe(before)
  })

  it('serializes overlapping writes without corrupting the file', async () => {
    const store = new NotesStore(file)
    await store.write('initial')
    // Overlapping saves happen in practice: the renderer debounces edits, but a slow
    // disk can still overlap two saves. Repeat enough rounds that a race is caught
    // reliably rather than one time in three.
    for (let round = 0; round < 20; round++) {
      const first = store.write('A'.repeat(20_000))
      const second = store.write('B'.repeat(20_000))
      await expect(Promise.all([first, second])).resolves.toBeDefined()
      const content = await store.read()
      // The file must hold exactly one complete write — never a mix of the two.
      expect(content === 'A'.repeat(20_000) || content === 'B'.repeat(20_000)).toBe(true)
    }
    const entries = await readdir(dir)
    expect(entries).toEqual(['notes.md'])
  })

  it('does not fail when a read overlaps a write', async () => {
    // On Windows, renaming onto a file that another handle still has open fails with
    // EPERM. A read racing a write therefore breaks the WRITE — the user sees a
    // spurious "Couldn't save notes". Both operations must go through the same
    // per-path queue so they cannot overlap.
    const store = new NotesStore(file)
    await store.write('initial')
    for (let round = 0; round < 20; round++) {
      const results = await Promise.allSettled([
        store.write('A'.repeat(20_000)),
        store.read()
      ])
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('fulfilled')
    }
  })

  it('re-throws a read error that is not a missing file', async () => {
    // Only ENOENT means "no file yet". Any other read error (here: the target is a
    // directory) must surface, not be swallowed into an empty string — otherwise the
    // user sees their notes silently disappear.
    const target = join(dir, 'notes.md')
    await mkdir(target)
    const store = new NotesStore(target)
    await expect(store.read()).rejects.toThrow()
  })

  it('overwrites existing content', async () => {
    const store = new NotesStore(file)
    await store.write('first')
    await store.write('second')
    await expect(store.read()).resolves.toBe('second')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/storage/NotesStore.test.ts`
Expected: FAIL — `Cannot find module './NotesStore'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/storage/atomicWrite.ts`:

```ts
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Every operation on a given path — reads and writes alike — is serialized, so two
 * overlapping operations cannot race.
 *
 * Writer vs. writer: without this, the second write removes the first write's temp file
 * and the first `rename` fails with ENOENT — the user sees a spurious "couldn't save".
 *
 * Reader vs. writer: on Windows, renaming onto a file that another handle still has
 * open fails with EPERM. A read racing a write therefore makes the *write* fail.
 */
const queues = new Map<string, Promise<void>>()

let tempCounter = 0

/**
 * Windows can transiently refuse a rename while another program — a virus scanner, a
 * file indexer, a sync client — holds the file open. Retrying briefly turns that
 * transient failure into a successful save instead of a spurious error to the user.
 */
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 20

/**
 * Runs `task` after any previously queued task for the same path has settled, so tasks
 * touching one file are executed one at a time.
 */
function enqueue<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(filePath)
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.then(task)
  // The queue must survive a failed write, so it tracks the settled promise.
  const settled = current.then(
    () => undefined,
    () => undefined
  )
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return current
}

/**
 * Reads a file through the per-path queue, so the read never overlaps a write to the
 * same file. Resolves to `null` when the file does not exist; any other read error is
 * re-thrown so the caller can tell "no file yet" apart from "the file is unreadable".
 */
export function readFileAtomic(filePath: string): Promise<string | null> {
  return enqueue(filePath, () => readFileIfExists(filePath))
}

/** Writes a file through the per-path queue. */
export function writeFileAtomic(filePath: string, content: string): Promise<void> {
  return enqueue(filePath, () => writeAtomic(filePath, content))
}

/**
 * Reads the current contents, derives the next contents and writes them — all inside the
 * per-path critical section. A caller that reads the file, then writes it back, must use
 * this instead of `writeFileAtomic`: between the read and the write another writer could
 * change the file, and the second writer's change would be silently lost.
 */
export function updateFileAtomic(
  filePath: string,
  update: (current: string) => string
): Promise<string> {
  return enqueue(filePath, async () => {
    const current = (await readFileIfExists(filePath)) ?? ''
    const next = update(current)
    await writeAtomic(filePath, next)
    return next
  })
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  // A unique temp name keeps concurrent writers on different paths from colliding.
  const tempPath = `${filePath}.${process.pid}.${tempCounter++}.tmp`
  try {
    await writeFile(tempPath, content, 'utf8')
    await renameWithRetry(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function renameWithRetry(tempPath: string, filePath: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(tempPath, filePath)
      return
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !isTransient(error)) throw error
      await delay(RENAME_RETRY_MS * attempt)
    }
  }
}

/** Errors that mean "try again shortly" rather than "this will never work". */
function isTransient(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
```

Create `src/main/storage/NotesStore.ts`:

```ts
import { readFileAtomic, writeFileAtomic } from './atomicWrite'

export class NotesStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<string> {
    // The read goes through the same per-path queue as the write: on Windows, a read
    // that overlaps a write makes the write's rename fail with EPERM.
    return (await readFileAtomic(this.filePath)) ?? ''
  }

  async write(content: string): Promise<void> {
    await writeFileAtomic(this.filePath, content)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/storage/NotesStore.test.ts`
Expected: PASS — 12 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/atomicWrite.ts src/main/storage/NotesStore.ts src/main/storage/NotesStore.test.ts
git commit -m "feat: add notes storage with atomic write"
```

---

## Task 5: Settings storage with corrupt-file fallback

**Files:**
- Create: `src/main/storage/SettingsStore.ts`
- Test: `src/main/storage/SettingsStore.test.ts`

**Interfaces:**
- Consumes: `SettingsData` from `src/shared/types.ts` (Task 2)
- Produces:
  - `DEFAULT_MODEL = 'MiniMax-M3'` — re-exported from `@shared/types` (defined in Task 2), not redefined here
  - `class SettingsStore`
    - `constructor(filePath: string)`
    - `async read(): Promise<SettingsData>`
    - `async write(data: Partial<SettingsData>): Promise<SettingsData>`
    - `async getApiKey(): Promise<string>`
    - `async getModel(): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `src/main/storage/SettingsStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, DEFAULT_MODEL } from './SettingsStore'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'settings-store-'))
  file = join(dir, 'settings.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('returns defaults when the file does not exist', async () => {
    const store = new SettingsStore(file)
    const data = await store.read()
    expect(data.hasAcknowledgedNotice).toBe(false)
    expect(data.apiKey).toBe('')
    expect(data.model).toBe(DEFAULT_MODEL)
  })

  it('falls back to defaults when the file is corrupt', async () => {
    await writeFile(file, '{ this is not json', 'utf8')
    const store = new SettingsStore(file)
    const data = await store.read()
    expect(data.hasAcknowledgedNotice).toBe(false)
    expect(data.apiKey).toBe('')
    expect(data.model).toBe(DEFAULT_MODEL)
  })

  it('round-trips the API key', async () => {
    const store = new SettingsStore(file)
    await store.write({ apiKey: 'sk-db-abc123' })
    await expect(store.getApiKey()).resolves.toBe('sk-db-abc123')
  })

  it('round-trips the notice acknowledgement flag', async () => {
    const store = new SettingsStore(file)
    await store.write({ hasAcknowledgedNotice: true })
    await expect(store.read()).resolves.toMatchObject({ hasAcknowledgedNotice: true })
  })

  it('preserves unspecified fields on a partial write', async () => {
    const store = new SettingsStore(file)
    await store.write({ apiKey: 'sk-db-abc123' })
    await store.write({ hasAcknowledgedNotice: true })
    const data = await store.read()
    expect(data.apiKey).toBe('sk-db-abc123')
    expect(data.hasAcknowledgedNotice).toBe(true)
  })

  it('leaves no temporary file behind', async () => {
    const store = new SettingsStore(file)
    await store.write({ apiKey: 'x' })
    const entries = await readdir(dir)
    expect(entries).toEqual(['settings.json'])
  })

  it('treats an empty model as the default model', async () => {
    await writeFile(file, JSON.stringify({ model: '' }), 'utf8')
    const store = new SettingsStore(file)
    await expect(store.getModel()).resolves.toBe(DEFAULT_MODEL)
  })

  it('does not lose a concurrent partial update', async () => {
    const store = new SettingsStore(file)
    // Two writers touch different fields at the same time — e.g. the user saves their
    // API key while the first-run notice is being acknowledged. A read-modify-write
    // outside the per-path critical section drops one of the two updates: the second
    // writer reads the file before the first writer's write lands, then overwrites it.
    // Repeat enough rounds that the race is caught reliably rather than one time in four.
    for (let round = 0; round < 20; round++) {
      await rm(file, { force: true })
      await Promise.all([
        store.write({ apiKey: 'sk-db-abc123' }),
        store.write({ hasAcknowledgedNotice: true })
      ])
      const data = await store.read()
      expect(data.apiKey).toBe('sk-db-abc123')
      expect(data.hasAcknowledgedNotice).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/storage/SettingsStore.test.ts`
Expected: FAIL — `Cannot find module './SettingsStore'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/storage/SettingsStore.ts`:

```ts
import type { SettingsData } from '@shared/types'
import { DEFAULT_MODEL } from '@shared/types'
import { createLogger } from '@shared/logger'
import { readFileAtomic, updateFileAtomic } from './atomicWrite'

export { DEFAULT_MODEL }

const log = createLogger('settings')

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<SettingsData> {
    try {
      const raw = await readFileAtomic(this.filePath)
      return parseSettings(raw ?? '')
    } catch (error) {
      log.warn('settings file unreadable, using defaults', { error: String(error) })
      return defaultSettings()
    }
  }

  async write(patch: Partial<SettingsData>): Promise<SettingsData> {
    // The read-modify-write must happen inside the per-path critical section. Reading
    // the file first and writing afterwards lets a concurrent writer change the file in
    // between, and the second write then silently discards the first writer's change.
    const written = await updateFileAtomic(this.filePath, (raw) => {
      const current = parseSettings(raw)
      const next: SettingsData = {
        hasAcknowledgedNotice: patch.hasAcknowledgedNotice ?? current.hasAcknowledgedNotice,
        apiKey: patch.apiKey ?? current.apiKey,
        model: patch.model && patch.model.length > 0 ? patch.model : current.model
      }
      return JSON.stringify(next, null, 2)
    })
    return parseSettings(written)
  }

  async getApiKey(): Promise<string> {
    return (await this.read()).apiKey
  }

  async getModel(): Promise<string> {
    return (await this.read()).model
  }
}

function defaultSettings(): SettingsData {
  return { hasAcknowledgedNotice: false, apiKey: '', model: DEFAULT_MODEL }
}

/** Parses the stored JSON, falling back to defaults for anything malformed. */
function parseSettings(raw: string): SettingsData {
  const defaults = defaultSettings()
  if (raw.trim().length === 0) return defaults
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    log.warn('settings file unreadable, using defaults', { error: String(error) })
    return defaults
  }
  if (typeof parsed !== 'object' || parsed === null) return defaults
  const data = parsed as Partial<SettingsData>
  return {
    hasAcknowledgedNotice:
      typeof data.hasAcknowledgedNotice === 'boolean'
        ? data.hasAcknowledgedNotice
        : defaults.hasAcknowledgedNotice,
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : defaults.apiKey,
    model: typeof data.model === 'string' && data.model.length > 0 ? data.model : defaults.model
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/storage/SettingsStore.test.ts`
Expected: PASS — 8 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/SettingsStore.ts src/main/storage/SettingsStore.test.ts
git commit -m "feat: add settings storage with corrupt-file fallback"
```

---

## Task 6: AI error mapping

**Files:**
- Create: `src/main/ai/errors.ts`
- Test: `src/main/ai/errors.test.ts`

**Interfaces:**
- Consumes: `AiErrorCode` from `src/shared/types.ts` (Task 2)
- Produces:
  - `AI_ERROR_MESSAGES: Record<AiErrorCode, string>` — Indonesian messages
  - `mapHttpStatus(status: number): AiErrorCode`
  - `errorMessage(code: AiErrorCode): string`

- [ ] **Step 1: Write the failing test**

Create `src/main/ai/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapHttpStatus, errorMessage, AI_ERROR_MESSAGES } from './errors'

describe('mapHttpStatus', () => {
  it('maps 401 to unauthorized', () => {
    expect(mapHttpStatus(401)).toBe('unauthorized')
  })

  it('maps 402 to payment_required', () => {
    expect(mapHttpStatus(402)).toBe('payment_required')
  })

  it('maps 403 to forbidden', () => {
    expect(mapHttpStatus(403)).toBe('forbidden')
  })

  it('maps 404 to not_found', () => {
    expect(mapHttpStatus(404)).toBe('not_found')
  })

  it('maps 429 to rate_limited', () => {
    expect(mapHttpStatus(429)).toBe('rate_limited')
  })

  it('maps any other status to unknown', () => {
    expect(mapHttpStatus(500)).toBe('unknown')
    expect(mapHttpStatus(418)).toBe('unknown')
  })
})

describe('errorMessage', () => {
  it('provides an Indonesian message for every code', () => {
    const codes = Object.keys(AI_ERROR_MESSAGES)
    expect(codes.length).toBeGreaterThan(0)
    for (const code of codes) {
      const message = errorMessage(code as keyof typeof AI_ERROR_MESSAGES)
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('explains how to set the API key when it is missing', () => {
    expect(errorMessage('no_api_key')).toContain('DATABYTE_API_KEY')
  })

  it('mentions the request plan when the quota is exhausted', () => {
    expect(errorMessage('payment_required')).toContain('Request Based Plan')
  })

  it('mentions the timeout limit', () => {
    expect(errorMessage('timeout')).toContain('30')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ai/errors.test.ts`
Expected: FAIL — `Cannot find module './errors'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/ai/errors.ts`:

```ts
import type { AiErrorCode } from '@shared/types'

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  unauthorized: 'API key ditolak. Periksa DATABYTE_API_KEY Anda.',
  payment_required: 'Jatah request habis. Top up Request Based Plan Anda.',
  forbidden: 'Akses ditolak. Periksa izin API key Anda.',
  not_found: 'Endpoint atau model tidak ditemukan. Periksa DATABYTE_MODEL.',
  rate_limited: 'Rate limit tercapai. Tunggu sebentar lalu coba lagi.',
  no_api_key:
    'API key belum diatur. Tambahkan di Settings atau variabel DATABYTE_API_KEY.',
  timeout: 'Permintaan melebihi batas 30 detik.',
  network: 'Gagal menghubungi server DataByte.',
  invalid_response: 'Respons server tidak dapat dibaca.',
  unknown: 'Terjadi kesalahan tak terduga.'
}

export function mapHttpStatus(status: number): AiErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized'
    case 402:
      return 'payment_required'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 429:
      return 'rate_limited'
    default:
      return 'unknown'
  }
}

export function errorMessage(code: AiErrorCode): string {
  return AI_ERROR_MESSAGES[code]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ai/errors.test.ts`
Expected: PASS — 11 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/errors.ts src/main/ai/errors.test.ts
git commit -m "feat: add AI error code mapping with Indonesian messages"
```

---

## Task 7: DataByte AI client

**Files:**
- Create: `src/main/ai/prompt.ts`, `src/main/ai/DataByteClient.ts`
- Test: `src/main/ai/DataByteClient.test.ts`

**Interfaces:**
- Consumes: `AiResult` from `src/shared/types.ts` (Task 2); `mapHttpStatus`, `errorMessage` from Task 6
- Produces:
  - `DATABYTE_ENDPOINT = 'https://ai.databyte.co.id/v1/chat/completions'`
  - `DEFAULT_SYSTEM_PROMPT: string`
  - `buildChatBody(model: string, question: string): { model: string; messages: { role: string; content: string }[]; temperature: number; max_tokens: number; stream: false }`
  - `extractAnswer(payload: unknown): string | null`
  - `class DataByteClient`
    - `constructor(options: { getApiKey: () => Promise<string>; getModel: () => Promise<string>; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch })`
    - `async ask(question: string): Promise<AiResult>`

- [ ] **Step 1: Write the failing test**

Create `src/main/ai/DataByteClient.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { DataByteClient, DATABYTE_ENDPOINT, extractAnswer, buildChatBody } from './DataByteClient'

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as unknown as Response
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({})
  } as unknown as Response
}

const question = 'Berapa harga langganan?'
const answer = 'Harga mulai dari 100 ribu per bulan.'

describe('buildChatBody', () => {
  it('uses the PRD parameters', () => {
    const body = buildChatBody('MiniMax-M3', question)
    expect(body.model).toBe('MiniMax-M3')
    expect(body.temperature).toBe(0.3)
    expect(body.max_tokens).toBe(600)
    expect(body.stream).toBe(false)
  })

  it('sends the question as the only user content', () => {
    const body = buildChatBody('MiniMax-M3', question)
    const userMessages = body.messages.filter((m) => m.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]?.content).toBe(question)
  })
})

describe('extractAnswer', () => {
  it('reads choices[0].message.content', () => {
    const payload = { choices: [{ message: { content: answer } }] }
    expect(extractAnswer(payload)).toBe(answer)
  })

  it('returns null for a malformed payload', () => {
    expect(extractAnswer({ nope: true })).toBeNull()
    expect(extractAnswer(null)).toBeNull()
  })
})

describe('DataByteClient.ask', () => {
  it('returns the answer on success', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ choices: [{ message: { content: answer } }] }))
    const client = new DataByteClient({
      getApiKey: async () => 'sk-db-test',
      getModel: async () => 'MiniMax-M3',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const result = await client.ask(question)
    expect(result.ok).toBe(true)
    expect(result.answer).toBe(answer)
    expect(result.errorCode).toBeNull()
  })

  it('calls the DataByte endpoint with a bearer token', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ choices: [{ message: { content: answer } }] }))
    const client = new DataByteClient({
      getApiKey: async () => 'sk-db-test',
      getModel: async () => 'MiniMax-M3',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    await client.ask(question)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(DATABYTE_ENDPOINT)
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-db-test')
  })

  it('does not call fetch when there is no API key', async () => {
    const fetchImpl = vi.fn(async () => okResponse({}))
    const client = new DataByteClient({
      getApiKey: async () => '',
      getModel: async () => 'MiniMax-M3',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const result = await client.ask(question)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('no_api_key')
    expect(result.message).toContain('DATABYTE_API_KEY')
  })

  it('prefers the env API key over the stored one', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ choices: [{ message: { content: answer } }] }))
    const client = new DataByteClient({
      getApiKey: async () => 'sk-db-from-store',
      getModel: async () => 'MiniMax-M3',
      env: { DATABYTE_API_KEY: 'sk-db-from-env' },
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    await client.ask(question)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-db-from-env')
  })

  it('prefers the env model over the stored one', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ choices: [{ message: { content: answer } }] }))
    const client = new DataByteClient({
      getApiKey: async () => 'sk-db-test',
      getModel: async () => 'MiniMax-M3',
      env: { DATABYTE_MODEL: 'Model-From-Env' },
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    await client.ask(question)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { model: string }
    expect(body.model).toBe('Model-From-Env')
  })

  it.each([
    [401, 'unauthorized'],
    [402, 'payment_required'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'rate_limited']
  ])('maps HTTP %i to %s', async (status, code) => {
    const fetchImpl = vi.fn(async () => errorResponse(status as number))
    const client = new DataByteClient({
      getApiKey: async () => 'sk-db-test',
      getModel: async () => 'MiniMax-M3',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const result = await client.ask(question)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe(code)
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('reports a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const client = new DataByteClient({
      getApiKey: async () => 'sk-db-test',
      getModel: async () => 'MiniMax-M3',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const result = await client.ask(question)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('network')
  })

  it('reports an unreadable response body', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ unexpected: true }))
    const client = new DataByteClient({
      getApiKey: async () => 'sk-db-test',
      getModel: async () => 'MiniMax-M3',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const result = await client.ask(question)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('invalid_response')
  })

  it('reports a timeout when the request exceeds the limit', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
    )
    const client = new DataByteClient({
      getApiKey: async () => 'sk-db-test',
      getModel: async () => 'MiniMax-M3',
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const result = await client.ask(question)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('timeout')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ai/DataByteClient.test.ts`
Expected: FAIL — `Cannot find module './DataByteClient'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/ai/prompt.ts`:

```ts
export const DEFAULT_SYSTEM_PROMPT = [
  'You are an assistant for a presenter who is speaking to an audience.',
  'Answer the question the presenter typed, in the same language the question uses.',
  'Keep the answer concise: at most a few sentences or a short list.',
  'If you are not certain, say so plainly instead of inventing details.',
  'Never claim to have observed the screen, the audio, or the clipboard.'
].join(' ')
```

Create `src/main/ai/DataByteClient.ts`:

```ts
import type { AiResult } from '@shared/types'
import { DEFAULT_MODEL } from '@shared/types'
import { mapHttpStatus, errorMessage } from './errors'
import { DEFAULT_SYSTEM_PROMPT } from './prompt'

export const DATABYTE_ENDPOINT = 'https://ai.databyte.co.id/v1/chat/completions'
export const DEFAULT_TIMEOUT_MS = 30_000

export interface ChatBody {
  model: string
  messages: { role: string; content: string }[]
  temperature: number
  max_tokens: number
  stream: false
}

export function buildChatBody(model: string, question: string): ChatBody {
  return {
    model,
    messages: [
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
      { role: 'user', content: question }
    ],
    temperature: 0.3,
    max_tokens: 600,
    stream: false
  }
}

export function extractAnswer(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0]
  if (typeof first !== 'object' || first === null) return null
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : null
}

export interface DataByteClientOptions {
  getApiKey: () => Promise<string>
  getModel: () => Promise<string>
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class DataByteClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly env: NodeJS.ProcessEnv

  constructor(private readonly options: DataByteClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.env = options.env ?? process.env
  }

  async ask(question: string): Promise<AiResult> {
    const apiKey = this.env.DATABYTE_API_KEY?.trim() || (await this.options.getApiKey()).trim()
    if (apiKey.length === 0) {
      return failure('no_api_key')
    }

    const model = this.env.DATABYTE_MODEL?.trim() || (await this.options.getModel()) || DEFAULT_MODEL
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(DATABYTE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(buildChatBody(model, question)),
        signal: controller.signal
      })

      if (!response.ok) {
        return failure(mapHttpStatus(response.status))
      }

      const payload: unknown = await response.json()
      const answer = extractAnswer(payload)
      if (answer === null) {
        return failure('invalid_response')
      }
      return { ok: true, answer, errorCode: null, message: '' }
    } catch (error) {
      if (isAbortError(error)) {
        return failure('timeout')
      }
      return failure('network')
    } finally {
      clearTimeout(timer)
    }
  }
}

function failure(errorCode: AiResult['errorCode']): AiResult {
  return {
    ok: false,
    answer: '',
    errorCode,
    message: errorCode === null ? '' : errorMessage(errorCode)
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'AbortError'
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ai/DataByteClient.test.ts`
Expected: PASS — 15 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/prompt.ts src/main/ai/DataByteClient.ts src/main/ai/DataByteClient.test.ts
git commit -m "feat: add DataByte AI client with timeout and error mapping"
```

---

## Task 8: Electron protection adapter and window factory

**Files:**
- Create: `src/main/protection/electronAdapter.ts`, `src/main/windows/notesWindow.ts`
- Test: `src/main/protection/electronAdapter.test.ts`, `src/main/windows/notesWindow.test.ts`

**Interfaces:**
- Consumes: `ContentProtectionAdapter` from `src/main/protection/types.ts` (Task 3)
- Produces:
  - `createElectronProtectionAdapter(win: BrowserWindow): ContentProtectionAdapter`
  - `createNotesWindow(options: { preloadPath: string; rendererFile: string }): BrowserWindow`

- [ ] **Step 1: Write the failing test**

Create `src/main/protection/electronAdapter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createElectronProtectionAdapter } from './electronAdapter'

describe('createElectronProtectionAdapter', () => {
  it('calls setContentProtection(true) when enabling', async () => {
    const setContentProtection = vi.fn()
    const adapter = createElectronProtectionAdapter({ setContentProtection } as never)
    await adapter.apply(true)
    expect(setContentProtection).toHaveBeenCalledWith(true)
  })

  it('calls setContentProtection(false) when disabling', async () => {
    const setContentProtection = vi.fn()
    const adapter = createElectronProtectionAdapter({ setContentProtection } as never)
    await adapter.apply(false)
    expect(setContentProtection).toHaveBeenCalledWith(false)
  })

  it('rethrows the Electron error so the service can record it', async () => {
    const setContentProtection = vi.fn(() => {
      throw new Error('setContentProtection failed')
    })
    const adapter = createElectronProtectionAdapter({ setContentProtection } as never)
    await expect(adapter.apply(true)).rejects.toThrow('setContentProtection failed')
  })
})
```

Create `src/main/windows/notesWindow.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const browserWindowOptions: unknown[] = []

vi.mock('electron', () => ({
  BrowserWindow: class {
    once = vi.fn()
    show = vi.fn()
    loadFile = vi.fn().mockResolvedValue(undefined)
    constructor(options: unknown) {
      browserWindowOptions.push(options)
    }
  }
}))

import { createNotesWindow } from './notesWindow'

beforeEach(() => {
  browserWindowOptions.length = 0
})

describe('createNotesWindow', () => {
  it('never asks the OS to hide the window from the taskbar or Dock (FR-05)', () => {
    createNotesWindow({ preloadPath: 'preload.js', rendererFile: 'index.html' })
    const options = browserWindowOptions[0] as Record<string, unknown>
    expect(options.skipTaskbar).toBeUndefined()
    expect(options.alwaysOnTop).toBeUndefined()
    expect(options.hidden).toBeUndefined()
  })

  it('locks down the renderer web preferences', () => {
    createNotesWindow({ preloadPath: 'preload.js', rendererFile: 'index.html' })
    const options = browserWindowOptions[0] as Record<string, unknown>
    const webPreferences = options.webPreferences as Record<string, unknown>
    expect(webPreferences.contextIsolation).toBe(true)
    expect(webPreferences.nodeIntegration).toBe(false)
    expect(webPreferences.sandbox).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/protection/electronAdapter.test.ts`
Expected: FAIL — `Cannot find module './electronAdapter'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/protection/electronAdapter.ts`:

```ts
import type { BrowserWindow } from 'electron'
import type { ContentProtectionAdapter } from './types'

/**
 * Bridges the pure ProtectionService to Electron's window API.
 *
 * `setContentProtection` uses `SetWindowDisplayAffinity` with
 * `WDA_EXCLUDEFROMCAPTURE` on Windows and `NSWindow.sharingType = .none` on
 * macOS. Failures are propagated so the service can report `error` rather
 * than a false `on`.
 */
export function createElectronProtectionAdapter(win: BrowserWindow): ContentProtectionAdapter {
  return {
    async apply(enabled: boolean): Promise<void> {
      win.setContentProtection(enabled)
    }
  }
}
```

Create `src/main/windows/notesWindow.ts`:

```ts
import { BrowserWindow } from 'electron'
import { join } from 'node:path'

export interface NotesWindowOptions {
  preloadPath: string
  rendererFile: string
}

export function createNotesWindow(options: NotesWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 680,
    minWidth: 360,
    minHeight: 420,
    title: 'Private Presenter Notes',
    backgroundColor: '#12151c',
    show: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  void win.loadFile(options.rendererFile)
  return win
}

export function resolvePreloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

export function resolveRendererFile(): string {
  return join(__dirname, '../renderer/index.html')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/protection/electronAdapter.test.ts src/main/windows/notesWindow.test.ts`
Expected: PASS — 5 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/main/protection/electronAdapter.ts src/main/protection/electronAdapter.test.ts src/main/windows/notesWindow.ts src/main/windows/notesWindow.test.ts
git commit -m "feat: add Electron protection adapter and notes window factory"
```

---

## Task 9: IPC handler registration

**Files:**
- Create: `src/main/ipc/registerIpcHandlers.ts`
- Test: `src/main/ipc/registerIpcHandlers.test.ts`

**Interfaces:**
- Consumes: `IPC_CHANNELS` (Task 1); `ProtectionService` (Task 3); `NotesStore` (Task 4); `SettingsStore` (Task 5); `DataByteClient` (Task 7); `PublicSettings` (Task 2)
- Produces:
  - `interface IpcDependencies { protection: ProtectionService; notes: NotesStore; settings: SettingsStore; ai: DataByteClient; broadcast: (channel: string, payload: unknown) => void }`
  - `registerIpcHandlers(ipcMain: IpcMain, deps: IpcDependencies): void`
  - `toPublicSettings(data: SettingsData): PublicSettings`

- [ ] **Step 1: Write the failing test**

Create `src/main/ipc/registerIpcHandlers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerIpcHandlers, toPublicSettings } from './registerIpcHandlers'
import { IPC_CHANNELS } from '@shared/channels'

interface Handler {
  (_event: unknown, ...args: unknown[]): unknown
}

class FakeIpcMain {
  handlers = new Map<string, Handler>()

  handle(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler)
  }
}

function setup() {
  const ipcMain = new FakeIpcMain()
  const protection = {
    getSnapshot: vi.fn(() => ({ status: 'off' as const, reason: null, updatedAt: 1 })),
    toggle: vi.fn(async () => ({ status: 'on' as const, reason: null, updatedAt: 2 })),
    setEnabled: vi.fn(async () => ({ status: 'on' as const, reason: null, updatedAt: 3 }))
  }
  const notes = {
    read: vi.fn(async () => '# notes'),
    write: vi.fn(async () => undefined)
  }
  const settings = {
    read: vi.fn(async () => ({
      hasAcknowledgedNotice: false,
      apiKey: 'sk-db-secret',
      model: 'MiniMax-M3'
    })),
    write: vi.fn(async () => ({
      hasAcknowledgedNotice: true,
      apiKey: 'sk-db-secret',
      model: 'MiniMax-M3'
    })),
    getApiKey: vi.fn(async () => 'sk-db-secret'),
    getModel: vi.fn(async () => 'MiniMax-M3')
  }
  const ai = {
    ask: vi.fn(async () => ({ ok: true, answer: 'Jawaban', errorCode: null, message: '' }))
  }
  const broadcast = vi.fn()

  registerIpcHandlers(ipcMain as never, {
    protection: protection as never,
    notes: notes as never,
    settings: settings as never,
    ai: ai as never,
    broadcast
  })

  return { ipcMain, protection, notes, settings, ai, broadcast }
}

describe('registerIpcHandlers', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup()
  })

  it('registers every invoke channel exactly once', () => {
    expect([...ctx.ipcMain.handlers.keys()].sort()).toEqual(
      [...Object.values(IPC_CHANNELS)].sort()
    )
  })

  it('returns the current protection snapshot without toggling', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.protectionGet)
    const result = (await handler?.({}, undefined)) as { status: string }
    expect(result.status).toBe('off')
    expect(ctx.protection.toggle).not.toHaveBeenCalled()
  })

  it('toggles protection through the service', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.protectionToggle)
    await handler?.({}, undefined)
    expect(ctx.protection.toggle).toHaveBeenCalled()
  })

  it('reads notes', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.notesGet)
    await expect(handler?.({}, undefined)).resolves.toBe('# notes')
  })

  it('rejects a non-string notes payload', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.notesSave)
    await expect(handler?.({}, 42)).rejects.toThrow()
    expect(ctx.notes.write).not.toHaveBeenCalled()
  })

  it('saves a string notes payload', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.notesSave)
    await handler?.({}, 'hello')
    expect(ctx.notes.write).toHaveBeenCalledWith('hello')
  })

  it('rejects a non-string AI question', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.aiAsk)
    await expect(handler?.({}, { bad: true })).rejects.toThrow()
    expect(ctx.ai.ask).not.toHaveBeenCalled()
  })

  it('asks the AI client', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.aiAsk)
    const result = (await handler?.({}, 'apa itu?')) as { answer: string }
    expect(result.answer).toBe('Jawaban')
  })

  it('never exposes the API key through settings:get', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.settingsGet)
    const result = (await handler?.({}, undefined)) as Record<string, unknown>
    expect(result.hasApiKey).toBe(true)
    expect(result.apiKey).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('sk-db-secret')
  })

  it('reports the notice acknowledgement flag through settings:get', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.settingsGet)
    const result = (await handler?.({}, undefined)) as Record<string, unknown>
    expect(result.hasAcknowledgedNotice).toBe(false)
  })

  it('stores a new API key', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.settingsSetApiKey)
    await handler?.({}, 'sk-db-new')
    expect(ctx.settings.write).toHaveBeenCalledWith({ apiKey: 'sk-db-new' })
  })

  it('rejects a non-string API key', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.settingsSetApiKey)
    await expect(handler?.({}, 123)).rejects.toThrow()
  })

  it('acknowledges the first-run notice', async () => {
    const handler = ctx.ipcMain.handlers.get(IPC_CHANNELS.settingsAcknowledgeNotice)
    await handler?.({}, undefined)
    expect(ctx.settings.write).toHaveBeenCalledWith({ hasAcknowledgedNotice: true })
  })
})

describe('toPublicSettings', () => {
  it('reduces settings to a safe public shape', () => {
    const result = toPublicSettings({
      hasAcknowledgedNotice: true,
      apiKey: 'sk-db-secret',
      model: 'MiniMax-M3'
    })
    expect(result).toEqual({
      hasApiKey: true,
      model: 'MiniMax-M3',
      hasAcknowledgedNotice: true
    })
    expect(JSON.stringify(result)).not.toContain('sk-db-secret')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/registerIpcHandlers.test.ts`
Expected: FAIL — `Cannot find module './registerIpcHandlers'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/ipc/registerIpcHandlers.ts`:

```ts
import type { IpcMain } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/channels'
import type { PublicSettings, SettingsData } from '@shared/types'
import type { ProtectionService } from '../protection/ProtectionService'
import type { NotesStore } from '../storage/NotesStore'
import type { SettingsStore } from '../storage/SettingsStore'
import type { DataByteClient } from '../ai/DataByteClient'

export interface IpcDependencies {
  protection: ProtectionService
  notes: NotesStore
  settings: SettingsStore
  ai: DataByteClient
  broadcast: (channel: string, payload: unknown) => void
}

export function toPublicSettings(data: SettingsData): PublicSettings {
  return {
    hasApiKey: data.apiKey.trim().length > 0,
    model: data.model,
    hasAcknowledgedNotice: data.hasAcknowledgedNotice
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`)
  }
  return value
}

export function registerIpcHandlers(ipcMain: IpcMain, deps: IpcDependencies): void {
  ipcMain.handle(IPC_CHANNELS.protectionGet, async () => deps.protection.getSnapshot())

  ipcMain.handle(IPC_CHANNELS.protectionToggle, async () => {
    const snapshot = await deps.protection.toggle()
    deps.broadcast(IPC_EVENTS.protectionChanged, snapshot)
    return snapshot
  })

  ipcMain.handle(IPC_CHANNELS.notesGet, async () => deps.notes.read())

  ipcMain.handle(IPC_CHANNELS.notesSave, async (_event, content: unknown) => {
    const text = requireString(content, 'notes content')
    await deps.notes.write(text)
  })

  ipcMain.handle(IPC_CHANNELS.aiAsk, async (_event, question: unknown) => {
    const text = requireString(question, 'question')
    return deps.ai.ask(text)
  })

  ipcMain.handle(IPC_CHANNELS.settingsGet, async () => toPublicSettings(await deps.settings.read()))

  ipcMain.handle(IPC_CHANNELS.settingsSetApiKey, async (_event, value: unknown) => {
    if (value !== null) {
      requireString(value, 'api key')
    }
    const data = await deps.settings.write({ apiKey: (value as string | null) ?? '' })
    return toPublicSettings(data)
  })

  ipcMain.handle(IPC_CHANNELS.settingsSetModel, async (_event, value: unknown) => {
    const model = requireString(value, 'model')
    const data = await deps.settings.write({ model })
    return toPublicSettings(data)
  })

  ipcMain.handle(IPC_CHANNELS.settingsAcknowledgeNotice, async () => {
    await deps.settings.write({ hasAcknowledgedNotice: true })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/registerIpcHandlers.test.ts`
Expected: PASS — 13 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/registerIpcHandlers.ts src/main/ipc/registerIpcHandlers.test.ts
git commit -m "feat: register IPC handlers with argument validation"
```

---

## Task 10: Preload bridge

**Files:**
- Create: `src/preload/index.ts`
- Test: `src/preload/index.test.ts`

**Interfaces:**
- Consumes: `IPC_CHANNELS` (Task 1); `ProtectionSnapshot`, `AiResult`, `PublicSettings` (Task 2)
- Produces: `window.presenter` with exactly these methods:
  - `getProtectionStatus(): Promise<ProtectionSnapshot>`
  - `toggleProtection(): Promise<ProtectionSnapshot>`
  - `getNotes(): Promise<string>`
  - `saveNotes(content: string): Promise<void>`
  - `askAi(question: string): Promise<AiResult>`
  - `getSettings(): Promise<PublicSettings>`
  - `setApiKey(value: string | null): Promise<PublicSettings>`
  - `setModel(value: string): Promise<PublicSettings>`
  - `acknowledgeNotice(): Promise<void>`
  - `onProtectionChanged(cb: (snapshot: ProtectionSnapshot) => void): () => void`

- [ ] **Step 1: Write the failing test**

Create `src/preload/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/channels'

const invoke = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_key: string, api: unknown) => {
      ;(globalThis as { __api?: unknown }).__api = api
    })
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    on: (...args: unknown[]) => on(...args),
    removeListener: (...args: unknown[]) => removeListener(...args)
  }
}))

interface PresenterApi {
  getProtectionStatus(): Promise<unknown>
  toggleProtection(): Promise<unknown>
  getNotes(): Promise<string>
  saveNotes(content: string): Promise<void>
  askAi(question: string): Promise<unknown>
  getSettings(): Promise<unknown>
  setApiKey(value: string | null): Promise<unknown>
  setModel(value: string): Promise<unknown>
  acknowledgeNotice(): Promise<void>
  onProtectionChanged(cb: (snapshot: unknown) => void): () => void
}

let api: PresenterApi

beforeEach(async () => {
  invoke.mockReset()
  on.mockReset()
  removeListener.mockReset()
  await import('./index')
  api = (globalThis as { __api?: PresenterApi }).__api as PresenterApi
})

describe('preload bridge', () => {
  it('invokes the toggle channel', async () => {
    invoke.mockResolvedValue({ status: 'on' })
    await api.toggleProtection()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.protectionToggle)
  })

  it('reads the status without toggling', async () => {
    invoke.mockResolvedValue({ status: 'off' })
    await api.getProtectionStatus()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.protectionGet)
  })

  it('invokes the notes get channel', async () => {
    invoke.mockResolvedValue('notes')
    await expect(api.getNotes()).resolves.toBe('notes')
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.notesGet)
  })

  it('invokes the notes save channel with the content', async () => {
    await api.saveNotes('hello')
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.notesSave, 'hello')
  })

  it('invokes the AI channel with the question', async () => {
    invoke.mockResolvedValue({ ok: true, answer: 'a', errorCode: null, message: '' })
    await api.askAi('apa?')
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.aiAsk, 'apa?')
  })

  it('invokes the settings channels', async () => {
    invoke.mockResolvedValue({ hasApiKey: false, model: 'MiniMax-M3' })
    await api.getSettings()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.settingsGet)
    await api.setApiKey('sk-db-x')
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.settingsSetApiKey, 'sk-db-x')
    await api.setModel('Model-X')
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.settingsSetModel, 'Model-X')
    await api.acknowledgeNotice()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.settingsAcknowledgeNotice)
  })

  it('subscribes to protection changes and returns an unsubscribe function', () => {
    const unsubscribe = api.onProtectionChanged(() => undefined)
    expect(on).toHaveBeenCalledWith(IPC_EVENTS.protectionChanged, expect.any(Function))
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
    expect(removeListener).toHaveBeenCalled()
  })

  it('does not expose the raw ipcRenderer', () => {
    expect((api as unknown as Record<string, unknown>).ipcRenderer).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/preload/index.test.ts`
Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Write minimal implementation**

Create `src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/channels'
import type { AiResult, ProtectionSnapshot, PublicSettings } from '@shared/types'

const api = {
  getProtectionStatus: (): Promise<ProtectionSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.protectionGet) as Promise<ProtectionSnapshot>,

  toggleProtection: (): Promise<ProtectionSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.protectionToggle) as Promise<ProtectionSnapshot>,

  getNotes: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.notesGet) as Promise<string>,

  saveNotes: (content: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.notesSave, content) as Promise<void>,

  askAi: (question: string): Promise<AiResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.aiAsk, question) as Promise<AiResult>,

  getSettings: (): Promise<PublicSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsGet) as Promise<PublicSettings>,

  setApiKey: (value: string | null): Promise<PublicSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsSetApiKey, value) as Promise<PublicSettings>,

  setModel: (value: string): Promise<PublicSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsSetModel, value) as Promise<PublicSettings>,

  acknowledgeNotice: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsAcknowledgeNotice) as Promise<void>,

  onProtectionChanged: (callback: (snapshot: ProtectionSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: ProtectionSnapshot): void => callback(snapshot)
    ipcRenderer.on(IPC_EVENTS.protectionChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.protectionChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('presenter', api)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/preload/index.test.ts`
Expected: PASS — 7 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/preload/index.test.ts
git commit -m "feat: add preload contextBridge API"
```

---

## Task 11: Safe markdown rendering

**Files:**
- Create: `src/renderer/src/lib/markdown.ts`
- Test: `src/renderer/src/lib/markdown.dom.test.ts`

**Interfaces:**
- Consumes: `marked`, `dompurify`
- Produces:
  - `renderMarkdown(source: string): string` — sanitized HTML string
  - `markdownToPlainText(source: string): string` — for the character count / preview fallback

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/markdown.dom.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown, markdownToPlainText } from './markdown'

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const html = renderMarkdown('**bold**')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('removes script tags', () => {
    const html = renderMarkdown('hi <script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert(1)')
  })

  it('removes event handler attributes', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('onerror')
  })

  it('removes javascript: urls', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('forces links to open safely', () => {
    const html = renderMarkdown('[x](https://example.com)')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('target="_blank"')
  })

  it('escapes raw html instead of executing it', () => {
    const html = renderMarkdown('<iframe src="https://evil.example"></iframe>')
    expect(html).not.toContain('<iframe')
  })

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })
})

describe('markdownToPlainText', () => {
  it('strips markdown syntax', () => {
    const text = markdownToPlainText('# Title\n\n- **item**')
    expect(text).not.toContain('#')
    expect(text).not.toContain('**')
    expect(text).toContain('Title')
    expect(text).toContain('item')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/markdown.dom.test.ts`
Expected: FAIL — `Cannot find module './markdown'`

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/lib/markdown.ts`:

```ts
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
]

const ALLOWED_ATTR = ['href', 'title', 'align']

let hookInstalled = false

function installHook(): void {
  if (hookInstalled) return
  hookInstalled = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

export function renderMarkdown(source: string): string {
  if (source.length === 0) return ''
  installHook()
  const parsed = marked.parse(source, { async: false })
  return DOMPurify.sanitize(parsed, { ALLOWED_TAGS, ALLOWED_ATTR })
}

export function markdownToPlainText(source: string): string {
  if (source.length === 0) return ''
  const parsed = marked.parse(source, { async: false })
  const container = document.createElement('div')
  container.innerHTML = DOMPurify.sanitize(parsed, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
  return (container.textContent ?? '').trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/markdown.dom.test.ts`
Expected: PASS — 8 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/markdown.ts src/renderer/src/lib/markdown.dom.test.ts
git commit -m "feat: add sanitized markdown rendering"
```

---

## Task 12: Renderer app store

**Files:**
- Create: `src/renderer/src/state/appStore.ts`
- Test: `src/renderer/src/state/appStore.dom.test.ts`

**Interfaces:**
- Consumes: `ProtectionSnapshot`, `PublicSettings` from `src/shared/types.ts`
- Produces:
  - `interface AppState { protection: ProtectionSnapshot; settings: PublicSettings; notes: string; savedState: 'idle' | 'saving' | 'saved' | 'error'; noticeAcknowledged: boolean }`
  - `class AppStore`
    - `getState(): AppState`
    - `setState(patch: Partial<AppState>): void`
    - `subscribe(listener: (state: AppState) => void): () => void`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/state/appStore.dom.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { AppStore } from './appStore'

describe('AppStore', () => {
  it('starts with protection off', () => {
    const store = new AppStore()
    expect(store.getState().protection.status).toBe('off')
  })

  it('starts with the default model', () => {
    const store = new AppStore()
    expect(store.getState().settings.model).toBe('MiniMax-M3')
  })

  it('notifies subscribers on change', () => {
    const store = new AppStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.setState({ notes: 'hello' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0].notes).toBe('hello')
  })

  it('does not notify when nothing changed', () => {
    const store = new AppStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.setState({})
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const store = new AppStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.setState({ notes: 'x' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('replaces the protection snapshot', () => {
    const store = new AppStore()
    store.setState({ protection: { status: 'error', reason: 'boom', updatedAt: 5 } })
    expect(store.getState().protection.status).toBe('error')
    expect(store.getState().protection.reason).toBe('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/appStore.dom.test.ts`
Expected: FAIL — `Cannot find module './appStore'`

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/state/appStore.ts`:

```ts
import type { ProtectionSnapshot, PublicSettings } from '@shared/types'
import { DEFAULT_MODEL } from '@shared/types'

export interface AppState {
  protection: ProtectionSnapshot
  settings: PublicSettings
  notes: string
  savedState: 'idle' | 'saving' | 'saved' | 'error'
  noticeAcknowledged: boolean
}

const INITIAL_STATE: AppState = {
  protection: { status: 'off', reason: null, updatedAt: 0 },
  settings: { hasApiKey: false, model: DEFAULT_MODEL, hasAcknowledgedNotice: false },
  notes: '',
  savedState: 'idle',
  noticeAcknowledged: false
}

export class AppStore {
  private state: AppState = INITIAL_STATE
  private listeners = new Set<(state: AppState) => void>()

  getState(): AppState {
    return this.state
  }

  setState(patch: Partial<AppState>): void {
    const next = { ...this.state, ...patch }
    const changed = (Object.keys(next) as (keyof AppState)[]).some(
      (key) => next[key] !== this.state[key]
    )
    if (!changed) return
    this.state = next
    for (const listener of this.listeners) listener(this.state)
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/appStore.dom.test.ts`
Expected: PASS — 6 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/appStore.ts src/renderer/src/state/appStore.dom.test.ts
git commit -m "feat: add renderer app store"
```

---

## Task 13: Renderer views and styling

**Files:**
- Create: `src/renderer/index.html`, `src/renderer/src/main.ts`, `src/renderer/src/views/StatusBar.ts`, `src/renderer/src/views/EditorView.ts`, `src/renderer/src/views/AiPanel.ts`, `src/renderer/src/views/NoticeDialog.ts`, `src/renderer/src/views/SettingsDialog.ts`, `src/renderer/src/lib/dom.ts`, `src/renderer/src/styles/app.css`
- Test: `src/renderer/src/views/views.dom.test.ts`

**Interfaces:**
- Consumes: `AppStore` (Task 12); `renderMarkdown` (Task 11); `ProtectionSnapshot` (Task 2)
- Produces:
  - `createStatusBar(root: HTMLElement): { render(snapshot: ProtectionSnapshot): void }`
  - `createEditorView(root: HTMLElement, options: { onChange: (content: string) => void; getContent: () => string }): { render(content: string): void }`
  - `createAiPanel(root: HTMLElement, options: { onAsk: (question: string) => void }): { setAnswer(answer: string): void; setError(message: string): void; setBusy(busy: boolean): void }`
  - `createNoticeDialog(root: HTMLElement, options: { onAcknowledge: () => void }): { open(): void; close(): void }`
  - `createSettingsDialog(root: HTMLElement, options: { onSave: (apiKey: string | null, model: string) => void }): { open(current: PublicSettings): void; close(): void }`
  - `el(tag, props?, children?): HTMLElement` — DOM helper

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/views/views.dom.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createStatusBar } from './StatusBar'
import { createAiPanel } from './AiPanel'
import { createNoticeDialog } from './NoticeDialog'
import { createSettingsDialog } from './SettingsDialog'

function mount(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return root
}

describe('createStatusBar', () => {
  it('renders the OFF state in grey with the word Not protected', () => {
    const root = mount()
    const bar = createStatusBar(root)
    bar.render({ status: 'off', reason: null, updatedAt: 1 })
    expect(root.textContent).toContain('Not protected')
    expect(root.querySelector('[data-status="off"]')).not.toBeNull()
  })

  it('renders the ON state with the word Protected', () => {
    const root = mount()
    const bar = createStatusBar(root)
    bar.render({ status: 'on', reason: null, updatedAt: 1 })
    expect(root.textContent).toContain('Protected')
    expect(root.querySelector('[data-status="on"]')).not.toBeNull()
  })

  it('renders the ERROR state with a distinct label and the reason', () => {
    const root = mount()
    const bar = createStatusBar(root)
    bar.render({ status: 'error', reason: 'API failure', updatedAt: 1 })
    expect(root.textContent).toContain('Protection failed')
    expect(root.textContent).not.toContain('Protected')
    const indicator = root.querySelector('[data-status="error"]')
    expect(indicator?.getAttribute('title')).toContain('API failure')
  })

  it('never uses the ON state for an error', () => {
    const root = mount()
    const bar = createStatusBar(root)
    bar.render({ status: 'error', reason: 'x', updatedAt: 1 })
    expect(root.querySelector('[data-status="on"]')).toBeNull()
  })
})

describe('createAiPanel', () => {
  it('always shows the third-party warning label', () => {
    const root = mount()
    createAiPanel(root, { onAsk: vi.fn() })
    expect(root.textContent).toContain('DataByte')
    expect(root.textContent).toContain('may be wrong')
  })

  it('keeps the warning label after an answer arrives', () => {
    const root = mount()
    const panel = createAiPanel(root, { onAsk: vi.fn() })
    panel.setAnswer('Some answer')
    expect(root.textContent).toContain('DataByte')
    expect(root.textContent).toContain('Some answer')
  })

  it('shows the error message', () => {
    const root = mount()
    const panel = createAiPanel(root, { onAsk: vi.fn() })
    panel.setError('Jatah request habis.')
    expect(root.textContent).toContain('Jatah request habis.')
  })

  it('calls onAsk with the typed question', () => {
    const root = mount()
    const onAsk = vi.fn()
    const panel = createAiPanel(root, { onAsk })
    const input = root.querySelector('textarea') as HTMLTextAreaElement
    input.value = 'apa itu?'
    panel.ask()
    expect(onAsk).toHaveBeenCalledWith('apa itu?')
  })

  it('does not call onAsk for an empty question', () => {
    const root = mount()
    const onAsk = vi.fn()
    const panel = createAiPanel(root, { onAsk })
    panel.ask()
    expect(onAsk).not.toHaveBeenCalled()
  })
})

describe('createNoticeDialog', () => {
  it('is hidden until opened', () => {
    const root = mount()
    const dialog = createNoticeDialog(root, { onAcknowledge: vi.fn() })
    expect(root.querySelector('[data-dialog="notice"]')?.hasAttribute('hidden')).toBe(true)
    dialog.open()
    expect(root.querySelector('[data-dialog="notice"]')?.hasAttribute('hidden')).toBe(false)
  })

  it('warns about exams, assessments and interviews', () => {
    const root = mount()
    const dialog = createNoticeDialog(root, { onAcknowledge: vi.fn() })
    dialog.open()
    const text = root.textContent ?? ''
    expect(text).toContain('exams')
    expect(text).toContain('assessments')
    expect(text).toContain('interviews')
  })

  it('states that the app stays visible in the taskbar', () => {
    const root = mount()
    const dialog = createNoticeDialog(root, { onAcknowledge: vi.fn() })
    dialog.open()
    expect(root.textContent).toContain('taskbar')
  })

  it('calls onAcknowledge and closes', () => {
    const root = mount()
    const onAcknowledge = vi.fn()
    const dialog = createNoticeDialog(root, { onAcknowledge })
    dialog.open()
    ;(root.querySelector('[data-action="acknowledge"]') as HTMLButtonElement).click()
    expect(onAcknowledge).toHaveBeenCalled()
    expect(root.querySelector('[data-dialog="notice"]')?.hasAttribute('hidden')).toBe(true)
  })
})

describe('createSettingsDialog', () => {
  it('is hidden until opened', () => {
    const root = mount()
    const dialog = createSettingsDialog(root, { onSave: vi.fn() })
    expect(root.querySelector('[data-dialog="settings"]')?.hasAttribute('hidden')).toBe(true)
  })

  it('uses a password input for the API key', () => {
    const root = mount()
    createSettingsDialog(root, { onSave: vi.fn() })
    const input = root.querySelector('input[data-field="apiKey"]') as HTMLInputElement
    expect(input.type).toBe('password')
  })

  it('does not prefill the API key value', () => {
    const root = mount()
    const dialog = createSettingsDialog(root, { onSave: vi.fn() })
    dialog.open({ hasApiKey: true, model: 'MiniMax-M3' })
    const input = root.querySelector('input[data-field="apiKey"]') as HTMLInputElement
    expect(input.value).toBe('')
    expect(root.textContent).toContain('API key tersimpan')
  })

  it('passes the model to onSave', () => {
    const root = mount()
    const onSave = vi.fn()
    const dialog = createSettingsDialog(root, { onSave })
    dialog.open({ hasApiKey: false, model: 'MiniMax-M3' })
    const model = root.querySelector('input[data-field="model"]') as HTMLInputElement
    model.value = 'Other-Model'
    ;(root.querySelector('[data-action="save-settings"]') as HTMLButtonElement).click()
    expect(onSave).toHaveBeenCalledWith(null, 'Other-Model')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/views/views.dom.test.ts`
Expected: FAIL — `Cannot find module './StatusBar'`

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/lib/dom.ts`:

```ts
type Props = Record<string, string | number | boolean | undefined>
type Child = Node | string | null | undefined

export function el(tag: string, props: Props = {}, children: Child[] = []): HTMLElement {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}
```

Create `src/renderer/src/views/StatusBar.ts`:

```ts
import type { ProtectionSnapshot } from '@shared/types'
import { clear, el } from '../lib/dom'

const LABELS: Record<ProtectionSnapshot['status'], string> = {
  off: 'Not protected',
  on: 'Protected',
  error: 'Protection failed'
}

export function createStatusBar(root: HTMLElement): { render(snapshot: ProtectionSnapshot): void } {
  const indicator = el('span', { class: 'status-indicator', 'data-status': 'off' })
  const label = el('span', { class: 'status-label', 'data-status': 'off', text: LABELS.off })
  root.append(indicator, label)

  return {
    render(snapshot: ProtectionSnapshot): void {
      indicator.setAttribute('data-status', snapshot.status)
      label.setAttribute('data-status', snapshot.status)
      label.textContent = LABELS[snapshot.status]
      if (snapshot.status === 'error') {
        indicator.setAttribute('title', snapshot.reason ?? 'Protection failed')
      } else {
        indicator.removeAttribute('title')
      }
    }
  }
}
```

Create `src/renderer/src/views/EditorView.ts`:

```ts
import { renderMarkdown } from '../lib/markdown'
import { clear, el } from '../lib/dom'

export interface EditorViewOptions {
  onChange: (content: string) => void
  getContent: () => string
}

export function createEditorView(
  root: HTMLElement,
  options: EditorViewOptions
): { render(content: string): void } {
  const tabs = el('div', { class: 'tabs' })
  const notesTab = el('button', { class: 'tab', 'data-tab': 'notes', text: 'Notes' })
  const previewTab = el('button', { class: 'tab', 'data-tab': 'preview', text: 'Preview' })
  tabs.append(notesTab, previewTab)

  const textarea = el('textarea', {
    class: 'notes-input',
    'data-field': 'notes',
    placeholder: '# Agenda\n- Intro\n- Demo',
    spellcheck: 'false'
  }) as HTMLTextAreaElement

  const preview = el('div', { class: 'notes-preview', hidden: 'true' })

  textarea.addEventListener('input', () => {
    options.onChange(textarea.value)
  })

  const showNotes = (): void => {
    textarea.hidden = false
    preview.hidden = true
    notesTab.classList.add('is-active')
    previewTab.classList.remove('is-active')
  }

  const showPreview = (): void => {
    textarea.hidden = true
    preview.hidden = false
    previewTab.classList.add('is-active')
    notesTab.classList.remove('is-active')
    preview.innerHTML = renderMarkdown(options.getContent())
  }

  notesTab.addEventListener('click', showNotes)
  previewTab.addEventListener('click', showPreview)

  root.append(tabs, textarea, preview)

  return {
    render(content: string): void {
      if (textarea.value !== content) textarea.value = content
      if (!preview.hidden) {
        clear(preview)
        preview.innerHTML = renderMarkdown(content)
      }
    }
  }
}
```

Create `src/renderer/src/views/AiPanel.ts`:

```ts
import { clear, el } from '../lib/dom'

export interface AiPanelOptions {
  onAsk: (question: string) => void
}

export function createAiPanel(
  root: HTMLElement,
  options: AiPanelOptions
): {
  setAnswer(answer: string): void
  setError(message: string): void
  setBusy(busy: boolean): void
  ask(): void
} {
  const input = el('textarea', {
    class: 'ai-input',
    'data-field': 'question',
    placeholder: 'Ask a question...',
    rows: '3'
  }) as HTMLTextAreaElement

  const askButton = el('button', { class: 'ai-ask', 'data-action': 'ask', text: 'Ask' }) as HTMLButtonElement
  const answer = el('div', { class: 'ai-answer', 'data-field': 'answer' })

  const warning = el(
    'p',
    { class: 'ai-warning', 'data-field': 'ai-warning' },
    [
      'Questions are sent to DataByte (a third party). AI answers may be wrong.'
    ]
  )

  root.append(
    el('h2', { class: 'panel-title', text: 'AI Assist' }),
    input,
    askButton,
    answer,
    warning
  )

  const ask = (): void => {
    const question = input.value.trim()
    if (question.length === 0) return
    options.onAsk(question)
  }

  askButton.addEventListener('click', ask)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      ask()
    }
  })

  return {
    ask,
    setAnswer(text: string): void {
      clear(answer)
      answer.textContent = text
    },
    setError(message: string): void {
      clear(answer)
      answer.textContent = message
      answer.setAttribute('data-error', 'true')
    },
    setBusy(busy: boolean): void {
      askButton.disabled = busy
      askButton.textContent = busy ? 'Asking...' : 'Ask'
    }
  }
}
```

Create `src/renderer/src/views/NoticeDialog.ts`:

```ts
import { el } from '../lib/dom'

export interface NoticeDialogOptions {
  onAcknowledge: () => void
}

export function createNoticeDialog(
  root: HTMLElement,
  options: NoticeDialogOptions
): { open(): void; close(): void } {
  const dialog = el('div', { class: 'dialog', 'data-dialog': 'notice', hidden: 'true' })

  const acknowledge = el('button', {
    class: 'primary',
    'data-action': 'acknowledge',
    text: 'I understand — continue'
  }) as HTMLButtonElement

  acknowledge.addEventListener('click', () => {
    options.onAcknowledge()
    dialog.hidden = true
  })

  dialog.append(
    el('h2', { text: 'Before you use Private Presenter Notes' }),
    el('p', {
      text:
        'This app hides your notes from screen sharing by asking the operating system to exclude the window from capture. It does not hide itself — the app and its window stay visible in your taskbar, window list, and Task Manager.'
    }),
    el('p', {
      text:
        "Make sure your use complies with your meeting or organization's rules. Using it during exams, assessments, or interviews that prohibit external help is not appropriate."
    }),
    el('p', {
      text:
        'A camera pointed at your screen, hardware recorders, and system-level monitoring software can still see this window.'
    }),
    acknowledge
  )

  root.append(dialog)

  return {
    open(): void {
      dialog.hidden = false
    },
    close(): void {
      dialog.hidden = true
    }
  }
}
```

Create `src/renderer/src/views/SettingsDialog.ts`:

```ts
import type { PublicSettings } from '@shared/types'
import { el } from '../lib/dom'

export interface SettingsDialogOptions {
  onSave: (apiKey: string | null, model: string) => void
}

export function createSettingsDialog(
  root: HTMLElement,
  options: SettingsDialogOptions
): { open(current: PublicSettings): void; close(): void } {
  const dialog = el('div', { class: 'dialog', 'data-dialog': 'settings', hidden: 'true' })

  const apiKey = el('input', {
    type: 'password',
    'data-field': 'apiKey',
    placeholder: 'sk-db-...',
    autocomplete: 'off'
  }) as HTMLInputElement

  const model = el('input', {
    type: 'text',
    'data-field': 'model',
    placeholder: 'MiniMax-M3'
  }) as HTMLInputElement

  const status = el('p', { class: 'settings-status', 'data-field': 'key-status' })

  const save = el('button', {
    class: 'primary',
    'data-action': 'save-settings',
    text: 'Save'
  }) as HTMLButtonElement

  save.addEventListener('click', () => {
    const keyValue = apiKey.value.trim()
    options.onSave(keyValue.length > 0 ? keyValue : null, model.value.trim())
    dialog.hidden = true
  })

  dialog.append(
    el('h2', { text: 'Settings' }),
    el('label', { text: 'DataByte API key' }),
    apiKey,
    status,
    el('label', { text: 'Model' }),
    model,
    save
  )

  root.append(dialog)

  return {
    open(current: PublicSettings): void {
      apiKey.value = ''
      model.value = current.model
      status.textContent = current.hasApiKey
        ? 'API key tersimpan. Kosongkan untuk menghapus.'
        : 'Belum ada API key tersimpan.'
      dialog.hidden = false
    },
    close(): void {
      dialog.hidden = true
    }
  }
}
```

Create `src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none';"
    />
    <title>Private Presenter Notes</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `src/renderer/src/styles/app.css`:

```css
:root {
  --bg: #12151c;
  --panel: #1a1f2a;
  --border: #2a3140;
  --text: #e6e9ef;
  --muted: #8b93a7;
  --accent: #4c8dff;
  --ok: #3fb950;
  --warn: #d29922;
  --err: #f85149;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.app-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.status-indicator {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  background: var(--muted);
}

.status-indicator[data-status='on'] {
  background: var(--ok);
}

.status-indicator[data-status='error'] {
  background: var(--err);
  border-radius: 2px;
}

.status-label {
  color: var(--muted);
}

.status-label[data-status='on'] {
  color: var(--ok);
}

.status-label[data-status='error'] {
  color: var(--err);
}

.hotkey-hint {
  color: var(--muted);
  font-size: 12px;
}

.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.editor-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  border-right: 1px solid var(--border);
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.tab {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  padding: 4px 10px;
}

.tab.is-active {
  background: var(--bg);
  border-color: var(--border);
  color: var(--text);
}

.notes-input,
.notes-preview {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  outline: none;
  overflow-y: auto;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.55;
  resize: none;
}

.notes-preview pre {
  background: var(--panel);
  border-radius: 6px;
  padding: 8px;
  overflow-x: auto;
}

.ai-pane {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  overflow-y: auto;
}

.panel-title {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.ai-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
}

.ai-ask,
.primary {
  align-self: flex-start;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.ai-ask:disabled {
  opacity: 0.6;
  cursor: default;
}

.ai-answer {
  min-height: 60px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  white-space: pre-wrap;
  line-height: 1.5;
}

.ai-answer[data-error='true'] {
  border-color: var(--err);
  color: var(--err);
}

.ai-warning {
  margin: 0;
  color: var(--warn);
  font-size: 12px;
  line-height: 1.45;
}

.app-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  font-size: 12px;
}

.dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(520px, calc(100vw - 32px));
  height: fit-content;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: 0 20px 60px rgb(0 0 0 / 45%);
  z-index: 10;
}

.dialog[hidden] {
  display: none;
}

.dialog h2 {
  margin-top: 0;
  font-size: 16px;
}

.dialog label {
  display: block;
  margin: 12px 0 4px;
  color: var(--muted);
  font-size: 12px;
}

.dialog input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
}

.settings-status {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
}
```

Create `src/renderer/src/main.ts`:

```ts
import { el } from './lib/dom'
import { AppStore } from './state/appStore'
import { createStatusBar } from './views/StatusBar'
import { createEditorView } from './views/EditorView'
import { createAiPanel } from './views/AiPanel'
import { createNoticeDialog } from './views/NoticeDialog'
import { createSettingsDialog } from './views/SettingsDialog'
import type { AiResult, ProtectionSnapshot } from '@shared/types'

declare global {
  interface Window {
    presenter: {
      getProtectionStatus(): Promise<ProtectionSnapshot>
      toggleProtection(): Promise<ProtectionSnapshot>
      getNotes(): Promise<string>
      saveNotes(content: string): Promise<void>
      askAi(question: string): Promise<AiResult>
      getSettings(): Promise<{ hasApiKey: boolean; model: string; hasAcknowledgedNotice: boolean }>
      setApiKey(value: string | null): Promise<{ hasApiKey: boolean; model: string; hasAcknowledgedNotice: boolean }>
      setModel(value: string): Promise<{ hasApiKey: boolean; model: string; hasAcknowledgedNotice: boolean }>
      acknowledgeNotice(): Promise<void>
      onProtectionChanged(cb: (snapshot: ProtectionSnapshot) => void): () => void
    }
  }
}

const store = new AppStore()
const root = document.getElementById('app')

if (!root) {
  throw new Error('mount point #app is missing')
}

if (typeof window.presenter === 'undefined') {
  root.append(
    el('div', { class: 'dialog' }, [
      'Fatal: the preload bridge is unavailable. Restart the app.'
    ])
  )
} else {
  const presenter = window.presenter

  const header = el('header', { class: 'app-header' })
  const body = el('div', { class: 'app-body' })
  const editorPane = el('section', { class: 'editor-pane' })
  const aiPane = el('aside', { class: 'ai-pane' })
  const footer = el('footer', { class: 'app-footer' })

  body.append(editorPane, aiPane)
  root.append(header, body, footer)

  header.append(el('h1', { class: 'app-title', text: 'Private Presenter Notes' }))

  const statusHost = el('span', { class: 'status' })
  const statusBar = createStatusBar(statusHost)
  header.append(statusHost)

  const toggleButton = el('button', {
    class: 'toggle',
    'data-action': 'toggle-protection',
    text: 'Toggle protection'
  }) as HTMLButtonElement

  const settingsButton = el('button', {
    class: 'secondary',
    'data-action': 'open-settings',
    text: 'Settings'
  }) as HTMLButtonElement

  header.append(toggleButton, settingsButton, el('span', {
    class: 'hotkey-hint',
    text: 'Ctrl+Shift+P'
  }))

  const saveStatus = el('span', { class: 'save-status', 'data-field': 'save-status' })
  const charCount = el('span', { class: 'char-count', 'data-field': 'char-count' })
  footer.append(saveStatus, charCount)

  let saveTimer: number | undefined

  const editor = createEditorView(editorPane, {
    onChange: (content) => {
      store.setState({ notes: content })
      charCount.textContent = `${content.length} chars`
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        void persist(content)
      }, 500)
    },
    getContent: () => store.getState().notes
  })

  async function persist(content: string): Promise<void> {
    store.setState({ savedState: 'saving' })
    saveStatus.textContent = 'Saving...'
    try {
      await presenter.saveNotes(content)
      store.setState({ savedState: 'saved' })
      saveStatus.textContent = 'Saved'
    } catch {
      store.setState({ savedState: 'error' })
      saveStatus.textContent = "Couldn't save notes"
    }
  }

  const aiPanel = createAiPanel(aiPane, {
    onAsk: (question) => {
      void runAi(question)
    }
  })

  async function runAi(question: string): Promise<void> {
    aiPanel.setBusy(true)
    try {
      const result = await presenter.askAi(question)
      if (result.ok) {
        aiPanel.setAnswer(result.answer)
      } else {
        aiPanel.setError(result.message)
      }
    } catch {
      aiPanel.setError('Terjadi kesalahan tak terduga.')
    } finally {
      aiPanel.setBusy(false)
    }
  }

  const notice = createNoticeDialog(root, {
    onAcknowledge: () => {
      void presenter.acknowledgeNotice().then(() => {
        store.setState({
          noticeAcknowledged: true,
          settings: { ...store.getState().settings, hasAcknowledgedNotice: true }
        })
      })
    }
  })

  const settings = createSettingsDialog(root, {
    onSave: (apiKey, model) => {
      void (async () => {
        if (apiKey !== null) {
          const updated = await presenter.setApiKey(apiKey)
          store.setState({ settings: updated })
        }
        const updated = await presenter.setModel(model)
        store.setState({ settings: updated })
      })()
    }
  })

  toggleButton.addEventListener('click', () => {
    void presenter.toggleProtection()
  })

  settingsButton.addEventListener('click', () => {
    settings.open(store.getState().settings)
  })

  presenter.onProtectionChanged((snapshot) => {
    store.setState({ protection: snapshot })
    statusBar.render(snapshot)
  })

  store.subscribe((state) => {
    statusBar.render(state.protection)
  })

  void (async () => {
    const [snapshot, notes, settingsData] = await Promise.all([
      presenter.getProtectionStatus(),
      presenter.getNotes(),
      presenter.getSettings()
    ])
    store.setState({ protection: snapshot, notes, settings: settingsData })
    statusBar.render(snapshot)
    editor.render(notes)
    charCount.textContent = `${notes.length} chars`
    if (!settingsData.hasAcknowledgedNotice) {
      notice.open()
    }
  })()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/views/views.dom.test.ts`
Expected: PASS — 15 tests passed

- [ ] **Step 5: Verify typecheck and lint are clean**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0 with no output

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/src/main.ts src/renderer/src/views src/renderer/src/lib/dom.ts src/renderer/src/styles/app.css
git commit -m "feat: add renderer views, layout and styling"
```

---

## Task 14: Main process wiring and hotkeys

**Files:**
- Create: `src/main/services/hotkeys.ts`, `src/main/services/singleInstance.ts`, `src/main/index.ts`
- Test: `src/main/services/hotkeys.test.ts`

**Interfaces:**
- Consumes: `ProtectionService` (Task 3), `NotesStore` (Task 4), `SettingsStore` (Task 5), `DataByteClient` (Task 7), `createElectronProtectionAdapter` (Task 8), `registerIpcHandlers` (Task 9), `createNotesWindow` (Task 8), `IPC_CHANNELS` (Task 1)
- Produces:
  - `TOGGLE_ACCELERATOR = 'Control+Shift+P'`
  - `registerHotkeys(options: { onToggle: () => void }): boolean` — returns false if registration failed
  - `acquireSingleInstanceLock(): boolean`
  - `src/main/index.ts` — the app entry point

- [ ] **Step 1: Write the failing test**

Create `src/main/services/hotkeys.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { TOGGLE_ACCELERATOR } from './hotkeys'

const register = vi.fn()

vi.mock('electron', () => ({
  globalShortcut: {
    register: (...args: unknown[]) => register(...args)
  }
}))

describe('TOGGLE_ACCELERATOR', () => {
  it('uses Ctrl+Shift+P', () => {
    expect(TOGGLE_ACCELERATOR).toBe('Control+Shift+P')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/hotkeys.test.ts`
Expected: FAIL — `Cannot find module './hotkeys'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/services/hotkeys.ts`:

```ts
import { globalShortcut } from 'electron'

export const TOGGLE_ACCELERATOR = 'Control+Shift+P'

export function registerHotkeys(options: { onToggle: () => void }): boolean {
  return globalShortcut.register(TOGGLE_ACCELERATOR, () => {
    options.onToggle()
  })
}
```

Create `src/main/services/singleInstance.ts`:

```ts
import { app } from 'electron'

export function acquireSingleInstanceLock(): boolean {
  return app.requestSingleInstanceLock()
}
```

Create `src/main/index.ts`:

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/channels'
import { createLogger } from '@shared/logger'
import { ProtectionService } from './protection/ProtectionService'
import { createElectronProtectionAdapter } from './protection/electronAdapter'
import { NotesStore } from './storage/NotesStore'
import { SettingsStore } from './storage/SettingsStore'
import { DataByteClient } from './ai/DataByteClient'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { createNotesWindow } from './windows/notesWindow'
import { registerHotkeys } from './services/hotkeys'
import { acquireSingleInstanceLock } from './services/singleInstance'

const log = createLogger('main')

if (!acquireSingleInstanceLock()) {
  app.quit()
} else {
  void start()
}

async function start(): Promise<void> {
  await app.whenReady()

  const userData = app.getPath('userData')
  const notes = new NotesStore(join(userData, 'notes.md'))
  const settings = new SettingsStore(join(userData, 'settings.json'))

  const win = createNotesWindow({
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererFile: join(__dirname, '../renderer/index.html')
  })

  const protection = new ProtectionService(createElectronProtectionAdapter(win))

  const ai = new DataByteClient({
    getApiKey: () => settings.getApiKey(),
    getModel: () => settings.getModel()
  })

  const broadcast = (channel: string, payload: unknown): void => {
    for (const target of BrowserWindow.getAllWindows()) {
      target.webContents.send(channel, payload)
    }
  }

  registerIpcHandlers(ipcMain, {
    protection,
    notes,
    settings,
    ai,
    broadcast
  })

  // The global hotkey calls the service directly, so it does not depend on
  // which window has focus, and the resulting status is broadcast to all windows.
  const registered = registerHotkeys({
    onToggle: () => {
      void protection.toggle().then((snapshot) => {
        broadcast(IPC_EVENTS.protectionChanged, snapshot)
      })
    }
  })
  if (!registered) {
    log.warn('global shortcut could not be registered; another app may hold it')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createNotesWindow({
        preloadPath: join(__dirname, '../preload/index.js'),
        rendererFile: join(__dirname, '../renderer/index.html')
      })
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/services/hotkeys.test.ts`
Expected: PASS — 1 test passed

- [ ] **Step 5: Verify typecheck and lint are clean**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0 with no output

- [ ] **Step 6: Commit**

```bash
git add src/main/services/hotkeys.ts src/main/services/hotkeys.test.ts src/main/services/singleInstance.ts src/main/index.ts
git commit -m "feat: wire main process, IPC handlers and global hotkey"
```

---

## Task 15: End-to-end smoke verification

**Files:**
- Create: `docs/testing-matrix.md`
- Modify: `README.md` (create)

**Interfaces:**
- Consumes: everything built in Tasks 1–14
- Produces: a verified app and the manual test matrix from the PRD

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`
Expected: PASS — all test files pass, 0 failures

- [ ] **Step 2: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0 with no output

- [ ] **Step 3: Build for production**

Run: `npm run build`
Expected: exits 0 and creates `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`

- [ ] **Step 4: Verify the production build kept the strict CSP**

Run: `grep -o "connect-src[^;]*;" out/renderer/index.html`
Expected: `connect-src 'none';`

- [ ] **Step 5: Verify the preload built as CommonJS**

Run: `grep -c "require(" out/preload/index.js`
Expected: `1` (or more) — the preload must use `require`, not `import`, because `sandbox: true` requires CJS.

- [ ] **Step 6: Launch the app and verify the core flow**

Run: `npm run dev`
Expected: the window opens. Verify by hand:
1. The status indicator reads "Not protected" and is grey (protection starts OFF).
2. Clicking "Toggle protection" turns it green and reads "Protected".
3. The notes textarea accepts text; the footer shows "Saving..." then "Saved".
4. Switching to the Preview tab renders the markdown.
5. The AI panel shows the permanent warning label.
6. Closing and reopening the app restores the notes.

- [ ] **Step 7: Verify the API key is not reachable from the renderer**

In the dev tools console of the notes window, run:
```js
JSON.stringify(window.presenter.getSettings())
```
Expected: `{"hasApiKey":false,"model":"MiniMax-M3"}` — no key value, even after setting one in Settings.

- [ ] **Step 8: Write the manual test matrix**

Create `docs/testing-matrix.md`:

```markdown
# Matriks Uji Manual — Private Presenter Notes

Diisi setelah setiap uji coba. Gunakan akun dan perangkat milik sendiri: satu perangkat
sebagai presenter, satu lagi (atau akun kedua) sebagai penonton.

Catat: OS + versi, aplikasi meeting + versi, dan hasil per baris.

| # | Skenario | Cara uji | OS / versi | Aplikasi / versi | Hasil | Catatan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Share seluruh layar di Zoom desktop (Windows) | Toggle ON, amati layar di sisi penonton | | | | |
| 2 | Share seluruh layar di Google Meet (Chrome) | Sama seperti 1 | | | | |
| 3 | Share seluruh layar di Microsoft Teams | Sama seperti 1 | | | | |
| 4 | Share satu jendela aplikasi lain, bukan layar penuh | Toggle ON dan OFF | | | | |
| 5 | Zoom, Meet, dan Teams di macOS | Sama seperti 1, catat versi macOS | | | | |
| 6 | Screenshot dan perekam layar bawaan OS | Tangkap layar saat ON | | | | |
| 7 | Toggle OFF | Matikan lalu amati penonton | | | | |
| 8 | Fail-visible | Simulasikan kegagalan API proteksi | | | | |
| 9 | Multi-monitor | Share monitor kedua dan monitor utama | | | | |
| 10 | Halaman demo fullscreen | Buka `demo.html`, masuk fullscreen | | | | |

## Uji AI Assist

| # | Skenario | Cara uji | Hasil | Catatan |
| --- | --- | --- | --- | --- |
| A1 | Tanpa API key | Kosongkan key di Settings, tekan Ask | | |
| A2 | API key salah | Isi key cacat, tekan Ask | | |
| A3 | Jatah request habis | Simulasikan HTTP 429 | | |
| A4 | Tidak ada request tanpa aksi | Tekan Ask, periksa log jaringan | | |
| A5 | API key tidak terlihat dari DevTools | Buka DevTools, periksa `window.presenter` | | |

## Keterbatasan yang harus konsisten dengan dokumentasi

- Kamera yang mengarah ke layar, perekam hardware, dan software monitoring tingkat sistem
  tetap bisa melihat jendela.
- macOS dengan ScreenCaptureKit bisa tetap menangkap jendela meski proteksi aktif.
- Windows di bawah versi 2004 bisa menampilkan area hitam, bukan mengeluarkan jendela dari capture.
```

- [ ] **Step 9: Write the README**

Create `README.md`:

````markdown
# Private Presenter Notes

Aplikasi desktop kecil yang menampilkan catatan, agenda, dan pertanyaan presenter di monitor
presenter **tanpa ikut tertangkap** saat layar dibagikan di Zoom, Google Meet, atau Teams.

Dibangun dari `PRD Private Presenter Notes.md`.

## Fitur (siklus ini)

- Editor catatan Markdown dengan preview, disimpan lokal di `%APPDATA%/meeting-private-window/notes.md`.
- Tombol dan hotkey global `Ctrl+Shift+P` untuk menyalakan/mematikan proteksi capture.
- Indikator status yang jujur: **Protected** (hijau), **Not protected** (abu-abu), atau
  **Protection failed** (merah) — tidak pernah menampilkan "Protected" jika proteksi gagal.
- Pemberitahuan penggunaan pertama kali.
- AI Assist: kirim pertanyaan yang Anda ketik ke DataByte API, jawaban ditampilkan di panel.

## Yang belum ada di siklus ini

Posisi/ukuran/opacity yang diingat, timer dan agenda per segmen, panduan tes capture,
teleprompter auto-scroll, ekspor/impor `.md`.

## Menjalankan

```bash
npm install
npm run dev
```

Perintah lain:

```bash
npm test          # unit + integrasi (Vitest)
npm run typecheck # tsc untuk main/preload dan renderer
npm run lint      # ESLint
npm run build     # build produksi ke out/
npm run dist      # build + paket installer (electron-builder)
```

## Konfigurasi AI Assist

API key dibaca dari main process. Urutan prioritas:

1. Variabel lingkungan `DATABYTE_API_KEY`
2. Nilai yang disimpan di dialog Settings (`settings.json` di userData)

Model diambil dari `DATABYTE_MODEL`, lalu dari Settings, lalu default `MiniMax-M3`.

```bash
# PowerShell
$env:DATABYTE_API_KEY = "sk-db-..."
$env:DATABYTE_MODEL = "MiniMax-M3"
npm run dev
```

> API key tidak pernah dikirim ke renderer, tidak masuk log, dan tidak tersimpan di file catatan.

## Batasan — baca sebelum dipakai

- Proteksi bekerja dengan meminta sistem operasi **mengecualikan jendela dari capture**.
  Ini bukan penyamaran aplikasi.
- Aplikasi dan jendelanya **tetap terlihat** di taskbar/Dock, daftar jendela, dan Task Manager.
- **Kamera yang mengarah ke layar, perekam hardware, dan software monitoring tingkat sistem
  tetap bisa melihat jendela ini.**
- Perilaku berbeda per versi OS dan per aplikasi meeting. Di macOS, aplikasi yang memakai
  ScreenCaptureKit bisa tetap menangkap jendela meski proteksi aktif.
- Pada Windows di bawah versi 2004, hasilnya bisa berupa **area hitam**, bukan jendela yang hilang.
- Aplikasi ini untuk kegunaan privasi presenter. **Jangan dipakai pada ujian, assessment, atau
  wawancara yang melarang bantuan eksternal.** Sesuaikan dengan kebijakan meeting atau
  organisasi Anda.

Matriks uji manual ada di [`docs/testing-matrix.md`](docs/testing-matrix.md).

## Arsitektur

```
src/
├─ shared/    # tipe & konstanta IPC, dipakai main + preload + renderer
├─ main/      # satu-satunya pihak yang boleh menyentuh OS
├─ preload/   # jembatan contextBridge -> window.presenter
└─ renderer/  # tanpa Node, tanpa jaringan (CSP connect-src 'none')
```

Aturan batas: renderer tidak pernah meng-import `electron` atau `node:*`; main dan preload
tidak pernah meng-import kode renderer. Semua aturan ini dipaksakan oleh ESLint.
````

- [ ] **Step 10: Commit**

```bash
git add README.md docs/testing-matrix.md
git commit -m "docs: add README and manual test matrix"
```

---

## Verification Summary

After all tasks complete, the following must all be true:

| Check | Command | Expected |
| --- | --- | --- |
| All tests pass | `npm test` | 0 failures |
| Types are strict and clean | `npm run typecheck` | exit 0 |
| Lint clean, layer boundaries enforced | `npm run lint` | exit 0 |
| Production build works | `npm run build` | creates `out/` |
| Renderer has no network access | `grep -o "connect-src[^;]*;" out/renderer/index.html` | `connect-src 'none';` |
| Preload is CommonJS | `grep -c "require(" out/preload/index.js` | ≥ 1 |
| Protection state machine has no Electron dependency | `grep -rn "electron" src/main/protection/ProtectionService.ts` | no match |
| API key never reaches the renderer | `JSON.stringify(await window.presenter.getSettings())` | no key value |
| Renderer cannot import Node | `grep -rn "from 'electron'" src/renderer/` | no match |

## Known Risks Carried Into the Manual Test Phase

These cannot be automated and are recorded in `docs/testing-matrix.md`:

1. Capture behaviour differs per OS version and per meeting app — a window may show black or stay captured.
2. macOS apps using ScreenCaptureKit may capture the window despite protection being active.
3. The `setContentProtection` flag takes effect on the **next** desktop composition, so a capture started immediately after the toggle can still contain the window. Leave a moment between toggling and sharing.
4. Windows below version 2004 falls back to `WDA_MONITOR` behaviour and shows a black area.
