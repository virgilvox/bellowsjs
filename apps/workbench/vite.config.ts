import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

/*
 * Both dev and build resolve the library from source. The comment here used
 * to say "dev", which was wrong about what the config did and hid the
 * consequence: bellows.live and the npm package are built from the same
 * source but are not the same artefact, so nothing the site does exercises
 * dist/, the exports map, scripts/postbuild.mjs or the emitted .d.ts.
 *
 * Building the app against dist/ instead was tried and rejected. It works,
 * but dist/bellows.js is one pre-bundled ESM file, so Rollup can no longer
 * split library internals across routes: measured, the entry chunk goes
 * from 123 KB gzipped to 145 KB while the total barely moves. That is 22 KB
 * on first paint to buy a check that belongs in a test.
 *
 * So the check is a test. packages/bellows/test/integration/package.test.ts
 * loads the built bundle through the package's own exports map and drives
 * it, which is what an installer gets, and CI runs it after the build.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      bellowsjs: fileURLToPath(new URL('../../packages/bellows/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
