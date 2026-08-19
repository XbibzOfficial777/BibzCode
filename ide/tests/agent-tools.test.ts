import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_DEFINITIONS, AGENT_TOOL_MAP } from '../shared/agent-tools';

describe('native agent tool registry', () => {
  it('exposes workspace, terminal, Git, and compression capabilities', () => {
    const names = AGENT_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toContain('workspace_read');
    expect(names).toContain('workspace_write');
    expect(names).toContain('terminal_run');
    expect(names).toContain('git_diff');
    expect(names).toContain('git_commit');
    expect(names).toContain('context_compress');
  });

  it('marks mutating and execution tools as protected', () => {
    expect(AGENT_TOOL_MAP.get('workspace_read')?.risk).toBe('read');
    expect(AGENT_TOOL_MAP.get('workspace_write')?.risk).toBe('write');
    expect(AGENT_TOOL_MAP.get('terminal_run')?.risk).toBe('terminal');
    expect(AGENT_TOOL_MAP.get('git_commit')?.risk).toBe('git');
  });
});
