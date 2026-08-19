import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const target = process.env.BIBZCODE_TARGET_ARCH || process.arch;
const platform = process.platform;

const archMap = {
  x64: 'x64',
  amd64: 'x64',
  arm64: 'arm64',
  armv7l: 'arm',
  arm: 'arm',
};
const targetArch = archMap[target] || target;

function repairNodePty() {
  const packageRoot = resolve(projectRoot, 'node_modules/node-pty');
  const built = resolve(packageRoot, 'build/Release/pty.node');
  if (!existsSync(built)) {
    console.log('[native-repair] node-pty build output not present; no repair needed.');
    return;
  }

  const prebuildDir = resolve(packageRoot, `prebuilds/${platform}-${targetArch}`);
  const expected = resolve(prebuildDir, 'pty.node');
  if (!existsSync(expected)) {
    mkdirSync(prebuildDir, { recursive: true });
    copyFileSync(built, expected);
    console.log(`[native-repair] restored ${expected}`);
  } else {
    console.log(`[native-repair] verified ${expected}`);
  }
}

repairNodePty();
console.log(`[native-repair] target=${target} normalized=${targetArch} platform=${platform}`);
