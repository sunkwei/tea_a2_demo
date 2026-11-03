/*
 * 后台脚本：所有跨域请求都放在这里做（内容脚本不直接连 tea_a2）。
 */
(function () {
  'use strict';

  const ext = globalThis.browser || globalThis.chrome;
  const Core = globalThis.TeaCore;
  const SETTINGS_KEY = 'settings';

  // ────────────────────────── 设置存取 ──────────────────────────

  async function getSettings() {
    const data = await ext.storage.local.get(SETTINGS_KEY);
    return Core.normalizeSettings(data && data[SETTINGS_KEY]);
  }

  async function saveSettings(settings) {
    const clean = Core.normalizeSettings(settings);
    await ext.storage.local.set({ [SETTINGS_KEY]: clean });
    return clean;
  }

  // ────────────────────────── tea_a2 调用 ──────────────────────────

  // 有些模型不收某个思考强度：minimax 拒 none、mimo 拒 minimal/xhigh/max。
  // 这类报错就沿阶梯换一个档位重试，并记住这个 provider/model 能用哪一档。
  const effortChoice = new Map();
  let effortLoaded = false;

  async function loadEffortChoice() {
    if (effortLoaded) return;
    effortLoaded = true;
    try {
      const data = await ext.storage.local.get('effortChoice');
      if (data && data.effortChoice && typeof data.effortChoice === 'object') {
        for (const k of Object.keys(data.effortChoice)) effortChoice.set(k, data.effortChoice[k]);
      }
    } catch (e) {
      /* 没有就算了 */
    }
  }

  async function saveEffortChoice() {
    try {
      const obj = {};
      for (const [k, v] of effortChoice) obj[k] = v;
      await ext.storage.local.set({ effortChoice: obj });
    } catch (e) {
      /* 存不住也只是下次再试一次 */
    }
  }

  async function chat(body, settings, tried) {
    const s = Core.normalizeSettings(settings);
    await loadEffortChoice();
    const key = (body.provider || s.provider) + '/' + (body.model || s.model);
    const payload = Object.assign({}, body);
    const chosen = effortChoice.get(key);
    if (chosen === 'omit') delete payload.reasoning_effort;
    else if (chosen) payload.reasoning_effort = chosen;
    const url = s.apiBase + '/api/llm/chat';
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error('连不上 tea_a2（' + url + '）：' + (e && e.message ? e.message : e));
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      /* 非 JSON，后面统一当错误处理 */
    }
    if (!res.ok || !data || data.error) {
      const msg = data && data.error ? data.error.message || data.error.code : text.slice(0, 300);
      const used = tried || [];
      if (payload.reasoning_effort && used.length < 3 && Core.isReasoningError(msg)) {
        const next = Core.nextEffort(payload.reasoning_effort, used);
        if (next) {
          effortChoice.set(key, next);
          await saveEffortChoice();
          const again = await chat(payload, s, used.concat([payload.reasoning_effort]));
          again.effortFallback =
            payload.reasoning_effort + ' → ' + (next === 'omit' ? '不指定' : next);
          return again;
        }
      }
      throw new Error('tea_a2 返回错误：' + msg);
    }
    return data;
  }

  // ────────────────────────── 搜索 ──────────────────────────

  async function fetchSearchResults(query, settings) {
    const s = Core.normalizeSettings(settings);
    const engine = Core.ENGINES[s.searchEngine] || Core.ENGINES.bing;
    if (!engine.parse) return { results: [], url: Core.buildSearchUrl(query, s) };
    const url = Core.buildSearchFetchUrl(query, s) || Core.buildSearchUrl(query, s);
    if (!url) return { results: [], url: '' };
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      const results = Core.parseSearchResults(html, s.searchEngine);
      return { results, url };
    } catch (e) {
      return { results: [], url, error: String(e && e.message ? e.message : e) };
    }
  }

  async function runSearch(text, settings) {
    const s = Core.normalizeSettings(settings);
    const query = String(text || '').trim();
    const useExtension = s.searchMode !== 'api';
    let results = [];
    let error = '';
    const url = Core.buildSearchUrl(query, s);
    if (useExtension) {
      const fetched = await fetchSearchResults(query, s);
      results = fetched.results;
      error = fetched.error || '';
    }

    if (!s.searchAiSummary) {
      return {
        ok: true,
        task: 'search',
        content: results.length ? '已抓到 ' + results.length + ' 条搜索结果。' : '已准备打开搜索结果页。',
        results,
        openUrl: url,
        note: error ? '抓取搜索结果失败（' + error + '），已改为直接打开搜索页。' : '',
      };
    }

    const body = Core.buildSearchBody(query, results, s);
    let data = await chat(body, s);
    // 上游把内部工具调用/搜索计划当正文吐出来时，换个问法再试（最多两次）
    for (const form of [1, 2]) {
      if (!Core.hasSearchArtifact(data.content)) break;
      try {
        const again = await chat(Core.buildSearchBody(query, results, s, { form }), s);
        if (again && again.content && !Core.hasSearchArtifact(again.content)) {
          data = again;
          break;
        }
        if (again && again.content) data = again;
      } catch (e) {
        /* 保持上一次的结果 */
      }
    }
    const content = Core.cleanSearchArtifacts(data.content || '');
    return {
      ok: true,
      task: 'search',
      content,
      reasoning: data.reasoning || '',
      results,
      openUrl: url,
      usage: data.usage || null,
      note:
        (error ? '扩展抓取搜索结果失败（' + error + '），已改用接口作答。' : '') +
        (Core.hasSearchArtifact(data.content)
          ? '（tea_a2 这次只返回了搜索工具调用、没有执行；可在设置里把「搜索方式」改成 extension）'
          : '') +
        (data.effortFallback
          ? '这个模型不接受思考强度「' + data.effortFallback.split(' → ')[0] + '」，已自动降到「' +
            data.effortFallback.split(' → ')[1] + '」。'
          : ''),
    };
  }

  // ────────────────────────── 三个任务 ──────────────────────────

  async function runTask(task, text, settings) {
    const s = Core.normalizeSettings(settings);
    if (task === 'search') return runSearch(text, s);

    const body = Core.buildChatBody(task, text, s);
    const data = await chat(body, s);
    return {
      ok: true,
      task,
      note: data.effortFallback
        ? '这个模型不接受思考强度「' + data.effortFallback.split(' → ')[0] + '」，已自动降到「' +
          data.effortFallback.split(' → ')[1] + '」。'
        : '',
      content: data.content || '',
      reasoning: data.reasoning || '',
      usage: data.usage || null,
      elapsed_ms: data.elapsed_ms,
      provider: data.provider || body.provider,
      model: data.model || body.model,
    };
  }

  // ────────────────────────── 消息路由 ──────────────────────────

  async function handle(msg) {
    switch (msg && msg.type) {
      case 'getSettings':
        return { ok: true, settings: await getSettings() };

      case 'saveSettings':
        return { ok: true, settings: await saveSettings(msg.settings) };

      case 'run':
        return runTask(msg.task, msg.text, await getSettings());

      case 'providers': {
        const s = await getSettings();
        const res = await fetch(s.apiBase + '/api/providers');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return { ok: true, providers: await res.json() };
      }

      case 'test': {
        const s = await getSettings();
        const body = {
          provider: s.provider,
          model: s.model,
          stream: false,
          messages: [{ role: 'user', content: '只回复：连接成功' }],
        };
        const data = await chat(body, s);
        return { ok: true, content: data.content || '', providers: null };
      }

      case 'openOptions':
        await ext.tabs.create({ url: ext.runtime.getURL('src/options.html') });
        return { ok: true };
      case 'openUrl':
        if (msg.url) await ext.tabs.create({ url: msg.url, active: true });
        return { ok: true };

      default:
        return { ok: false, error: '未知消息：' + (msg && msg.type) };
    }
  }

  // keep-alive 连接：只要页面还开着，就别回收这个事件页
  if (ext.runtime.onConnect) {
    ext.runtime.onConnect.addListener((port) => {
      if (port.name !== 'tea-select-keepalive') return;
      port.onDisconnect.addListener(() => {});
    });
  }

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handle(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  });

  // 快捷键：打开设置页
  if (ext.commands && ext.commands.onCommand) {
    ext.commands.onCommand.addListener((command) => {
      if (command === 'open-options') {
        const url = ext.runtime.getURL('src/options.html');
        ext.tabs.create({ url });
      }
    });
  }

  ext.runtime.onInstalled.addListener(async () => {
    const data = await ext.storage.local.get(SETTINGS_KEY);
    if (!data || !data[SETTINGS_KEY]) await saveSettings(Core.DEFAULT_SETTINGS);
  });
})();
