"""容错 JSON 解析。

小模型经常吐出坏 JSON（漏冒号、尾逗号、字符串没闭合、把 JSON 夹在解释文字里）。
这里做四层兜底：
  1. 去掉 ```json 代码围栏；
  2. 直接 json.loads；
  3. 扫描出配平的 {...} / [...] 片段再 loads（取最长的能解析的那个）；
  4. 自写的容错解析器（容忍裸键名、漏冒号、未闭合字符串）。
另外还提供 ``extract_int`` 这种「从自由文本里捞数字」的正则兜底。
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.S)


def _strip_fences(text: str) -> str:
    m = _FENCE.search(text)
    if m:
        return m.group(1).strip()
    return text.strip()


def _balanced_fragments(text: str) -> List[str]:
    """扫描出所有括号配平的 JSON 片段（忽略字符串里的括号）。"""
    out: List[str] = []
    stack: List[str] = []
    start = -1
    in_str = False
    esc = False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch in "{[":
            if not stack:
                start = i
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                continue
            open_ch = stack.pop()
            if (open_ch, ch) not in (("{", "}"), ("[", "]")):
                # 括号类型不匹配，直接放弃这一段
                stack = []
                start = -1
                continue
            if not stack and start >= 0:
                out.append(text[start : i + 1])
                start = -1
    return out


def _repair(text: str) -> str:
    """常见坏 JSON 的轻量修复。"""
    t = text.strip()
    # 去掉尾逗号
    t = re.sub(r",\s*([}\]])", r"\1", t)
    # 对象之间漏逗号
    t = re.sub(r"}\s*{", "},{", t)
    t = re.sub(r"]\s*\[", "],[", t)
    # 键名漏冒号：{"a" 1} -> {"a": 1}
    t = re.sub(r'"([^"\n]+)"\s+(?=["\[{]|[\d\-tfn])', r'"\1": ', t)
    return t


def _tolerant_loads(text: str) -> Optional[Any]:
    """自写容错 JSON 解析器：容忍裸键名、漏冒号、未闭合字符串。"""
    s = text
    pos = 0
    n = len(s)

    def skip_ws() -> None:
        nonlocal pos
        while pos < n and s[pos] in " \t\r\n":
            pos += 1

    def parse_string() -> str:
        nonlocal pos
        if pos < n and s[pos] == '"':
            pos += 1
            buf = []
            while pos < n:
                ch = s[pos]
                if ch == "\\" and pos + 1 < n:
                    nxt = s[pos + 1]
                    mapping = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/"}
                    buf.append(mapping.get(nxt, nxt))
                    pos += 2
                    continue
                if ch == '"':
                    pos += 1
                    return "".join(buf)
                buf.append(ch)
                pos += 1
            return "".join(buf)  # 未闭合：就当到结尾

        # 单引号字符串
        if pos < n and s[pos] == "'":
            pos += 1
            buf = []
            while pos < n and s[pos] != "'":
                buf.append(s[pos])
                pos += 1
            if pos < n:
                pos += 1
            return "".join(buf)
        return ""

    def parse_value() -> Any:
        nonlocal pos
        skip_ws()
        if pos >= n:
            return None
        ch = s[pos]
        if ch == "{":
            return parse_obj()
        if ch == "[":
            return parse_arr()
        if ch == '"' or ch == "'":
            return parse_string()
        # 数字 / 关键字
        start = pos
        while pos < n and s[pos] not in ",}] \t\r\n":
            pos += 1
        token = s[start:pos].strip()
        low = token.lower()
        if low in ("true", "yes"):
            return True
        if low in ("false", "no"):
            return False
        if low in ("null", "none", ""):
            return None
        try:
            if "." in token:
                return float(token)
            return int(token)
        except ValueError:
            return token

    def parse_obj() -> Dict[str, Any]:
        nonlocal pos
        obj: Dict[str, Any] = {}
        pos += 1  # {
        while True:
            skip_ws()
            if pos >= n:
                break
            if s[pos] == "}":
                pos += 1
                break
            if s[pos] == ",":
                pos += 1
                continue
            if s[pos] == '"' or s[pos] == "'":
                key = parse_string()
            else:
                start = pos
                while pos < n and s[pos] not in ":,}\n":
                    pos += 1
                key = s[start:pos].strip()
            skip_ws()
            if pos < n and s[pos] == ":":
                pos += 1
                value = parse_value()
            else:
                # 漏冒号：下一个非空 token 当值
                save = pos
                skip_ws()
                if pos < n and s[pos] not in ",}":
                    value = parse_value()
                else:
                    pos = save
                    value = None
            obj[key] = value
        return obj

    def parse_arr() -> List[Any]:
        nonlocal pos
        arr: List[Any] = []
        pos += 1  # [
        while True:
            skip_ws()
            if pos >= n:
                break
            if s[pos] == "]":
                pos += 1
                break
            if s[pos] == ",":
                pos += 1
                continue
            arr.append(parse_value())
        return arr

    try:
        val = parse_value()
        skip_ws()
        return val
    except Exception:  # noqa: BLE001
        return None


def extract_json(text: str) -> Optional[Any]:
    """从任意文本里抽出第一个能解析出来的 JSON 值。"""
    if not text:
        return None
    candidates: List[str] = []
    stripped = _strip_fences(text)
    candidates.append(stripped)
    candidates.extend(_balanced_fragments(stripped))
    for frag in _balanced_fragments(text):
        candidates.append(frag)

    # 第一层：直接 loads
    for cand in candidates:
        cand = cand.strip()
        if not cand:
            continue
        try:
            return json.loads(cand)
        except Exception:  # noqa: BLE001
            pass
    # 第二层：修复后 loads
    for cand in candidates:
        fixed = _repair(cand)
        if not fixed:
            continue
        try:
            return json.loads(fixed)
        except Exception:  # noqa: BLE001
            pass
    # 第三层：容错解析器
    for cand in candidates:
        val = _tolerant_loads(cand)
        if isinstance(val, (dict, list)):
            return val
    return None


def extract_int(text: str, keys: Optional[List[str]] = None) -> Optional[int]:
    """从自由文本里捞一个整数（模型不吐 JSON 时的最后兜底）。"""
    if not text:
        return None
    keys = keys or ["n", "action", "index", "i", "choice", "编号", "动作"]
    for k in keys:
        m = re.search(rf'["\']?{re.escape(k)}["\']?\s*[:：=]\s*(\d+)', text)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                continue
    m = re.search(r"第?\s*(\d+)\s*(?:个|号|项|步)", text)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    return None


def extract_str(text: str, keys: Optional[List[str]] = None) -> str:
    """从自由文本里捞一句话（台词）。"""
    keys = keys or ["say", "taunt", "line", "台词", "说"]
    for k in keys:
        m = re.search(rf'["\']?{re.escape(k)}["\']?\s*[:：=]\s*["\']([^"\']{{1,80}})["\']', text)
        if m:
            return m.group(1).strip()
    for k in keys:
        # 没有引号的值：只取到标点为止
        m = re.search(rf'["\']?{re.escape(k)}["\']?\s*[:：]\s*([^\n。！？，,;；]{{1,40}})', text)
        if m:
            return m.group(1).strip()
    return ""
