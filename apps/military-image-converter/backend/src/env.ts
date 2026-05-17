import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  ANTHROPIC_API_KEY:            z.string().default(''),
  OPENAI_API_KEY:               z.string().default(''),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().default(''),
  MOONSHOT_API_KEY:             z.string().default(''),
  PORT:                         z.coerce.number().int().positive().default(3001),
  LANGCHAIN_TRACING:            z.string().default('false'),
  LANGSMITH_API_KEY:            z.string().default(''),
  LANGSMITH_PROJECT:            z.string().default('default'),
  LANGSMITH_ENDPOINT:           z.string().default('https://api.smith.langchain.com'),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('[env] Invalid configuration:');
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;

const hasAnyKey = env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY ||
                  env.GOOGLE_GENERATIVE_AI_API_KEY || env.MOONSHOT_API_KEY;
if (!hasAnyKey) {
  console.warn('[env] Warning: no provider API keys found. Set at least one in .env');
}

// Static canvas dimensions — not configurable via env
export const CANVAS_W = 500;
export const CANVAS_H = 600;
