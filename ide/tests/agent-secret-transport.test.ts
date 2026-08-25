import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IdeSettings } from '../shared/contracts';
import { AgentService } from '../electron/agent-service';
import type { SecretStore } from '../electron/secret-store';
import type { ToolExecutor } from '../electron/tool-executor';

const fakeSettings = {
  aiProvider: 'google', aiBaseUrl: 'https://example.invalid/v1beta', aiModel: 'gemini-test',
  thinkingEnabled: false, thinkingMode: 'off', thinkingBudget: 1024, compressionContextWindow: 8192,
} as unknown as IdeSettings;

afterEach(() => vi.unstubAllGlobals());

describe('provider secret transport', () => {
  it('sends Google API key through a header and never through the URL', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input); capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const secrets = { get: () => 'test-google-secret-value' } as unknown as SecretStore;
    const service = new AgentService(secrets, () => fakeSettings, {} as ToolExecutor);
    const result = await service.testConnection();
    expect(result.ok).toBe(true);
    expect(capturedUrl).not.toContain('test-google-secret-value');
    expect(capturedUrl).not.toContain('?key=');
    expect(capturedHeaders['x-goog-api-key']).toBe('test-google-secret-value');
  });
});
