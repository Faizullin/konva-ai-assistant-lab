"""
Agent 1 — Interpreter

Takes a vague teacher intent and generates 3 distinct TaskOption suggestions.
Uses the fast model (haiku / gpt-4o-mini / gemini-2.0-flash).
"""
from langchain_core.prompts import ChatPromptTemplate

from config import get_models
from src.models.schemas import TaskOption, SuggestedOptions
from src.services.token_tracker import tracker
from tracing import traced

_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a PECS educational task designer generating drag-and-drop canvas tasks.

TEACHER'S REQUEST: {raw_intent}

Generate EXACTLY 3 task options. Each option MUST be directly and specifically about the topic
in the teacher's request above — do NOT invent unrelated themes.
Make the 3 options structurally different (vary task_type or difficulty).

Field rules:
- title: ≤8 words, reflects the actual topic
- description: 1-2 sentences on what the learner does
- task_type: mind_map | matching | sorting | drag_drop
- topic: the subject from the teacher's request
- central_concept: main word for mind_map; empty string for others
- relations: list of source/target concept links
- concepts: every word/phrase that needs a visual image card
- num_dropzones: 1-4
- num_distractors: 1-3
- language: ru | en | kz  (infer from the topic language)
- difficulty: beginner | intermediate | advanced"""),
    ("human", "Generate 3 task options for: {raw_intent}"),
])


@traced(name="interpret_intent", tags=["agent-1"])
def interpret_intent(raw_intent: str) -> list[TaskOption]:
    fast_model, _ = get_models()
    print("\n[Agent 1] Interpreting intent...")
    chain  = _PROMPT | fast_model.with_structured_output(SuggestedOptions)
    result = chain.invoke(
        {"raw_intent": raw_intent},
        config={"callbacks": [tracker], "tags": ["interpret_intent"]},
    )
    options = result.options[:3]
    print(f"    {len(options)} option(s) generated")
    for i, opt in enumerate(options):
        print(f"    [{i+1}] {opt.title}  ({opt.task_type}, {opt.difficulty})")
    return options
