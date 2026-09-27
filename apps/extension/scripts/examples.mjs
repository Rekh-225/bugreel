// Regenerates docs/extension/examples from a real recording of the fixture site (fixed port for stable URLs).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const cli = createRequire(path.join(root, 'package.json')).resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', '-c', 'playwright.extension.config.ts', 'apps/extension/tests/workflow.spec.ts', '-g', 'records a scenario'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, BUGREEL_WRITE_EXAMPLES: '1', BUGREEL_FIXTURE_PORT: '4173' },
});
process.exit(result.status ?? 1);
