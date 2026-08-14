import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron', 'electron-log', 'electron-log/*', 'electron-updater'],
  sourcemap: false,
  legalComments: 'none',
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['electron/main.ts'],
    format: 'esm',
    outfile: 'dist-electron/main.js',
  }),
  build({
    ...common,
    entryPoints: ['electron/preload.ts'],
    format: 'cjs',
    outfile: 'dist-electron/preload.cjs',
  }),
]);
