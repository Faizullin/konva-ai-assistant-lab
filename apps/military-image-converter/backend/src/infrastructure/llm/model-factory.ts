import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AnthropicModel, AppModel, GeminiModel, KimiModel, OpenAIModel, Provider } from '../../domain/entities';
import { env } from '../../env';

export const MODELS: Record<Provider, AppModel> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-3-flash-preview',
  kimi: 'moonshot-v1-8k-vision-preview',
};

export const ANTHROPIC_MODELS: AnthropicModel[] = ['claude-sonnet-4-20250514', 'claude-sonnet-4-6', 'claude-opus-4-7'];
export const GEMINI_MODELS: GeminiModel[] = ['gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview'];
export const OPENAI_MODELS: OpenAIModel[] = ['gpt-4o', 'gpt-5'];
export const KIMI_MODELS: KimiModel[] = ['moonshot-v1-8k-vision-preview', 'kimi-k2.6'];

const _anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
const _google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
const _openai = createOpenAICompatible({ name: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY });
const _kimi = createOpenAICompatible({ name: 'moonshot', baseURL: 'https://api.moonshot.ai/v1', apiKey: env.MOONSHOT_API_KEY });

function isAnthropicModel(model: AppModel): model is AnthropicModel {
  return ANTHROPIC_MODELS.includes(model as AnthropicModel);
}

function isOpenAIModel(model: AppModel): model is OpenAIModel {
  return OPENAI_MODELS.includes(model as OpenAIModel);
}

function isGeminiModel(model: AppModel): model is GeminiModel {
  return GEMINI_MODELS.includes(model as GeminiModel);
}

function isKimiModel(model: AppModel): model is KimiModel {
  return KIMI_MODELS.includes(model as KimiModel);
}

export function resolveModelId(provider: Provider, model?: AppModel): string {
  switch (provider) {
    case 'anthropic':
      if (model === undefined) return MODELS.anthropic;
      if (isAnthropicModel(model)) return model;
      throw new Error(`Unsupported Anthropic model: ${model}`);
    case 'openai':
      if (model === undefined) return MODELS.openai;
      if (isOpenAIModel(model)) return model;
      throw new Error(`Unsupported OpenAI model: ${model}`);
    case 'gemini':
      if (model === undefined) return MODELS.gemini;
      if (isGeminiModel(model)) return model;
      throw new Error(`Unsupported Gemini model: ${model}`);
    case 'kimi':
      if (model === undefined) return MODELS.kimi;
      if (isKimiModel(model)) return model;
      throw new Error(`Unsupported Kimi model: ${model}`);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function getModel(provider: Provider, model?: AppModel) {
  const modelId = resolveModelId(provider, model);

  switch (provider) {
    case 'openai': return _openai(modelId);
    case 'gemini': return _google(modelId);
    case 'kimi': return _kimi(modelId);
    case 'anthropic': return _anthropic(modelId);
    default: throw new Error(`Unsupported provider: ${provider}`);
  }
}
