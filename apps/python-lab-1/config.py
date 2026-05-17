import os
import functools
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY     = os.environ.get("OPENAI_API_KEY",    "")
GOOGLE_API_KEY     = os.environ.get("GOOGLE_API_KEY",    "")
MOONSHOT_API_KEY   = os.environ.get("MOONSHOT_API_KEY",  "")
MOONSHOT_BASE_URL  = os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1")
MODEL_PROVIDER     = os.environ.get("MODEL_PROVIDER", "anthropic").lower()

CANVAS_W = int(os.environ.get("CANVAS_W", 1200))
CANVAS_H = int(os.environ.get("CANVAS_H", 800))

# ── LangSmith tracing ─────────────────────────────────────────────────────────
# Bridge LANGSMITH_* vars → LANGCHAIN_* so LangChain auto-activates tracing.
_ls_key      = os.environ.get("LANGSMITH_API_KEY", "")
_ls_project  = os.environ.get("LANGSMITH_PROJECT", "default")
_ls_endpoint = os.environ.get("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com")
_tracing_on  = os.environ.get("LANGCHAIN_TRACING", "false").lower() == "true"

if _ls_key and _tracing_on:
    os.environ["LANGCHAIN_API_KEY"]      = _ls_key
    os.environ["LANGCHAIN_PROJECT"]      = _ls_project
    os.environ["LANGCHAIN_ENDPOINT"]     = _ls_endpoint
    os.environ["LANGCHAIN_TRACING"]   = "true"
    print(f"[tracing] LangSmith ON  -> project='{_ls_project}'  endpoint={_ls_endpoint}")
else:
    os.environ["LANGCHAIN_TRACING"] = "false"
    reason = "no LANGSMITH_API_KEY" if not _ls_key else "LANGCHAIN_TRACING not set to true"
    print(f"[tracing] LangSmith OFF ({reason})")

MOCK_IMAGE_DB = [
    {"id": "img_001", "label": "Я (I/Me)",           "url": "https://cdn.example.com/ya.jpg",       "category": "pronoun", "tags": ["person","self"]},
    {"id": "img_002", "label": "Хотеть (To want)",   "url": "https://cdn.example.com/khotet.jpg",   "category": "verb",    "tags": ["desire","want"]},
    {"id": "img_003", "label": "Учиться (To study)",  "url": "https://cdn.example.com/uchitsya.jpg", "category": "verb",    "tags": ["study","learn"]},
    {"id": "img_004", "label": "Любить (To love)",    "url": "https://cdn.example.com/lyubit.jpg",   "category": "verb",    "tags": ["love","heart"]},
    {"id": "img_005", "label": "Смотреть (To watch)", "url": "https://cdn.example.com/smotret.jpg",  "category": "verb",    "tags": ["watch","eyes"]},
    {"id": "img_006", "label": "Окно (Window)",       "url": "https://cdn.example.com/okno.jpg",     "category": "noun",    "tags": ["window","house"]},
    {"id": "img_007", "label": "Мяч (Ball)",          "url": "https://cdn.example.com/myach.jpg",    "category": "noun",    "tags": ["ball","sport"]},
    {"id": "img_008", "label": "Апельсин (Orange)",   "url": "https://cdn.example.com/apelsin.jpg",  "category": "noun",    "tags": ["fruit","orange"]},
    {"id": "img_009", "label": "Кошка (Cat)",         "url": "https://cdn.example.com/koshka.jpg",   "category": "noun",    "tags": ["animal","cat"]},
    {"id": "img_010", "label": "Читать (To read)",    "url": "https://cdn.example.com/chitat.jpg",   "category": "verb",    "tags": ["read","book"]},
]


@functools.lru_cache(maxsize=1)
def get_models():
    """Return (fast_model, capable_model) for the configured provider."""
    if MODEL_PROVIDER == "openai":
        from langchain_openai import ChatOpenAI
        fast    = ChatOpenAI(model="gpt-4o-mini", api_key=OPENAI_API_KEY, max_tokens=512)
        capable = ChatOpenAI(model="gpt-4o",      api_key=OPENAI_API_KEY, max_tokens=2000)

    elif MODEL_PROVIDER == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        # gemini-2.0-flash has no thinking overhead — safe for structured extraction at low token budgets
        fast    = ChatGoogleGenerativeAI(model="gemini-2.0-flash", google_api_key=GOOGLE_API_KEY, max_output_tokens=1024)
        capable = ChatGoogleGenerativeAI(model="gemini-2.5-pro",   google_api_key=GOOGLE_API_KEY, max_output_tokens=4000)

    elif MODEL_PROVIDER == "kimi":
        from langchain_openai import ChatOpenAI
        fast    = ChatOpenAI(model="moonshot-v1-8k",   api_key=MOONSHOT_API_KEY, base_url=MOONSHOT_BASE_URL, max_tokens=512)
        capable = ChatOpenAI(model="moonshot-v1-32k",  api_key=MOONSHOT_API_KEY, base_url=MOONSHOT_BASE_URL, max_tokens=2000)

    else:  # anthropic (default)
        from langchain_anthropic import ChatAnthropic
        fast    = ChatAnthropic(model="claude-haiku-4-5-20251001",  api_key=ANTHROPIC_API_KEY, max_tokens=2048)
        capable = ChatAnthropic(model="claude-sonnet-4-20250514", api_key=ANTHROPIC_API_KEY, max_tokens=4096)

    print(f"[config] provider={MODEL_PROVIDER}  fast={fast.model if hasattr(fast, 'model') else fast.model_name}  capable={capable.model if hasattr(capable, 'model') else capable.model_name}")
    return fast, capable
