import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, providerPreset } from '../shared/provider-catalog';
import { cleanAssistantText } from '../electron/response-cleaner';

describe('provider catalog', () => {
  it('contains Agnes AI as an OpenAI-compatible streaming preset', () => {
    const preset = providerPreset('agnes');
    expect(preset.label).toBe('Agnes AI');
    expect(preset.baseUrl).toBe('https://apihub.agnes-ai.com/v1');
    expect(preset.protocol).toBe('openai-compatible');
    expect(preset.models).toContain('agnes-2.5-flash');
  });

  it('keeps a broad catalog and a custom fallback', () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThan(20);
    expect(providerPreset('custom').baseUrl).toContain('/v1');
  });
});

describe('assistant response cleanup', () => {
  it('removes common filler while preserving code', () => {
    const input = "Sure, here's the answer:\n\nUse this function.\n\n```ts\nconst sure = 'keep this';\n```\n\nHope this helps!";
    const output = cleanAssistantText(input);
    expect(output).toContain('Use this function.');
    expect(output).toContain("const sure = 'keep this';");
    expect(output).not.toMatch(/^Sure/);
    expect(output).not.toMatch(/Hope this helps/);
  });

  it('does not erase substantive short responses', () => {
    expect(cleanAssistantText('Surely this is the correct fix.')).toBe('Surely this is the correct fix.');
  });
});
