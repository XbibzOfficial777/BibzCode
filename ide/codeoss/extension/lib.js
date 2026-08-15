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

class ProtocolDecoder {
  constructor(marker, onText, onMessage) {
    this.marker = marker;
    this.onText = onText;
    this.onMessage = onMessage;
    this.buffer = '';
  }

  push(value) {
    this.buffer += String(value ?? '');
    while (this.buffer) {
      const index = this.buffer.indexOf(this.marker);
      if (index < 0) {
        let keep = 0;
        const limit = Math.min(this.marker.length - 1, this.buffer.length);
        for (let size = limit; size > 0; size -= 1) {
          if (this.marker.startsWith(this.buffer.slice(-size))) { keep = size; break; }
        }
        const ready = this.buffer.slice(0, this.buffer.length - keep);
        if (ready) this.onText(ready);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        return;
      }
      if (index > 0) this.onText(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index);
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const encoded = this.buffer.slice(this.marker.length, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        this.onMessage(JSON.parse(decoded));
      } catch {
        this.onText(`${this.marker}${encoded}\n`);
      }
    }
  }

  flush() {
    if (this.buffer) this.onText(this.buffer);
    this.buffer = '';
  }
}

module.exports = { validateSessionId, stripAnsi, safeFileName, managedPythonPath, workspaceRoot, ProtocolDecoder };
