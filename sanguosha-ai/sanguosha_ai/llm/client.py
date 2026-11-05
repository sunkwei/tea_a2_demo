"""OpenAI 兼容的 LLM 客户端。

只依赖 requests，直接 POST {base}/chat/completions。
针对三个模型的差异都做了适配：
  * minimax-m3.1-flash：自适应思考模型，不能关思考 → 传 reasoning_effort=low + reasoning_split=true，
    思考内容会单独落到 reasoning_content 字段（界面上可以展示「模型在想什么」）。
  * deepseek-flash / mimo-v2.6-flash：默认就返回 reasoning_content，不用特殊参数。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, Optional

import requests

from ..config import ModelSpec, resolve_endpoint


@dataclass
class ChatResult:
    ok: bool = False
    content: str = ""
    reasoning: str = ""
    raw: str = ""
    elapsed: float = 0.0
    error: str = ""
    usage: Dict[str, object] = field(default_factory=dict)

    @property
    def text(self) -> str:
        return self.content or self.reasoning


class LlmClient:
    def __init__(self, spec: ModelSpec, timeout: int = 90) -> None:
        self.spec = spec
        self.timeout = timeout
        self.endpoint = resolve_endpoint(spec)
        self.calls = 0
        self.errors = 0
        self.total_elapsed = 0.0

    # ------------------------------------------------------------------
    @property
    def available(self) -> bool:
        return bool(self.endpoint.base_url and self.endpoint.api_key)

    def describe(self) -> str:
        if not self.available:
            return f"{self.spec.key}（未配置 api_url/api_key）"
        return f"{self.spec.key} @ {self.endpoint.base_url}"

    # ------------------------------------------------------------------
    def chat(
        self,
        system: str,
        user: str,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        retries: int = 2,
    ) -> ChatResult:
        if not self.available:
            return ChatResult(ok=False, error="模型未配置（缺少 api_url 或 api_key）")
        payload: Dict[str, object] = {
            "model": self.spec.api_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.spec.temperature if temperature is None else temperature,
            "max_tokens": max_tokens or self.spec.max_tokens,
            "stream": False,
        }
        if self.spec.reasoning_effort:
            payload["reasoning_effort"] = self.spec.reasoning_effort
        if self.spec.reasoning_split:
            payload["reasoning_split"] = True

        url = f"{self.endpoint.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.endpoint.api_key}",
        }
        last_err = ""
        started = time.time()
        for attempt in range(retries + 1):
            try:
                resp = requests.post(url, headers=headers, data=None, json=payload, timeout=self.timeout)
                self.calls += 1
                if resp.status_code != 200:
                    last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
                    if resp.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    break
                data = resp.json()
                msg = (data.get("choices") or [{}])[0].get("message", {}) or {}
                content = (msg.get("content") or "").strip()
                reasoning = (msg.get("reasoning_content") or "").strip()
                self.total_elapsed += time.time() - started
                return ChatResult(
                    ok=bool(content),
                    content=content,
                    reasoning=reasoning,
                    raw=content or reasoning,
                    elapsed=time.time() - started,
                    usage=data.get("usage") or {},
                )
            except requests.RequestException as e:  # noqa: BLE001
                last_err = f"网络错误：{e}"
                if attempt < retries:
                    time.sleep(1.0 * (attempt + 1))
                    continue
            except Exception as e:  # noqa: BLE001
                last_err = f"调用异常：{e}"
                break
        self.errors += 1
        self.total_elapsed += time.time() - started
        return ChatResult(ok=False, error=last_err or "未知错误", elapsed=time.time() - started)
