"""「AI 托管 / 玩家接管」混成模块。

做成 mixin 而不是直接改 TownApp，是为了把「托管」这套逻辑集中在一个文件里，
需要的状态（game / _run_bg / _append / _refresh_all / _set_choices / btn_next）由 app.py 提供。

玩法：
  * 点「AI 托管」→ 镇长交给 AI：NPC 自主行动、AI 每天做决定、事件自动裁决、一天天往前走；
  * 玩家任何时候在输入框写一句并回车 → **立即接管**（这一步 AI 做完就交给你）；
  * 点「■ 接管」按钮 → 停止托管，回到手动模式。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import theme as T


class AutoHostMixin:
    """给 TownApp 混入 AI 托管能力。"""

    #: 每一步之间停多久（毫秒），让玩家看得清
    AUTOPILOT_DELAY_MS = 1500

    def _init_autopilot(self, policy: str = "auto") -> None:
        self.autopilot_mode = False
        self.autopilot_policy = policy
        self._pilot = None
        self._autopilot_after: Optional[str] = None
        self._takeover_text: str = ""
        self._takeover_pending = False

    # ------------------------------------------------------------------
    # 开关
    # ------------------------------------------------------------------
    def _toggle_autopilot(self) -> None:
        if self.autopilot_mode:
            self._stop_autopilot("玩家接管")
        else:
            self._start_autopilot()

    def _start_autopilot(self) -> None:
        self.autopilot_mode = True
        self._takeover_pending = False
        self._takeover_text = ""
        self._update_autopilot_ui()
        policy_txt = "LLM 决策（失败自动回落规则）" if self.autopilot_policy != "rule" else "纯规则"
        self._append(
            f"【AI 托管】镇长交给 AI 代理（{policy_txt}）。NPC 会自主行动，AI 每天做决定、"
            f"自动裁决事件、日子一天天往前走。\n"
            f"你随时可以在下面输入一句行动直接接管，或点右侧「■ 接管」按钮收回指挥权。",
            "day",
        )
        self._autopilot_tick()

    def _stop_autopilot(self, reason: str = "") -> None:
        was_on = self.autopilot_mode or self._autopilot_after is not None
        self.autopilot_mode = False
        if self._autopilot_after is not None:
            try:
                self.after_cancel(self._autopilot_after)
            except Exception:
                pass
            self._autopilot_after = None
        self._update_autopilot_ui()
        if was_on and reason:
            self._append(f"【{reason}】AI 托管已停止，镇长由你接手。", "speaker")

    def _update_autopilot_ui(self) -> None:
        btn = getattr(self, "btn_auto", None)
        if btn is not None:
            try:
                if self.autopilot_mode:
                    btn.configure(text="■ 接管", bg=T.BAD, fg="#1d1a17",
                                  activebackground=T.BAD, activeforeground="#1d1a17")
                else:
                    btn.configure(text="AI 托管", bg=T.BG_CARD, fg=T.FG,
                                  activebackground=T.ACCENT_SOFT, activeforeground=T.FG)
            except Exception:
                pass
        nxt = getattr(self, "btn_next", None)
        if nxt is not None:
            try:
                nxt.configure(state="disabled" if self.autopilot_mode else "normal")
            except Exception:
                pass

    def _set_autopilot_policy(self, policy: str) -> None:
        self.autopilot_policy = policy
        self._pilot = None
        txt = "纯规则（离线可用）" if policy == "rule" else "LLM 决策（失败回落规则）"
        self._append(f"托管策略切换为：{txt}", "system")
        if self.autopilot_mode:
            self._update_autopilot_ui()

    # ------------------------------------------------------------------
    # 托管主循环
    # ------------------------------------------------------------------
    def _autopilot_tick(self) -> None:
        self._autopilot_after = None
        if not self.autopilot_mode:
            return
        if getattr(self, "busy", False):
            self._autopilot_after = self.after(300, self._autopilot_tick)
            return
        if getattr(self.game.state, "over", False):
            self._stop_autopilot("本局已结束")
            return
        self._run_bg(self._autopilot_one_step, self._on_autopilot_step, "AI 托管中…")
        # 托管期间输入框保持可用：玩家随时可以接管
        entry = getattr(self, "entry", None)
        if entry is not None:
            try:
                entry.configure(state="normal")
            except Exception:
                pass

    def _autopilot_one_step(self) -> Any:
        """后台线程里跑：注入 NPC 自主事件 + AI 决策 + 裁事件 + 行动 + 推进一天。"""
        from ..agents.autopilot import Autopilot
        from ..autoplay import inject_npc_events

        state = self.game.state
        if self._pilot is None or getattr(self._pilot, "game", None) is not self.game:
            self._pilot = Autopilot(self.game, policy=self.autopilot_policy)
        inject_npc_events(self.game, state.rng.spawn(f"uihost-{state.day}-{len(state.memory)}"))
        return self._pilot.step()

    def _on_autopilot_step(self, entry: Dict[str, Any]) -> None:
        st = self.game.state
        self._append(f"—— 第{entry.get('day')}天 · {entry.get('season')}季 · "
                     f"{entry.get('weather')}（AI 托管）——", "day")
        for ev in entry.get("events", []) or []:
            ch = "，".join(ev.get("changes") or []) or "无变化"
            self._append(f"【{ev.get('title')}】▸ {ev.get('choice')} → {ch}", "system")
        self._append(f"AI 镇长：{entry.get('decision', '')}", "speaker")
        if entry.get("why"):
            self._append(f"　理由：{entry['why']}", "system")
        if entry.get("narrative"):
            self._append(entry["narrative"], "story")
        if entry.get("choice"):
            ch = "，".join(entry.get("changes") or []) or "无变化"
            self._append(f"　▸ {entry['choice']} → {ch}", "change")
        notes = entry.get("notes") or []
        if notes:
            self._append(f"　结算：{'；'.join(notes)}", "system")
        self._set_choices([])
        self._refresh_all()

        # 玩家刚才要求接管 → 这一步做完就交回去
        if self._takeover_pending:
            text = self._takeover_text
            self._takeover_pending = False
            self._takeover_text = ""
            self._run_player_action(text)
            return

        if st.over:
            self._stop_autopilot("本局已结束")
            return
        if self.autopilot_mode:
            self._autopilot_after = self.after(self.AUTOPILOT_DELAY_MS, self._autopilot_tick)

    # ------------------------------------------------------------------
    # 玩家接管
    # ------------------------------------------------------------------
    def _takeover(self, text: str) -> None:
        """玩家在托管中输入了行动 → 收回指挥权。"""
        self._takeover_text = text
        entry = getattr(self, "entry", None)
        if entry is not None:
            try:
                entry.delete(0, "end")
            except Exception:
                pass
        self._stop_autopilot("玩家接管")
        if getattr(self, "busy", False):
            self._takeover_pending = True
            self._append("（AI 正在收尾这一步，马上交给你。）", "system")
            return
        self._run_player_action(text)

    def _run_player_action(self, text: str) -> None:
        self._append(f"▸ 你决定：{text}", "speaker")
        self._set_choices([])
        self._run_bg(lambda: self.game.do_action(text), self._on_action_done, "世界正在回应…")
