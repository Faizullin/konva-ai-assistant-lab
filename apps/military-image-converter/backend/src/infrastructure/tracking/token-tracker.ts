import { loadPricing } from './pricing-loader';
import type { PricingMap } from './pricing-loader';
import type { UsageRecord } from '../../domain/entities';

const PRICING: PricingMap = await loadPricing();

export function calcCost(model: string, inp: number, out: number): number {
  const p = PRICING[model];
  if (!p) {
    throw new Error(`Pricing not loaded for model ${model}`);
  }

  return (inp / 1_000_000) * p.input + (out / 1_000_000) * p.output;
}

export type TrackedRecord = UsageRecord & { step: string };

export class TokenTracker {
  private records: TrackedRecord[] = [];

  track(step: string, usage: UsageRecord): void {
    this.records.push({ step, ...usage });
  }

  totals() {
    return {
      inputTokens:  this.records.reduce((s, r) => s + r.inputTokens,  0),
      outputTokens: this.records.reduce((s, r) => s + r.outputTokens, 0),
      costUsd:      this.records.reduce((s, r) => s + r.costUsd,      0),
    };
  }

  getRecords(): TrackedRecord[] { return [...this.records]; }
  reset(): void                 { this.records = []; }
}
