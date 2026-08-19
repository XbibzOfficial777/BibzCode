import React from 'react';
import ReactDOM from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { App } from './App';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

monaco.editor.defineTheme('bibz-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '737373', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'd4d4d4', fontStyle: 'bold' },
    { token: 'string', foreground: 'b9b9b9' },
    { token: 'number', foreground: 'ffffff' },
    { token: 'type', foreground: 'd0d0d0' },
  ],
  colors: {
    'editor.background': '#080808',
    'editor.foreground': '#e6e6e6',
    'editorLineNumber.foreground': '#565656',
    'editorLineNumber.activeForeground': '#d7d7d7',
    'editorCursor.foreground': '#ffffff',
    'editor.selectionBackground': '#3f3f3f',
    'editor.inactiveSelectionBackground': '#292929',
    'editor.lineHighlightBackground': '#111111',
    'editorIndentGuide.background1': '#222222',
    'editorIndentGuide.activeBackground1': '#555555',
  },
});
monaco.editor.defineTheme('bibz-light', {
  base: 'vs',
  inherit: true,
  rules: [{ token: 'comment', foreground: '6a737d', fontStyle: 'italic' }, { token: 'keyword', foreground: '005cc5', fontStyle: 'bold' }, { token: 'string', foreground: '032f62' }],
  colors: { 'editor.background': '#ffffff', 'editor.foreground': '#24292f', 'editorCursor.foreground': '#111111', 'editor.selectionBackground': '#b6d7ff', 'editor.lineHighlightBackground': '#f6f8fa' },
});
monaco.editor.defineTheme('high-contrast', {
  base: 'hc-black',
  inherit: true,
  rules: [{ token: 'comment', foreground: '7ee787', fontStyle: 'italic' }, { token: 'keyword', foreground: 'ff7b72', fontStyle: 'bold' }, { token: 'string', foreground: 'a5d6ff' }],
  colors: { 'editor.background': '#000000', 'editor.foreground': '#ffffff', 'editorCursor.foreground': '#ffffff', 'editor.selectionBackground': '#264f78' },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
