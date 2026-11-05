"""配置：模型接入、阵容、对局参数。

密钥来源优先级：
  1. 环境变量 SGSS_<PROVIDER>_KEY
  2. 项目目录 config.json
  3. ~/.tea_agent/provider.yaml（复用本机已配置好的账号）

三个模型（题目指定）：
  minimax-m3.1-flash  → provider minimax，api 模型名 MiniMax-M3.1-Flash
  deepseek-flash     → provider deepseek，api 模型名 deepseek-flash
  mimo-v2.6-flash    → provider mimo，api 模型名 mimo-v2.6-flash
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import yaml

PROJECT_DIR = Path(__file__).resolve().parent.parent
CONFIG_JSON = PROJECT_DIR / "config.json"


@dataclass
class ModelSpec:
    key: str  # 对外的模型名，如 deepseek-flash
    provider: str  # provider.yaml 里的段名
    api_model: str  # 请求里实际用的模型名
    label: str = ""  # 界面显示名
    temperature: float = 0.7
    max_tokens: int = 4000
    reasoning_effort: str = ""
    reasoning_split: bool = False

    @property
    def display(self) -> str:
        return self.label or self.key


MODEL_SPECS: Dict[str, ModelSpec] = {
    "minimax-m3.1-flash": ModelSpec(
        key="minimax-m3.1-flash",
        provider="minimax",
        api_model="MiniMax-M3.1-Flash",
        label="minimax-m3.1-flash",
        temperature=0.8,
        max_tokens=4000,
        # MiniMax-M3.1-Flash 是自适应思考模型：不能关思考，只能调低（low 约 6~10s）
        reasoning_effort="low",
        reasoning_split=True,
    ),
    "deepseek-flash": ModelSpec(
        key="deepseek-flash",
        provider="deepseek",
        api_model="deepseek-flash",
        label="deepseek-flash",
        temperature=0.6,
        max_tokens=4000,
        reasoning_effort="",
    ),
    "mimo-v2.6-flash": ModelSpec(
        key="mimo-v2.6-flash",
        provider="mimo",
        api_model="mimo-v2.6-flash",
        label="mimo-v2.6-flash",
        temperature=0.7,
        max_tokens=4000,
    ),
}

MODEL_ORDER = ["minimax-m3.1-flash", "deepseek-flash", "mimo-v2.6-flash"]


def _provider_yaml_path() -> Optional[Path]:
    env = os.environ.get("SGSS_PROVIDER_YAML")
    if env:
        p = Path(env)
        return p if p.exists() else None
    p = Path.home() / ".tea_agent" / "provider.yaml"
    return p if p.exists() else None


def _load_yaml() -> Dict:
    p = _provider_yaml_path()
    if not p:
        return {}
    try:
        data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


def _load_json() -> Dict:
    if not CONFIG_JSON.exists():
        return {}
    try:
        return json.loads(CONFIG_JSON.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        return {}


@dataclass
class Endpoint:
    base_url: str
    api_key: str
    extra: Dict = field(default_factory=dict)


def resolve_endpoint(spec: ModelSpec) -> Endpoint:
    """按优先级解析某个模型对应的 api_url / api_key。"""
    cfg = _load_json()
    providers = _load_yaml().get("providers", {}) or {}
    p = providers.get(spec.provider, {}) or {}

    base_url = (
        cfg.get(spec.provider, {}).get("api_url")
        or os.environ.get(f"SGSS_{spec.provider.upper()}_URL")
        or p.get("api_url")
        or ""
    )
    api_key = (
        cfg.get(spec.provider, {}).get("api_key")
        or os.environ.get(f"SGSS_{spec.provider.upper()}_KEY")
        or os.environ.get(f"{spec.provider.upper()}_API_KEY")
        or p.get("api_key")
        or ""
    )
    if isinstance(p.get("api_keys"), list) and p["api_keys"] and not api_key:
        api_key = p["api_keys"][0]
    return Endpoint(base_url=base_url.rstrip("/"), api_key=api_key, extra=p)


@dataclass
class GameConfig:
    seed: int = 20261105
    max_turns: int = 60
    think_delay: float = 0.6  # 界面上的动画停顿（秒）
    llm_timeout: int = 90
    llm_responses: bool = True  # 是否让模型自己决定出闪/桃（False = 规则自动）
    fallback: bool = True  # 模型失败时用规则策略兜底
    seats: List[str] = field(default_factory=lambda: list(MODEL_ORDER))
    heroes: Dict[str, str] = field(default_factory=dict)  # 模型名 -> 武将 key

    def hero_for(self, model_key: str) -> str:
        return self.heroes.get(model_key, "")


def load_game_config(overrides: Optional[Dict] = None) -> GameConfig:
    cfg = _load_json().get("game", {}) or {}
    gc = GameConfig()
    for k, v in cfg.items():
        if hasattr(gc, k):
            setattr(gc, k, v)
    heroes = dict(cfg.get("heroes", {}) or {})
    heroes.update(_load_json().get("lineup", {}) or {})
    gc.heroes = heroes
    if overrides:
        for k, v in overrides.items():
            if k == "heroes" and isinstance(v, dict):
                gc.heroes.update(v)
            elif hasattr(gc, k):
                setattr(gc, k, v)
    return gc
