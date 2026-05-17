import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir        = dirname(fileURLToPath(import.meta.url));
const CREDS_DIR    = resolve(__dir, '..', '..', '..', 'credentials');
const PRICING_FILE = resolve(CREDS_DIR, 'pricing.json');

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1_000; // 3 days

export type PriceEntry = { input: number; output: number };
export type PricingMap = Record<string, PriceEntry>;

const REQUIRED_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'gpt-4o',
  'gpt-5',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'kimi-k2.6',
  'moonshot-v1-8k-vision-preview',
];

const OPENROUTER_IDS: Record<string, string> = {
  'claude-sonnet-4-20250514':      'anthropic/claude-sonnet-4',
  'claude-sonnet-4-6':             'anthropic/claude-sonnet-4.6',
  'claude-opus-4-7':               'anthropic/claude-opus-4.7',
  'gpt-4o':                        'openai/gpt-4o',
  'gpt-5':                         'openai/gpt-5',
  'gemini-2.5-pro':                'google/gemini-2.5-pro',
  'gemini-3-flash-preview':        'google/gemini-3-flash-preview',
  'gemini-3-pro-preview':          'google/gemini-3.1-pro-preview',
  'kimi-k2.6':                     'moonshotai/kimi-k2.6',
  'moonshot-v1-8k-vision-preview': 'moonshotai/kimi-k2.5',
};

// Sorted fingerprint — changes when REQUIRED_MODELS is updated
const MODEL_FINGERPRINT = [...REQUIRED_MODELS].sort().join(',');

type CacheFile = {
  createdAt:        string;
  updatedAt:        string;
  modelFingerprint: string;
  pricing:          PricingMap;
};

type StaleReason = 'missing' | 'expired' | 'models_changed';

function checkCache(): { valid: true; data: CacheFile } | { valid: false; reason: StaleReason } {
  if (!existsSync(PRICING_FILE)) return { valid: false, reason: 'missing' };

  let data: CacheFile;
  try {
    data = JSON.parse(readFileSync(PRICING_FILE, 'utf-8')) as CacheFile;
  } catch {
    return { valid: false, reason: 'missing' };
  }

  const updatedAt = new Date(data.updatedAt ?? data.createdAt ?? 0).getTime();
  if (Date.now() - updatedAt > CACHE_TTL_MS)
    return { valid: false, reason: 'expired' };

  if (data.modelFingerprint !== MODEL_FINGERPRINT)
    return { valid: false, reason: 'models_changed' };

  return { valid: true, data };
}

type OpenRouterModel = { id: string; pricing?: { prompt?: string; completion?: string } };

function priceToPerMillion(value: unknown): number {
  if (typeof value !== 'string') throw new Error('OpenRouter pricing value is invalid');
  return Math.round(Number(value) * 1_000_000 * 10_000) / 10_000;
}

function validatePricing(pricing: PricingMap): PricingMap {
  for (const model of REQUIRED_MODELS) {
    const p = pricing[model];
    if (!p || !Number.isFinite(p.input) || !Number.isFinite(p.output))
      throw new Error(`Pricing missing or invalid for model ${model}`);
  }
  return pricing;
}

async function fetchPricing(): Promise<PricingMap> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'HTTP-Referer': 'military-image-converter', 'X-Title': 'Military Image Converter' },
  });
  if (!response.ok)
    throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText}`);

  const data = await response.json() as { data?: OpenRouterModel[] };
  if (!Array.isArray(data.data)) throw new Error('OpenRouter returned invalid model data');

  const byId = Object.fromEntries(data.data.map(m => [m.id, m]));
  const pricing: PricingMap = {};

  for (const model of REQUIRED_MODELS) {
    const found = byId[OPENROUTER_IDS[model]];
    if (!found) throw new Error(`OpenRouter model not found for ${model}`);
    pricing[model] = {
      input:  priceToPerMillion(found.pricing?.prompt),
      output: priceToPerMillion(found.pricing?.completion),
    };
    console.log(`  [pricing] ${model.padEnd(36)} in=$${pricing[model].input}  out=$${pricing[model].output}  (${found.id})`);
  }

  return validatePricing(pricing);
}

function saveCache(pricing: PricingMap, existing?: CacheFile): void {
  const now  = new Date().toISOString();
  const file: CacheFile = {
    createdAt:        existing?.createdAt ?? now,
    updatedAt:        now,
    modelFingerprint: MODEL_FINGERPRINT,
    pricing,
  };
  mkdirSync(CREDS_DIR, { recursive: true });
  writeFileSync(PRICING_FILE, JSON.stringify(file, null, 2), 'utf-8');
  console.log(`[pricing] Saved to credentials/pricing.json (createdAt=${file.createdAt})`);
}

export async function loadPricing(): Promise<PricingMap> {
  const check = checkCache();

  if (check.valid) {
    console.log(`[pricing] Cache valid — updatedAt=${check.data.updatedAt}  models=${Object.keys(check.data.pricing).length}`);
    return check.data.pricing;
  }

  const REASONS: Record<StaleReason, string> = {
    missing:        'credentials/pricing.json not found',
    expired:        'cache older than 3 days',
    models_changed: 'model registry changed (added/removed entries)',
  };
  console.log(`[pricing] Refetching from OpenRouter — reason: ${REASONS[check.reason]}`);

  const existingCache = check.reason !== 'missing'
    ? (() => { try { return JSON.parse(readFileSync(PRICING_FILE, 'utf-8')) as CacheFile; } catch { return undefined; } })()
    : undefined;

  const pricing = await fetchPricing();
  saveCache(pricing, existingCache);
  return pricing;
}
