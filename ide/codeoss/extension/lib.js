'use strict';

const path = require('node:path');

const SESSION_ID = /^(?:bzcli|dscli)-[0-9a-f]{12}$/;

function validateSessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null;
}

function stripAnsi(value) {
  return String(value ?? '').replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

function safeFileName(value, fallback = 'session') {
  const cleaned = String(value ?? '').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 100);
  return cleaned || fallback;
}

function managedPythonPath(globalStoragePath, platform = process.platform) {
  return platform === 'win32'
    ? path.join(globalStoragePath, 'runtime', 'Scripts', 'python.exe')
    : path.join(globalStoragePath, 'runtime', 'bin', 'python');
}

function workspaceRoot(workspaceFolders) {
  const folders = Array.isArray(workspaceFolders) ? workspaceFolders : [];
  const first = folders.find((entry) => entry?.uri?.scheme === 'file');
  return first?.uri?.fsPath || undefined;
}

module.exports = { validateSessionId, stripAnsi, safeFileName, managedPythonPath, workspaceRoot };
