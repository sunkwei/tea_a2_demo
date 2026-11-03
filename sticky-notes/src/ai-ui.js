/**
 * 便笺 · AI 交互层
 *
 * 依赖 window.StickyCore（core.js）与 window.StickyAI（ai.js），
 * 由 app.js 在启动后调用 StickyAIUI.init(api) 注入应用侧能力。
 *
 * 提供：
 *   · 编辑器内：✨ AI 归类 / ⏰ AI 建议提醒时间
 *   · AI 面板：💬 问便笺 / 📝 长文拆条 / 🌐 联网整理
 */
(function (root) {
  'use strict';

  const C = root.StickyCore;
  const AI = root.StickyAI;
  let api = null;

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));

  let lastAskNotes = [];
  let aiModelOptions = [];

  /* ------------------------------------------------------------------ *
   * 基础
   * ------------------------------------------------------------------ */

  function aiSettings() {
    const s = (api && api.getSettings()) || {};
    return Object.assign(
      { enabled: false, base: AI.DEFAULT_BASE, model: '', timeoutMs: AI.DEFAULT_TIMEOUT, thinking: 'auto' },
      s.ai || {}
    );
  }

  function aiEnabled() {
    return !!aiSettings().enabled;
  }

  function guard() {
    if (aiEnabled()) return true;
    api.toast('AI 增强未启用：请到「⚙ 设置 → AI 增强」里打开开关', 'warn', 6000);
    const st = $('#settings-modal');
    if (st) st.hidden = false;
    return false;
  }

  async function aiChat(prompt, extra) {
    const s = aiSettings();
    const opts = Object.assign(
      {
        base: s.base,
        model: s.model,
        timeoutMs: s.timeoutMs,
        thinking: s.thinking,
        prompt,
        maxTokens: AI.DEFAULT_MAX_TOKENS,
      },
      extra || {}
    );
    return AI.chat(opts);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  function setStatus(text, cls) {
    const el = $('#ai-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'hint' + (cls ? ' ' + cls : '');
  }

  /** 按钮 loading 包装 */
  async function withBusy(btn, label, fn) {
    if (!btn) return fn();
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /* ------------------------------------------------------------------ *
   * 编辑器：AI 归类
   * ------------------------------------------------------------------ */

  function applyCategory(cat) {
    const sel = $('#nm-cat');
    if (!sel) return;
    let opt = $$('option', sel).find((o) => o.value === cat);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      sel.appendChild(opt);
    }
    sel.value = cat;
    const custom = $('#nm-cat-new');
    if (custom) custom.value = '';
    if (api && api.refreshCategoryHint) api.refreshCategoryHint();
  }

  async function aiCategorize() {
    if (!guard()) return;
    const text = $('#nm-text').value.trim();
    if (!text) {
      api.toast('先写点内容再让 AI 归类', 'warn');
      return;
    }
    const btn = $('#nm-ai-cat');
    await withBusy(btn, '思考中…', async () => {
      try {
        const r = await aiChat(AI.buildCategorizePrompt(text, api.categories(), Date.now()));
        const parsed = AI.parseCategorize(r.content, api.categories());
        if (!parsed) throw new Error('模型没返回可解析的 JSON');
        applyCategory(parsed.category);
        const hint = $('#nm-cat-hint');
        if (hint) {
          const kws = parsed.keywords.length ? `（命中「${parsed.keywords.join('、')}」）` : '';
          hint.textContent = `AI 建议「${parsed.category}」${kws}${parsed.reason ? '：' + parsed.reason : ''}`;
          hint.className = 'hint';
        }
        api.toast(`✨ AI 归类：${parsed.category}`, 'ok');
      } catch (e) {
        api.toast('AI 归类失败：' + (e.message || e), 'err', 7000);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 编辑器：AI 建议提醒时间
   * ------------------------------------------------------------------ */

  async function aiSuggestTime() {
    if (!guard()) return;
    const text = $('#nm-text').value.trim();
    if (!text) {
      api.toast('先写点内容再让 AI 找时间', 'warn');
      return;
    }
    const btn = $('#nm-ai-time');
    await withBusy(btn, '找时间中…', async () => {
      try {
        const r = await aiChat(AI.buildTimePrompt(text, Date.now()));
        const t = AI.parseTime(r.content);
        if (!t || !t.hasTime) {
          api.toast('这条便笺里没找到明确的时间', 'warn');
          return;
        }
        const at = $('#nm-remind-at');
        at.value = C.toLocalInputValue(t.at);
        const cb = $('#nm-remind');
        cb.checked = true;
        at.disabled = false;
        api.toast(
          `⏰ AI 建议：${t.text || C.formatDateTime(t.at)} → ${C.formatDateTime(t.at)} 提醒` +
            (t.reason ? `（${t.reason}）` : ''),
          'ok',
          7000
        );
      } catch (e) {
        api.toast('AI 时间建议失败：' + (e.message || e), 'err', 7000);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * AI 面板
   * ------------------------------------------------------------------ */

  function openAI() {
    if (!guard()) return;
    $('#ai-modal').hidden = false;
    setStatus(aiSettings().model ? `模型：${aiSettings().model}` : '用服务端默认模型');
    const q = $('#ai-ask-q');
    if (q) q.focus();
  }

  function switchTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== name));
  }

  /* --------------------------- 问便笺 --------------------------- */

  async function runAsk() {
    if (!guard()) return;
    const q = $('#ai-ask-q').value.trim();
    if (!q) {
      api.toast('先写下你的问题', 'warn');
      return;
    }
    const out = $('#ai-ask-out');
    out.innerHTML = '<div class="ai-busy">思考中…</div>';
    const notes = api.visibleNotes();
    lastAskNotes = notes;
    try {
      const r = await aiChat(AI.buildAskPrompt(q, AI.notesToContext(notes), Date.now()));
      const ans = AI.parseAnswer(r.content);
      if (!ans) throw new Error('模型没返回可解析的结果');
      let html = `<div class="ai-answer">${esc(ans.answer).replace(/\[(\d+)\]/g, (m, n) => {
        const idx = Number(n) - 1;
        const ok = idx >= 0 && idx < notes.length;
        return ok ? `<a href="#" class="ai-ref" data-idx="${idx}">[${n}]</a>` : m;
      })}</div>`;
      if (ans.refs && ans.refs.length) {
        html +=
          '<div class="ai-refs">来源：' +
          ans.refs
            .filter((n) => n >= 1 && n <= notes.length)
            .map((n) => `<a href="#" class="ai-ref" data-idx="${n - 1}">[${n}] ${esc((notes[n - 1] || {}).text || '').slice(0, 28)}</a>`)
            .join(' ') +
          '</div>';
      }
      if (ans.notes && ans.notes.length) {
        html +=
          '<div class="ai-sub">建议记下的点：</div><ul class="ai-list">' +
          ans.notes.map((t) => `<li>${esc(t)}</li>`).join('') +
          '</ul>';
      }
      const effortLabel =
        r.reasoning_effort === 'none'
          ? 'none（不思考）'
          : r.reasoning_effort === 'auto' || !r.reasoning_effort
          ? 'auto'
          : r.reasoning_effort;
      html += `<div class="ai-meta">${esc(r.model || '')} · 思考档位 ${esc(effortLabel)} · ${r.elapsed_ms || 0} ms</div>`;
      out.innerHTML = html;
    } catch (e) {
      out.innerHTML = `<div class="ai-error">AI 提问失败：${esc(e.message || e)}</div>`;
    }
  }

  /* --------------------------- 长文拆条 --------------------------- */

  function renderNoteSuggestions(list, outEl) {
    if (!list.length) {
      outEl.innerHTML = '<div class="ai-error">没有解析出可用的便笺</div>';
      return;
    }
    outEl.innerHTML =
      '<ul class="ai-list pick">' +
      list
        .map(
          (n, i) =>
            `<li><label class="check"><input type="checkbox" checked data-idx="${i}" /> ` +
            `<span class="ai-pick-text">${esc(n.text)}</span></label>` +
            `<span class="ai-tag">${esc(n.category)}</span>` +
            (n.remind_at ? `<span class="ai-tag time">⏰ ${esc(C.formatDateTime(n.remind_at))}</span>` : '') +
            (n.source ? `<span class="ai-src">${esc(n.source)}</span>` : '') +
            '</li>'
        )
        .join('') +
      '</ul>' +
      '<div class="row"><button class="btn primary" data-act="save-picked">💾 保存勾选的为便笺</button>' +
      '<button class="btn" data-act="save-all">全部保存</button></div>';
  }

  function savePicked(list, outEl, onlyChecked) {
    const boxes = $$('input[type=checkbox][data-idx]', outEl);
    const picked = [];
    list.forEach((n, i) => {
      const box = boxes.find((b) => Number(b.dataset.idx) === i);
      if (onlyChecked && (!box || !box.checked)) return;
      picked.push(n);
    });
    if (!picked.length) {
      api.toast('没有勾选任何一条', 'warn');
      return;
    }
    const created = api.saveNotes(picked);
    api.toast(`已保存 ${created} 条便笺`, 'ok');
  }

  async function runSummarize() {
    if (!guard()) return;
    const text = $('#ai-sum-text').value.trim();
    if (!text) {
      api.toast('先粘贴一段材料', 'warn');
      return;
    }
    const out = $('#ai-sum-out');
    out.innerHTML = '<div class="ai-busy">拆解中…</div>';
    try {
      const r = await aiChat(AI.buildSummarizePrompt(text, api.categories(), Date.now()));
      const list = AI.parseNotes(r.content, api.categories());
      renderNoteSuggestions(list, out);
      out.dataset.list = JSON.stringify(list);
    } catch (e) {
      out.innerHTML = `<div class="ai-error">AI 拆解失败：${esc(e.message || e)}</div>`;
    }
  }

  /* --------------------------- 联网整理 --------------------------- */

  async function runSearch() {
    if (!guard()) return;
    const q = $('#ai-search-q').value.trim();
    if (!q) {
      api.toast('先写下想查什么', 'warn');
      return;
    }
    const out = $('#ai-search-out');
    out.innerHTML = '<div class="ai-busy">联网搜索中…（可能需要几十秒）</div>';
    try {
      const r = await aiChat(AI.buildSearchPrompt(q, api.categories(), Date.now()), { webTools: true });
      const list = AI.parseNotes(r.content, api.categories());
      renderNoteSuggestions(list, out);
      out.dataset.list = JSON.stringify(list);
      const calls = r.web_tool_calls || [];
      if (calls.length) {
        out.insertAdjacentHTML(
          'afterbegin',
          `<div class="ai-meta">联网工具调用 ${calls.length} 次：${esc(
            calls.map((c) => c.tool || '').join('、')
          )}</div>`
        );
      }
    } catch (e) {
      out.innerHTML = `<div class="ai-error">联网整理失败：${esc(e.message || e)}</div>`;
    }
  }

  /* ------------------------------------------------------------------ *
   * 连接状态
   * ------------------------------------------------------------------ */

  async function testAI() {
    const out = $('#ai-conn');
    if (out) out.textContent = '连接中…';
    const s = aiSettings();
    const r = await AI.testConnection(s.base);
    if (!out) return;
    if (!r.ok) {
      out.innerHTML = `<span style="color:var(--danger)">✗ ${esc(r.error)}</span>`;
      api.toast('连不上 ' + s.base + '，请确认 tea_a2 已启动', 'err', 7000);
      return;
    }
    out.innerHTML =
      `✓ 已连接 tea_a2 <b>v${esc(r.version)}</b>，当前模型 <b>${esc(r.model)}</b>（${esc(r.provider)}）` +
      `<br />可用 provider：${esc(r.models.map((m) => m.provider + '/' + m.model).join('、'))}`;
    refreshModelOptions(r.models);
    api.toast('AI 连接正常', 'ok');
  }

  function refreshModelOptions(models) {
    aiModelOptions = models || [];
    const sel = $('#set-ai-model');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML =
      '<option value="">（用服务端默认）</option>' +
      aiModelOptions
        .map((m) => `<option value="${esc(m.model)}">${esc(m.provider)} / ${esc(m.model)}</option>`)
        .join('');
    if (cur) sel.value = cur;
  }

  /* ------------------------------------------------------------------ *
   * 初始化
   * ------------------------------------------------------------------ */

  function init(injected) {
    api = injected;

    // 顶栏
    const btnAI = $('#btn-ai');
    if (btnAI) btnAI.addEventListener('click', openAI);

    // 编辑器里的两个按钮
    const b1 = $('#nm-ai-cat');
    if (b1) b1.addEventListener('click', aiCategorize);
    const b2 = $('#nm-ai-time');
    if (b2) b2.addEventListener('click', aiSuggestTime);

    // AI 面板
    $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    const runAskBtn = $('#ai-ask-run');
    if (runAskBtn) runAskBtn.addEventListener('click', runAsk);
    const sumBtn = $('#ai-sum-run');
    if (sumBtn) sumBtn.addEventListener('click', runSummarize);
    const searchBtn = $('#ai-search-run');
    if (searchBtn) searchBtn.addEventListener('click', runSearch);

    // 面板里的保存按钮（事件委托）
    document.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'save-picked' || act.dataset.act === 'save-all') {
        e.preventDefault();
        const out = act.closest('.ai-out');
        let list = [];
        try {
          list = JSON.parse(out.dataset.list || '[]');
        } catch (err) {
          list = [];
        }
        savePicked(list, out, act.dataset.act === 'save-picked');
      }
      const ref = e.target.closest('.ai-ref');
      if (ref) {
        e.preventDefault();
        focusNote(Number(ref.dataset.idx));
      }
    });

    // 设置里的 AI 区块
    const setAi = $('#set-ai');
    if (setAi) {
      setAi.addEventListener('change', () => {
        api.saveSettings({ ai: Object.assign(aiSettings(), { enabled: setAi.checked }) });
        api.toast(setAi.checked ? 'AI 增强已启用' : 'AI 增强已关闭（完全离线）');
      });
    }
    const setBase = $('#set-ai-base');
    if (setBase) {
      setBase.addEventListener('change', () => {
        api.saveSettings({ ai: Object.assign(aiSettings(), { base: AI.normalizeBase(setBase.value) }) });
        setBase.value = aiSettings().base;
      });
    }
    const setModel = $('#set-ai-model');
    if (setModel) {
      setModel.addEventListener('change', () => {
        api.saveSettings({ ai: Object.assign(aiSettings(), { model: setModel.value }) });
      });
    }
    const setTimeoutEl = $('#set-ai-timeout');
    if (setTimeoutEl) {
      setTimeoutEl.addEventListener('change', () => {
        const sec = Math.max(5, Math.min(600, Math.round(Number(setTimeoutEl.value) || 45)));
        setTimeoutEl.value = sec;
        api.saveSettings({ ai: Object.assign(aiSettings(), { timeoutMs: sec * 1000 }) });
      });
    }
    const setThinking = $('#set-ai-thinking');
    if (setThinking) {
      setThinking.addEventListener('change', () => {
        api.saveSettings({ ai: Object.assign(aiSettings(), { thinking: setThinking.value }) });
        api.toast('思考强度：' + (setThinking.value === 'auto' ? '自动（按模型能力降级）' : setThinking.value === 'none' ? '不思考' : '允许思考'));
      });
    }
    const btnTest = $('#btn-ai-test');
    if (btnTest) btnTest.addEventListener('click', testAI);

    // 隐私说明
    const priv = $('#ai-privacy');
    if (priv) {
      priv.textContent = aiEnabled()
        ? `AI 已启用：便笺内容会发送到 ${aiSettings().base} 的模型 provider`
        : 'AI 未启用：本应用完全离线';
    }
  }

  /** 从设置面板打开时同步一次 AI 相关控件 */
  function syncSettingsUi() {
    const s = aiSettings();
    const setAi = $('#set-ai');
    if (setAi) setAi.checked = !!s.enabled;
    const setBase = $('#set-ai-base');
    if (setBase) setBase.value = s.base;
    const setModel = $('#set-ai-model');
    if (setModel) setModel.value = s.model || '';
    const setTimeoutEl = $('#set-ai-timeout');
    if (setTimeoutEl) setTimeoutEl.value = Math.round((s.timeoutMs || AI.DEFAULT_TIMEOUT) / 1000);
    const setThinking = $('#set-ai-thinking');
    if (setThinking) setThinking.value = s.thinking || 'auto';
    const priv = $('#ai-privacy');
    if (priv) {
      priv.textContent = s.enabled
        ? `AI 已启用：便笺内容会发送到 ${s.base} 的模型 provider`
        : 'AI 未启用：本应用完全离线';
    }
  }

  /** 跳到某条便笺并高亮 */
  function focusNote(idx) {
    const n = lastAskNotes[idx];
    if (!n) return;
    const card = document.querySelector(`.note[data-id="${CSS.escape(n.id)}"]`);
    if (!card) {
      api.toast('那条便笺已被过滤掉了', 'warn');
      return;
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1600);
  }

  root.StickyAIUI = { init, syncSettingsUi, openAI, testAI, focusNote };
})(typeof globalThis !== 'undefined' ? globalThis : window);
