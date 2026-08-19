// @ts-check
const { performance } = require('perf_hooks');
const startupLog = (milestone) => console.debug(`Backend main: ${milestone} [${(performance.now() / 1000).toFixed(3)} s since backend process start]`);
startupLog('entry point loaded');
const { BackendApplicationConfigProvider } = require('@theia/core/lib/node/backend-application-config-provider');
const main = require('@theia/core/lib/node/main');

BackendApplicationConfigProvider.set({
    "singleInstance": true,
    "frontendConnectionTimeout": 0,
    "configurationFolder": ".theia",
    "configureProxyFromPreferences": false
});

globalThis.extensionInfo = [
    {
        "name": "@theia/electron",
        "version": "1.74.1"
    },
    {
        "name": "@theia/core",
        "version": "1.74.1"
    },
    {
        "name": "@theia/variable-resolver",
        "version": "1.74.1"
    },
    {
        "name": "@theia/editor",
        "version": "1.74.1"
    },
    {
        "name": "@theia/filesystem",
        "version": "1.74.1"
    },
    {
        "name": "@theia/workspace",
        "version": "1.74.1"
    },
    {
        "name": "@theia/markers",
        "version": "1.74.1"
    },
    {
        "name": "@theia/messages",
        "version": "1.74.1"
    },
    {
        "name": "@theia/outline-view",
        "version": "1.74.1"
    },
    {
        "name": "@theia/monaco",
        "version": "1.74.1"
    },
    {
        "name": "@theia/navigator",
        "version": "1.74.1"
    },
    {
        "name": "@theia/userstorage",
        "version": "1.74.1"
    },
    {
        "name": "@theia/preferences",
        "version": "1.74.1"
    },
    {
        "name": "@theia/process",
        "version": "1.74.1"
    },
    {
        "name": "@theia/file-search",
        "version": "1.74.1"
    },
    {
        "name": "@theia/terminal",
        "version": "1.74.1"
    },
    {
        "name": "bibzcode-ide",
        "version": "0.0.0"
    }
];

const serverModule = require('./server');
const serverAddress = main.start(serverModule());

serverAddress.then((addressInfo) => {
    if (process && process.send && addressInfo) {
        process.send(addressInfo);
    }
});

globalThis.serverAddress = serverAddress;
