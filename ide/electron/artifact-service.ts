import { mkdir, readFile, rename as renameFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentArtifact, ArtifactOperation, ArtifactStatus } from '../shared/contracts.js';
import { isWithin } from './security.js';
import { WorkspaceService } from './workspace.js';

interface Snapshot { exists: boolean; isDirectory: boolean; content?: string }

export class ArtifactService {
  private artifacts = new Map<string, AgentArtifact>();
  private readonly stateFile: string;
  constructor(private readonly workspace: WorkspaceService, userData: string) { this.stateFile = path.join(userData, 'agent-artifacts.json'); }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const raw = await readFile(this.stateFile, 'utf8').catch(() => '[]');
    try { const values = JSON.parse(raw) as AgentArtifact[]; this.artifacts = new Map(values.filter((item) => item && typeof item.id === 'string').slice(-200).map((item) => [item.id, item])); } catch { this.artifacts.clear(); }
  }

  private async persist(): Promise<void> {
    const temp = `${this.stateFile}.tmp-${process.pid}`;
    await writeFile(temp, `${JSON.stringify([...this.artifacts.values()].slice(-200), null, 2)}\\n`, { encoding: 'utf8', mode: 0o600 });
    await renameFile(temp, this.stateFile);
  }

  private absolute(relativePath: string): string {
    const root = this.workspace.requireRoot(); const absolute = path.resolve(root, relativePath);
    if (!isWithin(root, absolute)) throw new Error('Artifact path escapes the workspace.'); return absolute;
  }

  private async snapshot(relativePath: string): Promise<Snapshot> {
    const info = await stat(this.absolute(relativePath)).catch(() => null);
    if (!info) return { exists: false, isDirectory: false };
    if (info.isDirectory()) return { exists: true, isDirectory: true };
    const content = await readFile(this.absolute(relativePath), 'utf8').catch(() => undefined);
    return { exists: true, isDirectory: false, content };
  }

  async capture(requestId: string, operation: ArtifactOperation, relativePath: string, before: Snapshot, after: Snapshot, extra: Partial<AgentArtifact> = {}): Promise<AgentArtifact> {
    const artifact: AgentArtifact = {
      id: `${requestId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      requestId,
      operation,
      status: 'applied',
      relativePath,
      beforeExists: before.exists,
      afterExists: after.exists,
      beforeContent: before.content,
      afterContent: after.content,
      createdAt: new Date().toISOString(),
      summary: `${operation} ${relativePath}`,
      ...extra,
    };
    this.artifacts.set(artifact.id, artifact); await this.persist(); return artifact;
  }

  async around(requestId: string, operation: ArtifactOperation, relativePath: string, action: () => Promise<void>, extra: Partial<AgentArtifact> = {}): Promise<AgentArtifact> {
    const before = await this.snapshot(relativePath); await action(); const after = await this.snapshot(relativePath);
    return this.capture(requestId, operation, relativePath, before, after, extra);
  }

  list(requestId?: string): AgentArtifact[] { return [...this.artifacts.values()].filter((item) => !requestId || item.requestId === requestId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }

  async aroundRename(requestId: string, fromPath: string, toPath: string, action: () => Promise<void>): Promise<AgentArtifact> {
    const before = await this.snapshot(fromPath); await action(); const after = await this.snapshot(toPath);
    return this.capture(requestId, 'rename', toPath, before, after, { fromPath, toPath, summary: `rename ${fromPath} → ${toPath}` });
  }

  private async restore(artifact: AgentArtifact): Promise<void> {
    const target = artifact.toPath ?? artifact.relativePath;
    if (artifact.operation === 'rename' && artifact.fromPath && artifact.toPath) {
      await this.workspace.rename(artifact.toPath, artifact.fromPath); return;
    }
    if (artifact.beforeExists && artifact.beforeContent !== undefined) {
      await this.workspace.write(target, artifact.beforeContent); return;
    }
    if (artifact.beforeExists && artifact.beforeContent === undefined) throw new Error('Artifact has no safe before snapshot; revert was refused.');
    if (artifact.afterExists) await this.workspace.trash(target);
  }

  async setStatus(id: string, status: Extract<ArtifactStatus, 'kept' | 'rejected'>): Promise<AgentArtifact> {
    const current = this.artifacts.get(id); if (!current) throw new Error('Artifact not found.');
    const updated = { ...current, status }; this.artifacts.set(id, updated); await this.persist(); return updated;
  }

  async revert(id: string): Promise<AgentArtifact> {
    const current = this.artifacts.get(id); if (!current) throw new Error('Artifact not found.');
    if (current.status === 'reverted' || current.status === 'rejected') return current;
    await this.restore(current); const updated = { ...current, status: 'reverted' as const }; this.artifacts.set(id, updated); await this.persist(); return updated;
  }

  async reject(id: string): Promise<AgentArtifact> { await this.revert(id); return this.setStatus(id, 'rejected'); }
}
