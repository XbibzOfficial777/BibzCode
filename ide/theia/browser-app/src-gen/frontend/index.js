// @ts-check
require('reflect-metadata');
const startupLog = (milestone) => console.debug(`Frontend: ${milestone} [${(performance.now() / 1000).toFixed(3)} s since frontend page start]`);
startupLog('loading modules...');
const { Container } = require('@theia/core/shared/inversify');
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');

FrontendApplicationConfigProvider.set({
    "applicationName": "Eclipse Theia",
    "defaultTheme": {
        "light": "light",
        "dark": "dark"
    },
    "defaultIconTheme": "theia-file-icons",
    "electron": {
        "windowOptions": {},
        "showWindowEarly": true,
        "splashScreenOptions": {},
        "appUserModelId": "",
        "uriScheme": "theia"
    },
    "defaultLocale": "",
    "validatePreferencesSchema": true,
    "reloadOnReconnect": false,
    "uriScheme": "theia"
});


self.MonacoEnvironment = {
    getWorkerUrl: function (moduleId, label) {
        return './editor.worker.js';
    }
}

function load(container, jsModule) {
    return Promise.resolve(jsModule)
        .then(containerModule => container.load(containerModule.default));
}

async function preload(container) {
    try {
        await load(container, import('@theia/core/lib/browser/preload/preload-module'));
        const { Preloader } = require('@theia/core/lib/browser/preload/preloader');
        const preloader = container.get(Preloader);
        await preloader.initialize();
    } catch (reason) {
        console.error('Failed to run preload scripts.');
        if (reason) {
            console.error(reason);
        }
    }
}

module.exports = (async () => {
    const { messagingFrontendModule } = require('@theia/core/lib/browser/messaging/messaging-frontend-module');
    const container = new Container();
    container.load(messagingFrontendModule);


    startupLog('container created');

    await preload(container);
    startupLog('preloaded');


    const { MonacoInit } = require('@theia/monaco/lib/browser/monaco-init');
    ;

    const { FrontendApplication } = require('@theia/core/lib/browser');
    const { frontendApplicationModule } = require('@theia/core/lib/browser/frontend-application-module');
    const { loggerFrontendModule } = require('@theia/core/lib/browser/logger-frontend-module');

    container.load(frontendApplicationModule);
    undefined

    container.load(loggerFrontendModule);


    startupLog('core modules loaded');

    try {
        await load(container, import('@theia/core/lib/browser/i18n/i18n-frontend-module'));
        await load(container, import('@theia/core/lib/browser/menu/browser-menu-module'));
        await load(container, import('@theia/core/lib/browser/window/browser-window-module'));
        await load(container, import('@theia/core/lib/browser/keyboard/browser-keyboard-module'));
        await load(container, import('@theia/core/lib/browser/request/browser-request-module'));
        await load(container, import('@theia/variable-resolver/lib/browser/variable-resolver-frontend-module'));
        await load(container, import('@theia/editor/lib/browser/editor-frontend-module'));
        await load(container, import('@theia/filesystem/lib/browser/filesystem-frontend-module'));
        await load(container, import('@theia/filesystem/lib/browser/download/file-download-frontend-module'));
        await load(container, import('@theia/filesystem/lib/browser/file-dialog/file-dialog-module'));
        await load(container, import('@theia/workspace/lib/browser/workspace-frontend-module'));
        await load(container, import('@theia/markers/lib/browser/problem/problem-frontend-module'));
        await load(container, import('@theia/outline-view/lib/browser/outline-view-frontend-module'));
        await load(container, import('@theia/monaco/lib/browser/monaco-frontend-module'));
        await load(container, import('@theia/console/lib/browser/console-frontend-module'));
        await load(container, import('@theia/output/lib/browser/output-frontend-module'));
        await load(container, import('@theia/process/lib/common/process-common-module'));
        await load(container, import('@theia/file-search/lib/browser/file-search-frontend-module'));
        await load(container, import('@theia/terminal/lib/browser/terminal-frontend-module'));
        await load(container, import('@theia/userstorage/lib/browser/user-storage-frontend-module'));
        await load(container, import('@theia/task/lib/browser/task-frontend-module'));
        await load(container, import('@theia/navigator/lib/browser/navigator-frontend-module'));
        await load(container, import('@theia/test/lib/browser/view/test-view-frontend-module'));
        await load(container, import('@theia/debug/lib/browser/debug-frontend-module'));
        await load(container, import('@theia/messages/lib/browser/messages-frontend-module'));
        await load(container, import('@theia/ai-core/lib/browser/ai-core-frontend-module'));
        await load(container, import('@theia/ai-mcp/lib/browser/mcp-frontend-module'));
        await load(container, import('@theia/bulk-edit/lib/browser/bulk-edit-frontend-module'));
        await load(container, import('@theia/callhierarchy/lib/browser/callhierarchy-frontend-module'));
        await load(container, import('@theia/editor-preview/lib/browser/editor-preview-frontend-module'));
        await load(container, import('@theia/notebook/lib/browser/notebook-frontend-module'));
        await load(container, import('@theia/preferences/lib/browser/preference-frontend-module'));
        await load(container, import('@theia/scm/lib/browser/scm-frontend-module'));
        await load(container, import('@theia/search-in-workspace/lib/browser/search-in-workspace-frontend-module'));
        await load(container, import('@theia/timeline/lib/browser/timeline-frontend-module'));
        await load(container, import('@theia/typehierarchy/lib/browser/typehierarchy-frontend-module'));
        await load(container, import('@theia/plugin-ext/lib/plugin-ext-frontend-module'));
        await load(container, import('@theia/plugin-ext-vscode/lib/browser/plugin-vscode-frontend-module'));
        await load(container, import('@theia/vsx-registry/lib/common/vsx-registry-common-module'));
        await load(container, import('@theia/vsx-registry/lib/browser/vsx-registry-frontend-module'));
        await load(container, import('bibzcode-ide/lib/browser/bibzcode-ide-frontend-module'));

        MonacoInit.init(container);
        ;
        startupLog('modules loaded');
        await start();
    } catch (reason) {
        console.error('Failed to start the frontend application.');
        if (reason) {
            console.error(reason);
        }
    }

    function start() {
        (window['theia'] = window['theia'] || {}).container = container;
        startupLog('resolving application');
        const application = container.get(FrontendApplication);
        startupLog('application resolved');
        return application.start();
    }
})();
