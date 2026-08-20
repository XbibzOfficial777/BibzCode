import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const temporary = path.resolve('.tmp-package');
await rm(temporary, { recursive: true, force: true });
await mkdir(temporary, { recursive: true });
const cli = path.resolve('node_modules/electron-builder/out/cli/cli.js');
const args = [cli, '--linux', 'deb', 'rpm', 'AppImage', '--publish', 'never', ...process.argv.slice(2)];
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, TMPDIR: temporary },
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
});
await rm(temporary, { recursive: true, force: true });
if (code !== 0) process.exitCode = Number(code);
