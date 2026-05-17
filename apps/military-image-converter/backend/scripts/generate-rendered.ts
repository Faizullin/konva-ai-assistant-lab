#!/usr/bin/env tsx
/**
 * Like generate.ts but also renders the generated Konva.js code to a PNG
 * using the Node.js Konva-compatible renderer (konva-node.ts + @napi-rs/canvas).
 * The PNG path is embedded in the markdown report.
 *
 * Usage:
 *   tsx scripts/generate-rendered.ts <image-path> --provider <anthropic|openai|gemini|kimi> [--model <model-id>] [--no-refine]
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenerateCodeUseCase } from '../src/application/generate-code.usecase';
import { RefineCodeUseCase } from '../src/application/refine-code.usecase';
import type { AppModel, GeneratedCode, Provider } from '../src/domain/entities';
import { CANVAS_H, CANVAS_W } from '../src/env';
import { AiSdkCodeGenerator } from '../src/infrastructure/llm/ai-sdk-provider';
import { resolveModelId } from '../src/infrastructure/llm/model-factory';
import { TokenTracker } from '../src/infrastructure/tracking/token-tracker';
import { flushTraces } from '../src/infrastructure/tracing/langsmith';
import { renderToBuffer } from './konva-node';
import { resizeImageForApi } from './resize-image';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

const PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini', 'kimi'];

function mimeOf(p: string): string { return MIME[extname(p).toLowerCase()] ?? 'image/png'; }
function fmt(n: number):     string { return n.toLocaleString('en-US'); }
function fmtCost(n: number): string { return `$${n.toFixed(5)}`; }
function hr(c = '─', w = 64): string { return c.repeat(w); }
function col(s: string,  w: number): string { return s.padEnd(w); }
function colR(s: string, w: number): string { return s.padStart(w); }

function trySyntax(code: string): string | null {
  try { new Function('Konva', 'stage', 'layer', code); return null; }
  catch (e: any) { return e?.message ?? String(e); }
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  if (!args.length || args[0].startsWith('--')) {
    console.error('Usage: tsx scripts/generate-rendered.ts <image-path> --provider <anthropic|openai|gemini|kimi> [--model <model-id>] [--no-refine]');
    process.exit(1);
  }
  const imagePath = resolve(args[0]);
  let provider: Provider | null = null;
  let model: AppModel | undefined;
  let autoRefine = true;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) { provider = args[++i] as Provider; }
    else if (args[i] === '--model' && args[i + 1]) { model = args[++i] as AppModel; }
    else if (args[i] === '--no-refine') { autoRefine = false; }
  }
  if (!provider) { console.error('[error] --provider is required. Options: ' + PROVIDERS.join(' | ')); process.exit(1); }
  if (!PROVIDERS.includes(provider)) { console.error(`[error] Unknown provider "${provider}". Options: ${PROVIDERS.join(' | ')}`); process.exit(1); }
  return { imagePath, provider, model, autoRefine };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { imagePath, provider, model, autoRefine } = parseArgs();
  if (!existsSync(imagePath)) { console.error(`[error] File not found: ${imagePath}`); process.exit(1); }

  const originalBuffer   = readFileSync(imagePath);
  const originalMimeType = mimeOf(imagePath);
  const resizedImage     = await resizeImageForApi(originalBuffer);
  const imageBuffer      = resizedImage.buffer;
  const mimeType         = resizedImage.mimeType;
  const fileSizeKb  = (statSync(imagePath).size / 1024).toFixed(1);
  const modelId     = resolveModelId(provider, model);
  const startedAt   = new Date();

  const generator    = new AiSdkCodeGenerator();
  const generateCase = new GenerateCodeUseCase(generator);
  const refineCase   = new RefineCodeUseCase(generator);
  const tracker      = new TokenTracker();

  type AttemptEntry = { label: string; result: GeneratedCode; syntaxError: string | null; durationMs: number };
  const attempts: AttemptEntry[] = [];

  console.log('\n' + hr('═'));
  console.log('  MILITARY IMAGE CONVERTER — Script Run (with render)');
  console.log(hr('═'));
  console.log(`  Image    : ${imagePath} (${fileSizeKb} KB, ${originalMimeType})`);
  console.log(`  API image: ${resizedImage.sourceWidth}x${resizedImage.sourceHeight} -> ${resizedImage.width}x${resizedImage.height} (${mimeType})`);
  console.log(`  Provider : ${provider}  →  model: ${modelId}`);
  console.log(`  Canvas   : ${CANVAS_W}×${CANVAS_H}px`);
  console.log(`  Started  : ${startedAt.toISOString()}`);
  console.log(hr());

  // ── Attempt 1 ─────────────────────────────────────────────────────────────
  console.log('\n  [1] Generating...');
  const t1  = Date.now();
  const gen = await generateCase.execute({ targetImage: imageBuffer, mimeType, provider, model });
  const d1  = Date.now() - t1;

  tracker.track('attempt-1', gen.usage);
  const syntaxErr1 = trySyntax(gen.code);
  attempts.push({ label: 'attempt-1', result: gen, syntaxError: syntaxErr1, durationMs: d1 });
  console.log(`  ${syntaxErr1 ? '⚠' : '✓'} done  ${(d1 / 1000).toFixed(1)}s  |  in: ${fmt(gen.usage.inputTokens)}  out: ${fmt(gen.usage.outputTokens)}  cost: ${fmtCost(gen.usage.costUsd)}`);
  if (syntaxErr1) console.log(`    syntax error: ${syntaxErr1}`);

  // ── Attempt 2: auto-refine on syntax error ─────────────────────────────────
  let finalResult = gen;
  if (autoRefine && syntaxErr1) {
    console.log('\n  [2] Auto-refining (syntax error)...');
    const t2  = Date.now();
    const ref = await refineCase.execute({
      attemptId: gen.attemptId, previousCode: gen.code,
      targetImage: imageBuffer, mimeType, provider, model,
      feedback: { type: 'error', message: syntaxErr1 },
    });
    const d2 = Date.now() - t2;
    tracker.track('attempt-2', ref.usage);
    const syntaxErr2 = trySyntax(ref.code);
    attempts.push({ label: 'attempt-2', result: ref, syntaxError: syntaxErr2, durationMs: d2 });
    console.log(`  ${syntaxErr2 ? '⚠' : '✓'} done  ${(d2 / 1000).toFixed(1)}s  |  in: ${fmt(ref.usage.inputTokens)}  out: ${fmt(ref.usage.outputTokens)}  cost: ${fmtCost(ref.usage.costUsd)}`);
    if (syntaxErr2) console.log(`    syntax error persists: ${syntaxErr2}`);
    else            console.log('    syntax check passed');
    finalResult = ref;
  }

  // ── Render to PNG ─────────────────────────────────────────────────────────
  let renderError: string | null = null;
  let pngBuffer: Buffer | null   = null;
  console.log('\n  Rendering to PNG...');
  try {
    pngBuffer = renderToBuffer(finalResult.code, CANVAS_W, CANVAS_H);
    console.log(`  ✓ rendered  (${(pngBuffer.length / 1024).toFixed(1)} KB)`);
  } catch (e: any) {
    renderError = e?.message ?? String(e);
    console.log(`  ⚠ render failed: ${renderError}`);
  }

  // ── Console output ────────────────────────────────────────────────────────
  console.log('\n' + hr());
  console.log('  GENERATED KONVA.JS CODE');
  console.log(hr());
  console.log(finalResult.code);

  const totals = tracker.totals();
  console.log('\n' + hr());
  console.log('  TOKEN USAGE & COST');
  console.log(hr());
  console.log(`  ${col('Step', 12)} ${col('Model', 28)} ${colR('In', 9)} ${colR('Out', 9)} ${colR('Cost', 12)}`);
  console.log(`  ${hr('-', 12)} ${hr('-', 28)} ${hr('-', 9)} ${hr('-', 9)} ${hr('-', 12)}`);
  for (const r of tracker.getRecords()) {
    console.log(`  ${col(r.step, 12)} ${col(r.model, 28)} ${colR(fmt(r.inputTokens), 9)} ${colR(fmt(r.outputTokens), 9)} ${colR(fmtCost(r.costUsd), 12)}`);
  }
  console.log(`  ${hr('─', 74)}`);
  console.log(`  ${col('TOTAL', 12)} ${col('', 28)} ${colR(fmt(totals.inputTokens), 9)} ${colR(fmt(totals.outputTokens), 9)} ${colR(fmtCost(totals.costUsd), 12)}`);

  // ── Save output files ─────────────────────────────────────────────────────
  const __dir  = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(__dir, 'output');
  mkdirSync(outDir, { recursive: true });

  const ts      = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const modelStem = modelId.replace(/[^a-z0-9-]+/gi, '-');
  const stem    = `${basename(imagePath, extname(imagePath))}_${provider}_${modelStem}_${ts}`;
  const mdPath  = join(outDir, `${stem}.md`);
  const pngPath = join(outDir, `${stem}.png`);

  const attemptRows = attempts.map((a, i) =>
    `| ${i + 1} | ${a.syntaxError ? '⚠ error' : '✓ pass'} | ${(a.durationMs / 1000).toFixed(1)}s ` +
    `| ${fmt(a.result.usage.inputTokens)} | ${fmt(a.result.usage.outputTokens)} | ${fmtCost(a.result.usage.costUsd)} |`
  ).join('\n');

  const usageRows = tracker.getRecords().map(r =>
    `| ${r.step} | \`${r.model}\` | ${fmt(r.inputTokens)} | ${fmt(r.outputTokens)} | ${fmtCost(r.costUsd)} |`
  ).join('\n');

  const renderSection = pngBuffer
    ? [`## Rendered Output`, ``, `![Rendered Konva output](./${stem}.png)`, ``]
    : [`## Rendered Output`, ``, `_Render failed: ${renderError}_`, ``];

  const md = [
    `# Military Image Converter — Output Report`, ``,
    `**Generated:** ${startedAt.toISOString().replace('T', ' ').slice(0, 16)}  **Provider:** \`${provider}\`  **Model:** \`${modelId}\``, ``,
    `## Image`, ``,
    `| Field | Value |`, `|-------|-------|`,
    `| File | \`${basename(imagePath)}\` |`,
    `| Size | ${fileSizeKb} KB |`,
    `| Source dimensions | ${resizedImage.sourceWidth}x${resizedImage.sourceHeight}px |`,
    `| API dimensions | ${resizedImage.width}x${resizedImage.height}px |`,
    `| Canvas | ${CANVAS_W}×${CANVAS_H}px |`, ``,
    `## Attempts`, ``,
    `| # | Status | Duration | In | Out | Cost |`,
    `|---|--------|----------|----|-----|------|`,
    attemptRows, ``,
    ...renderSection,
    `## Generated Konva.js Code`, ``,
    `\`\`\`javascript`, finalResult.code, `\`\`\``, ``,
    `## Token Usage & Cost`, ``,
    `| Step | Model | In | Out | Cost (USD) |`,
    `|------|-------|---:|---:|-----------:|`,
    usageRows,
    `| **TOTAL** | | ${fmt(totals.inputTokens)} | ${fmt(totals.outputTokens)} | **${fmtCost(totals.costUsd)}** |`,
  ].join('\n');

  writeFileSync(mdPath, md, 'utf-8');
  if (pngBuffer) writeFileSync(pngPath, pngBuffer);

  console.log('\n  Output saved:');
  console.log(`  → ${mdPath}`);
  if (pngBuffer) console.log(`  → ${pngPath}`);
  console.log('\n' + hr('═') + '\n');
}

main()
  .finally(() => flushTraces())
  .catch((err) => { console.error('[fatal]', err); process.exit(1); });
