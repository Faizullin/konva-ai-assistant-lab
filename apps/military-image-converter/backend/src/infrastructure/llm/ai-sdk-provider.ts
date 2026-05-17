import * as ai from 'ai';
import { createLangSmithProviderOptions, wrapAISDK } from 'langsmith/experimental/vercel';
import { randomUUID } from 'node:crypto';
import type { GenerateRequest, GeneratedCode, RefineRequest } from '../../domain/entities';
import type { CodeGeneratorPort } from '../../domain/ports';
import { CANVAS_H, CANVAS_W } from '../../env';
import { calcCost } from '../tracking/token-tracker';
import { getModel, resolveModelId } from './model-factory';
import { GENERATE_SYSTEM, REFINE_SYSTEM, generateUserMsg, refineErrorMsg, refineVisualMsg } from './prompts';

const { generateText } = wrapAISDK(ai);

function extractCode(raw: string): string {
  const m = raw.match(/```(?:javascript|js|typescript|ts)?\n?([\s\S]*?)```/);
  return (m ? m[1] : raw).trim();
}

function toDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function requireUsageToken(value: number | undefined, label: string): number {
  if (value === undefined) {
    throw new Error(`Missing ${label} token usage from model response`);
  }

  return value;
}

function readUInt24LE(buf: Buffer, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

function getPngSize(buf: Buffer): { w: number; h: number } | null {
  const isPng = buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG';
  if (!isPng) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function getJpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);

    if (length < 2 || offset + 2 + length > buf.length) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { w: buf.readUInt16BE(offset + 7), h: buf.readUInt16BE(offset + 5) };
    }

    offset += 2 + length;
  }

  return null;
}

function getWebpSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const type = buf.toString('ascii', 12, 16);
  if (type === 'VP8X') {
    return { w: readUInt24LE(buf, 24) + 1, h: readUInt24LE(buf, 27) + 1 };
  }

  if (type === 'VP8 ' && buf.length >= 30) {
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }

  if (type === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }

  return null;
}

function getImageSize(buf: Buffer): { w: number; h: number } {
  return getPngSize(buf) ?? getJpegSize(buf) ?? getWebpSize(buf) ?? { w: 0, h: 0 };
}

export class AiSdkCodeGenerator implements CodeGeneratorPort {
  async generate(req: GenerateRequest): Promise<GeneratedCode> {
    const modelId = resolveModelId(req.provider, req.model);
    const { w: srcW, h: srcH } = getImageSize(req.targetImage);

    const result = await generateText({
      model: getModel(req.provider, req.model),
      system: GENERATE_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', image: new URL(toDataUrl(req.targetImage, req.mimeType)) },
          { type: 'text', text: generateUserMsg(CANVAS_W, CANVAS_H, srcW, srcH, req.userNote) },
        ],
      }],
      providerOptions: {
        langsmith: createLangSmithProviderOptions<typeof ai.generateText>({
          name: 'generate_konva_code',
          metadata: {
            step: 'generate',
            provider: req.provider,
            model: modelId,
            mimeType: req.mimeType,
            sourceWidth: srcW,
            sourceHeight: srcH,
            hasUserNote: !!req.userNote?.trim(),
          },
        }),
      },
    });
    const inp = requireUsageToken(result.usage.inputTokens, 'input');
    const out = requireUsageToken(result.usage.outputTokens, 'output');
    return {
      attemptId: randomUUID(),
      code: extractCode(result.text),
      rawResponse: result.text,
      usage: { model: modelId, inputTokens: inp, outputTokens: out, costUsd: calcCost(modelId, inp, out) },
    };
  }

  async refine(req: RefineRequest): Promise<GeneratedCode> {
    const modelId = resolveModelId(req.provider, req.model);
    const userText = req.feedback.type === 'error'
      ? refineErrorMsg(req.previousCode, req.feedback)
      : refineVisualMsg(req.previousCode, (req.feedback as Extract<typeof req.feedback, { type: 'render' }>).userNote);

    const images: any[] = [{ type: 'image', image: new URL(toDataUrl(req.targetImage, req.mimeType)) }];
    if (req.feedback.type === 'render') {
      images.push({ type: 'image', image: new URL(req.feedback.dataUrl) });
    }

    const result = await generateText({
      model: getModel(req.provider, req.model),
      system: REFINE_SYSTEM,
      messages: [{ role: 'user', content: [...images, { type: 'text', text: userText }] }],
      providerOptions: {
        langsmith: createLangSmithProviderOptions<typeof ai.generateText>({
          name: 'refine_konva_code',
          metadata: {
            step: 'refine',
            provider: req.provider,
            model: modelId,
            feedbackType: req.feedback.type,
          },
        }),
      },
    });
    const inp = requireUsageToken(result.usage.inputTokens, 'input');
    const out = requireUsageToken(result.usage.outputTokens, 'output');
    return {
      attemptId: req.attemptId,
      code: extractCode(result.text),
      rawResponse: result.text,
      usage: { model: modelId, inputTokens: inp, outputTokens: out, costUsd: calcCost(modelId, inp, out) },
    };
  }
}
