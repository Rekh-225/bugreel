// Regenerates docs/extension/store/*.png from the built extension and the synthetic demo site.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const cli = createRequire(path.join(root, 'package.json')).resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', '-c', 'playwright.extension.config.ts', 'apps/extension/tests/store-screenshots.spec.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, BUGREEL_STORE_SHOTS: '1' },
});
process.exit(result.status ?? 1);
