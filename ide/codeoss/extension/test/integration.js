'use strict';
const assert = require('node:assert/strict');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('bibzcode.bibzcode-ai');
  assert.ok(extension, 'BibzCode extension was not discovered');
  await extension.activate();
  assert.equal(extension.isActive, true, 'BibzCode extension did not activate');
  const commands = new Set(await vscode.commands.getCommands(true));
  for (const command of [
    'bibzcode.openAgent', 'bibzcode.setupRuntime', 'bibzcode.providers.select',
    'bibzcode.providers.setKey', 'bibzcode.providers.selectModel',
    'bibzcode.sessions.new', 'bibzcode.sessions.resume', 'bibzcode.sessions.rename',
    'bibzcode.sessions.delete', 'bibzcode.sessions.export',
    'bibzcode.languages.browseExtensions',
  ]) assert.ok(commands.has(command), `missing command: ${command}`);
  await vscode.commands.executeCommand('bibzcode.providers.refresh');
  await vscode.commands.executeCommand('bibzcode.sessions.refresh');
  await vscode.commands.executeCommand('workbench.view.extension.bibzcode');
  await vscode.commands.executeCommand('bibzcode.agent.focus');
  await new Promise((resolve) => setTimeout(resolve, 750));
  console.log('BibzCode extension-host integration passed.');
}
module.exports = { run };
