import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Version shown in the console's top bar: package.json version, plus the commit and date of the build.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
let commit = (process.env.GITHUB_SHA ?? '').slice(0, 7);
try { if (!commit) commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { commit = ''; }

// Relative base so the same build works on GitHub Pages (/simulador-consola-rm/) and anywhere else.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  test: { environment: 'node' },
} as never);
