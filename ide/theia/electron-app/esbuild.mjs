import { browserOptions, mode, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const windowsCaShim = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/ci/windows-ca-certs-shim.cjs');
const windowsCaShimPlugin = {
    name: 'bibzcode-windows-ca-certs-shim',
    setup(build) {
        build.onResolve({ filter: /^@vscode\/windows-ca-certs$/ }, () => ({ path: windowsCaShim }));
    },
};
for (const options of [nodeOptions, electronOptions]) {
    options.plugins = [windowsCaShimPlugin, ...(options.plugins ?? [])];
    options.alias = { ...(options.alias ?? {}), '@vscode/windows-ca-certs': windowsCaShim };
}

if (mode === 'development' && process.env.THEIA_DEV_SOURCEMAP !== '1') {
    browserOptions.sourcemap = false;
    nodeOptions.sourcemap = false;
    electronOptions.sourcemap = false;
}

async function buildOnce(options, label) {
    const context = await esbuild.context(options);
    try {
        console.log(`[build/${label}] Build started`);
        const result = await context.rebuild();
        console.log(`[build/${label}] Finished with ${result.errors?.length || 0} errors`);
    } finally {
        await context.dispose();
    }
}

if (watch) {
    const browserContext = await esbuild.context(browserOptions);
    const nodeContext = await esbuild.context(nodeOptions);
    const electronContext = await esbuild.context(electronOptions);
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
        electronContext.watch(),
    ]);
} else {
    try {
        await buildOnce(browserOptions, 'browser');
        await buildOnce(nodeOptions, 'node');
        await buildOnce(electronOptions, 'electron');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
