"""LLM 客户端：后端适配与配置。

支持的后端：
  * minimax     —— 在线 MiniMax（OpenAI 兼容，https://api.minimax.cn/v1）
  * openai      —— 任意 OpenAI 兼容端点（LM Studio / vLLM / 云服务）
  * ollama      —— 本地 Ollama（http://127.0.0.1:11434）
  * offline     —— 不可用时由 agents 层回退到程序化叙述器

密钥来源优先级：
  1. 环境变量 MINIMAX_API_KEY / AITOWN_MINIMAX_KEY / OPENAI_API_KEY
  2. 项目 config.json
  3. ~/.tea_agent/provider.yaml 里的 minimax / openai 段（复用本机已配置好的账号）

关于 MiniMax-M3.1-Flash（自适应思考模型）：
  * 不能关闭思考（thinking.type=disabled 会 400）；
  * 但可以调低思考量：reasoning_effort=low。实测 NPC 生成从 100s 降到 6~10s。
  * 提示词越啰嗦它想得越久，所以提示词要短、字段长度要写死上限。
"""
from __future__ import annotations

import io
import json
import os
import re
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple

from .parsing import extract_json

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_PATH = os.path.join(PROJECT_DIR, "config.json")

DEFAULT_CONFIG: Dict[str, Any] = {
    "backend": "auto",
    "minimax_url": "https://api.minimax.cn/v1",
    "minimax_model": "MiniMax-M3.1-Flash",
    "openai_url": "http://127.0.0.1:1234/v1",
    "openai_model": "local-model",
    "ollama_url": "http://127.0.0.1:11434",
    "ollama_model": "qwen2.5:7b",
    "api_key": "",
    "temperature": 0.9,
    "max_tokens": 4000,
    "timeout": 180,
    "retries": 1,
    "reasoning_effort": "low",
    "reasoning_split": True,
}


# --------------------------------------------------------------------------
# 配置
# --------------------------------------------------------------------------
def _read_provider_yaml() -> Dict[str, Any]:
    """从 ~/.tea_agent/provider.yaml 里抠出 minimax / openai 的接入信息。"""
    path = os.path.expanduser(r"~\.tea_agent\provider.yaml")
    if not os.path.exists(path):
        return {}
    try:
        with io.open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except Exception:
        return {}
    out: Dict[str, Any] = {}
    for prov, key in (("minimax", "minimax"), ("openai", "openai")):
        m = re.search(rf"^\s*{prov}:\s*$(.*?)(?=^\s{{2}}\S|\Z)", text, re.S | re.M)
        if not m:
            continue
        block = m.group(1)
        url = re.search(r"api_url:\s*(\S+)", block)
        k = re.search(r"api_key:\s*(\S+)", block)
        model = re.search(r"default_model:\s*(\S+)", block)
        if k:
            out[key] = {
                "api_url": url.group(1) if url else "",
                "api_key": k.group(1).strip("'\""),
                "model": model.group(1) if model else "",
            }
    return out


def load_config(path: Optional[str] = None) -> Dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    cfg_path = path or CONFIG_PATH
    if os.path.exists(cfg_path):
        try:
            with io.open(cfg_path, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                cfg.update(data)
        except Exception:
            pass

    prov = _read_provider_yaml()
    mm = prov.get("minimax")
    if mm:
        if mm.get("api_url") and not cfg.get("minimax_url_set"):
            cfg["minimax_url"] = mm["api_url"]
        if mm.get("api_key") and not cfg.get("api_key"):
            cfg["api_key"] = mm["api_key"]
        if mm.get("model") and not cfg.get("minimax_model_set"):
            cfg["minimax_model"] = mm["model"]

    env_key = (
        os.environ.get("MINIMAX_API_KEY")
        or os.environ.get("AITOWN_MINIMAX_KEY")
        or os.environ.get("OPENAI_API_KEY")
    )
    if env_key:
        cfg["api_key"] = env_key
    for env_name, cfg_key in (
        ("AITOWN_BACKEND", "backend"),
        ("AITOWN_MINIMAX_URL", "minimax_url"),
        ("AITOWN_MINIMAX_MODEL", "minimax_model"),
        ("AITOWN_OPENAI_URL", "openai_url"),
        ("AITOWN_OPENAI_MODEL", "openai_model"),
        ("AITOWN_OLLAMA_URL", "ollama_url"),
        ("AITOWN_OLLAMA_MODEL", "ollama_model"),
        ("AITOWN_REASONING_EFFORT", "reasoning_effort"),
    ):
        v = os.environ.get(env_name)
        if v:
            cfg[cfg_key] = v
    return cfg


# --------------------------------------------------------------------------
# 后端
# --------------------------------------------------------------------------
class Backend:
    """后端接口。"""

    name = "base"
    last_reasoning = ""

    def available(self) -> bool:
        return False

    def describe(self) -> str:
        return self.name

    def complete(self, system: str, prompt: str, json_mode: bool = True) -> str:
        raise NotImplementedError


class OpenAICompatBackend(Backend):
    """任何 OpenAI 兼容的 /chat/completions 端点（MiniMax / LM Studio / vLLM）。"""

    def __init__(
        self,
        name: str,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout: int = 180,
        temperature: float = 0.9,
        max_tokens: int = 4000,
        retries: int = 1,
        reasoning_effort: str = "",
        reasoning_split: bool = False,
        extra_headers: Optional[Dict[str, str]] = None,
    ):
        self.name = name
        self.base_url = (base_url or "").rstrip("/")
        self.model = model
        self.api_key = api_key or ""
        self.timeout = timeout
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.retries = max(0, retries)
        self.reasoning_effort = reasoning_effort or ""
        self.reasoning_split = reasoning_split
        self.extra_headers = extra_headers or {}
        self.last_error = ""

    def describe(self) -> str:
        return f"{self.name}:{self.model}@{self.base_url}"

    def available(self) -> bool:
        return bool(self.base_url and self.model)

    def _endpoint(self) -> str:
        if self.base_url.endswith("/chat/completions"):
            return self.base_url
        return self.base_url + "/chat/completions"

    def _headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = "Bearer " + self.api_key
        h.update(self.extra_headers)
        return h

    def complete(self, system: str, prompt: str, json_mode: bool = True) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        if self.reasoning_effort:
            payload["reasoning_effort"] = self.reasoning_effort
        if self.reasoning_split:
            payload["reasoning_split"] = True
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        last_err = ""
        for attempt in range(self.retries + 1):
            req = urllib.request.Request(
                self._endpoint(), data=body, headers=self._headers(), method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read().decode("utf-8", "replace")
                data = json.loads(raw)
                choice = (data.get("choices") or [{}])[0]
                msg = choice.get("message") or {}
                self.last_reasoning = msg.get("reasoning_content") or ""
                content = msg.get("content") or ""
                finish = choice.get("finish_reason")
                if content and finish != "length":
                    return content
                if content and finish == "length":
                    last_err = "输出被 max_tokens 截断"
                else:
                    last_err = f"空回复（finish_reason={finish}）"
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:300]
                last_err = f"HTTP {e.code}: {detail}"
                if e.code in (400, 401, 403, 404):
                    break
            except Exception as e:  # noqa: BLE001
                last_err = f"{type(e).__name__}: {e}"
            if attempt < self.retries:
                time.sleep(1.5 * (attempt + 1))
        self.last_error = last_err
        raise RuntimeError(f"[{self.name}] 请求失败：{last_err}")


class OllamaBackend(Backend):
    """本地 Ollama（可选）。"""

    def __init__(
        self,
        url: str = "http://127.0.0.1:11434",
        model: str = "qwen2.5:7b",
        timeout: int = 180,
        temperature: float = 0.9,
        max_tokens: int = 4000,
        retries: int = 1,
        reasoning_effort: str = "",
        reasoning_split: bool = False,
    ):
        self.name = "ollama"
        self.url = (url or "").rstrip("/")
        self.model = model
        self.timeout = timeout
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.retries = max(0, retries)
        self.last_error = ""

    def describe(self) -> str:
        return f"ollama:{self.model}@{self.url}"

    def available(self) -> bool:
        try:
            req = urllib.request.Request(self.url + "/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def complete(self, system: str, prompt: str, json_mode: bool = True) -> str:
        payload: Dict[str, Any] = {
            "model": self.model,
            "system": system,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": self.temperature,
                "num_predict": self.max_tokens,
            },
        }
        if json_mode:
            payload["format"] = "json"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        last_err = ""
        for attempt in range(self.retries + 1):
            req = urllib.request.Request(
                self.url + "/api/generate", data=body, headers={"Content-Type": "application/json"}, method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read().decode("utf-8", "replace"))
                text = data.get("response") or ""
                if text:
                    return text
                last_err = "empty response"
            except Exception as e:  # noqa: BLE001
                last_err = f"{type(e).__name__}: {e}"
            if attempt < self.retries:
                time.sleep(1.5 * (attempt + 1))
        self.last_error = last_err
        raise RuntimeError(f"[ollama] 请求失败：{last_err}")


class OfflineBackend(Backend):
    """永远不可用：上层据此回退到程序化叙述器。"""

    name = "offline"

    def available(self) -> bool:
        return False

    def describe(self) -> str:
        return "offline（程序化叙述器）"


# --------------------------------------------------------------------------
# 客户端
# --------------------------------------------------------------------------
class LLMClient:
    def __init__(self, config: Optional[Dict[str, Any]] = None, backend: Optional[Backend] = None):
        self.config = config or load_config()
        self.backend: Backend = backend or self._pick_backend()
        self.last_error = ""
        self.calls = 0

    # -- 选择后端 -------------------------------------------------------
    def _common(self) -> Dict[str, Any]:
        return dict(
            timeout=int(self.config.get("timeout", 180)),
            temperature=float(self.config.get("temperature", 0.9)),
            max_tokens=int(self.config.get("max_tokens", 4000)),
            retries=int(self.config.get("retries", 1)),
            reasoning_effort=str(self.config.get("reasoning_effort", "") or ""),
            reasoning_split=bool(self.config.get("reasoning_split", False)),
        )

    def _pick_backend(self) -> Backend:
        mode = str(self.config.get("backend", "auto")).lower()
        common = self._common()
        if mode in ("offline", "template", "none"):
            return OfflineBackend()

        if mode == "minimax":
            return OpenAICompatBackend(
                name="minimax",
                base_url=self.config.get("minimax_url", "https://api.minimax.cn/v1"),
                model=self.config.get("minimax_model", "MiniMax-M3.1-Flash"),
                api_key=self.config.get("api_key", ""),
                **common,
            )
        if mode == "openai":
            return OpenAICompatBackend(
                name="openai",
                base_url=self.config.get("openai_url", ""),
                model=self.config.get("openai_model", ""),
                api_key=self.config.get("api_key", ""),
                **common,
            )
        if mode == "ollama":
            return OllamaBackend(
                url=self.config.get("ollama_url", "http://127.0.0.1:11434"),
                model=self.config.get("ollama_model", "qwen2.5:7b"),
                **common,
            )

        # auto：在线优先，本地兜底
        if self.config.get("api_key") and self.config.get("minimax_url"):
            backend = OpenAICompatBackend(
                name="minimax",
                base_url=self.config.get("minimax_url"),
                model=self.config.get("minimax_model", "MiniMax-M3.1-Flash"),
                api_key=self.config.get("api_key", ""),
                **common,
            )
            if backend.available():
                return backend
        ollama = OllamaBackend(
            url=self.config.get("ollama_url", "http://127.0.0.1:11434"),
            model=self.config.get("ollama_model", "qwen2.5:7b"),
            **common,
        )
        if ollama.available():
            return ollama
        if self.config.get("openai_url") and self.config.get("api_key"):
            return OpenAICompatBackend(
                name="openai",
                base_url=self.config.get("openai_url"),
                model=self.config.get("openai_model", "local-model"),
                api_key=self.config.get("api_key", ""),
                **common,
            )
        return OfflineBackend()

    # -- 对外 -----------------------------------------------------------
    @property
    def online(self) -> bool:
        return isinstance(self.backend, (OpenAICompatBackend, OllamaBackend)) and self.backend.available()

    def describe(self) -> str:
        return self.backend.describe()

    def complete(self, system: str, prompt: str, json_mode: bool = True) -> str:
        self.calls += 1
        try:
            return self.backend.complete(system, prompt, json_mode=json_mode)
        except Exception as e:  # noqa: BLE001
            self.last_error = str(e)
            raise

    def complete_json(
        self, system: str, prompt: str, json_mode: bool = True
    ) -> Tuple[Optional[Any], str, str]:
        """返回 (解析后的 JSON, 原始文本, 错误信息)。任何一步失败都不抛异常。"""
        try:
            raw = self.complete(system, prompt, json_mode=json_mode)
        except Exception as e:  # noqa: BLE001
            self.last_error = str(e)
            return None, "", str(e)
        data = extract_json(raw)
        if data is None:
            # 有些推理模型会把 JSON 混在 reasoning 里
            reasoning = getattr(self.backend, "last_reasoning", "") or ""
            if reasoning:
                data = extract_json(reasoning)
        if data is None:
            err = "模型没有返回可解析的 JSON"
            self.last_error = err
            return None, raw, err
        return data, raw, ""
