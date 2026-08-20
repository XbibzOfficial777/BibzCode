import { createRequire } from 'node:module';
import path from 'node:path';

type HostMessage =
  | { type: 'activate'; id: string; installPath: string; entry: string; settings: Record<string, unknown> }
  | { type: 'execute-command'; id: string; command: string; arguments?: unknown[] }
  | { type: 'deactivate'; id: string };

type HostEvent =
  | { type: 'status'; id: string; state: 'starting' | 'running' | 'failed' | 'stopped'; message: string; commands: string[]; activatedAt?: string }
  | { type: 'command'; id: string; command: string; arguments: unknown[] }
  | { type: 'message'; id: string; message: string };

const send = (event: HostEvent): void => { if (process.send) process.send(event); };
const requireFromHere = createRequire(__filename);
const commandHandlers = new Map<string, (args: unknown[]) => unknown | Promise<unknown>>();
const active = new Map<string, { deactivate?: () => unknown | Promise<unknown> }>();

function installVscodeShim(id: string, settings: Record<string, unknown>): void {
  const nodeModule = requireFromHere('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const originalLoad = nodeModule._load;
  const shim = {
    commands: {
      registerCommand: (command: string, callback: ( ...args: unknown[]) => unknown | Promise<unknown>) => {
        if (!/^[a-zA-Z0-9._-]{1,160}$/.test(command)) throw new Error('Extension command name is invalid.');
        commandHandlers.set(`${id}:${command}`, async (args) => callback(...args));
        send({ type: 'message', id, message: `Registered command ${command}` });
        return { dispose: () => commandHandlers.delete(`${id}:${command}`) };
      },
      executeCommand: async (command: string, ...args: unknown[]) => {
        if (command === 'setContext') return undefined;
        throw new Error(`Command execution is restricted in BibzCode host: ${command}`);
      },
    },
    window: {
      showInformationMessage: async (message: string) => { send({ type: 'message', id, message: String(message).slice(0, 2000) }); return undefined; },
      showWarningMessage: async (message: string) => { send({ type: 'message', id, message: `Warning: ${String(message).slice(0, 2000)}` }); return undefined; },
      showErrorMessage: async (message: string) => { send({ type: 'message', id, message: `Error: ${String(message).slice(0, 2000)}` }); return undefined; },
    },
    workspace: {
      getConfiguration: (section?: string) => ({ get: <T>(key: string, fallback?: T) => (settings[`${section ? `${section}.` : ''}${key}`] as T | undefined) ?? fallback }),
      workspaceFolders: [],
    },
    extensions: { getExtension: () => undefined },
    env: { appName: 'BibzCode IDE', appHost: 'desktop' },
    Uri: { file: (value: string) => ({ fsPath: path.resolve(value), scheme: 'file', toString: () => `file://${path.resolve(value)}` }) },
    Disposable: { from: (...items: Array<{ dispose: () => void }>) => ({ dispose: () => items.forEach((item) => item.dispose()) }) },
  };
  nodeModule._load = (request, parent, isMain) => request === 'vscode' ? shim : originalLoad(request, parent, isMain);
}

async function activate(message: Extract<HostMessage, { type: 'activate' }>): Promise<void> {
  const entry = path.resolve(message.installPath, message.entry);
  send({ type: 'status', id: message.id, state: 'starting', message: `Loading ${message.entry}`, commands: [] });
  try {
    installVscodeShim(message.id, message.settings);
    const extension = requireFromHere(entry) as { activate?: () => unknown | Promise<unknown>; deactivate?: () => unknown | Promise<unknown> };
    if (typeof extension.activate !== 'function') throw new Error('Extension has no activate() export.');
    await Promise.race([Promise.resolve(extension.activate()), new Promise((_, reject) => setTimeout(() => reject(new Error('Activation timed out after 10 seconds.')), 10_000))]);
    active.set(message.id, { deactivate: extension.deactivate });
    const commands = [...commandHandlers.keys()].filter((key) => key.startsWith(`${message.id}:`)).map((key) => key.slice(message.id.length + 1));
    send({ type: 'status', id: message.id, state: 'running', message: 'Extension activated in the guarded host.', commands, activatedAt: new Date().toISOString() });
  } catch (error) {
    send({ type: 'status', id: message.id, state: 'failed', message: error instanceof Error ? error.message : String(error), commands: [] });
  }
}

process.on('message', (message: HostMessage) => {
  void (async () => {
    if (message.type === 'activate') return activate(message);
    if (message.type === 'deactivate') {
      const current = active.get(message.id);
      if (current?.deactivate) await Promise.race([Promise.resolve(current.deactivate()), new Promise((resolve) => setTimeout(resolve, 2000))]);
      active.delete(message.id);
      for (const key of commandHandlers.keys()) if (key.startsWith(`${message.id}:`)) commandHandlers.delete(key);
      send({ type: 'status', id: message.id, state: 'stopped', message: 'Extension deactivated.', commands: [] });
      return;
    }
    if (message.type === 'execute-command') {
      const handler = commandHandlers.get(`${message.id}:${message.command}`);
      if (!handler) throw new Error(`Command is not registered: ${message.command}`);
      await Promise.race([Promise.resolve(handler(message.arguments ?? [])), new Promise((_, reject) => setTimeout(() => reject(new Error('Command timed out after 10 seconds.')), 10_000))]);
    }
  })().catch((error) => send({ type: 'message', id: message.type === 'execute-command' ? message.id : '', message: error instanceof Error ? error.message : String(error) }));
});

process.on('disconnect', () => process.exit(0));
