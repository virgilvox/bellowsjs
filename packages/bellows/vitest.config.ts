import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    /* Builds dist/ once, before any worker, for package.test.ts. */
    globalSetup: ['./test/global-setup.ts'],
    /*
     * Not a performance gate, just room. Several tests render seconds of
     * audio and take two to three seconds on an idle machine: the brown
     * noise bound renders four seconds at 44100, and vitest's default
     * five second per-test limit leaves it about a factor of two of
     * headroom, which a loaded machine eats. Measured under load it timed
     * out; measured on vitest 2 and vitest 4 it takes the same time either
     * way, so the tightness is the default's, not a regression. The
     * assertions are the gate; this stops the clock being one.
     */
    testTimeout: 30_000,
  },
});
