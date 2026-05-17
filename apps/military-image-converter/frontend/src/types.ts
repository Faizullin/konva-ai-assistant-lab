export type Provider = 'anthropic' | 'openai' | 'gemini' | 'kimi';
export type AnthropicModel = 'claude-sonnet-4-20250514' | 'claude-sonnet-4-6' | 'claude-opus-4-7';
export type OpenAIModel = 'gpt-4o' | 'gpt-5';
export type GeminiModel = 'gemini-2.5-pro' | 'gemini-3-flash-preview' | 'gemini-3-pro-preview';
export type KimiModel = 'moonshot-v1-8k-vision-preview' | 'kimi-k2.6';
export type AppModel = AnthropicModel | OpenAIModel | GeminiModel | KimiModel;

export type UsageRecord = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type GenerateResponse = {
  attemptId: string;
  code: string;
  rawResponse: string;
  usage: UsageRecord;
};

export type ProviderResult = {
  id: string;
  attemptId?: string;
  provider: Provider;
  model?: AppModel;
  label: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  code?: string;
  rawResponse?: string;
  usage?: UsageRecord;
  dataUrl?: string;       // rendered PNG snapshot
  renderError?: string;
  apiError?: string;
  durationMs?: number;
};
