'use strict';

const vscode = require('vscode');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const providers = require('./providers.json');
const { validateSessionId, stripAnsi, safeFileName, managedPythonPath, workspaceRoot } = require('./lib');

const KEY_PREFIX = 'bibzcode.provider.';
const OUTPUT_LIMIT = 5 * 1024 * 1024;

function baseEnvironment() {
  const exact = new Set([
    'PATH', 'Path', 'HOME', 'USER', 'LOGNAME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'SHELL',
    'LANG', 'LANGUAGE', 'LC_ALL', 'TERM', 'COLORTERM', 'DISPLAY', 'WAYLAND_DISPLAY',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  ]);
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (exact.has(key) || key.startsWith('LC_') || key.startsWith('XDG_') || key.startsWith('BIBZCODE_'))) env[key] = value;
  }
  return env;
}

class RuntimeBridge {
  constructor(context) {
    this.context = context;
    this.output = vscode.window.createOutputChannel('BibzCode');
    this.runtimeRoot = path.join(context.extensionPath, 'runtime');
  }

  pythonPath() {
    const configured = vscode.workspace.getConfiguration('bibzcode').get('pythonPath', '').trim();
    if (configured) return configured;
    const managed = managedPythonPath(this.context.globalStorageUri.fsPath);
    if (fs.existsSync(managed)) return managed;
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  async providerEnvironment(providerId, model) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const env = { ...baseEnvironment(), PYTHONPATH: this.runtimeRoot, BIBZCODE_PROVIDER: provider.id };
    if (model) env.BIBZCODE_MODEL = model;
    const secret = await this.context.secrets.get(`${KEY_PREFIX}${provider.id}.key`);
    if (secret) env[provider.env] = secret;
    return env;
  }

  async run(args, options = {}) {
    const python = this.pythonPath();
    const env = options.env || { ...baseEnvironment(), PYTHONPATH: this.runtimeRoot };
    return runProcess(python, ['-m', 'bibzcode.ide_bridge', ...args], {
      cwd: options.cwd,
      env,
      input: options.input,
      timeout: options.timeout || 120_000,
      output: this.output,
    });
  }

  async json(args, options = {}) {
    const result = await this.run(args, options);
    if (result.code !== 0) throw new Error(stripAnsi(result.stderr || result.stdout || `Bridge exited ${result.code}`));
    const text = stripAnsi(result.stdout).trim();
    try { return JSON.parse(text); }
    catch { throw new Error(`BibzCode returned invalid data: ${text.slice(0, 300)}`); }
  }

  async setupRuntime() {
    const selected = await vscode.window.showQuickPick([
      { label: 'Core runtime', description: 'Providers, sessions, memory, tools, and document essentials', profile: 'core' },
      { label: 'Full runtime', description: 'All optional browser, media, plotting, and MCP dependencies', profile: 'full' },
    ], { title: 'Set up BibzCode managed runtime', ignoreFocusOut: true });
    if (!selected) return;

    const configured = vscode.workspace.getConfiguration('bibzcode').get('pythonPath', '').trim();
    const basePython = configured || (process.platform === 'win32' ? 'python' : 'python3');
    const runtimeDir = path.join(this.context.globalStorageUri.fsPath, 'runtime');
    const requirements = path.join(this.runtimeRoot, 'requirements-lock.txt');
    const optional = path.join(this.runtimeRoot, 'requirements-optional-lock.txt');
    await fsp.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Setting up BibzCode ${selected.profile} runtime`,
      cancellable: true,
    }, async (progress, token) => {
      progress.report({ message: 'Creating isolated Python environment…' });
      await checkedProcess(basePython, ['-m', 'venv', runtimeDir], this.output, token, 180_000);
      const managed = managedPythonPath(this.context.globalStorageUri.fsPath);
      progress.report({ message: 'Installing verified core dependencies…' });
      await checkedProcess(managed, ['-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes', '-r', requirements], this.output, token, 900_000);
      if (selected.profile === 'full') {
        progress.report({ message: 'Installing verified optional dependencies…' });
        await checkedProcess(managed, ['-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes', '-r', optional], this.output, token, 1_200_000);
      }
      progress.report({ message: 'Verifying runtime…' });
      await checkedProcess(managed, ['-c', 'import bibzcode; print(bibzcode.__version__)'], this.output, token, 60_000, { PYTHONPATH: this.runtimeRoot });
    });
    vscode.window.showInformationMessage('BibzCode runtime is ready.');
  }

  dispose() { this.output.dispose(); }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { child.kill('SIGTERM'); reject(new Error(`Process timed out after ${options.timeout} ms`)); }
    }, options.timeout || 120_000);
    const append = (kind, chunk) => {
      const value = chunk.toString();
      options.output?.append(value);
      if (kind === 'stdout') stdout = (stdout + value).slice(-OUTPUT_LIMIT);
      else stderr = (stderr + value).slice(-OUTPUT_LIMIT);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', (error) => { settled = true; clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr });
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function checkedProcess(command, args, output, token, timeout, extraEnv = {}) {
  if (token.isCancellationRequested) throw new vscode.CancellationError();
  const processPromise = runProcess(command, args, { env: { ...baseEnvironment(), ...extraEnv }, timeout, output });
  const result = await processPromise;
  if (result.code !== 0) throw new Error(stripAnsi(result.stderr || result.stdout || `${command} exited ${result.code}`));
}

class ProviderItem extends vscode.TreeItem {
  constructor(provider, active, model, hasKey) {
    super(provider.name, vscode.TreeItemCollapsibleState.None);
    this.provider = provider;
    this.contextValue = 'bibzcode.provider';
    this.description = `${active ? 'active · ' : ''}${model}${hasKey ? ' · key set' : ' · no key'}`;
    this.iconPath = new vscode.ThemeIcon(active ? 'radio-tower' : 'server-environment', active ? new vscode.ThemeColor('charts.green') : undefined);
    this.tooltip = `${provider.name}\nModel: ${model}\nAPI key: ${hasKey ? 'stored securely' : 'not configured'}`;
    this.command = { command: 'bibzcode.providers.select', title: 'Select Provider', arguments: [this] };
  }
}

class ProviderTreeProvider {
  constructor(context, bridge, onState) {
    this.context = context;
    this.bridge = bridge;
    this.onState = onState;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }
  activeId() { return this.context.globalState.get('bibzcode.activeProvider', 'openrouter'); }
  models() { return this.context.globalState.get('bibzcode.models', {}); }
  modelFor(provider) { return this.models()[provider.id] || provider.defaultModel; }
  async getChildren() {
    const active = this.activeId();
    const result = [];
    for (const provider of providers) {
      const hasKey = Boolean(await this.context.secrets.get(`${KEY_PREFIX}${provider.id}.key`));
      result.push(new ProviderItem(provider, provider.id === active, this.modelFor(provider), hasKey));
    }
    return result;
  }
  getTreeItem(item) { return item; }
  refresh() { this.emitter.fire(undefined); this.onState?.(); }
  resolveProvider(item) { return item?.provider || providers.find((p) => p.id === this.activeId()); }
  async select(item) {
    let provider = this.resolveProvider(item);
    if (!item) {
      const picked = await vscode.window.showQuickPick(providers.map((p) => ({ label: p.name, description: p.id, provider: p })), { title: 'Select BibzCode provider' });
      provider = picked?.provider;
    }
    if (!provider) return;
    await this.context.globalState.update('bibzcode.activeProvider', provider.id);
    this.refresh();
    vscode.window.showInformationMessage(`BibzCode provider: ${provider.name}`);
  }
  async setKey(item) {
    const provider = this.resolveProvider(item);
    if (!provider) return;
    const key = await vscode.window.showInputBox({
      title: `API key for ${provider.name}`,
      prompt: 'The value is stored in the operating-system credential store and is never written to the workspace.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'API key is required',
    });
    if (key === undefined) return;
    await this.context.secrets.store(`${KEY_PREFIX}${provider.id}.key`, key.trim());
    this.refresh();
    const action = await vscode.window.showInformationMessage(`${provider.name} key saved securely.`, 'Test connection');
    if (action) await this.test(item);
  }
  async deleteKey(item) {
    const provider = this.resolveProvider(item);
    if (!provider) return;
    const confirm = await vscode.window.showWarningMessage(`Remove the saved ${provider.name} API key?`, { modal: true }, 'Remove');
    if (confirm !== 'Remove') return;
    await this.context.secrets.delete(`${KEY_PREFIX}${provider.id}.key`);
    this.refresh();
  }
  async selectModel(item) {
    const provider = this.resolveProvider(item);
    if (!provider) return;
    const key = await this.context.secrets.get(`${KEY_PREFIX}${provider.id}.key`);
    let models = provider.models.slice();
    const refresh = { label: '$(cloud-download) Fetch live models', kind: 'live' };
    const custom = { label: '$(edit) Enter model ID', kind: 'custom' };
    let picked = await vscode.window.showQuickPick([refresh, custom, ...models.map((model) => ({ label: model, kind: 'model' }))], { title: `Model for ${provider.name}`, matchOnDescription: true });
    if (!picked) return;
    if (picked.kind === 'live') {
      if (!key) { vscode.window.showWarningMessage(`Set the ${provider.name} API key first.`); return; }
      try {
        const env = await this.bridge.providerEnvironment(provider.id, this.modelFor(provider));
        const response = await this.bridge.json(['models', '--provider', provider.id, '--live'], { env });
        models = response.models || [];
        picked = await vscode.window.showQuickPick(models.map((model) => ({ label: typeof model === 'string' ? model : model.id, kind: 'model' })), { title: `Live models for ${provider.name}` });
        if (!picked) return;
      } catch (error) { vscode.window.showErrorMessage(`Unable to load models: ${error.message}`); return; }
    }
    let model = picked.label.replace(/^\$\([^)]*\)\s*/, '');
    if (picked.kind === 'custom') {
      model = await vscode.window.showInputBox({ title: `Model ID for ${provider.name}`, ignoreFocusOut: true, validateInput: (value) => value.trim() ? undefined : 'Model ID is required' });
      if (!model) return;
    }
    const all = { ...this.models(), [provider.id]: model.trim() };
    await this.context.globalState.update('bibzcode.models', all);
    this.refresh();
  }
  async test(item) {
    const provider = this.resolveProvider(item);
    if (!provider) return;
    if (!await this.context.secrets.get(`${KEY_PREFIX}${provider.id}.key`)) { vscode.window.showWarningMessage(`Set the ${provider.name} API key first.`); return; }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Testing ${provider.name}…` }, async () => {
      try {
        const env = await this.bridge.providerEnvironment(provider.id, this.modelFor(provider));
        const result = await this.bridge.json(['validate', '--provider', provider.id], { env, timeout: 60_000 });
        if (result.ok) vscode.window.showInformationMessage(result.message || `${provider.name} connection succeeded.`);
        else vscode.window.showWarningMessage(result.message || `${provider.name} rejected the connection.`);
      } catch (error) { vscode.window.showErrorMessage(`Connection test failed: ${error.message}`); }
    });
  }
  dispose() { this.emitter.dispose(); }
}

class SessionItem extends vscode.TreeItem {
  constructor(session) {
    const id = validateSessionId(session.session_id);
    super(session.session_name || id || 'Invalid session', vscode.TreeItemCollapsibleState.None);
    this.session = { ...session, session_id: id };
    this.contextValue = id ? 'bibzcode.session' : 'bibzcode.session.invalid';
    this.description = `${session.message_count || 0} messages · ${(session.updated_at || session.created_at || '').slice(0, 16).replace('T', ' ')}`;
    this.tooltip = id ? `${id}\n${this.description}` : 'Invalid session record';
    this.iconPath = new vscode.ThemeIcon('comment-discussion');
    if (id) this.command = { command: 'bibzcode.sessions.resume', title: 'Resume Session', arguments: [this] };
  }
}

class SessionTreeProvider {
  constructor(bridge) {
    this.bridge = bridge;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }
  async getChildren() {
    try {
      const data = await this.bridge.json(['sessions']);
      return (data.sessions || []).map((session) => new SessionItem(session));
    } catch { return []; }
  }
  getTreeItem(item) { return item; }
  refresh() { this.emitter.fire(undefined); }
  dispose() { this.emitter.dispose(); }
}

class AgentViewProvider {
  constructor(context, bridge, providerTree, sessionTree) {
    this.context = context;
    this.bridge = bridge;
    this.providerTree = providerTree;
    this.sessionTree = sessionTree;
    this.view = undefined;
    this.child = undefined;
    this.pendingSession = undefined;
    this.pendingDraft = '';
  }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(async (message) => {
      try {
        if (message?.type === 'start') await this.start();
        else if (message?.type === 'stop') this.stop();
        else if (message?.type === 'send') this.send(message.text);
      } catch (error) { this.post('status', `Error: ${error.message}`); }
    }, undefined, this.context.subscriptions);
    view.onDidDispose(() => { this.view = undefined; }, undefined, this.context.subscriptions);
    this.post('state', this.child ? 'running' : 'stopped');
    if (this.pendingSession !== undefined) {
      const session = this.pendingSession || undefined;
      this.pendingSession = undefined;
      void this.start(session);
    }
    if (this.pendingDraft) {
      this.post('draft', this.pendingDraft);
      this.pendingDraft = '';
    }
  }
  async pickWorkspace() {
    if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before running the agent.');
    const folders = (vscode.workspace.workspaceFolders || []).filter((folder) => folder.uri.scheme === 'file');
    if (!folders.length) throw new Error('Open or add a local workspace folder first.');
    if (folders.length === 1) return folders[0].uri;
    const picked = await vscode.window.showQuickPick(folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, uri: folder.uri })), { title: 'Run BibzCode in workspace folder' });
    return picked?.uri;
  }
  async open(sessionId) {
    if (sessionId && !validateSessionId(sessionId)) throw new Error('Invalid session ID.');
    await vscode.commands.executeCommand('workbench.view.extension.bibzcode');
    await vscode.commands.executeCommand('bibzcode.agent.focus');
    if (!this.view) { this.pendingSession = sessionId || ''; return; }
    await this.start(sessionId);
  }
  async start(sessionId) {
    if (sessionId && !validateSessionId(sessionId)) throw new Error('Invalid session ID.');
    const cwd = await this.pickWorkspace();
    if (!cwd) return;
    this.stop();
    const provider = providers.find((item) => item.id === this.providerTree.activeId()) || providers[0];
    const model = this.providerTree.modelFor(provider);
    const env = await this.bridge.providerEnvironment(provider.id, model);
    this.post('clear', '');
    this.post('status', `${provider.name} · ${model} · ${path.basename(cwd.fsPath)}`);
    this.post('state', 'starting');
    const child = spawn(this.bridge.pythonPath(), ['-m', 'bibzcode', ...(sessionId ? ['-s', sessionId] : [])], {
      cwd: cwd.fsPath,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    const output = (chunk) => this.post('output', stripAnsi(chunk.toString()).slice(-100_000));
    child.stdout.on('data', output);
    child.stderr.on('data', output);
    child.stdin.on('error', () => { /* process exit races with user input */ });
    child.once('spawn', () => this.post('state', 'running'));
    child.once('error', (error) => { this.post('output', `\nUnable to start BibzCode: ${error.message}\n`); this.finish(child); });
    child.once('exit', (code, signal) => { this.post('output', `\n[BibzCode exited ${code ?? signal ?? 'unknown'}]\n`); this.finish(child); });
  }
  setDraft(value) {
    const text = String(value || '').slice(0, 65_536);
    if (!this.view) this.pendingDraft = text;
    else this.post('draft', text);
  }
  send(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 65_536) return;
    if (!this.child?.stdin?.writable) { this.post('status', 'Start the agent first.'); return; }
    this.child.stdin.write(`${text}\n`);
  }
  stop() {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill('SIGTERM');
    this.post('state', 'stopped');
  }
  finish(child) {
    if (this.child === child) this.child = undefined;
    this.post('state', 'stopped');
    this.sessionTree.refresh();
  }
  post(type, data) { void this.view?.webview.postMessage({ type, data }); }
  html(webview) {
    const nonce = require('node:crypto').randomBytes(18).toString('base64');
    const csp = `default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">body{padding:0;color:var(--vscode-foreground);font-family:var(--vscode-font-family)}.bar{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--vscode-panel-border)}button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:5px 9px;cursor:pointer}button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}#status{padding:6px 8px;color:var(--vscode-descriptionForeground);font-size:11px}#output{height:46vh;min-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word;padding:8px;margin:0;background:var(--vscode-terminal-background)}form{padding:8px;display:grid;gap:6px}textarea{box-sizing:border-box;width:100%;resize:vertical;min-height:64px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:7px}</style></head><body><div class="bar"><button id="start">Start / Restart</button><button class="secondary" id="stop">Stop</button></div><div id="status">Stopped</div><pre id="output" aria-live="polite"></pre><form id="form"><textarea id="input" maxlength="65536" placeholder="Message or slash command"></textarea><button>Send</button></form><script nonce="${nonce}">const vscode=acquireVsCodeApi(),output=document.getElementById('output'),status=document.getElementById('status'),input=document.getElementById('input');document.getElementById('start').onclick=()=>vscode.postMessage({type:'start'});document.getElementById('stop').onclick=()=>vscode.postMessage({type:'stop'});document.getElementById('form').onsubmit=e=>{e.preventDefault();if(input.value.trim()){vscode.postMessage({type:'send',text:input.value});input.value=''}};window.addEventListener('message',({data:m})=>{if(m.type==='output'){output.textContent+=m.data;if(output.textContent.length>2000000)output.textContent=output.textContent.slice(-1500000);output.scrollTop=output.scrollHeight}else if(m.type==='clear')output.textContent='';else if(m.type==='status')status.textContent=m.data;else if(m.type==='state')document.body.dataset.state=m.data;else if(m.type==='draft'){input.value=m.data;input.focus()}});</script></body></html>`;
  }
  dispose() { this.stop(); }
}

function sessionIdFrom(item) { return validateSessionId(item?.session?.session_id); }

async function activate(context) {
  const bridge = new RuntimeBridge(context);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  status.command = 'bibzcode.providers.select';
  status.name = 'BibzCode Provider';
  const providerTree = new ProviderTreeProvider(context, bridge, updateStatus);
  const sessionTree = new SessionTreeProvider(bridge);
  const agent = new AgentViewProvider(context, bridge, providerTree, sessionTree);

  function updateStatus() {
    const provider = providers.find((item) => item.id === providerTree.activeId()) || providers[0];
    status.text = `$(sparkle) ${provider.name}: ${providerTree.modelFor(provider)}`;
    status.tooltip = 'Select BibzCode provider and model';
    status.show();
  }
  updateStatus();

  context.subscriptions.push(
    bridge, status, providerTree, sessionTree, agent,
    vscode.window.registerWebviewViewProvider('bibzcode.agent', agent, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerTreeDataProvider('bibzcode.providers', providerTree),
    vscode.window.registerTreeDataProvider('bibzcode.sessions', sessionTree),
    vscode.commands.registerCommand('bibzcode.setupRuntime', () => bridge.setupRuntime()),
    vscode.commands.registerCommand('bibzcode.providers.refresh', () => providerTree.refresh()),
    vscode.commands.registerCommand('bibzcode.providers.select', (item) => providerTree.select(item)),
    vscode.commands.registerCommand('bibzcode.providers.setKey', (item) => providerTree.setKey(item)),
    vscode.commands.registerCommand('bibzcode.providers.deleteKey', (item) => providerTree.deleteKey(item)),
    vscode.commands.registerCommand('bibzcode.providers.selectModel', (item) => providerTree.selectModel(item)),
    vscode.commands.registerCommand('bibzcode.providers.test', (item) => providerTree.test(item)),
    vscode.commands.registerCommand('bibzcode.openAgent', () => agent.open()),
    vscode.commands.registerCommand('bibzcode.sessions.new', async () => { await agent.open(); sessionTree.refresh(); }),
    vscode.commands.registerCommand('bibzcode.sessions.refresh', () => sessionTree.refresh()),
    vscode.commands.registerCommand('bibzcode.sessions.resume', async (item) => {
      let id = sessionIdFrom(item);
      if (!id) {
        const data = await bridge.json(['sessions']);
        const picked = await vscode.window.showQuickPick((data.sessions || []).map((s) => ({ label: s.session_name || s.session_id, description: s.session_id, id: s.session_id })), { title: 'Resume BibzCode session' });
        id = validateSessionId(picked?.id);
      }
      if (id) await agent.open(id);
    }),
    vscode.commands.registerCommand('bibzcode.sessions.rename', async (item) => {
      const id = sessionIdFrom(item); if (!id) return;
      const name = await vscode.window.showInputBox({ title: 'Rename BibzCode session', value: item.session.session_name || '', validateInput: (value) => value.trim() ? undefined : 'Name is required' });
      if (!name) return;
      await bridge.json(['rename-session', id, name.trim()]); sessionTree.refresh();
    }),
    vscode.commands.registerCommand('bibzcode.sessions.delete', async (item) => {
      const id = sessionIdFrom(item); if (!id) return;
      const confirmEnabled = vscode.workspace.getConfiguration('bibzcode').get('confirmSessionDelete', true);
      if (confirmEnabled) {
        const choice = await vscode.window.showWarningMessage(`Delete session “${item.label}”? This cannot be undone.`, { modal: true }, 'Delete');
        if (choice !== 'Delete') return;
      }
      await bridge.json(['delete-session', id]); sessionTree.refresh();
    }),
    vscode.commands.registerCommand('bibzcode.sessions.export', async (item) => {
      const id = sessionIdFrom(item); if (!id) return;
      const base = safeFileName(item.session.session_name || id);
      const target = await vscode.window.showSaveDialog({
        title: 'Export BibzCode session',
        defaultUri: vscode.Uri.file(path.join(workspaceRoot(vscode.workspace.workspaceFolders) || process.cwd(), `${base}.md`)),
        filters: { Markdown: ['md'], HTML: ['html'], Text: ['txt'], JSON: ['json'] },
      });
      if (!target) return;
      await bridge.json(['export-session', id, target.fsPath]);
      vscode.window.showInformationMessage(`Session exported to ${target.fsPath}`);
    }),
    vscode.commands.registerCommand('bibzcode.askSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) return;
      const selected = editor.document.getText(editor.selection).slice(0, 50_000);
      const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
      const prompt = `Review this selection from ${relative}:\n\n${selected}`;
      await agent.open();
      agent.setDraft(prompt);
      vscode.window.showInformationMessage('Selection context is ready in the BibzCode agent input.');
    }),
    vscode.commands.registerCommand('bibzcode.workspace.addFolder', () => vscode.commands.executeCommand('workbench.action.addRootFolder')),
    vscode.commands.registerCommand('bibzcode.languages.browseExtensions', () => vscode.commands.executeCommand('workbench.extensions.search', '@category:"Programming Languages"')),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
