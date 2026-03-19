from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import Setting, get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])

AVAILABLE_MODELS = [
    {"id": "deepseek/deepseek-v3.2", "name": "DeepSeek V3.2 (default)"},
    {"id": "mistralai/mistral-7b-instruct", "name": "Mistral 7B Instruct (fast, cheap)"},
    {"id": "mistralai/mixtral-8x7b-instruct", "name": "Mixtral 8x7B (balanced)"},
    {"id": "anthropic/claude-3-haiku", "name": "Claude 3 Haiku (fast)"},
    {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet (high quality)"},
    {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini (fast)"},
    {"id": "openai/gpt-4o", "name": "GPT-4o (high quality)"},
    {"id": "google/gemini-flash-1.5", "name": "Gemini 1.5 Flash (fast)"},
]


class SettingsUpdate(BaseModel):
    openrouter_api_key: str | None = None
    openrouter_model: str | None = None


@router.get("/")
def get_settings(db: Session = Depends(get_db)):
    api_key = db.query(Setting).filter_by(key="openrouter_api_key").first()
    model = db.query(Setting).filter_by(key="openrouter_model").first()
    return {
        "openrouter_api_key_set": bool(api_key and api_key.value),
        # Mask the key — only show last 4 chars
        "openrouter_api_key_hint": (
            "***" + api_key.value[-4:] if api_key and len(api_key.value) > 4 else ""
        ),
        "openrouter_model": model.value if model else "deepseek/deepseek-v3.2",
        "available_models": AVAILABLE_MODELS,
    }


@router.put("/")
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    if body.openrouter_api_key is not None:
        _upsert(db, "openrouter_api_key", body.openrouter_api_key)
    if body.openrouter_model is not None:
        _upsert(db, "openrouter_model", body.openrouter_model)
    db.commit()
    return {"ok": True}


def _upsert(db: Session, key: str, value: str):
    setting = db.query(Setting).filter_by(key=key).first()
    if setting:
        setting.value = value
    else:
        db.add(Setting(key=key, value=value))
