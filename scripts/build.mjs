import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
for (const dir of ['packages/model', 'packages/parser', 'packages/core', 'packages/renderer-html', 'apps/cli']) {
  const result = spawnSync(process.execPath, [tsc, '-p', `${dir}/tsconfig.json`], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
