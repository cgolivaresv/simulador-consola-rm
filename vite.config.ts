import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (/simulador-consola-rm/) and anywhere else.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  test: { environment: 'node' },
} as never);
