import type { AgentCompletionRequest, AgentOrchestrationEvent, AgentOrchestrationRequest, AgentOrchestrationTask } from '../shared/contracts.js';
import { AgentService, type ToolAgentEvent } from './agent-service.js';
import type { AgentToolName } from '../shared/agent-tools.js';

type ApprovalCall = { id: string; name: AgentToolName; arguments: Record<string, unknown> };
type ApprovalRisk = 'read' | 'write' | 'terminal' | 'git';
type Approve = (call: ApprovalCall, risk: ApprovalRisk, requestId: string) => Promise<boolean>;

export class AgentOrchestrator {
  constructor(private readonly agent: AgentService) {}

  async run(orchestrationId: string, request: AgentOrchestrationRequest, signal: AbortSignal, emit: (event: AgentOrchestrationEvent) => void, emitStream: (task: AgentOrchestrationTask, requestId: string, event: ToolAgentEvent) => void, approve: Approve): Promise<void> {
    const tasks = request.tasks.slice(0, 16); if (!tasks.length) throw new Error('Orchestration requires at least one task.');
    const ids = new Set(tasks.map((task) => task.id)); if (ids.size !== tasks.length) throw new Error('Orchestration task IDs must be unique.');
    for (const task of tasks) for (const dependency of task.dependsOn ?? []) if (!ids.has(dependency)) throw new Error(`Unknown task dependency: ${dependency}`);
    const allowMutations = request.allowMutations === true;
    const maxConcurrency = allowMutations ? 1 : Math.max(1, Math.min(4, request.maxConcurrency ?? 3));
    const pending = new Map(tasks.map((task) => [task.id, task])); const done = new Set<string>(); const failed = new Set<string>(); let running = 0;
    emit({ orchestrationId, type: 'started', message: `${tasks.length} agent tasks queued (concurrency ${maxConcurrency}).` });

    const runTask = async (task: AgentOrchestrationTask): Promise<void> => {
      const requestId = crypto.randomUUID(); emit({ orchestrationId, type: 'task-start', taskId: task.id, requestId, label: task.label });
      try {
        const completion: AgentCompletionRequest = { prompt: task.prompt, systemPrompt: task.systemPrompt || 'You are a child BibzCode agent. Work only on the assigned subtask, use read-only tools by default, and report evidence.', requestId, taskId: task.id, allowMutations };
        for await (const event of this.agent.streamAgent(completion, signal, (call, risk) => approve(call, risk, requestId))) emitStream(task, requestId, event);
        done.add(task.id); emit({ orchestrationId, type: 'task-done', taskId: task.id, requestId, label: task.label });
      } catch (error) {
        failed.add(task.id); emit({ orchestrationId, type: 'task-error', taskId: task.id, requestId, label: task.label, message: error instanceof Error ? error.message : String(error) });
      }
    };

    await new Promise<void>((resolve, reject) => {
      const tick = (): void => {
        if (signal.aborted) { emit({ orchestrationId, type: 'cancelled', message: 'Orchestration cancelled.' }); resolve(); return; }
        const blocked = [...pending.values()].filter((task) => (task.dependsOn ?? []).some((dependency) => failed.has(dependency)));
        blocked.forEach((task) => { pending.delete(task.id); failed.add(task.id); emit({ orchestrationId, type: 'task-error', taskId: task.id, label: task.label, message: 'Skipped because a dependency failed.' }); });
        if (!pending.size && running === 0) { emit({ orchestrationId, type: 'done', message: failed.size ? `${failed.size} task(s) failed or were skipped.` : 'All agent tasks completed.' }); resolve(); return; }
        const ready = [...pending.values()].filter((task) => (task.dependsOn ?? []).every((dependency) => done.has(dependency))).slice(0, Math.max(0, maxConcurrency - running));
        for (const task of ready) { pending.delete(task.id); running += 1; void runTask(task).finally(() => { running -= 1; tick(); }).catch(reject); }
        if (pending.size && !ready.length && running === 0) { reject(new Error('Orchestration contains a dependency cycle.')); }
      };
      tick();
    });
  }
}
