import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Full paths, so the dev server finds both pages no matter where it is started from.
const page = (name) => fileURLToPath(new URL(`web/${name}`, import.meta.url));

// The web app lives in web/. The .env file stays at the repo root.
export default defineConfig({
  root: 'web',
  envDir: '..',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    // Bowl ID is the front page. The bank it grew out of is kept at /bank.html.
    rollupOptions: { input: { main: page('index.html'), bank: page('bank.html') } },
  },
  server: { port: 5173, strictPort: true },
});
