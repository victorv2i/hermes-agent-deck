// Type-only augmentation: extends vitest's `expect` with jest-dom matchers
// (toBeInTheDocument, toHaveAttribute, …). The matchers are registered at
// runtime in setup.ts via expect.extend(matchers).
//
// vitest 4 declares `Assertion`/`AsymmetricMatchersContaining` in @vitest/expect
// (re-exported from "vitest"), so jest-dom's bundled `declare module "vitest"`
// augmentation does not merge. We augment @vitest/expect directly, matching the
// exact `<T = any>` generic default so declaration merging applies.
import matchersStandalone = require('@testing-library/jest-dom/matchers')

declare module '@vitest/expect' {
  interface Assertion<T = any> extends matchersStandalone.TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends matchersStandalone.TestingLibraryMatchers<
    any,
    void
  > {}
}
