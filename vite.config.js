import { defineConfig } from 'vite';

// The web app lives in web/. The .env file stays at the repo root.
export default defineConfig({
  root: 'web',
  envDir: '..',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2020' },
  server: { port: 5173, strictPort: true },
});
