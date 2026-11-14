// Syncs repo mock-data into emberwise/web/public/data so the app can try the
// real files first and fall back to src/mocks per file.
// Run automatically by `npm run dev` and `npm run build`; or manually:
//   node scripts/sync-data.mjs
// Source: <repo>/mock-data  →  emberwise/web/public/data
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(webRoot, '..', '..');
const srcDir = join(repoRoot, 'mock-data');
const destDir = join(webRoot, 'public', 'data');

if (!existsSync(srcDir)) {
  console.warn(`[sync-data] ${srcDir} not found — public/data left untouched`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

// Mirror: remove stale synced files, then copy everything currently in mock-data.
for (const f of readdirSync(destDir)) {
  rmSync(join(destDir, f));
}

let copied = 0;
let bytes = 0;
for (const f of readdirSync(srcDir)) {
  const s = join(srcDir, f);
  if (!statSync(s).isFile()) continue;
  cpSync(s, join(destDir, f));
  copied++;
  bytes += statSync(s).size;
}
console.log(`[sync-data] copied ${copied} files (${(bytes / 1024).toFixed(0)} KiB) mock-data → public/data`);
