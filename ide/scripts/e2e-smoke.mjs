import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'bibzcode-ide-e2e-'));
const workspace = path.join(temporary, 'workspace');
const profile = path.join(temporary, 'profile');
const report = path.join(temporary, 'report.json');
const outputDir = path.resolve('test-results');
const screenshot = path.join(outputDir, 'bibzcode-ide.png');
await mkdir(workspace, { recursive: true });
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(workspace, 'hello.py'), 'print("hello from BibzCode IDE")\n');

const executable = path.resolve('node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const child = spawn(executable, ['--no-sandbox', `--user-data-dir=${profile}`, '.'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BIBZCODE_IDE_TEST_WORKSPACE: workspace,
    BIBZCODE_IDE_E2E: '1',
    BIBZCODE_IDE_E2E_REPORT: report,
    BIBZCODE_IDE_E2E_SCREENSHOT: screenshot,
  },
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
let exitState = 'running';
child.stdout?.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr?.on('data', (chunk) => { logs += chunk.toString(); });
child.on('exit', (code, signal) => { exitState = `exited code=${code} signal=${signal}`; });

const deadline = Date.now() + 35_000;
let parsed;
try {
  while (Date.now() < deadline) {
    try { parsed = JSON.parse(await readFile(report, 'utf8')); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
  }
  if (!parsed) {
    const markers = [];
    for (const suffix of ['imported', 'locked', 'boot']) {
      try { markers.push(`${suffix}=${(await readFile(`${report}.${suffix}`, 'utf8')).trim()}`); }
      catch { markers.push(`${suffix}=missing`); }
    }
    throw new Error(`Electron smoke report timed out (${exitState}, ${markers.join(', ')}).\n${logs.slice(-4000)}`);
  }
  const expected = {
    brand: true,
    explorer: true,
    fixture: true,
    nodeProcess: 'undefined',
    nodeRequire: 'undefined',
    api: 'object',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (parsed[key] !== value) throw new Error(`E2E assertion failed for ${key}: ${JSON.stringify(parsed[key])}`);
  }
  if (!String(parsed.title).includes('BibzCode IDE')) throw new Error('Production title was not rendered');
  if (!String(parsed.csp).includes("object-src 'none'")) throw new Error('Strict renderer CSP is missing');
  if (!String(parsed.url).startsWith('bibzcode://app/')) throw new Error(`Production renderer did not use the secure custom protocol: ${parsed.url}`);
  const prefs = parsed.webPreferences ?? {};
  if (prefs.nodeIntegration !== false || prefs.contextIsolation !== true || prefs.sandbox !== true || prefs.webSecurity !== true) {
    throw new Error('Secure BrowserWindow preferences were not preserved');
  }
  await access(screenshot);
  console.log(`Electron production smoke passed. Screenshot: ${screenshot}`);
} finally {
  if (child.pid) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
  }
  await rm(temporary, { recursive: true, force: true });
}
