export type AgentToolName =
  | 'workspace_list'
  | 'workspace_read'
  | 'workspace_search'
  | 'workspace_write'
  | 'workspace_create'
  | 'workspace_rename'
  | 'workspace_trash'
  | 'terminal_run'
  | 'git_status'
  | 'git_diff'
  | 'git_stage'
  | 'git_unstage'
  | 'git_commit'
  | 'context_compress';

export type AgentToolRisk = 'read' | 'write' | 'terminal' | 'git';

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  risk: AgentToolRisk;
  parameters: Record<string, unknown>;
}

const string = (description: string, maxLength = 4096): Record<string, unknown> => ({ type: 'string', description, maxLength });
const boolean = (description: string): Record<string, unknown> => ({ type: 'boolean', description });
const integer = (description: string, minimum: number, maximum: number): Record<string, unknown> => ({ type: 'integer', description, minimum, maximum });
const object = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false });

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [
  { name: 'workspace_list', description: 'List files and directories inside the opened workspace.', risk: 'read', parameters: object({ path: string('Relative directory path. Use an empty string for workspace root.') }) },
  { name: 'workspace_read', description: 'Read a UTF-8 text file from the opened workspace.', risk: 'read', parameters: object({ path: string('Workspace-relative file path.', 4096) }, ['path']) },
  { name: 'workspace_search', description: 'Search text across the opened workspace and return matching file locations.', risk: 'read', parameters: object({ query: string('Text query to search for.', 500) }, ['query']) },
  { name: 'workspace_write', description: 'Write complete UTF-8 text content to an existing or new workspace file.', risk: 'write', parameters: object({ path: string('Workspace-relative file path.', 4096), content: string('Complete replacement file content.', 10_000_000) }, ['path', 'content']) },
  { name: 'workspace_create', description: 'Create a new empty file or directory in the workspace.', risk: 'write', parameters: object({ path: string('Workspace-relative target path.', 4096), kind: { type: 'string', enum: ['file', 'directory'] } }, ['path', 'kind']) },
  { name: 'workspace_rename', description: 'Rename or move a workspace file or directory within the workspace.', risk: 'write', parameters: object({ from: string('Existing workspace-relative path.', 4096), to: string('New workspace-relative path.', 4096) }, ['from', 'to']) },
  { name: 'workspace_trash', description: 'Move a workspace file or directory to the operating system trash.', risk: 'write', parameters: object({ path: string('Workspace-relative path to trash.', 4096) }, ['path']) },
  { name: 'terminal_run', description: 'Run a bounded shell command in the opened workspace and return stdout/stderr.', risk: 'terminal', parameters: object({ command: string('Shell command to run in the workspace.', 8192) }, ['command']) },
  { name: 'git_status', description: 'Read Git porcelain status for the opened workspace.', risk: 'git', parameters: object({}) },
  { name: 'git_diff', description: 'Read a Git diff for the workspace or one relative path.', risk: 'git', parameters: object({ path: string('Optional workspace-relative path.', 4096), staged: boolean('Read staged diff instead of working-tree diff.') }) },
  { name: 'git_stage', description: 'Stage one workspace-relative path in Git.', risk: 'git', parameters: object({ path: string('Workspace-relative path to stage.', 4096) }, ['path']) },
  { name: 'git_unstage', description: 'Unstage one workspace-relative path in Git.', risk: 'git', parameters: object({ path: string('Workspace-relative path to unstage.', 4096) }, ['path']) },
  { name: 'git_commit', description: 'Create a one-line Git commit in the opened workspace.', risk: 'git', parameters: object({ message: string('One-line commit message.', 500) }, ['message']) },
  { name: 'context_compress', description: 'Deterministically compress text context using the configured compression policy.', risk: 'read', parameters: object({ text: string('Text context to compress.', 2_000_000), targetChars: integer('Maximum target character count.', 2048, 4_000_000) }, ['text', 'targetChars']) },
];

export const AGENT_TOOL_MAP = new Map(AGENT_TOOL_DEFINITIONS.map((tool) => [tool.name, tool] as const));
