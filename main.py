"""
Canvas AI — CLI entry point.

Two-phase flow (LangGraph interrupt/resume):
  Phase 1: Agent 1 interprets vague intent → 3 TaskOption suggestions → pauses
  Phase 2: User picks an option → Agent 2 generates full canvas → saves output

Usage:
  python main.py                                      # interactive, provider from .env
  python main.py --prompt "family connections task"  # custom prompt
  python main.py --prompt "..." --provider openai    # override provider
  python main.py --prompt "..." --pick 2             # auto-select option 2 (non-interactive)
"""
import argparse
import json
import os
import sys
from datetime import datetime

from langgraph.types import Command

OUTPUT_DIR   = os.path.join(os.path.dirname(__file__), "output")
VALID_PROVIDERS = ("anthropic", "openai", "gemini")

DEFAULT_PROMPT = (
    "Create a beginner task for children. "
    "Topic: the Russian pronoun Я (I/Me). "
    "Connect Я to 3 verbs: Хотеть, Учиться, Любить. "
    "Hide one verb behind a drop zone. Difficulty: beginner."
)


def _apply_provider(provider: str):
    if provider not in VALID_PROVIDERS:
        print(f"[error] Unknown provider '{provider}'. Choose: {', '.join(VALID_PROVIDERS)}", file=sys.stderr)
        sys.exit(1)
    os.environ["MODEL_PROVIDER"] = provider


def _print_suggestions(suggestions: list[dict]):
    print("\n" + "═" * 64)
    print("Agent 1 suggests — pick a layout:")
    for i, s in enumerate(suggestions):
        print(f"\n  [{i + 1}]  {s['title']}")
        print(f"        Type: {s['task_type']}  |  Difficulty: {s['difficulty']}")
        print(f"        {s['description']}")
    print()


def _build_markdown(final: dict, provider: str) -> str:
    ts      = datetime.now().strftime("%Y-%m-%d %H:%M")
    canvas  = final.get("canvas") or {}
    nodes   = canvas.get("nodes", [])
    tray    = canvas.get("tray", [])
    warnings = final.get("warnings", [])
    suggestions = final.get("suggestions", [])
    selected    = final.get("selected_index", 0)

    warn_md = "\n".join(f"- ⚠ {w}" for w in warnings) if warnings else "_none_"
    tray_md = " · ".join(f"`{t['label']}`" for t in tray) or "_empty_"
    node_rows = "\n".join(
        f"| {n.get('id','')} | {n.get('type','')} | "
        f"{n.get('label') or n.get('image_id') or n.get('content','—')} |"
        for n in nodes
    )
    suggestion_rows = "\n".join(
        f"| {'**selected**' if i == selected else str(i+1)} | {s['title']} | {s['task_type']} | {s['difficulty']} |"
        for i, s in enumerate(suggestions)
    )

    return "\n".join([
        "# Canvas AI — Output Report", "",
        f"**Generated:** {ts}  **Provider:** `{provider}`", "",
        "## Suggestions presented", "",
        "| # | Title | Type | Difficulty |",
        "|---|-------|------|------------|",
        suggestion_rows, "",
        "---", "",
        "## Generated canvas", "",
        f"**Summary:** {canvas.get('task_summary', '')}", "",
        "| Metric | Value |", "|--------|-------|",
        f"| Nodes  | {len(nodes)} |",
        f"| Tray   | {len(tray)} |", "",
        f"**Tray items:** {tray_md}", "",
        "**Warnings:**", "", warn_md, "",
        "<details><summary>Node list</summary>", "",
        "| id | type | label / image |",
        "|----|------|---------------|",
        node_rows, "",
        "</details>", "",
        "## Token usage & cost", "",
        "| Step | Model | Input | Output | Total | Cost (USD) |",
        "|------|-------|------:|-------:|------:|-----------:|",
        *[
            f"| {r['step']} | `{r['model']}` | {r['input_tokens']:,} "
            f"| {r['output_tokens']:,} | {r['total_tokens']:,} | ${r['total_cost']:.5f} |"
            for r in (final.get("token_usage") or {}).get("records", [])
        ],
        *([
            f"| **TOTAL** | | "
            f"{final['token_usage']['totals']['input_tokens']:,} | "
            f"{final['token_usage']['totals']['output_tokens']:,} | "
            f"{final['token_usage']['totals']['total_tokens']:,} | "
            f"**${final['token_usage']['totals']['total_cost_usd']:.5f}** |"
        ] if final.get("token_usage") else []),
        "",
        "<details><summary>Raw JSON</summary>", "",
        "```json",
        json.dumps(final, ensure_ascii=False, indent=2, default=str),
        "```", "",
        "</details>",
    ])


def main():
    parser = argparse.ArgumentParser(description="Canvas AI — multi-agent pipeline")
    parser.add_argument("--prompt",   "-p", default=None, help="Task description (vague is fine)")
    parser.add_argument("--provider", "-P", default=None, choices=VALID_PROVIDERS)
    parser.add_argument("--pick",     "-k", type=int,  default=None, help="Auto-select option 1-3")
    args = parser.parse_args()

    if args.provider:
        _apply_provider(args.provider)

    # Delay src imports so MODEL_PROVIDER env var is set first
    from src.graph.pipeline import app
    from src.services.token_tracker import tracker
    tracker.reset()

    provider = os.environ.get("MODEL_PROVIDER", "anthropic")
    prompt   = args.prompt or DEFAULT_PROMPT
    config   = {"configurable": {"thread_id": "main"}}
    initial  = {
        "raw_intent":     prompt,
        "suggestions":    [],
        "selected_index": 0,
        "canvas":         None,
        "warnings":       [],
    }

    # ── Phase 1: interpret → interrupt at select ──────────────────────────────
    result = app.invoke(initial, config)
    suggestions = result.get("suggestions", [])

    if not suggestions:
        print("[error] Agent 1 returned no suggestions.", file=sys.stderr)
        sys.exit(1)

    _print_suggestions(suggestions)

    # ── Human selection ───────────────────────────────────────────────────────
    if args.pick is not None:
        selected = max(0, min(args.pick - 1, len(suggestions) - 1))
        print(f"  → Auto-selected: [{selected + 1}] {suggestions[selected]['title']}")
    else:
        while True:
            try:
                raw = input(f"Pick [1-{len(suggestions)}]: ").strip()
                selected = int(raw) - 1
                if 0 <= selected < len(suggestions):
                    break
                print(f"  Enter a number between 1 and {len(suggestions)}.")
            except (ValueError, EOFError):
                pass
            except KeyboardInterrupt:
                print("\nAborted.")
                sys.exit(0)

    # ── Phase 2: resume → generate ────────────────────────────────────────────
    print(f"\n  Generating canvas for: [{selected + 1}] {suggestions[selected]['title']}...")
    final = app.invoke(Command(resume=selected), config)

    canvas   = final.get("canvas") or {}
    warnings = final.get("warnings", [])

    print("\n" + "─" * 40)
    print("RESULT SUMMARY")
    print(f"  task_summary : {canvas.get('task_summary', '')}")
    print(f"  nodes        : {len(canvas.get('nodes', []))}")
    print(f"  tray         : {len(canvas.get('tray', []))}")
    print(f"  warnings     : {warnings or 'none'}")

    print("\nTOKEN USAGE & COST")
    print(tracker.report())

    # ── Save outputs ──────────────────────────────────────────────────────────
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = f"{provider}_{ts}"

    json_path = os.path.join(OUTPUT_DIR, f"{stem}.json")
    md_path   = os.path.join(OUTPUT_DIR, f"{stem}.md")

    output = {**final, "token_usage": tracker.to_dict()}
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(_build_markdown(output, provider))

    png_path = os.path.join(OUTPUT_DIR, f"{stem}.png")
    try:
        from src.services.drawer import draw_canvas
        draw_canvas(canvas, png_path)
        print(f"\nSaved → {json_path}")
        print(f"       → {md_path}")
        print(f"       → {png_path}")
    except Exception as e:
        print(f"\nSaved → {json_path}")
        print(f"       → {md_path}")
        print(f"       [draw skipped: {e}]")


if __name__ == "__main__":
    main()
