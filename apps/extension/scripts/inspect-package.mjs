// Prints what the release ZIP contains and checks it for development files, remote code, and credentials.
// Usage: node apps/extension/scripts/inspect-package.mjs
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readZip } from './zip.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(await fs.readFile(path.join(root, 'apps/extension/manifest.json'), 'utf8'));
const zipPath = path.join(root, 'apps/extension/release', `bugreel-extension-${pkg.version}.zip`);
const entries = await readZip(zipPath);
const problems = [];

console.log(`Archive: ${zipPath}`);
for (const entry of entries) console.log(`  ${entry.name.padEnd(40)} ${String(entry.data.length).padStart(8)} bytes`);

const manifestEntry = entries.find(entry => entry.name === 'manifest.json');
if (!manifestEntry) problems.push('manifest.json is not at the archive root');
const manifest = manifestEntry ? JSON.parse(manifestEntry.data.toString('utf8')) : {};
if (manifest.version !== pkg.version || sourceManifest.version !== pkg.version) problems.push(`version mismatch: zip ${manifest.version}, source ${sourceManifest.version}, package.json ${pkg.version}`);
if (JSON.stringify(manifest.permissions) !== JSON.stringify(['debugger', 'storage', 'sidePanel'])) problems.push(`unexpected permissions ${JSON.stringify(manifest.permissions)}`);
for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'web_accessible_resources', 'externally_connectable']) if (key in manifest) problems.push(`manifest has ${key}`);

const dev = entries.filter(entry => /\.(map|ts|tsx)$|(^|\/)\.env|node_modules|fixtures|(^|\/)tests?\/|\.spec\./.test(entry.name));
if (dev.length) problems.push(`development files: ${dev.map(entry => entry.name).join(', ')}`);
const text = entries.filter(entry => /\.(js|html|json|css)$/.test(entry.name)).map(entry => entry.data.toString('utf8')).join('\n');
if (/<script[^>]+src=["']https?:|import\(\s*["']https?:|https?:\/\/[^\s"'`]+\.js\b/.test(text)) problems.push('remote script reference');
if (/\beval\(|new Function\(/.test(text)) problems.push('eval or new Function present');
if (/DEVIN_API_KEY|sk-[A-Za-z0-9]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20}/.test(text)) problems.push('credential-like string present');
for (const entry of entries.filter(entry => entry.name.endsWith('.js'))) {
  // Real import statements only (statement start), not string literals such as the draft template's
  // "import { test, expect } from '@playwright/test'".
  const imports = entry.data.toString('utf8').match(/(?:^|[;\n{}])\s*import\s*(?:[\w$*{}\s,]*?\s*from\s*)?["']([^"']+)["']/g) || [];
  const external = imports.map(statement => statement.match(/["']([^"']+)["']$/)[1]).filter(specifier => !/^\.{1,2}\//.test(specifier));
  if (external.length) problems.push(`${entry.name} imports a non-relative module: ${external.join(' ')}`);
}
const required = ['manifest.json', 'background.js', 'content.js', 'sidepanel.html', 'sidepanel.js', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png'];
for (const name of required) if (!entries.some(entry => entry.name === name)) problems.push(`missing ${name}`);

const bytes = await fs.readFile(zipPath);
console.log(`\nmanifest.version=${manifest.version} minimum_chrome_version=${manifest.minimum_chrome_version} permissions=${JSON.stringify(manifest.permissions)}`);
console.log(`Size: ${bytes.length} bytes`);
console.log(`SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);
if (problems.length) { console.error('\nPROBLEMS:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('\nPackage checks passed: bundled code only, no development, environment, test, or credential files.');
