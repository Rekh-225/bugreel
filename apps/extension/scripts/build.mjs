// Reproducible production build of the Chrome extension into apps/extension/dist.
// Usage: node apps/extension/scripts/build.mjs [--zip]
import { build } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');
const pkg = JSON.parse(await fs.readFile(path.resolve(root, '../../package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));

const shared = {
  configFile: false,
  logLevel: 'warn',
  root: path.join(root, 'src'),
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  oxc: { jsx: { runtime: 'automatic' } },
};

await fs.rm(outDir, { recursive: true, force: true });

// 1. Side panel page and module service worker (may share chunks).
await build({
  ...shared,
  base: './',
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome120',
    minify: true,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: { sidepanel: path.join(root, 'src/sidepanel/sidepanel.html'), background: path.join(root, 'src/background/index.ts') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
});

// 2. Capture script: one self-contained classic script evaluated in an isolated world.
await build({
  ...shared,
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome120',
    minify: true,
    sourcemap: false,
    lib: { entry: path.join(root, 'src/content/capture.ts'), formats: ['iife'], name: 'BugReelCapture', fileName: () => 'content.js' },
  },
});

// Vite keeps the HTML entry's relative directory; place the page at the package root.
await fs.rename(path.join(outDir, 'sidepanel', 'sidepanel.html'), path.join(outDir, 'sidepanel.html')).catch(async error => {
  if (error.code !== 'ENOENT') throw error;
});
await fs.rm(path.join(outDir, 'sidepanel'), { recursive: true, force: true });
const html = await fs.readFile(path.join(outDir, 'sidepanel.html'), 'utf8');
await fs.writeFile(path.join(outDir, 'sidepanel.html'), html.replaceAll('../', './'));

await fs.cp(path.join(root, 'public'), outDir, { recursive: true });
manifest.version = pkg.version;
await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Guard against accidentally shipping remote code or development files.
const files = [];
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full); else files.push(path.relative(outDir, full).split(path.sep).join('/'));
  }
}
await walk(outDir);
for (const file of files) {
  if (/\.(map|ts|tsx)$|(^|\/)\.env/.test(file)) throw new Error(`Refusing to package development file: ${file}`);
  if (/\.(js|html)$/.test(file)) {
    const text = await fs.readFile(path.join(outDir, file), 'utf8');
    if (/<script[^>]+src=["']https?:/i.test(text) || /import\(\s*["']https?:/.test(text)) throw new Error(`Remote code reference in ${file}`);
  }
}
for (const required of ['manifest.json', 'background.js', 'content.js', 'sidepanel.html', 'icons/icon-128.png']) {
  if (!files.includes(required)) throw new Error(`Build is missing ${required}`);
}
console.log(`Built BugReel extension ${manifest.version} into ${path.relative(process.cwd(), outDir)} (${files.length} files).`);

if (process.argv.includes('--zip')) {
  const zipPath = path.join(root, 'release', `bugreel-extension-${manifest.version}.zip`);
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await writeZip(outDir, files.sort(), zipPath);
  console.log(`Packaged ${path.relative(process.cwd(), zipPath)}`);
}
