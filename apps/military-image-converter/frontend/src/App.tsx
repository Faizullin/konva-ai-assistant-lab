import { useCallback, useMemo, useState } from 'react';
import { Uploader } from './components/Uploader';
import { ProviderCard } from './components/ProviderCard';
import { generate, refine } from './lib/api';
import type { AppModel, Provider, ProviderResult } from './types';

type ModelOption = {
  id: string;
  label: string;
  provider: Provider;
  model?: AppModel;
};

const MODEL_OPTIONS: ModelOption[] = [
  { id: 'anthropic-sonnet-4', label: 'Anthropic / Claude Sonnet 4', provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  { id: 'anthropic-sonnet-4-6', label: 'Anthropic / Claude Sonnet 4.6', provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { id: 'anthropic-opus-4-7', label: 'Anthropic / Claude Opus 4.7', provider: 'anthropic', model: 'claude-opus-4-7' },
  { id: 'openai-gpt-4o', label: 'OpenAI / GPT-4o', provider: 'openai', model: 'gpt-4o' },
  { id: 'openai-gpt-5', label: 'OpenAI / GPT-5', provider: 'openai', model: 'gpt-5' },
  { id: 'gemini-2.5-pro', label: 'Gemini / 2.5 Pro', provider: 'gemini', model: 'gemini-2.5-pro' },
  { id: 'gemini-3-flash-preview', label: 'Gemini / 3 Flash Preview', provider: 'gemini', model: 'gemini-3-flash-preview' },
  { id: 'gemini-3-pro-preview', label: 'Gemini / 3 Pro Preview', provider: 'gemini', model: 'gemini-3-pro-preview' },
  { id: 'kimi-vision-preview', label: 'Kimi / Vision Preview', provider: 'kimi', model: 'moonshot-v1-8k-vision-preview' },
  { id: 'kimi-k2-6', label: 'Kimi / K2.6', provider: 'kimi', model: 'kimi-k2.6' },
];

function newId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyResult(option: ModelOption): ProviderResult {
  return {
    id: 'empty',
    provider: option.provider,
    model: option.model,
    label: option.label,
    status: 'idle',
  };
}

function resizeImageForApi(dataUrl: string): Promise<string> {
  const targetLongestSide = 768;

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const sourceWidth = image.naturalWidth;
      const sourceHeight = image.naturalHeight;
      const longestSide = Math.max(sourceWidth, sourceHeight);

      if (longestSide <= 0) {
        resolve(dataUrl);
        return;
      }

      const scale = targetLongestSide / longestSide;
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        resolve(dataUrl);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('Could not resize image before upload'));
    image.src = dataUrl;
  });
}

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState('gemini-3-flash-preview');
  const [userNote, setUserNote] = useState('');
  const [results, setResults] = useState<ProviderResult[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const selectedOption = useMemo(() => {
    const found = MODEL_OPTIONS.find(option => option.id === selectedOptionId);
    return found !== undefined ? found : MODEL_OPTIONS[0];
  }, [selectedOptionId]);

  const activeResult = useMemo(() => {
    const found = results.find(result => result.id === activeId);
    return found !== undefined ? found : emptyResult(selectedOption);
  }, [activeId, results, selectedOption]);

  function updateResult(id: string, update: Partial<ProviderResult>) {
    setResults(prev => prev.map(result => result.id === id ? { ...result, ...update } : result));
  }

  const handleRender = useCallback((id: string, update: Pick<ProviderResult, 'dataUrl' | 'renderError'>) => {
    setResults(prev => prev.map(result => result.id === id ? { ...result, ...update } : result));
  }, []);

  async function handleGenerate() {
    if (image === null) return;
    if (running) return;

    const id = newId();
    const pending: ProviderResult = {
      id,
      provider: selectedOption.provider,
      model: selectedOption.model,
      label: selectedOption.label,
      status: 'loading',
    };

    setRunning(true);
    setActiveId(id);
    setResults(prev => [pending, ...prev]);

    const t0 = Date.now();
    try {
      const resizedImage = await resizeImageForApi(image);
      const res = await generate(resizedImage, selectedOption.provider, selectedOption.model, userNote);
      updateResult(id, {
        attemptId: res.attemptId,
        status: 'done',
        code: res.code,
        rawResponse: res.rawResponse,
        usage: res.usage,
        durationMs: Date.now() - t0,
      });
    } catch (e: any) {
      const message = e instanceof Error ? e.message : 'failed';
      updateResult(id, {
        status: 'error',
        apiError: message,
        durationMs: Date.now() - t0,
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleRefine() {
    if (image === null) return;
    if (running) return;
    if (activeResult.status !== 'done') return;
    if (activeResult.attemptId === undefined) return;
    if (activeResult.code === undefined) return;
    if (activeResult.dataUrl === undefined) return;

    const sourceAttemptId = activeResult.attemptId;
    const sourceCode = activeResult.code;
    const sourceRender = activeResult.dataUrl;
    const sourceProvider = activeResult.provider;
    const sourceModel = activeResult.model;
    const sourceLabel = activeResult.label;

    const id = newId();
    const pending: ProviderResult = {
      id,
      attemptId: sourceAttemptId,
      provider: sourceProvider,
      model: sourceModel,
      label: `${sourceLabel} / refine`,
      status: 'loading',
    };

    setRunning(true);
    setActiveId(id);
    setResults(prev => [pending, ...prev]);

    const t0 = Date.now();
    try {
      const resizedImage = await resizeImageForApi(image);
      const res = await refine(
        sourceAttemptId,
        sourceCode,
        resizedImage,
        sourceProvider,
        sourceModel,
        sourceRender,
        userNote,
      );
      updateResult(id, {
        attemptId: res.attemptId,
        status: 'done',
        code: res.code,
        rawResponse: res.rawResponse,
        usage: res.usage,
        durationMs: Date.now() - t0,
      });
    } catch (e: any) {
      const message = e instanceof Error ? e.message : 'failed';
      updateResult(id, {
        status: 'error',
        apiError: message,
        durationMs: Date.now() - t0,
      });
    } finally {
      setRunning(false);
    }
  }

  const canGenerate = image !== null && !running;
  const canRefine = image !== null
    && !running
    && activeResult.status === 'done'
    && activeResult.attemptId !== undefined
    && activeResult.code !== undefined
    && activeResult.dataUrl !== undefined;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f0f4f8', padding: 24 }}>
      <h1 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700, color: '#1a202c' }}>
        Military Image Converter
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(360px, 1fr) 280px', gap: 20, alignItems: 'start' }}>
        <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e2e8f0' }}>
          <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 13, color: '#4a5568' }}>Source Image</p>
          <Uploader onImage={setImage} preview={image} />

          <label style={{ display: 'block', margin: '16px 0 8px', fontWeight: 600, fontSize: 13, color: '#4a5568' }} htmlFor="model-option">
            Provider / Model
          </label>
          <select
            id="model-option"
            value={selectedOptionId}
            disabled={running}
            onChange={(e) => setSelectedOptionId(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #cbd5e0',
              borderRadius: 8,
              background: '#fff',
              color: '#1a202c',
              fontSize: 13,
            }}
          >
            {MODEL_OPTIONS.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>

          <label style={{ display: 'block', margin: '14px 0 8px', fontWeight: 600, fontSize: 13, color: '#4a5568' }} htmlFor="user-note">
            Additional Prompt
          </label>
          <textarea
            id="user-note"
            value={userNote}
            disabled={running}
            onChange={(e) => setUserNote(e.target.value)}
            placeholder="Optional notes, e.g. keep two close vertical divider lines"
            rows={4}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              border: '1px solid #cbd5e0',
              borderRadius: 8,
              resize: 'vertical',
              color: '#1a202c',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          />

          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            style={{
              marginTop: 16,
              width: '100%',
              padding: '10px 0',
              background: canGenerate ? '#e53e3e' : '#cbd5e0',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 14,
              cursor: canGenerate ? 'pointer' : 'not-allowed',
            }}
          >
            {running ? 'Generating...' : 'Generate'}
          </button>

          <button
            onClick={handleRefine}
            disabled={!canRefine}
            style={{
              marginTop: 10,
              width: '100%',
              padding: '10px 0',
              background: canRefine ? '#2d3748' : '#cbd5e0',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 14,
              cursor: canRefine ? 'pointer' : 'not-allowed',
            }}
          >
            {running ? 'Working...' : 'Refine Active Result'}
          </button>
        </div>

        <ProviderCard
          result={activeResult}
          onRender={handleRender}
        />

        <aside style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #e2e8f0' }}>
            <h2 style={{ margin: 0, fontSize: 14, color: '#1a202c' }}>Results</h2>
          </div>

          <div style={{ maxHeight: 'calc(100vh - 128px)', overflow: 'auto' }}>
            {results.length === 0 && (
              <p style={{ margin: 0, padding: 14, fontSize: 12, color: '#718096' }}>
                Generated outputs will appear here.
              </p>
            )}

            {results.map((result) => {
              const active = result.id === activeResult.id;
              const cost = result.usage ? `$${result.usage.costUsd.toFixed(5)}` : '';
              const time = result.durationMs != null ? `${(result.durationMs / 1000).toFixed(1)}s` : '';
              return (
                <button
                  key={result.id}
                  onClick={() => setActiveId(result.id)}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: 0,
                    borderBottom: '1px solid #edf2f7',
                    background: active ? '#ebf4ff' : '#fff',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1a202c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {result.label}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: result.status === 'error' ? '#c53030' : '#718096' }}>
                    <span>{result.status}</span>
                    <span>{[time, cost].filter(Boolean).join(' / ')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
