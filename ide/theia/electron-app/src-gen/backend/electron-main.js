// @ts-check

require('@theia/core/shared/reflect-metadata');
const { performance } = require('perf_hooks');
const startupLog = (milestone) => console.debug(`Electron main: ${milestone} [${(performance.now() / 1000).toFixed(3)} s since electron main start]`);
startupLog('loading modules...');

// Workaround for https://github.com/electron/electron/issues/9225. Chrome has an issue where
// in certain locales (e.g. PL), image metrics are wrongly computed. We explicitly set the
// LC_NUMERIC to prevent this from happening (selects the numeric formatting category of the
// C locale, http://en.cppreference.com/w/cpp/locale/LC_categories).
if (process.env.LC_ALL) {
    process.env.LC_ALL = 'C';
}
process.env.LC_NUMERIC = 'C';

(async () => {
    // Useful for Electron/NW.js apps as GUI apps on macOS doesn't inherit the `$PATH` define
    // in your dotfiles (.bashrc/.bash_profile/.zshrc/etc).
    // https://github.com/electron/electron/issues/550#issuecomment-162037357
    // https://github.com/eclipse-theia/theia/pull/3534#issuecomment-439689082
    (await require('@theia/core/electron-shared/fix-path')).default();

    const { resolve } = require('path');
    const theiaAppProjectPath = resolve(__dirname, '..', '..');
    process.env.THEIA_APP_PROJECT_PATH = theiaAppProjectPath;
    const { default: electronMainApplicationModule } = require('@theia/core/lib/electron-main/electron-main-application-module');
    const { ElectronMainApplication, ElectronMainApplicationGlobals } = require('@theia/core/lib/electron-main/electron-main-application');
    const { Container } = require('@theia/core/shared/inversify');
    const { app } = require('electron');

    const config = {
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
};
    const isSingleInstance = true;

    if (isSingleInstance && !app.requestSingleInstanceLock(process.argv)) {
        // There is another instance running, exit now. The other instance will request focus.
        app.quit();
        return;
    }

    const container = new Container();
    container.load(electronMainApplicationModule);
    container.bind(ElectronMainApplicationGlobals).toConstantValue({
        THEIA_APP_PROJECT_PATH: theiaAppProjectPath,
        THEIA_BACKEND_MAIN_PATH: resolve(__dirname, 'main.js'),
        THEIA_FRONTEND_HTML_PATH: resolve(__dirname, '..', '..', 'lib', 'frontend', 'index.html'),
        THEIA_SECONDARY_WINDOW_HTML_PATH: resolve(__dirname, '..', '..', 'lib', 'frontend', 'secondary-window.html')
    });
    startupLog('container created');

    function load(raw) {
        return Promise.resolve(raw.default).then(module =>
            container.load(module)
        );
    }

    async function start() {
        startupLog('resolving application');
        const application = container.get(ElectronMainApplication);
        startupLog('application resolved');
        await application.start(config);
    }

    try {
        await load(require('@theia/filesystem/lib/electron-main/electron-main-module'));
        startupLog('modules loaded');
        await start();
    } catch (reason) {
        if (typeof reason !== 'number') {
            console.error('Failed to start the electron application.');
            if (reason) {
                console.error(reason);
            }
        }
        app.quit();
    };
})();
