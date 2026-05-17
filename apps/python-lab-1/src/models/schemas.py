from typing import Optional
from pydantic import BaseModel, Field


class Relation(BaseModel):
    source: str
    target: str


class TaskIntent(BaseModel):
    task_type:       str
    topic:           str
    central_concept: str
    relations:       list[Relation]
    concepts:        list[str]
    num_dropzones:   int
    num_distractors: int
    language:        str
    difficulty:      str


class TaskOption(BaseModel):
    """One suggested canvas task variant — produced by Agent 1 (Interpreter)."""
    title:           str
    description:     str
    task_type:       str
    topic:           str
    central_concept: str
    relations:       list[Relation]
    concepts:        list[str]
    num_dropzones:   int
    num_distractors: int
    language:        str
    difficulty:      str

    def to_intent(self) -> TaskIntent:
        intent_fields = set(TaskIntent.model_fields)
        return TaskIntent(**{k: v for k, v in self.model_dump().items() if k in intent_fields})


class SuggestedOptions(BaseModel):
    """Structured output wrapper for Agent 1 — always exactly 3 options."""
    options: list[TaskOption]


class CanvasNode(BaseModel):
    id:          str
    type:        str
    x:           Optional[float] = None
    y:           Optional[float] = None
    width:       Optional[float] = None
    height:      Optional[float] = None
    image_id:    Optional[str]   = None
    image_url:   Optional[str]   = None
    label:       Optional[str]   = None
    draggable:   Optional[bool]  = None
    correct_ids: Optional[list[str]] = None
    placeholder: Optional[str]   = None
    from_node:   Optional[str]   = Field(None, alias="from")
    to_node:     Optional[str]   = Field(None, alias="to")
    style:       Optional[str]   = None
    content:     Optional[str]   = None
    fontSize:    Optional[float] = None

    class Config:
        populate_by_name = True


class TrayItem(BaseModel):
    image_id:  str
    image_url: str
    label:     str


class GeneratedCanvas(BaseModel):
    task_summary: str
    nodes:        list[CanvasNode]
    tray:         list[TrayItem]
    warnings:     list[str] = []
