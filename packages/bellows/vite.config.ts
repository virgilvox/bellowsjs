import { defineConfig } from 'vite';

/*
 * People copy the bundles on their own, from a CDN or into a vendor folder, so
 * each one names its license at the top. The singing voice, which carried
 * CHIMERA's MIT code, moved to bellows-voice with its notice. A /*! comment is a legal comment, which the minifier
 * keeps. scripts/gen-worklet.mjs puts the same line on the worklet bundle.
 */
const BANNER =
  '/*! bellowsjs | MIT, Copyright (c) 2026 Moheeb Zara */';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'Bellows',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'bellows.js' : 'bellows.standalone.js'),
    },
    sourcemap: true,
    target: 'es2022',
    minify: 'esbuild',
    rollupOptions: { output: { banner: BANNER } },
  },
});
