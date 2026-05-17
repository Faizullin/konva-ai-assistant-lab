"""
LangSmith tracing utilities.

Activation: set in .env —
    LANGSMITH_API_KEY=lsv2_...
    LANGSMITH_PROJECT=your-project
    LANGCHAIN_TRACING=true   (config.py bridges LANGSMITH_* → LANGCHAIN_*)

Usage in other modules:
    from tracing import traced, print_trace_url

    @traced(name="my_step", tags=["pipeline"])
    def my_function(...): ...
"""

import os
from langsmith import traceable, Client
from langsmith.run_helpers import get_current_run_tree

TRACING_ON = os.environ.get("LANGCHAIN_TRACING", "false").lower() == "true"
_PROJECT   = os.environ.get("LANGCHAIN_PROJECT", "default")
_ENDPOINT  = os.environ.get("LANGCHAIN_ENDPOINT", "https://api.smith.langchain.com")


def traced(name: str = None, tags: list[str] | None = None, metadata: dict | None = None):
    """
    Decorator that registers a function as a traceable LangSmith step.

    When tracing is off the function runs unchanged — zero overhead.

        @traced(name="resolve_images", tags=["retrieval"])
        def resolve_images(...): ...
    """
    def decorator(fn):
        if not TRACING_ON:
            return fn
        return traceable(
            name=name or fn.__name__,
            tags=tags or [],
            metadata=metadata or {},
        )(fn)
    return decorator


def get_run_url() -> str | None:
    """Return the LangSmith UI URL for the innermost active run, or None."""
    if not TRACING_ON:
        return None
    run = get_current_run_tree()
    if run is None:
        return None
    # Walk up to root run so we always link to the top-level trace page
    root = run
    while root.parent_run_id:
        root = root
        break
    return f"{_ENDPOINT.rstrip('/')}/projects/p/{_PROJECT}/runs/{root.id}"


def print_trace_url():
    """Print the LangSmith trace URL if tracing is active."""
    url = get_run_url()
    if url:
        print(f"    [trace] {url}")


def get_client() -> Client | None:
    """Return an authenticated LangSmith Client, or None if tracing is off."""
    if not TRACING_ON:
        return None
    api_key = os.environ.get("LANGCHAIN_API_KEY", "")
    if not api_key:
        return None
    return Client(api_url=_ENDPOINT, api_key=api_key)


def log_feedback(run_id: str, score: float, comment: str = "") -> bool:
    """
    Submit a 0-1 score for a completed run (e.g. from human review).

    Returns True on success, False if tracing is off or client unavailable.
    """
    client = get_client()
    if client is None:
        return False
    client.create_feedback(run_id=run_id, key="quality", score=score, comment=comment)
    return True
