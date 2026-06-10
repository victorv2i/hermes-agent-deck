import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Point @agent-deck/protocol at the worktree's local copy so tests pick up
      // changes that are not yet merged into the main project's package.
      '@agent-deck/protocol': path.resolve(__dirname, '../../packages/protocol/src/index.ts'),
      // Test-only stub for the windowing engine. The real `@tanstack/react-virtual`
      // is added to package.json deps and resolved by the production `vite.config.ts`
      // build (after the integrator's `pnpm install`); under jsdom — where every
      // element measures 0 — we substitute a deterministic windowing stub so the
      // virtualization contract (a bounded visible subset + measure + scroll) is
      // exercised hermetically without the package installed. See the stub for the
      // simulated-viewport math.
      '@tanstack/react-virtual': path.resolve(__dirname, './src/test/reactVirtualStub.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    passWithNoTests: true,
    // @lobehub/icons (and its transitive deps @lobehub/fluent-emoji, @lobehub/ui)
    // use extension-less ESM directory imports that Node.js ESM does not support.
    // Vite's transform resolves these correctly, so we inline these packages so
    // they're processed by Vite's plugin pipeline (adding .js extensions) rather
    // than being treated as native Node ESM externals.
    server: {
      deps: {
        inline: ['@lobehub/icons', '@lobehub/ui', '@lobehub/fluent-emoji'],
      },
    },
  },
})
