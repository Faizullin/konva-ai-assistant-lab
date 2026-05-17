"""
Agent 2 — Canvas Generator

Receives a TaskIntent and runs the full pipeline:
  resolve_images → generate_layout → validate_and_repair
Uses the capable model (sonnet / gpt-4o / gemini-2.5-pro).
"""
import json

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool
from langchain_core.output_parsers.openai_tools import JsonOutputKeyToolsParser

from config import get_models, CANVAS_W, CANVAS_H
from src.models.schemas import TaskIntent, GeneratedCanvas, CanvasNode, TrayItem
from src.services.image_resolver import resolve_images
from src.services.token_tracker import tracker
from src.services.validator import validate_and_repair
from tracing import traced


def _build_image_context(resolved: dict) -> str:
    correct     = [v for v in resolved.values() if v["role"] == "correct"]
    distractors = [v for v in resolved.values() if v["role"] == "distractor"]
    c_lines = "\n".join(
        f'id="{r["id"]}" label="{r["label"]}" url="{r["url"]}" role="correct"'
        for r in correct
    )
    d_lines = "\n".join(
        f'id="{d["id"]}" label="{d["label"]}" url="{d["url"]}" role="distractor"'
        for d in distractors
    ) or "(none)"
    return f"CORRECT IMAGES:\n{c_lines}\n\nDISTRACTOR IMAGES:\n{d_lines}"


@tool("generate_canvas", args_schema=GeneratedCanvas)
def _generate_canvas_tool(
    task_summary: str,
    nodes: list[CanvasNode],
    tray: list[TrayItem],
    warnings: list[str] = [],
) -> GeneratedCanvas:
    """Generate a complete canvas layout for an educational task."""
    return GeneratedCanvas(task_summary=task_summary, nodes=nodes, tray=tray, warnings=warnings)


@traced(name="generate_layout", tags=["agent-2", "layout"])
def generate_layout(intent: TaskIntent, resolved_images: dict) -> GeneratedCanvas:
    print("\n[Agent 2 — 3/4] Generating canvas layout...")
    _, capable_model = get_models()

    difficulty_rule = {
        "beginner":     "distractors clearly different category from correct answers",
        "intermediate": "distractors from same category as correct answers",
        "advanced":     "distractors visually or semantically very similar to correct answers",
    }.get(intent.difficulty, "")

    system = f"""You are a canvas layout engine for an educational drag-and-drop task editor.
Canvas: {CANVAS_W}x{CANVAS_H}px. Safe area: 40px padding all edges.

{_build_image_context(resolved_images)}

RULES:
- Use ONLY the image_ids listed above. Never invent ids or urls.
- Central concept: place a Card at ({CANVAS_W//2},{CANVAS_H//2}) using the correct image_id for the central concept.
- For mind_map: spread radial cards at radius 220px around the center.
- Card: type="Card" width=120 height=120 draggable=false.
- DropZone: type="DropZone" width=130 height=130; correct_ids must reference real image_ids above.
- Arrow: type="Arrow" style="dashed" to DropZone, "solid" to Card.
- Generate EXACTLY {intent.num_dropzones} DropZone node(s), no more, no less.
- Minimum 20px gap between nodes.
- DropZone replaces the concept the learner must guess — that Card moves to tray.
- Tray: correct answer(s) + distractors from DISTRACTOR IMAGES.
- Difficulty rule: {difficulty_rule}.
- Node ids must be unique: node_1, dz_1, arrow_1, text_1, etc."""

    model_with_tool = capable_model.bind_tools(
        [_generate_canvas_tool],
        tool_choice="generate_canvas",
    )
    layout_chain = (
        ChatPromptTemplate.from_messages([
            ("system", system),
            ("human",  "{task_description}"),
        ])
        | model_with_tool
        | JsonOutputKeyToolsParser(key_name="generate_canvas", first_tool_only=True)
    )

    task_description = (
        f"Task type : {intent.task_type}\n"
        f"Topic     : {intent.topic}\n"
        f"Central   : {intent.central_concept}\n"
        f"Relations : {json.dumps([r.model_dump() for r in intent.relations], ensure_ascii=False)}\n"
        f"Dropzones : {intent.num_dropzones}\n"
        f"Language  : {intent.language}\n"
        f"Difficulty: {intent.difficulty}"
    )

    raw    = layout_chain.invoke(
        {"task_description": task_description},
        config={"callbacks": [tracker], "tags": ["generate_layout"]},
    )
    canvas = GeneratedCanvas(**raw)
    print(f"    nodes : {len(canvas.nodes)}  tray : {len(canvas.tray)}")
    return canvas


@traced(name="run_canvas_agent", tags=["agent-2"])
def run_canvas_agent(intent: TaskIntent) -> tuple[GeneratedCanvas, list[str]]:
    """Full Agent 2 pipeline: resolve → layout → validate."""
    images           = resolve_images(intent.concepts, intent.language, intent.num_distractors)
    canvas           = generate_layout(intent, images)
    canvas, warnings = validate_and_repair(canvas, images)
    return canvas, warnings
