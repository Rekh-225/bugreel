import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { readZip } from '../scripts/zip.mjs';

const root = path.resolve(__dirname, '..');

test('the production build packages a complete, self-contained extension ZIP without development files', async () => {
  test.setTimeout(120_000);
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, 'scripts', 'build.mjs'), '--zip'], { cwd: path.resolve(root, '..', '..') });
  expect(stdout).toContain('Packaged');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist', 'manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({ manifest_version: 3, permissions: ['debugger', 'storage', 'sidePanel'], background: { service_worker: 'background.js', type: 'module' }, side_panel: { default_path: 'sidepanel.html' } });
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.web_accessible_resources).toBeUndefined();

  const entries = await readZip(path.join(root, 'release', `bugreel-extension-${manifest.version}.zip`));
  const names = entries.map(entry => entry.name);
  for (const required of ['manifest.json', 'background.js', 'content.js', 'sidepanel.html', 'sidepanel.js', 'icons/icon-16.png', 'icons/icon-128.png']) expect(names).toContain(required);
  expect(names.some(name => /\.(map|ts|tsx)$|\.env|node_modules|tests?\//.test(name))).toBe(false);
  const scripts = entries.filter(entry => /\.(js|html)$/.test(entry.name)).map(entry => entry.data.toString('utf8'));
  for (const source of scripts) {
    expect(source).not.toMatch(/https?:\/\/[^\s"'`]+\.js\b/);
    expect(source).not.toMatch(/\beval\(/);
    expect(source).not.toMatch(/new Function\(/);
  }
  const content = entries.find(entry => entry.name === 'content.js')!.data.toString('utf8');
  expect(content).not.toMatch(/\bimport\b|\bexport\b|\brequire\(/);
  expect(content).toContain('__bugreelCaptureMain');
});
