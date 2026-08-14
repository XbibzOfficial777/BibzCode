import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import { writeFileSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import log from 'electron-log/main.js';
import updater from 'electron-updater';
import { z } from 'zod';
import { CHANNELS, type IdeSettings } from '../shared/contracts.js';
import { GitService } from './git-service.js';
import { ProcessManager } from './process-manager.js';
import { RuntimeService } from './runtime.js';
import { isWithin, sanitizeError } from './security.js';
import { SettingsStore } from './settings-store.js';
import { WorkspaceService } from './workspace.js';

const { autoUpdater } = updater;

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'false';
app.setName('BibzCode IDE');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{
  scheme: 'bibzcode',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true },
}]);
if (process.env.BIBZCODE_IDE_E2E_REPORT) writeFileSync(`${process.env.BIBZCODE_IDE_E2E_REPORT}.imported`, 'yes\n');

if (!app.requestSingleInstanceLock()) app.quit();
if (process.env.BIBZCODE_IDE_E2E_REPORT) writeFileSync(`${process.env.BIBZCODE_IDE_E2E_REPORT}.locked`, 'yes\n');

let window: BrowserWindow | null = null;
let settings: SettingsStore;
let workspace: WorkspaceService;
let processes: ProcessManager;
let runtime: RuntimeService;
const git = new GitService();

const send = (channel: string, payload: unknown): void => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
};

function safeHandle(channel: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { return await handler(...args); }
    catch (error) {
      log.warn(`IPC ${channel} rejected: ${sanitizeError(error)}`);
      throw new Error(sanitizeError(error), { cause: error });
    }
  });
}

const relativeSchema = z.string().max(4096);
const nonEmptyRelative = relativeSchema.min(1);

function registerIpc(): void {
  safeHandle(CHANNELS.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  }));
  safeHandle(CHANNELS.appOpenExternal, async (raw) => {
    const value = z.string().url().max(2048).parse(raw);
    const url = new URL(value);
    const allowedHosts = new Set(['github.com', 'docs.python.org', 'bibzcode.bibzflow.workers.dev']);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('External URL is not on the allowlist');
    await shell.openExternal(url.toString());
  });
  safeHandle(CHANNELS.updateCheck, async () => {
    if (!app.isPackaged) return { available: false, message: 'Updates are checked only in packaged builds.' };
    autoUpdater.autoDownload = false;
    const result = await autoUpdater.checkForUpdates();
    const available = Boolean(result?.updateInfo.version && result.updateInfo.version !== app.getVersion());
    return { available, version: result?.updateInfo.version ?? '', message: available ? 'An update is available.' : 'BibzCode IDE is up to date.' };
  });

  safeHandle(CHANNELS.settingsGet, () => settings.get());
  safeHandle(CHANNELS.settingsSet, (raw) => settings.set(z.record(z.string(), z.unknown()).parse(raw) as Partial<IdeSettings>));

  safeHandle(CHANNELS.workspaceCurrent, () => workspace.getRoot());
  safeHandle(CHANNELS.workspaceSelect, async () => {
    const selected = await dialog.showOpenDialog(window!, { title: 'Open workspace', properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return '';
    const root = path.resolve(selected.filePaths[0]);
    workspace.setRoot(root);
    processes.setWorkspace(root);
    await settings.set({ lastWorkspace: root });
    app.addRecentDocument(root);
    send(CHANNELS.workspaceChanged, root);
    return root;
  });
  safeHandle(CHANNELS.workspaceList, (raw = '') => workspace.list(relativeSchema.parse(raw)));
  safeHandle(CHANNELS.workspaceSearch, (raw) => workspace.search(z.string().max(500).parse(raw)));
  safeHandle(CHANNELS.fileRead, (raw) => workspace.read(nonEmptyRelative.parse(raw)));
  safeHandle(CHANNELS.fileWrite, async (rawPath, rawContent) => {
    const relative = nonEmptyRelative.parse(rawPath);
    await workspace.write(relative, z.string().max(10 * 1024 * 1024).parse(rawContent));
    send(CHANNELS.workspaceChanged, workspace.getRoot());
  });
  safeHandle(CHANNELS.fileCreate, async (rawPath, rawKind) => {
    await workspace.create(nonEmptyRelative.parse(rawPath), z.enum(['file', 'directory']).parse(rawKind));
    send(CHANNELS.workspaceChanged, workspace.getRoot());
  });
  safeHandle(CHANNELS.fileRename, async (rawFrom, rawTo) => {
    await workspace.rename(nonEmptyRelative.parse(rawFrom), nonEmptyRelative.parse(rawTo));
    send(CHANNELS.workspaceChanged, workspace.getRoot());
  });
  safeHandle(CHANNELS.fileTrash, async (raw) => {
    await workspace.trash(nonEmptyRelative.parse(raw));
    send(CHANNELS.workspaceChanged, workspace.getRoot());
  });

  safeHandle(CHANNELS.terminalRun, (raw) => {
    const input = z.object({ command: z.string().min(1).max(8192) }).parse(raw);
    return processes.runTerminal(input.command, workspace.requireRoot(), settings.get().shellPath);
  });
  safeHandle(CHANNELS.terminalStop, (raw) => processes.stop(z.string().uuid().parse(raw)));

  safeHandle(CHANNELS.runtimeStatus, () => runtime.status(settings.get().pythonPath));
  safeHandle(CHANNELS.runtimeSetup, (raw) => runtime.setup(z.object({ full: z.boolean() }).parse(raw).full, settings.get().pythonPath));
  safeHandle(CHANNELS.cliStart, async () => {
    const root = workspace.requireRoot();
    const status = await runtime.status(settings.get().pythonPath);
    if (status.state !== 'ready' || !status.python) throw new Error(status.message);
    const invocation = runtime.cliInvocation(status.python);
    return processes.startCli(invocation.executable, invocation.args, root, invocation.env);
  });
  safeHandle(CHANNELS.cliInput, (raw) => {
    const input = z.object({ sessionId: z.string().uuid(), data: z.string().max(65_536) }).parse(raw);
    processes.inputCli(input.sessionId, input.data);
  });
  safeHandle(CHANNELS.cliStop, (raw) => processes.stop(z.string().uuid().parse(raw)));

  safeHandle(CHANNELS.gitStatus, () => git.status(workspace.requireRoot()));
  safeHandle(CHANNELS.gitDiff, (raw) => {
    const input = z.object({ relativePath: relativeSchema.default(''), staged: z.boolean().default(false) }).parse(raw ?? {});
    return git.diff(workspace.requireRoot(), input.relativePath, input.staged);
  });
  safeHandle(CHANNELS.gitStage, (raw) => git.stage(workspace.requireRoot(), nonEmptyRelative.parse(raw)));
  safeHandle(CHANNELS.gitUnstage, (raw) => git.unstage(workspace.requireRoot(), nonEmptyRelative.parse(raw)));
  safeHandle(CHANNELS.gitCommit, (raw) => git.commit(workspace.requireRoot(), z.string().min(1).max(500).parse(raw)));
}

function buildMenu(): void {
  const command = (name: string) => () => send(CHANNELS.menuCommand, name);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File', submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+K CmdOrCtrl+O', click: command('open-folder') },
        { type: 'separator' },
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', click: command('new-file') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: command('save') },
        { label: 'Close Editor', accelerator: 'CmdOrCtrl+W', click: command('close-editor') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View', submenu: [
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+Shift+P', click: command('command-palette') },
        { label: 'Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: command('view-explorer') },
        { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', click: command('view-search') },
        { label: 'Source Control', accelerator: 'CmdOrCtrl+Shift+G', click: command('view-source-control') },
        { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Terminal', submenu: [
        { label: 'Focus Terminal', accelerator: 'Ctrl+`', click: command('focus-terminal') },
        { label: 'Clear Terminal', click: command('clear-terminal') },
        { label: 'Stop Active Command', accelerator: 'Ctrl+Shift+C', click: command('stop-terminal') },
      ],
    },
    {
      label: 'BibzCode', submenu: [
        { label: 'Start / Restart Assistant', accelerator: 'CmdOrCtrl+Shift+B', click: command('start-assistant') },
        { label: 'Stop Assistant', click: command('stop-assistant') },
        { label: 'Runtime Setup…', click: command('runtime-setup') },
      ],
    },
    {
      role: 'help', submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://github.com/XbibzOfficial777/BibzCode#readme') },
        { label: 'Security Policy', click: () => shell.openExternal('https://github.com/XbibzOfficial777/BibzCode/security/policy') },
        { label: 'Check for Updates…', click: command('check-updates') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    title: 'BibzCode IDE',
    width: 1500,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#050505',
    show: false,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'app-icon.png') : path.resolve(import.meta.dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('bibzcode://app/') && !url.startsWith('http://127.0.0.1:5173')) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });

  const developmentUrl = process.env.BIBZCODE_IDE_DEV_URL;
  if (developmentUrl && !app.isPackaged) await window.loadURL(developmentUrl);
  else await window.loadURL('bibzcode://app/index.html');

  const reportPath = process.env.BIBZCODE_IDE_E2E_REPORT;
  if (reportPath) {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const renderer = await window.webContents.executeJavaScript(`({
      title: document.title,
      brand: document.body.innerText.includes('BibzCode IDE'),
      explorer: document.body.innerText.includes('EXPLORER'),
      fixture: document.body.innerText.includes('hello.py'),
      nodeProcess: typeof globalThis.process,
      nodeRequire: typeof globalThis.require,
      api: typeof window.bibzIDE,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '',
      url: location.href
    })`, true) as Record<string, unknown>;
    const screenshotPath = process.env.BIBZCODE_IDE_E2E_SCREENSHOT;
    if (screenshotPath) await writeFile(screenshotPath, (await window.webContents.capturePage()).toPNG());
    await writeFile(reportPath, `${JSON.stringify({
      ...renderer,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    setTimeout(() => app.quit(), 50).unref();
  }
}

app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => processes?.stopAll());
app.on('activate', () => { if (!window) void createWindow(); });

async function bootstrap(): Promise<void> {
  await app.whenReady();
  if (process.env.BIBZCODE_IDE_E2E_REPORT) {
    await writeFile(`${process.env.BIBZCODE_IDE_E2E_REPORT}.boot`, 'ready\n', { encoding: 'utf8', mode: 0o600 });
  }
  const rendererRoot = path.resolve(import.meta.dirname, '..', 'dist-renderer');
  protocol.handle('bibzcode', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not Found', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(rendererRoot, relative);
    if (!isWithin(rendererRoot, file)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  log.initialize();
  log.transports.file.level = 'warn';
  log.transports.console.level = app.isPackaged ? 'warn' : 'info';
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  settings = new SettingsStore(app.getPath('userData'));
  const loadedSettings = await settings.load();
  workspace = new WorkspaceService();
  let initialWorkspace = process.env.BIBZCODE_IDE_TEST_WORKSPACE || loadedSettings.lastWorkspace;
  if (initialWorkspace) {
    const info = await stat(initialWorkspace).catch(() => null);
    if (info?.isDirectory()) workspace.setRoot(initialWorkspace);
    else initialWorkspace = '';
  }
  processes = new ProcessManager((channel, payload) => send(channel, payload));
  if (initialWorkspace) processes.setWorkspace(initialWorkspace);
  runtime = new RuntimeService(process.resourcesPath, app.getPath('userData'), app.isPackaged, (channel, payload) => send(channel, payload));
  registerIpc();
  buildMenu();
  await createWindow();
}

void bootstrap().catch((error) => {
  log.error('BibzCode IDE failed to start', error);
  app.exit(1);
});
