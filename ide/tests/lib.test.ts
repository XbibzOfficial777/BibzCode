import { describe, expect, it } from 'vitest';
import { basename, friendlyError, joinRelative, languageForPath, parentPath } from '../src/lib';

describe('renderer utilities', () => {
  it('maps common IDE languages', () => {
    expect(languageForPath('src/App.tsx')).toBe('typescript');
    expect(languageForPath('worker.py')).toBe('python');
    expect(languageForPath('unknown.data')).toBe('plaintext');
  });
  it('handles portable relative paths', () => {
    expect(basename('src/a.ts')).toBe('a.ts');
    expect(parentPath('src/a.ts')).toBe('src');
    expect(joinRelative('src', 'a.ts')).toBe('src/a.ts');
  });
  it('removes Electron invoke noise from errors', () => {
    expect(friendlyError(new Error("Error invoking remote method 'x': Error: denied"))).toBe('denied');
  });
});
