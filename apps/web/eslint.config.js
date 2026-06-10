import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Allow intentionally-unused `_`-prefixed args/vars/catch-bindings — e.g. a
      // mock fn whose later positional args are read off `mock.calls` (not the body),
      // or a destructure that skips leading tuple slots.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // shadcn/ui components co-locate a component with its cva variants export,
    // which trips react-refresh's single-export rule. This is the upstream pattern.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // The surface registry is the single source of truth that co-locates the
    // route-level React.lazy() element factories with the NAV data + grouping
    // helpers — exporting both components and non-components by design.
    files: ['src/app/navigation.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Ambient .d.ts module augmentation (e.g. extending vitest's Assertion with
    // jest-dom matchers) legitimately needs `import = require` interop and empty
    // interfaces that merge into a supertype.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      // The matcher generics must mirror jest-dom's / @vitest/expect's own
      // `any`-defaulted signatures for declaration merging to apply.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
