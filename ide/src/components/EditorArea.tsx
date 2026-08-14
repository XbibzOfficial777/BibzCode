import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Circle, X } from 'lucide-react';
import type { IdeSettings, OpenFile } from '../../shared/contracts';
import { basename } from '../lib';
import logo from '../assets/logo.png';

export function EditorArea({ files, activePath, settings, targetLine, onActivate, onChange, onClose, onSave, onCursor }: {
  files: OpenFile[]; activePath: string; settings: IdeSettings | null; targetLine: number;
  onActivate: (path: string) => void; onChange: (path: string, content: string) => void;
  onClose: (path: string) => void; onSave: () => void; onCursor: (line: number, column: number) => void;
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const active = files.find((file) => file.relativePath === activePath);
  useEffect(() => {
    if (targetLine > 0 && editorRef.current) {
      editorRef.current.revealLineInCenter(targetLine);
      editorRef.current.setPosition({ lineNumber: targetLine, column: 1 });
      editorRef.current.focus();
    }
  }, [targetLine, activePath]);

  const mount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.addCommand(2048 | 49, onSave); // Monaco KeyMod.CtrlCmd | KeyCode.KeyS
    editor.onDidChangeCursorPosition((event) => onCursor(event.position.lineNumber, event.position.column));
    if (targetLine > 0) editor.setPosition({ lineNumber: targetLine, column: 1 });
  };

  return <main className="editor-shell">
    <div className="editor-tabs" role="tablist">
      {files.map((file) => <button role="tab" aria-selected={file.relativePath === activePath} className={file.relativePath === activePath ? 'active' : ''} key={file.relativePath} onClick={() => onActivate(file.relativePath)}>
        {file.dirty && <Circle className="dirty-dot" />}<span title={file.relativePath}>{basename(file.relativePath)}</span>
        <span className="tab-close" role="button" aria-label={`Close ${basename(file.relativePath)}`} onClick={(event) => { event.stopPropagation(); onClose(file.relativePath); }}><X /></span>
      </button>)}
    </div>
    <div className="editor-content">
      {active ? <Editor
        key={active.relativePath}
        path={active.relativePath}
        value={active.content}
        language={active.language}
        theme="bibz-dark"
        onMount={mount}
        onChange={(value) => onChange(active.relativePath, value ?? '')}
        options={{
          automaticLayout: true,
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
          fontSize: settings?.editorFontSize ?? 14,
          wordWrap: settings?.wordWrap ?? 'off',
          minimap: { enabled: true, scale: 1 },
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          padding: { top: 12, bottom: 16 },
          renderWhitespace: 'selection',
          formatOnPaste: false,
          formatOnType: false,
          links: false,
          readOnly: active.relativePath.startsWith('virtual://'),
        }}
      /> : <div className="welcome-editor">
        <img src={logo} alt="BibzCode IDE" />
        <h1>BibzCode IDE</h1>
        <p>Secure AI-native development with the complete BibzCode runtime.</p>
        <div className="welcome-shortcuts"><span><kbd>Ctrl</kbd><kbd>K</kbd> <kbd>Ctrl</kbd><kbd>O</kbd> Open folder</span><span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd> Command palette</span><span><kbd>Ctrl</kbd><kbd>`</kbd> Terminal</span><span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>B</kbd> BibzCode assistant</span></div>
      </div>}
    </div>
  </main>;
}
