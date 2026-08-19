import { z } from 'zod';
import type { AgentToolDefinition, AgentToolName } from '../shared/agent-tools.js';
import { AGENT_TOOL_DEFINITIONS, AGENT_TOOL_MAP } from '../shared/agent-tools.js';
import { GitService } from './git-service.js';
import { ProcessManager } from './process-manager.js';
import { WorkspaceService } from './workspace.js';

const schemas: Record<AgentToolName, z.ZodTypeAny> = {
  workspace_list: z.object({ path: z.string().max(4096).default('') }),
  workspace_read: z.object({ path: z.string().min(1).max(4096) }),
  workspace_search: z.object({ query: z.string().min(1).max(500) }),
  workspace_write: z.object({ path: z.string().min(1).max(4096), content: z.string().max(10 * 1024 * 1024) }),
  workspace_create: z.object({ path: z.string().min(1).max(4096), kind: z.enum(['file', 'directory']) }),
  workspace_rename: z.object({ from: z.string().min(1).max(4096), to: z.string().min(1).max(4096) }),
  workspace_trash: z.object({ path: z.string().min(1).max(4096) }),
  terminal_run: z.object({ command: z.string().min(1).max(8192) }),
  git_status: z.object({}),
  git_diff: z.object({ path: z.string().max(4096).default(''), staged: z.boolean().default(false) }),
  git_stage: z.object({ path: z.string().min(1).max(4096) }),
  git_unstage: z.object({ path: z.string().min(1).max(4096) }),
  git_commit: z.object({ message: z.string().min(1).max(500).refine((value) => !/[\r\n]/.test(value), 'Commit message must be one line') }),
  context_compress: z.object({ text: z.string().max(2_000_000), targetChars: z.number().int().min(2048).max(4_000_000) }),
};

const APPROVAL_TOOLS = new Set<AgentToolName>(['workspace_write', 'workspace_create', 'workspace_rename', 'workspace_trash', 'terminal_run', 'git_stage', 'git_unstage', 'git_commit']);
const MAX_RESULT_CHARS = 80_000;

export interface ToolExecutionResult { name: AgentToolName; ok: boolean; output: string; }

export class ToolExecutor {
  constructor(private readonly workspace: WorkspaceService, private readonly processes: ProcessManager, private readonly git: GitService, private readonly compress: (text: string, targetChars: number) => unknown) {}

  definitions(): readonly AgentToolDefinition[] { return AGENT_TOOL_DEFINITIONS; }
  has(name: string): name is AgentToolName { return AGENT_TOOL_MAP.has(name as AgentToolName); }
  requiresApproval(name: AgentToolName): boolean { return APPROVAL_TOOLS.has(name); }

  async execute(name: AgentToolName, rawArgs: Record<string, unknown>): Promise<ToolExecutionResult> {
    const args = schemas[name].parse(rawArgs) as Record<string, unknown>;
    const root = this.workspace.requireRoot();
    let value: unknown;
    switch (name) {
      case 'workspace_list': value = await this.workspace.list(args.path as string); break;
      case 'workspace_read': value = await this.workspace.read(args.path as string); break;
      case 'workspace_search': value = await this.workspace.search(args.query as string); break;
      case 'workspace_write': await this.workspace.write(args.path as string, args.content as string); value = `Wrote ${args.path}`; break;
      case 'workspace_create': await this.workspace.create(args.path as string, args.kind as 'file' | 'directory'); value = `Created ${args.kind} ${args.path}`; break;
      case 'workspace_rename': await this.workspace.rename(args.from as string, args.to as string); value = `Renamed ${args.from} to ${args.to}`; break;
      case 'workspace_trash': await this.workspace.trash(args.path as string); value = `Moved ${args.path} to the operating system trash`; break;
      case 'terminal_run': value = await this.processes.executeCommand(args.command as string, root); break;
      case 'git_status': value = await this.git.status(root); break;
      case 'git_diff': value = await this.git.diff(root, args.path as string, args.staged as boolean); break;
      case 'git_stage': await this.git.stage(root, args.path as string); value = `Staged ${args.path}`; break;
      case 'git_unstage': await this.git.unstage(root, args.path as string); value = `Unstaged ${args.path}`; break;
      case 'git_commit': value = await this.git.commit(root, args.message as string); break;
      case 'context_compress': value = this.compress(args.text as string, args.targetChars as number); break;
    }
    const output = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return { name, ok: true, output: output.length > MAX_RESULT_CHARS ? `${output.slice(0, MAX_RESULT_CHARS)}\n[tool output truncated]` : output };
  }
}
