import type { AiProvider } from './contracts';

export type ProviderProtocol = 'openai-compatible' | 'anthropic' | 'google';

export interface ProviderPreset {
  id: AiProvider;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  keyUrl?: string;
  local?: boolean;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1', models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o4-mini'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514', models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', label: 'Google Gemini', protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'], keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4.1-mini', models: ['openai/gpt-4.1-mini', 'google/gemini-2.5-flash', 'anthropic/claude-sonnet-4', 'qwen/qwen3-235b-a22b', 'meta-llama/llama-4-maverick'], keyUrl: 'https://openrouter.ai/keys' },
  { id: 'ollama', label: 'Ollama', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'llama3.2', models: ['llama3.2', 'qwen3', 'deepseek-r1', 'codellama'], local: true },
  { id: 'groq', label: 'Groq', protocol: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b'], keyUrl: 'https://console.groq.com/keys' },
  { id: 'together', label: 'Together AI', protocol: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'deepseek-ai/DeepSeek-R1'], keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'huggingface', label: 'Hugging Face', protocol: 'openai-compatible', baseUrl: 'https://router.huggingface.co/v1', defaultModel: 'Qwen/Qwen3-235B-A22B', models: ['Qwen/Qwen3-235B-A22B', 'meta-llama/Llama-3.3-70B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3'], keyUrl: 'https://huggingface.co/settings/tokens' },
  { id: 'mistral', label: 'Mistral AI', protocol: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'], keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'fireworks', label: 'Fireworks AI', protocol: 'openai-compatible', baseUrl: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct', models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/qwen3-235b-a22b'], keyUrl: 'https://fireworks.ai/account/api-keys' },
  { id: 'cerebras', label: 'Cerebras', protocol: 'openai-compatible', baseUrl: 'https://api.cerebras.ai/v1', defaultModel: 'llama-3.3-70b', models: ['llama-3.3-70b', 'qwen-3-32b'], keyUrl: 'https://cloud.cerebras.ai/platform' },
  { id: 'xai', label: 'xAI Grok', protocol: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini', models: ['grok-3-mini', 'grok-3', 'grok-2-latest'], keyUrl: 'https://console.x.ai/' },
  { id: 'perplexity', label: 'Perplexity', protocol: 'openai-compatible', baseUrl: 'https://api.perplexity.ai', defaultModel: 'sonar-pro', models: ['sonar-pro', 'sonar', 'sonar-reasoning-pro'], keyUrl: 'https://www.perplexity.ai/settings/api' },
  { id: 'moonshot', label: 'Moonshot / Kimi', protocol: 'openai-compatible', baseUrl: 'https://api.moonshot.ai/v1', defaultModel: 'kimi-k2-0711-preview', models: ['kimi-k2-0711-preview', 'moonshot-v1-128k'], keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  { id: 'qwen', label: 'Qwen / DashScope', protocol: 'openai-compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'], keyUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'siliconflow', label: 'SiliconFlow', protocol: 'openai-compatible', baseUrl: 'https://api.siliconflow.com/v1', defaultModel: 'Qwen/Qwen3-235B-A22B', models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-R1', 'THUDM/GLM-4-32B-0414'], keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'nvidia', label: 'NVIDIA NIM', protocol: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'meta/llama-3.3-70b-instruct', models: ['meta/llama-3.3-70b-instruct', 'qwen/qwen3-235b-a22b'], keyUrl: 'https://build.nvidia.com/' },
  { id: 'cohere', label: 'Cohere', protocol: 'openai-compatible', baseUrl: 'https://api.cohere.com/compatibility/v1', defaultModel: 'command-a-03-2025', models: ['command-a-03-2025', 'command-r-plus'], keyUrl: 'https://dashboard.cohere.com/api-keys' },
  { id: 'sambanova', label: 'SambaNova Cloud', protocol: 'openai-compatible', baseUrl: 'https://api.sambanova.ai/v1', defaultModel: 'Meta-Llama-3.3-70B-Instruct', models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1'], keyUrl: 'https://cloud.sambanova.ai/apis' },
  { id: 'novita', label: 'Novita AI', protocol: 'openai-compatible', baseUrl: 'https://api.novita.ai/v3/openai', defaultModel: 'deepseek/deepseek-r1', models: ['deepseek/deepseek-r1', 'meta-llama/llama-3.3-70b-instruct'], keyUrl: 'https://novita.ai/settings/key-management' },
  { id: 'hyperbolic', label: 'Hyperbolic', protocol: 'openai-compatible', baseUrl: 'https://api.hyperbolic.xyz/v1', defaultModel: 'Qwen/Qwen3-235B-A22B', models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-R1'], keyUrl: 'https://app.hyperbolic.xyz/settings' },
  { id: 'deepinfra', label: 'DeepInfra', protocol: 'openai-compatible', baseUrl: 'https://api.deepinfra.com/v1/openai', defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct', models: ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'deepseek-ai/DeepSeek-R1'], keyUrl: 'https://deepinfra.com/dash/api_keys' },
  { id: 'ai21', label: 'AI21 Labs', protocol: 'openai-compatible', baseUrl: 'https://api.ai21.com/studio/v1', defaultModel: 'jamba-1.5-large', models: ['jamba-1.5-large', 'jamba-mini'], keyUrl: 'https://studio.ai21.com/account/api-key' },
  { id: 'minimax', label: 'MiniMax', protocol: 'openai-compatible', baseUrl: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-Text-01', models: ['MiniMax-Text-01', 'MiniMax-M1'], keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key' },
  { id: 'zhipu', label: 'Zhipu / GLM', protocol: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.5', models: ['glm-4.5', 'glm-4-plus', 'glm-4-flash'], keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'modelscope', label: 'ModelScope', protocol: 'openai-compatible', baseUrl: 'https://api-inference.modelscope.cn/v1', defaultModel: 'Qwen/Qwen3-235B-A22B', models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-R1'], keyUrl: 'https://modelscope.cn/my/myaccesstoken' },
  { id: 'friendli', label: 'FriendliAI', protocol: 'openai-compatible', baseUrl: 'https://api.friendli.ai/serverless/v1', defaultModel: 'meta-llama-3.1-70b-instruct', models: ['meta-llama-3.1-70b-instruct'], keyUrl: 'https://friendli.ai/' },
  { id: 'replicate', label: 'Replicate', protocol: 'openai-compatible', baseUrl: 'https://openai-proxy.replicate.com/v1', defaultModel: 'meta/meta-llama-3-70b-instruct', models: ['meta/meta-llama-3-70b-instruct'], keyUrl: 'https://replicate.com/account/api-tokens' },
  { id: 'agnes', label: 'Agnes AI', protocol: 'openai-compatible', baseUrl: 'https://apihub.agnes-ai.com/v1', defaultModel: 'agnes-2.5-flash', models: ['agnes-2.5-flash', 'agnes-2.0-flash'], keyUrl: 'https://platform.agnes-ai.com/' },
  { id: 'lmstudio', label: 'LM Studio', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'local-model', models: ['local-model'], local: true },
  { id: 'vllm', label: 'vLLM', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', defaultModel: 'local-model', models: ['local-model'], local: true },
  { id: 'litellm', label: 'LiteLLM Proxy', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:4000/v1', defaultModel: 'gpt-4.1', models: ['gpt-4.1'], local: true },
  { id: 'custom', label: 'Custom OpenAI-compatible', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', defaultModel: 'custom-model', models: ['custom-model'] },
];

export const PROVIDER_PRESET_MAP = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset] as const));
export const isAiProvider = (value: unknown): value is AiProvider => PROVIDER_PRESETS.some((preset) => preset.id === value);
export const providerPreset = (id: AiProvider): ProviderPreset => PROVIDER_PRESET_MAP.get(id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
