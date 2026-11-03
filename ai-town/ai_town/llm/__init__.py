"""LLM 层：后端适配 + 提示词 + 健壮 JSON 解析。

后端优先级（auto 模式）：
    Ollama (127.0.0.1:11434) → OpenAI 兼容 (LM Studio / vLLM) → 离线模板
没有本地模型时游戏依然可玩：agents 层会退回到程序化叙述器。
"""
from __future__ import annotations

from .client import LLMClient, Backend, OllamaBackend, OpenAICompatBackend, load_config
from .parsing import (
    extract_json,
    coerce_npcs,
    coerce_events,
    coerce_action,
    sanitize_effects,
)

__all__ = [
    "LLMClient",
    "Backend",
    "OllamaBackend",
    "OpenAICompatBackend",
    "load_config",
    "extract_json",
    "coerce_npcs",
    "coerce_events",
    "coerce_action",
    "sanitize_effects",
]
