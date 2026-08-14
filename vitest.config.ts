import { defineVitestConfig } from '@papercusp/test-config';

// Unit layer: *.test.ts, excludes *.integration.test.ts. Path aliases
// (@papercusp/*) resolve via vite-tsconfig-paths from the root tsconfig.
export default defineVitestConfig({ layer: 'unit' });
