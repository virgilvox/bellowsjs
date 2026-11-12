import { defineConfig } from 'vite';

/*
 * The bundles carry ported MIT code (THIRD_PARTY_NOTICES.md) and people copy
 * them on their own, from a CDN or into a vendor folder, so each one names its
 * licenses at the top. A /*! comment is a legal comment, which the minifier
 * keeps. scripts/gen-worklet.mjs puts the same line on the worklet bundle.
 */
const BANNER =
  '/*! bellowsjs | MIT, Copyright (c) 2026 Moheeb Zara | includes code from CHIMERA, https://github.com/jamesondh/chimera-vocal-synth, ' +
  'Copyright (c) 2026 Jameson Hodge, MIT License | notices in THIRD_PARTY_NOTICES.md */';

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
