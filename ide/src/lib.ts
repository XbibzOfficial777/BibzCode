export function languageForPath(relativePath: string): string {
  const extension = relativePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', json: 'json', jsonc: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', xml: 'xml', svg: 'xml',
    sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', sql: 'sql', rs: 'rust', go: 'go', java: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift',
  };
  return map[extension] ?? 'plaintext';
}

export function basename(relativePath: string): string {
  return relativePath.split('/').filter(Boolean).pop() ?? relativePath;
}

export function parentPath(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function joinRelative(parent: string, child: string): string {
  return [...parent.split('/').filter(Boolean), child].join('/');
}

export function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error);
}
