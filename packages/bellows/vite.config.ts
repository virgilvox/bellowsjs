import { defineConfig } from 'vite';

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
  },
});
