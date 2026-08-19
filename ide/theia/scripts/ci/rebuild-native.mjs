import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const requestedArch = process.env.BIBZCODE_REBUILD_ARCH || '';
const normalizedArch = requestedArch || process.arch;
const targetPlatform = process.env.BIBZCODE_REBUILD_PLATFORM || process.platform;
const directElectronRebuild = Boolean(requestedArch) || targetPlatform === 'win32';

const command = directElectronRebuild
  ? ['electron-rebuild', '--version', '42.3.0', '--arch', normalizedArch, '--platform', targetPlatform, '--module-dir', projectRoot, '--force', '--sequential']
  : ['theia', 'rebuild:electron', '--cacheRoot', '..'];

console.log(`[native-rebuild] ${directElectronRebuild ? 'direct' : 'theia'} rebuild: npx ${command.join(' ')}`);
const result = spawnSync('npx', command, {
  cwd: resolve(projectRoot, 'electron-app'),
  stdio: 'inherit',
  env: process.env,
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const repair = spawnSync(process.execPath, [resolve(here, 'repair-native-modules.mjs')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, BIBZCODE_TARGET_ARCH: requestedArch || process.arch },
});
process.exit(repair.status ?? 1);
