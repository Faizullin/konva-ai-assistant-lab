"""
Token usage tracking + cost estimation across all three providers.

Pricing logic (runs once at import time):
  1. Check credentials/pricing.json in project root.
  2. If it exists → load and use it.
  3. If it does not → fetch live rates from OpenRouter (no API key required),
     extract prices for our models, save to credentials/pricing.json, use them.
  4. If the fetch fails → fall back to hardcoded table.
"""
import json
import os
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

# project root = two levels above this file (src/services/token_tracker.py)
_ROOT         = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
_CREDS_DIR    = os.path.join(_ROOT, "credentials")
_PRICING_FILE = os.path.join(_CREDS_DIR, "pricing.json")

# ── Hardcoded fallback (USD / 1 M tokens, updated 2026-05) ───────────────────
_FALLBACK: dict[str, dict[str, float]] = {
    "claude-haiku-4-5-20251001": {"input": 0.80,  "output": 4.00},
    "claude-sonnet-4-20250514":  {"input": 3.00,  "output": 15.00},
    "gpt-4o-mini":               {"input": 0.15,  "output": 0.60},
    "gpt-4o":                    {"input": 2.50,  "output": 10.00},
    "gemini-2.0-flash":          {"input": 0.10,  "output": 0.40},
    "gemini-2.5-pro":            {"input": 1.25,  "output": 10.00},
}

# Our model name → OpenRouter model-id prefix for matching
_OR_MAP = {
    "gpt-4o-mini":               "openai/gpt-4o-mini",
    "gpt-4o":                    "openai/gpt-4o",
    "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4-5",
    "claude-sonnet-4-20250514":  "anthropic/claude-sonnet-4",
    "gemini-2.0-flash":          "google/gemini-2.0-flash",
    "gemini-2.5-pro":            "google/gemini-2.5-pro",
}


def _fetch_openrouter() -> tuple[dict[str, dict], dict[str, dict[str, float]]]:
    """
    Fetch all models from OpenRouter.
    Returns:
      models_full  — {our_name: full OpenRouter model object}
      pricing      — {our_name: {input: float, output: float}}  (USD / 1M tokens)
    """
    url = "https://openrouter.ai/api/v1/models"
    req = urllib.request.Request(url, headers={"HTTP-Referer": "pecs-ai", "X-Title": "PECS AI"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        or_models = {m["id"]: m for m in json.loads(resp.read()).get("data", [])}

    models_full: dict[str, dict]              = {}
    pricing:     dict[str, dict[str, float]]  = {}

    for our_name, or_prefix in _OR_MAP.items():
        # Exact match first; then shortest prefix match (avoids lite/preview variants)
        match = or_models.get(or_prefix) or min(
            (m for mid, m in or_models.items() if mid.startswith(or_prefix)),
            key=lambda m: len(m["id"]),
            default=None,
        )
        if match:
            p   = match.get("pricing", {})
            inp = round(float(p.get("prompt",     0)) * 1_000_000, 4)
            out = round(float(p.get("completion", 0)) * 1_000_000, 4)
            models_full[our_name] = match
            pricing[our_name]     = {"input": inp, "output": out}
            print(f"  [pricing] {our_name:<32} in=${inp}  out=${out}  (via {match['id']})")
        else:
            models_full[our_name] = {"id": or_prefix, "name": our_name, "pricing": {}, "_source": "fallback"}
            pricing[our_name]     = _FALLBACK[our_name]
            print(f"  [pricing] {our_name:<32} not found on OpenRouter — using fallback")

    return models_full, pricing


def _load_pricing() -> dict[str, dict[str, float]]:
    if os.path.exists(_PRICING_FILE):
        try:
            with open(_PRICING_FILE, encoding="utf-8") as f:
                data = json.load(f)
            print(f"[pricing] Using cached rates from credentials/pricing.json  (fetched {data.get('fetched_at', '?')})")
            return data["pricing"]
        except Exception as e:
            print(f"[pricing] Could not read pricing.json ({e}) — fetching fresh")

    print("[pricing] credentials/pricing.json not found — fetching from OpenRouter...")
    try:
        models_full, pricing = _fetch_openrouter()
        os.makedirs(_CREDS_DIR, exist_ok=True)
        with open(_PRICING_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "models":     models_full,
                    "pricing":    pricing,
                },
                f, indent=2, ensure_ascii=False,
            )
        print(f"[pricing] Saved to {_PRICING_FILE}")
        return pricing
    except Exception as e:
        print(f"[pricing] OpenRouter fetch failed ({e}) — using hardcoded fallback")
        return _FALLBACK


PRICING = _load_pricing()


@dataclass
class CallRecord:
    step:          str
    model:         str
    input_tokens:  int
    output_tokens: int
    input_cost:    float
    output_cost:   float

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def total_cost(self) -> float:
        return self.input_cost + self.output_cost


class TokenTracker(BaseCallbackHandler):
    """LangChain callback that captures token usage from every LLM call."""

    def __init__(self):
        super().__init__()
        self.records:       list[CallRecord] = []
        self._pending_model: str = "unknown"
        self._pending_step:  str = "unknown"

    def reset(self):
        self.records.clear()

    # ── LangChain callback hooks ───────────────────────────────────────────────

    def on_llm_start(self, serialized: dict, prompts: list, **kwargs):
        kw = serialized.get("kwargs", {})
        self._pending_model = (
            kw.get("model") or kw.get("model_name") or
            serialized.get("name", "unknown")
        )
        # tags passed via chain config carry the step label
        tags = kwargs.get("tags") or []
        self._pending_step = next((t for t in tags if not t.startswith("seq:")), "unknown")

    def on_llm_end(self, response: Any, **kwargs):
        inp, out = self._extract_tokens(response)
        pricing  = PRICING.get(self._pending_model, {"input": 0.0, "output": 0.0})
        self.records.append(CallRecord(
            step          = self._pending_step,
            model         = self._pending_model,
            input_tokens  = inp,
            output_tokens = out,
            input_cost    = inp / 1_000_000 * pricing["input"],
            output_cost   = out / 1_000_000 * pricing["output"],
        ))

    # ── Token extraction (provider-specific formats) ──────────────────────────

    def _extract_tokens(self, response: Any) -> tuple[int, int]:
        llm_output = getattr(response, "llm_output", None) or {}

        # OpenAI: llm_output["token_usage"]
        if "token_usage" in llm_output:
            u = llm_output["token_usage"]
            return u.get("prompt_tokens", 0), u.get("completion_tokens", 0)

        # Anthropic: llm_output["usage"]
        if "usage" in llm_output:
            u = llm_output["usage"]
            return u.get("input_tokens", 0), u.get("output_tokens", 0)

        # Gemini: usage lives in gen.message.usage_metadata (not llm_output or gen_info)
        try:
            msg = response.generations[0][0].message
            u   = getattr(msg, "usage_metadata", None) or {}
            if u:
                return u.get("input_tokens", 0), u.get("output_tokens", 0)
        except (IndexError, AttributeError, TypeError):
            pass

        # Gemini fallback: generation_info["usage_metadata"] (older versions)
        try:
            gen_info = response.generations[0][0].generation_info or {}
            u = gen_info.get("usage_metadata", {})
            if u:
                return u.get("prompt_token_count", 0), u.get("candidates_token_count", 0)
        except (IndexError, AttributeError, TypeError):
            pass

        return 0, 0

    # ── Reporting ─────────────────────────────────────────────────────────────

    def report(self) -> str:
        if not self.records:
            return "  (no token data captured)"

        lines = [
            f"  {'Step':<24} {'Model':<32} {'In':>7} {'Out':>7} {'Tokens':>8} {'Cost':>10}",
            f"  {'-'*24} {'-'*32} {'-'*7} {'-'*7} {'-'*8} {'-'*10}",
        ]
        for r in self.records:
            lines.append(
                f"  {r.step:<24} {r.model:<32} "
                f"{r.input_tokens:>7,} {r.output_tokens:>7,} "
                f"{r.total_tokens:>8,} ${r.total_cost:>9.5f}"
            )

        total_in   = sum(r.input_tokens  for r in self.records)
        total_out  = sum(r.output_tokens for r in self.records)
        total_cost = sum(r.total_cost    for r in self.records)
        lines += [
            f"  {'─'*90}",
            f"  {'TOTAL':<24} {'':<32} "
            f"{total_in:>7,} {total_out:>7,} "
            f"{total_in+total_out:>8,} ${total_cost:>9.5f}",
        ]
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "records": [
                {
                    "step":          r.step,
                    "model":         r.model,
                    "input_tokens":  r.input_tokens,
                    "output_tokens": r.output_tokens,
                    "total_tokens":  r.total_tokens,
                    "input_cost":    round(r.input_cost,  6),
                    "output_cost":   round(r.output_cost, 6),
                    "total_cost":    round(r.total_cost,  6),
                }
                for r in self.records
            ],
            "totals": {
                "input_tokens":  sum(r.input_tokens  for r in self.records),
                "output_tokens": sum(r.output_tokens for r in self.records),
                "total_tokens":  sum(r.total_tokens  for r in self.records),
                "total_cost_usd": round(sum(r.total_cost for r in self.records), 6),
            },
        }


# Module-level singleton — reset at the start of each pipeline run
tracker = TokenTracker()
