import { browserOptions, mode, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import esbuild from 'esbuild';

// Theia 1.74.1's linked source-map plugin can stop the shared esbuild service
// in development mode after a rebuild. Keep development builds reliable in the
// sandbox; opt in to linked maps when investigating source-level issues.
if (mode === 'development' && process.env.THEIA_DEV_SOURCEMAP !== '1') {
    browserOptions.sourcemap = false;
    nodeOptions.sourcemap = false;
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
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await buildOnce(browserOptions, 'browser');
        await buildOnce(nodeOptions, 'node');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
