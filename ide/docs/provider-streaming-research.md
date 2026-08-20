# Provider and streaming research

## Agnes AI

Official Agnes documentation states that Agnes AI exposes an OpenAI-style API. The official base URL is `https://apihub.agnes-ai.com/v1`, authentication uses `Authorization: Bearer <API_KEY>`, and the chat endpoint is `/chat/completions`. The official examples use `stream: true`; the public model catalog lists `agnes-2.5-flash` and `agnes-2.0-flash` for text/vision chat workflows. Agnes therefore belongs in BibzCode as a first-class preset backed by the shared OpenAI-compatible streaming adapter, while image/video endpoints remain separate capabilities for future media tools.

Sources: https://agnes-ai.com/doc ; https://wiki.agnes-ai.com/en/docs/quickstart ; https://github.com/AgnesAI-Labs/AgnesAI-Models

## OpenAI-compatible providers

Many gateways can share the OpenAI-compatible adapter when they expose `/models`, `/chat/completions`, bearer authentication, and Server-Sent Events (SSE) deltas. The provider must remain configurable by base URL and model because availability, rate limits, quotas, and supported request parameters vary by account and model.

## OpenAI streaming

OpenAI's official API reference documents streaming events and recommends keeping API keys out of browser/client code. BibzCode's design keeps provider requests in Electron main process, exposes only typed IPC, and streams sanitized text chunks to the renderer.

Source: https://developers.openai.com/api/reference/overview/

## Implementation decision

Add a typed provider preset registry with an `openai-compatible` protocol for OpenAI, DeepSeek, OpenRouter, Ollama, Together, Groq, Fireworks, Cerebras, xAI, Mistral, Perplexity, Moonshot/Kimi, Qwen/DashScope, SiliconFlow, NVIDIA NIM, Hugging Face, LM Studio, vLLM, LiteLLM, Agnes AI, and custom endpoints. Keep Anthropic and Google adapters where their wire formats differ. Unknown providers use the custom OpenAI-compatible path rather than pretending a provider-specific API is supported.
