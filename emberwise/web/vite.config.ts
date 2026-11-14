import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Emits dist/sw-manifest.json listing every built asset so the hand-written
// service worker can precache the app shell.
function swManifestPlugin() {
  return {
    name: 'emberwise-sw-manifest',
    apply: 'build' as const,
    closeBundle() {
      const dir = join(process.cwd(), 'dist', 'assets');
      let files: string[] = [];
      try {
        files = readdirSync(dir).map((f) => `assets/${f}`);
      } catch {
        files = [];
      }
      writeFileSync(
        join(process.cwd(), 'dist', 'sw-manifest.json'),
        JSON.stringify({ assets: files, generatedAt: new Date().toISOString() })
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), swManifestPlugin()],
  server: { port: 5173 },
});
