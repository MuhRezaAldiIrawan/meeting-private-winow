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
