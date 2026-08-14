import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.resolve('release');
const allowed = /\.(deb|rpm|exe|dmg|zip|yml|blockmap)$/i;
const names = (await readdir(releaseDir)).filter((name) => allowed.test(name) && name !== 'builder-debug.yml').sort();
if (!names.length) throw new Error('No release artifacts found');
const lines = [];
for (const name of names) {
  const file = path.join(releaseDir, name);
  if (!(await stat(file)).isFile()) continue;
  const digest = createHash('sha256').update(await readFile(file)).digest('hex');
  lines.push(`${digest}  ${name}`);
}
await writeFile(path.join(releaseDir, 'SHA256SUMS'), `${lines.join('\n')}\n`, { mode: 0o644 });
console.log(`Verified ${lines.length} release artifacts; wrote SHA256SUMS.`);
