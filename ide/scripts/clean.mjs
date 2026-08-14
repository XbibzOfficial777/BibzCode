import { rm } from 'node:fs/promises';

for (const target of ['dist-electron', 'dist-renderer', 'release', 'coverage', '.tmp-package']) {
  await rm(new URL(`../${target}`, import.meta.url), { recursive: true, force: true });
}
