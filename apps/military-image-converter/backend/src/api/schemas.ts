import { z } from 'zod';

const provider = z.enum(['anthropic', 'openai', 'gemini', 'kimi']);
const anthropicModel = z.enum(['claude-sonnet-4-20250514', 'claude-sonnet-4-6', 'claude-opus-4-7']);
const openaiModel = z.enum(['gpt-4o', 'gpt-5']);
const geminiModel = z.enum(['gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview']);
const kimiModel = z.enum(['moonshot-v1-8k-vision-preview', 'kimi-k2.6']);
const appModel = z.union([anthropicModel, openaiModel, geminiModel, kimiModel]);

export const GenerateBodySchema = z.object({
  targetImage: z.string().min(1),
  provider,
  model: appModel.optional(),
  userNote: z.string().max(2000).optional(),
});

export const RefineBodySchema = z.object({
  attemptId:    z.string().uuid(),
  previousCode: z.string().min(1),
  targetImage:  z.string().min(1),
  provider,
  model: appModel.optional(),
  feedback: z.discriminatedUnion('type', [
    z.object({ type: z.literal('error'),  message: z.string(), stack: z.string().optional() }),
    z.object({ type: z.literal('render'), dataUrl: z.string(), userNote: z.string().optional() }),
  ]),
});
