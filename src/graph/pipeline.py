"""
LangGraph multi-agent pipeline.

Flow:
  interpret_node  →  select_node (human interrupt)  →  generate_node  →  END

  Agent 1 (interpret_node): fast model → 3 TaskOption suggestions
  Human pause (select_node): caller resumes with chosen index
  Agent 2 (generate_node):  capable model → full GeneratedCanvas
"""
from typing import TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import interrupt

from src.agents.canvas_agent import run_canvas_agent
from src.agents.interpreter import interpret_intent
from src.models.schemas import TaskOption


class PipelineState(TypedDict):
    raw_intent:     str
    suggestions:    list[dict]   # list[TaskOption.model_dump()]
    selected_index: int
    canvas:         dict | None
    warnings:       list[str]


# ── nodes ─────────────────────────────────────────────────────────────────────

def interpret_node(state: PipelineState) -> dict:
    options = interpret_intent(state["raw_intent"])
    return {"suggestions": [o.model_dump() for o in options]}


def select_node(state: PipelineState) -> dict:
    """
    Suspends graph execution and surfaces suggestions to the caller.
    Resume by calling: app.invoke(Command(resume=<index>), config)
    """
    selected_index = interrupt({
        "type":        "select_option",
        "suggestions": state["suggestions"],
    })
    return {"selected_index": int(selected_index)}


def generate_node(state: PipelineState) -> dict:
    option = TaskOption(**state["suggestions"][state["selected_index"]])
    intent = option.to_intent()
    canvas, warnings = run_canvas_agent(intent)
    return {
        "canvas":   canvas.model_dump(),
        "warnings": warnings,
    }


# ── graph ─────────────────────────────────────────────────────────────────────

def build_graph():
    g = StateGraph(PipelineState)

    g.add_node("interpret", interpret_node)
    g.add_node("select",    select_node)
    g.add_node("generate",  generate_node)

    g.set_entry_point("interpret")
    g.add_edge("interpret", "select")
    g.add_edge("select",    "generate")
    g.add_edge("generate",  END)

    return g.compile(checkpointer=MemorySaver())


# Singleton — import this in main.py
app = build_graph()
