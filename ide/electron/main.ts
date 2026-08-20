import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import { writeFileSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import log from 'electron-log/main.js';
import updater from 'electron-updater';
import { z } from 'zod';
import { CHANNELS, type AgentOrchestrationRequest, type IdeSettings } from '../shared/contracts.js';
import { GitService } from './git-service.js';
import { ProcessManager } from './process-manager.js';
import { isWithin, sanitizeError } from './security.js';
import { SettingsStore } from './settings-store.js';
import { SecretStore } from './secret-store.js';
import { AgentService } from './agent-service.js';
import { ToolExecutor } from './tool-executor.js';
import { cleanAssistantText } from './response-cleaner.js';
import { WorkspaceService } from './workspace.js';
import { ExtensionService } from './extension-service.js';
import { ArtifactService } from './artifact-service.js';
import { ExtensionHostManager } from './extension-host-manager.js';
import { AgentOrchestrator } from './agent-orchestrator.js';

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
let secrets: SecretStore;
let agent: AgentService;
let tools: ToolExecutor;
let workspace: WorkspaceService;
let processes: ProcessManager;
let extensions: ExtensionService;
let artifacts: ArtifactService;
let extensionHost: ExtensionHostManager;
let orchestrator: AgentOrchestrator;
const agentStreams = new Map<string, AbortController>();
const orchestrationStreams = new Map<string, AbortController>();
const approvalWaiters = new Map<string, (approved: boolean) => void>();
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
    const allowedHosts = new Set(['github.com', 'open-vsx.org', 'marketplace.visualstudio.com']);
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
  safeHandle(CHANNELS.extensionSearch, async (raw) => {
    const input = z.object({ query: z.string().max(200).default(''), registry: z.enum(['open-vsx', 'vscode-marketplace']) }).parse(raw ?? {});
    return extensions.search(input.query, input.registry);
  });
  safeHandle(CHANNELS.extensionInstalled, () => extensions.installedList());
  safeHandle(CHANNELS.extensionInstall, (raw) => extensions.install(z.object({ id: z.string().min(3).max(256), publisher: z.string().min(1).max(128), name: z.string().min(1).max(128), displayName: z.string().max(256), version: z.string().max(64), description: z.string().max(5000), source: z.enum(['open-vsx', 'vscode-marketplace']), downloadUrl: z.string().url().max(4096), iconUrl: z.string().url().max(4096).optional(), readmeUrl: z.string().url().max(4096).optional(), enginesVscode: z.string().max(100).optional(), categories: z.array(z.string().max(80)).max(12), downloadCount: z.number().finite().optional(), rating: z.number().finite().optional(), compatible: z.boolean(), compatibilityMessage: z.string().max(500).optional() }).parse(raw)));
  safeHandle(CHANNELS.extensionInstallVsix, async () => {
    const selected = await dialog.showOpenDialog(window!, { title: 'Install VSIX Extension', properties: ['openFile'], filters: [{ name: 'VS Code Extension', extensions: ['vsix'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return extensions.installVsix(path.resolve(selected.filePaths[0]));
  });
  safeHandle(CHANNELS.extensionUninstall, async (raw) => { const id = z.string().min(3).max(256).parse(raw); await extensionHost.stop(id); return extensions.uninstall(id); });
  safeHandle(CHANNELS.extensionSetEnabled, async (raw) => { const input = z.object({ id: z.string().min(3).max(256), enabled: z.boolean() }).parse(raw); const result = await extensions.setEnabled(input.id, input.enabled); if (!input.enabled) await extensionHost.stop(input.id); else if (result.trust === 'trusted' && result.risk.activationEvents.includes('*')) await extensionHost.start(result); return result; });
  safeHandle(CHANNELS.extensionSetTrust, async (raw) => { const input = z.object({ id: z.string().min(3).max(256), trust: z.enum(['trusted', 'untrusted']) }).parse(raw); if (input.trust === 'untrusted') await extensionHost.stop(input.id); const result = await extensions.setTrust(input.id, input.trust); if (result.trust === 'trusted' && result.enabled && result.risk.activationEvents.includes('*')) await extensionHost.start(result); return result; });
  safeHandle(CHANNELS.extensionRuntimeStart, async (raw) => { const id = z.string().min(3).max(256).parse(raw); const item = (await extensions.installedList()).find((value) => value.id === id); if (!item) throw new Error('Extension is not installed.'); return extensionHost.start(item); });
  safeHandle(CHANNELS.extensionRuntimeStop, (raw) => extensionHost.stop(z.string().min(3).max(256).parse(raw)));
  safeHandle(CHANNELS.extensionRuntimeStatus, () => extensionHost.status());
  safeHandle(CHANNELS.extensionRuntimeCommand, async (raw) => { const input = z.object({ id: z.string().min(3).max(256), command: z.string().min(1).max(160), arguments: z.array(z.unknown()).max(32).default([]) }).parse(raw); return extensionHost.executeCommand(input.id, input.command, input.arguments); });
  safeHandle(CHANNELS.settingsSet, (raw) => settings.set(z.record(z.string(), z.unknown()).parse(raw) as Partial<IdeSettings>));
  safeHandle(CHANNELS.secretStatus, () => ({ configured: secrets.has('ai-api-key') }));
  safeHandle(CHANNELS.secretSet, async (raw) => {
    const input = z.object({ name: z.literal('ai-api-key'), value: z.string().max(16_384) }).parse(raw);
    if (input.value.trim()) await secrets.set(input.name, input.value);
    else await secrets.clear(input.name);
    return { configured: secrets.has(input.name) };
  });
  safeHandle(CHANNELS.secretClear, async (raw) => {
    const input = z.object({ name: z.literal('ai-api-key') }).parse(raw);
    await secrets.clear(input.name);
    return { configured: false };
  });
  safeHandle(CHANNELS.agentProbe, () => agent.testConnection());
  safeHandle(CHANNELS.agentModels, () => agent.listModels());
  safeHandle(CHANNELS.agentComplete, (raw) => agent.complete(z.object({ prompt: z.string().min(1).max(200_000), systemPrompt: z.string().max(16_384).optional() }).parse(raw)));
  safeHandle(CHANNELS.agentStreamStart, (raw) => {
    const input = z.object({ requestId: z.string().uuid(), request: z.object({ prompt: z.string().min(1).max(200_000), systemPrompt: z.string().max(16_384).optional(), taskId: z.string().max(128).optional(), allowMutations: z.boolean().optional() }) }).parse(raw);
    if (agentStreams.has(input.requestId)) throw new Error('Agent request is already running.');
    const controller = new AbortController(); agentStreams.set(input.requestId, controller);
    void (async () => {
      let rawText = '';
      send(CHANNELS.agentStreamEvent, { requestId: input.requestId, type: 'start' });
      try {
        for await (const event of agent.streamAgent({ ...input.request, requestId: input.requestId }, controller.signal, (call, risk) => new Promise<boolean>((resolve) => {
          const key = `${input.requestId}:${call.id}`;
          approvalWaiters.set(key, resolve);
          send(CHANNELS.agentStreamEvent, { requestId: input.requestId, type: 'approval_request', callId: call.id, tool: call.name, arguments: call.arguments, risk });
        }))) {
          if (event.type === 'delta') { rawText += event.delta; send(CHANNELS.agentStreamEvent, { requestId: input.requestId, type: 'delta', delta: event.delta }); }
          else if (event.type === 'tool_call') send(CHANNELS.agentStreamEvent, { requestId: input.requestId, type: 'tool_call', callId: event.callId, tool: event.tool, arguments: event.arguments, risk: event.risk });
          else if (event.type === 'tool_result') send(CHANNELS.agentStreamEvent, { requestId: input.requestId, type: 'tool_result', callId: event.callId, tool: event.tool, result: event.result, risk: event.risk });
          else if (event.type === 'approval_request') { /* callback above already emitted the request before awaiting the decision */ }
        }
        send(CHANNELS.agentStreamEvent, { requestId: input.requestId, type: 'done', text: cleanAssistantText(rawText) });
      } catch (error) {
        if (!controller.signal.aborted) send(CHANNELS.agentStreamEvent, { requestId: input.requestId, type: 'error', message: error instanceof Error ? error.message : String(error) });
      } finally { agentStreams.delete(input.requestId); }
    })();
    return { requestId: input.requestId };
  });
  safeHandle(CHANNELS.agentStreamCancel, (raw) => {
    const requestId = z.string().uuid().parse(raw); const controller = agentStreams.get(requestId);
    if (controller) controller.abort();
    for (const [key, resolve] of approvalWaiters) if (key.startsWith(`${requestId}:`)) { resolve(false); approvalWaiters.delete(key); }
    return { cancelled: Boolean(controller) };
  });
  safeHandle(CHANNELS.agentApprove, (raw) => {
    const input = z.object({ requestId: z.string().uuid(), callId: z.string().min(1).max(256), approved: z.boolean() }).parse(raw);
    const key = `${input.requestId}:${input.callId}`; const orchestrationKey = `${input.callId}:${input.requestId}`; const resolve = approvalWaiters.get(key) ?? approvalWaiters.get(orchestrationKey);
    if (!resolve) return { accepted: false };
    approvalWaiters.delete(key); approvalWaiters.delete(orchestrationKey); resolve(input.approved); return { accepted: true };
  });
  safeHandle(CHANNELS.artifactList, (raw) => artifacts.list(raw ? z.string().uuid().parse(raw) : undefined));
  safeHandle(CHANNELS.artifactKeep, (raw) => artifacts.setStatus(z.string().min(1).max(256).parse(raw), 'kept'));
  safeHandle(CHANNELS.artifactReject, (raw) => artifacts.reject(z.string().min(1).max(256).parse(raw)));
  safeHandle(CHANNELS.artifactRevert, (raw) => artifacts.revert(z.string().min(1).max(256).parse(raw)));
  safeHandle(CHANNELS.agentOrchestrate, (raw) => {
    const input = z.object({ tasks: z.array(z.object({ id: z.string().min(1).max(128), label: z.string().min(1).max(200), prompt: z.string().min(1).max(100_000), systemPrompt: z.string().max(16_384).optional(), dependsOn: z.array(z.string().min(1).max(128)).max(16).optional() }).strict()).min(1).max(16), maxConcurrency: z.number().int().min(1).max(4).optional(), allowMutations: z.boolean().default(false) }).parse(raw) as AgentOrchestrationRequest;
    const orchestrationId = crypto.randomUUID(); const controller = new AbortController(); orchestrationStreams.set(orchestrationId, controller);
    void orchestrator.run(orchestrationId, input, controller.signal, (event) => send(CHANNELS.agentOrchestrationEvent, event), (task, requestId, event) => send(CHANNELS.agentStreamEvent, { requestId, orchestrationId, taskId: task.id, ...event }), async (call, risk, requestId) => new Promise<boolean>((resolve) => { const key = `${requestId}:${call.id}`; approvalWaiters.set(key, resolve); send(CHANNELS.agentStreamEvent, { requestId, orchestrationId, type: 'approval_request', callId: call.id, tool: call.name, arguments: call.arguments, risk }); })).finally(() => orchestrationStreams.delete(orchestrationId));
    return { orchestrationId };
  });
  safeHandle(CHANNELS.agentOrchestrationCancel, (raw) => { const id = z.string().uuid().parse(raw); const controller = orchestrationStreams.get(id); if (controller) controller.abort(); return { cancelled: Boolean(controller) }; });
  safeHandle(CHANNELS.compressionTest, (raw) => {
    const input = z.object({ text: z.string().max(2_000_000), targetChars: z.number().int().min(2_048).max(4_000_000) }).parse(raw);
    return agent.compressContext(input.text, input.targetChars);
  });

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
        { label: 'Run Agent Prompt…', accelerator: 'CmdOrCtrl+Shift+I', click: command('agent-prompt') },
        { label: 'Open Native AI Assistant', accelerator: 'CmdOrCtrl+Shift+B', click: command('start-assistant') },
        { label: 'Stop AI Response', click: command('stop-assistant') },
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
app.on('before-quit', () => { processes?.stopAll(); extensionHost?.stopAll(); for (const controller of agentStreams.values()) controller.abort(); for (const controller of orchestrationStreams.values()) controller.abort(); for (const resolve of approvalWaiters.values()) resolve(false); approvalWaiters.clear(); });
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
  secrets = new SecretStore(app.getPath('userData'));
  await secrets.load();
  extensions = new ExtensionService(app.getPath('userData'));
  await extensions.load();
  workspace = new WorkspaceService();
  let initialWorkspace = process.env.BIBZCODE_IDE_TEST_WORKSPACE || loadedSettings.lastWorkspace;
  if (initialWorkspace) {
    const info = await stat(initialWorkspace).catch(() => null);
    if (info?.isDirectory()) workspace.setRoot(initialWorkspace);
    else initialWorkspace = '';
  }
  processes = new ProcessManager((channel, payload) => send(channel, payload));
  if (initialWorkspace) processes.setWorkspace(initialWorkspace);
  artifacts = new ArtifactService(workspace, app.getPath('userData'));
  await artifacts.load();
  extensionHost = new ExtensionHostManager((event) => send(CHANNELS.extensionRuntimeEvent, event), () => ({ theme: settings.get().theme, locale: 'en' }));
  for (const installed of await extensions.installedList()) if (installed.enabled && installed.trust === 'trusted' && installed.risk.activationEvents.includes('*')) void extensionHost.start(installed);
  tools = new ToolExecutor(workspace, processes, git, (text, targetChars) => agent.compressContext(text, targetChars), (requestId, operation, relativePath, action, extra) => artifacts.around(requestId, operation, relativePath, action, extra), (requestId, fromPath, toPath, action) => artifacts.aroundRename(requestId, fromPath, toPath, action));
  agent = new AgentService(secrets, () => settings.get(), tools);
  orchestrator = new AgentOrchestrator(agent);
  registerIpc();
  buildMenu();
  await createWindow();
}

void bootstrap().catch((error) => {
  log.error('BibzCode IDE failed to start', error);
  app.exit(1);
});
