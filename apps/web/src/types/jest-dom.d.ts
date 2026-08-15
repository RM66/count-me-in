// Type-only side-effect: pulls the declare-module augmentation that adds
// jest-dom matchers (toBeInTheDocument, etc.) into the vitest Assertion type.
// vitest.setup.ts imports the same module at runtime, but it sits at the
// project root outside the tsconfig include, so the augmentation never reaches
// tsc. This file lives under src/types and is picked up by src/**/*.ts.
import '@testing-library/jest-dom/vitest'
