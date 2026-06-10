import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // apps/web has its own flat config (Vite scaffold); it is linted via its own
  // `lint` script. Excluding it here keeps a single tsconfigRootDir for the root run.
  // `.ux-*.mjs` are transient, untracked UX-probe scratch scripts (ad-hoc
  // Playwright drivers run against a live dev server), not part of the codebase.
  // Local tool working directories hold transient copies; never lint them.
  // `.design-gen/**` holds generated design artifacts; never lint them.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.gen.*',
      'apps/web/**',
      '.design-gen/**',
      '.claude/**',
      '.ux-*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Standalone Node scripts (e.g. the confirmatory live smoke). Plain .mjs, so
  // `no-undef` is active (unlike TS files); declare the Node globals they use.
  {
    files: ['apps/server/scripts/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
)
