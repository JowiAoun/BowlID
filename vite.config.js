import { defineConfig } from 'vite';

// The web app lives in web/. The .env file stays at the repo root.
export default defineConfig({
  root: 'web',
  envDir: '..',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    // BowlID is the front page. The bank it grew out of is kept at /bank.html.
    rollupOptions: { input: { main: 'web/index.html', bank: 'web/bank.html' } },
  },
  server: { port: 5173, strictPort: true },
});
