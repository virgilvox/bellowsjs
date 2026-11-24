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
      // BELLOWS_WASM_LOCAL=1 plays the workspace's own build of bellows-wasm (npm run build -w
      // packages/bellows-wasm first) instead of the published one, to try a change before release
      ...(process.env.BELLOWS_WASM_LOCAL
        ? { 'bellows-wasm-npm': fileURLToPath(new URL('../../packages/bellows-wasm/dist/index.js', import.meta.url)) }
        : {}),
    },
  },
  server: {
    port: 5173,
  },
  /*
   * bellows-voice imports 'bellowsjs' by name. Pre-bundled, esbuild would fold a second copy of
   * bellowsjs into it, and that copy's engine catalog never hears of the voice plugin the site's
   * copy loaded, so singer() throws (MEASURED: the voice lab failed this way in dev once
   * bellows-voice came from npm instead of a symlink). Left out of the pre-bundle, its import goes
   * through the alias above to the one copy the site uses. The production build resolves the same
   * way and was not affected. bellows-wasm, which the site takes from npm under the alias
   * bellows-wasm-npm (the workspace copy is unbuilt where the site builds), imports it the same way.
   */
  optimizeDeps: {
    exclude: ['bellows-voice', 'bellows-wasm-npm'],
  },
});
