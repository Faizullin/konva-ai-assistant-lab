import type { AppModel, Provider, GenerateResponse } from '../types';

export async function generate(targetImage: string, provider: Provider, model?: AppModel, userNote?: string): Promise<GenerateResponse> {
  const note = userNote !== undefined && userNote.trim().length > 0 ? userNote.trim() : undefined;
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetImage, provider, model, userNote: note }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const apiError = (err as { error?: string }).error;
    throw new Error(apiError !== undefined ? apiError : `HTTP ${res.status}`);
  }
  return res.json();
}

export async function refine(
  attemptId: string,
  previousCode: string,
  targetImage: string,
  provider: Provider,
  model: AppModel | undefined,
  renderedDataUrl: string,
  userNote?: string,
): Promise<GenerateResponse> {
  const note = userNote !== undefined && userNote.trim().length > 0 ? userNote.trim() : undefined;
  const res = await fetch('/api/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attemptId,
      previousCode,
      targetImage,
      provider,
      model,
      feedback: {
        type: 'render',
        dataUrl: renderedDataUrl,
        userNote: note,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const apiError = (err as { error?: string }).error;
    throw new Error(apiError !== undefined ? apiError : `HTTP ${res.status}`);
  }
  return res.json();
}
