import { Client } from 'langsmith';
import { env } from '../../env';

const enabled = env.LANGCHAIN_TRACING.toLowerCase() === 'true' && !!env.LANGSMITH_API_KEY;

export const langsmith = new Client({
  apiUrl: env.LANGSMITH_ENDPOINT,
  apiKey: env.LANGSMITH_API_KEY || undefined,
});

export async function flushTraces(): Promise<void> {
  if (enabled) await langsmith.flush();
}
