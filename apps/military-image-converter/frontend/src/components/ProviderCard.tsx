import { useEffect, useRef } from 'react';
import { execKonva, CANVAS_H, CANVAS_W } from '../lib/executor';
import type { ProviderResult } from '../types';

const COLORS: Record<string, string> = {
  anthropic: '#b65f2a',
  openai: '#0f8f72',
  gemini: '#2563eb',
  kimi: '#7c3aed',
};

type Props = {
  result: ProviderResult;
  onRender: (id: string, update: Pick<ProviderResult, 'dataUrl' | 'renderError'>) => void;
};

export function ProviderCard({ result, onRender }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const color = Object.prototype.hasOwnProperty.call(COLORS, result.provider) ? COLORS[result.provider] : '#718096';
  const subtitle = result.model !== undefined ? result.model : result.label;
  const errorText = result.apiError !== undefined
    ? result.apiError
    : result.renderError !== undefined
      ? result.renderError
      : 'error';
  const rawText = result.rawResponse !== undefined
    ? result.rawResponse
    : result.code !== undefined
      ? result.code
      : '';

  useEffect(() => {
    if (result.status !== 'done') {
      return;
    }

    if (result.code === undefined) {
      return;
    }

    if (containerRef.current === null) {
      return;
    }

    const render = execKonva(containerRef.current, result.code);
    if (render.ok) {
      onRender(result.id, { dataUrl: render.dataUrl, renderError: undefined });
      return;
    }

    onRender(result.id, { dataUrl: undefined, renderError: render.error });
  }, [result.id, result.status, result.code, onRender]);

  return (
    <div style={{
      border: '2px solid #e2e8f0',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#fff',
      transition: 'border-color 0.15s',
    }}>
      <div style={{ background: color, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0 }}>
          {result.provider}
          <span style={{ marginLeft: 8, opacity: 0.85, fontWeight: 500, textTransform: 'none' }}>
            {subtitle}
          </span>
        </span>
        {result.usage && (
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, whiteSpace: 'nowrap' }}>
            {result.usage.inputTokens.toLocaleString()} in / {result.usage.outputTokens.toLocaleString()} out / ${result.usage.costUsd.toFixed(5)}
          </span>
        )}
      </div>

      <div style={{ background: '#f8f9fa', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 330 }}>
        {result.status === 'idle' && (
          <span style={{ color: '#a0aec0', fontSize: 12 }}>waiting</span>
        )}
        {result.status === 'loading' && (
          <span style={{ color: '#718096', fontSize: 12 }}>generating...</span>
        )}
        {result.status === 'error' && (
          <span style={{ color: '#e53e3e', fontSize: 11, padding: 12, textAlign: 'center' }}>
            {errorText}
          </span>
        )}
        <div
          ref={containerRef}
          style={{
            display: result.status === 'done' ? 'block' : 'none',
            transform: 'scale(0.55)',
            transformOrigin: 'top left',
            width: CANVAS_W,
            height: CANVAS_H,
            marginBottom: -(CANVAS_H * 0.45),
            marginRight: -(CANVAS_W * 0.45),
          }}
        />
      </div>

      {result.status === 'done' && (
        <details style={{ borderTop: '1px solid #edf2f7', padding: '10px 12px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#2d3748' }}>
            View details
          </summary>

          <section style={{ marginTop: 10 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 12, color: '#4a5568' }}>Full AI Response</h3>
            <pre style={{
              margin: 0,
              maxHeight: 180,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#f7fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: 10,
              fontSize: 11,
              lineHeight: 1.45,
              color: '#1a202c',
            }}>
              {rawText}
            </pre>
          </section>

          <section style={{ marginTop: 10 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 12, color: '#4a5568' }}>Extracted JavaScript</h3>
            <pre style={{
              margin: 0,
              maxHeight: 220,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#111827',
              borderRadius: 6,
              padding: 10,
              fontSize: 11,
              lineHeight: 1.45,
              color: '#e5e7eb',
            }}>
              {result.code}
            </pre>
          </section>
        </details>
      )}

      <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #edf2f7' }}>
        <span style={{ fontSize: 11, color: '#a0aec0' }}>
          {result.durationMs != null ? `${(result.durationMs / 1000).toFixed(1)}s` : ''}
        </span>
        <span style={{ fontSize: 11, color }}>{result.status}</span>
      </div>
    </div>
  );
}
