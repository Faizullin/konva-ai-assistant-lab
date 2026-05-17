import { Hono }        from 'hono';
import { zValidator }  from '@hono/zod-validator';
import { GenerateBodySchema, RefineBodySchema } from './schemas';
import { GenerateCodeUseCase } from '../application/generate-code.usecase';
import { RefineCodeUseCase }   from '../application/refine-code.usecase';
import { AiSdkCodeGenerator }  from '../infrastructure/llm/ai-sdk-provider';
import { TokenTracker }        from '../infrastructure/tracking/token-tracker';

const generator       = new AiSdkCodeGenerator();
const generateUseCase = new GenerateCodeUseCase(generator);
const refineUseCase   = new RefineCodeUseCase(generator);

const sessions = new Map<string, TokenTracker>();

function parseImage(dataUrl: string): { buffer: Buffer; mimeType: string } {
  if (dataUrl.startsWith('data:')) {
    const [meta, b64] = dataUrl.split(',');
    return { buffer: Buffer.from(b64, 'base64'), mimeType: meta.slice(5, meta.indexOf(';')) };
  }
  return { buffer: Buffer.from(dataUrl, 'base64'), mimeType: 'image/png' };
}

export const apiRoutes = new Hono()

  .post('/generate', zValidator('json', GenerateBodySchema), async (c) => {
    const { targetImage, provider, model, userNote } = c.req.valid('json');
    const { buffer, mimeType }      = parseImage(targetImage);

    const result  = await generateUseCase.execute({ targetImage: buffer, mimeType, provider, model, userNote });
    const tracker = new TokenTracker();
    tracker.track('generate', result.usage);
    sessions.set(result.attemptId, tracker);
    return c.json(result);
  })

  .post('/refine', zValidator('json', RefineBodySchema), async (c) => {
    const body             = c.req.valid('json');
    const { buffer, mimeType } = parseImage(body.targetImage);

    const result  = await refineUseCase.execute({ ...body, targetImage: buffer, mimeType });
    const tracker = sessions.get(body.attemptId) ?? new TokenTracker();
    tracker.track('refine', result.usage);
    sessions.set(body.attemptId, tracker);
    return c.json(result);
  })

  .get('/usage', (c) => {
    const id      = c.req.query('attemptId');
    if (!id)       return c.json({ error: 'attemptId required' }, 400);
    const tracker = sessions.get(id);
    if (!tracker)  return c.json({ error: 'session not found' }, 404);
    return c.json({ records: tracker.getRecords(), totals: tracker.totals() });
  });
