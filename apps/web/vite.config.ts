import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server port + BFF proxy target are env-overridable so a second instance
// (the hermetic chat e2e, talking to the mock-gateway BFF) can run alongside the
// default one. Defaults preserve the original 5173 → :7878 behavior.
const devPort = Number(process.env.AGENT_DECK_WEB_PORT ?? '5173')
const bffTarget = process.env.AGENT_DECK_BFF_TARGET ?? 'http://127.0.0.1:7878'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // The heavy stacks (markdown/katex, mermaid, xterm, codemirror/shiki) are
    // imported only through lazy routes/components, so rolldown's automatic
    // chunking already keeps them out of the eager entry and splits them per
    // route. We deliberately do NOT name groups for those — consolidating them
    // creates shared chunks that get pulled back into the eager critical path
    // (modulepreload), which is a regression. We only curate the deps that are
    // *eagerly* loaded by the app shell, splitting them into independent,
    // long-cacheable vendor chunks. The result: a deploy that only touches app
    // code keeps the framework caches warm, and the eager entry shrinks from a
    // single ~900 kB blob to app glue + cacheable framework chunks.
    //
    // Rolldown's advancedChunks is the first-class API in Vite 8 (the older
    // rollupOptions.output.manualChunks is deprecated under rolldown-vite).
    // There is intentionally no catch-all `node_modules` group: a broad
    // catch-all sweeps lazy-only deps into a shared chunk and re-promotes them
    // into the eager path. `[\\/]` is used in the path tests per the rolldown
    // cross-platform recommendation.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            // Animation library — eager (used across the shell).
            { name: 'framer-motion', test: /node_modules[\\/]framer-motion[\\/]/ },
            // Data-fetching + virtualization — eager.
            { name: 'tanstack', test: /node_modules[\\/]@tanstack[\\/]/ },
            // Radix primitives — eager (UI kit).
            { name: 'radix', test: /node_modules[\\/](radix-ui|@radix-ui)[\\/]/ },
            // Realtime transport — eager.
            {
              name: 'socketio',
              test: /node_modules[\\/](socket\.io-client|engine\.io-client|socket\.io-parser|@socket\.io[\\/].*)[\\/]/,
            },
            // Router — eager, but versions independently of the app.
            {
              name: 'router',
              test: /node_modules[\\/](react-router|react-router-dom)[\\/]/,
              priority: 2,
            },
            // React core — the most stable dependency, isolated for max caching.
            // Higher priority so react/react-dom are claimed before any group
            // above could transitively reach them.
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
              priority: 3,
            },
          ],
        },
      },
    },
    // Lazy chunks (mermaid/codemirror) are legitimately large and load on
    // demand; raise the warning ceiling so the build output isn't noisy.
    chunkSizeWarningLimit: 700,
  },
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    proxy: {
      '/api': { target: bffTarget, changeOrigin: true },
      '/socket.io': { target: bffTarget, ws: true, changeOrigin: true },
    },
  },
})
