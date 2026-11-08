/* 设置页逻辑 */
(function () {
  'use strict';

  const ext = globalThis.browser || globalThis.chrome;
  const Core = globalThis.TeaCore;
  const KEY = 'settings';

  const $ = (id) => document.getElementById(id);

  const TEXT_FIELDS = [
    'apiBase',
    'provider',
    'model',
    'translateProvider',
    'translateModel',
    'searchProvider',
    'searchModel',
    'summarizeProvider',
    'summarizeModel',
    'searchUrlTemplate',
    'visionProvider',
    'visionModel',
    'visionWorkspace',
    'visionPrompt',
    'regionKey',
  ];
  const NUMBER_FIELDS = ['minChars', 'maxTextChars', 'visionMaxSide'];
  const SELECT_FIELDS = [
    'translateReasoning',
    'searchReasoning',
    'summarizeReasoning',
    'searchEngine',
    'searchMode',
    'visionReasoning',
  ];
  const CHECK_FIELDS = ['searchAiSummary', 'showReasoning'];

  let settings = Core.normalizeSettings(null);
  let saveTimer = null;

  function send(msg) {
    return new Promise((resolve, reject) => {
      let ret;
      try {
        ret = ext.runtime.sendMessage(msg);
      } catch (e) {
        reject(e);
        return;
      }
      if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
      else {
        ext.runtime.sendMessage(msg, (res) => {
          const err = ext.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res);
        });
      }
    });
  }

  function setStatus(text, cls) {
    const el = $('status');
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function saveState(text) {
    const el = $('saveState');
    el.textContent = text;
    setTimeout(() => {
      el.textContent = '设置会自动保存';
    }, 1800);
  }

  function collect() {
    const out = Object.assign({}, settings);
    for (const f of TEXT_FIELDS) out[f] = $(f).value.trim();
    for (const f of NUMBER_FIELDS) out[f] = Number($(f).value) || 0;
    for (const f of SELECT_FIELDS) out[f] = $(f).value;
    for (const f of CHECK_FIELDS) out[f] = $(f).checked;
    return Core.normalizeSettings(out);
  }

  function fill() {
    for (const f of TEXT_FIELDS) $(f).value = settings[f] == null ? '' : settings[f];
    for (const f of NUMBER_FIELDS) $(f).value = settings[f];
    for (const f of SELECT_FIELDS) $(f).value = settings[f];
    for (const f of CHECK_FIELDS) $(f).checked = !!settings[f];
  }

  function persist() {
    settings = collect();
    return ext.storage.local.set({ [KEY]: settings }).then(() => saveState('已保存'));
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persist().catch((e) => setStatus('保存失败：' + e.message, 'bad'));
    }, 250);
  }

  function initSelects() {
    for (const id of ['translateReasoning', 'searchReasoning', 'summarizeReasoning', 'visionReasoning']) {
      const sel = $(id);
      sel.innerHTML = '';
      for (const level of Core.REASONING_LEVELS) {
        const opt = document.createElement('option');
        opt.value = level;
        opt.textContent = level;
        sel.appendChild(opt);
      }
    }
    const engineSel = $('searchEngine');
    engineSel.innerHTML = '';
    for (const key of Object.keys(Core.ENGINES)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = Core.ENGINES[key].name;
      engineSel.appendChild(opt);
    }
  }

  function fillProviderList(data) {
    const pl = $('providerList');
    const ml = $('modelList');
    pl.innerHTML = '';
    ml.innerHTML = '';
    // data 就是 /api/providers 的返回：{ providers: [...], active: {...} }
    const list = (data && data.providers) || [];
    for (const p of list) {
      const opt = document.createElement('option');
      opt.value = p.name;
      pl.appendChild(opt);
      for (const m of p.models || []) {
        const mopt = document.createElement('option');
        mopt.value = m;
        mopt.label = p.name + ' / ' + m;
        ml.appendChild(mopt);
      }
    }
    const active = data && data.active;
    if (active) {
      $('providerHint').textContent =
        '已读取 ' + list.length + ' 个提供商；tea_a2 当前用的是 ' +
        active.provider + '/' + active.model + '。';
    } else {
      $('providerHint').textContent = '已读取 ' + list.length + ' 个提供商。';
    }
  }

  async function loadProviders() {
    setStatus('读取中…');
    try {
      const res = await send({ type: 'providers' });
      if (!res || !res.ok) throw new Error((res && res.error) || '读取失败');
      fillProviderList(res.providers);
      setStatus('已读取提供商', 'ok');
    } catch (e) {
      setStatus('读取失败：' + e.message, 'bad');
    }
  }

  async function testConnection() {
    setStatus('测试中…');
    try {
      const res = await send({ type: 'test' });
      if (!res || !res.ok) throw new Error((res && res.error) || '测试失败');
      setStatus('连接正常：' + (res.content || '').slice(0, 24), 'ok');
    } catch (e) {
      setStatus('连接失败：' + e.message, 'bad');
    }
  }

  async function init() {
    initSelects();
    const data = await ext.storage.local.get(KEY);
    settings = Core.normalizeSettings(data && data[KEY]);
    fill();

    for (const f of TEXT_FIELDS.concat(NUMBER_FIELDS)) {
      $(f).addEventListener('input', scheduleSave);
    }
    for (const f of SELECT_FIELDS.concat(CHECK_FIELDS)) {
      $(f).addEventListener('change', scheduleSave);
    }

    $('btnProviders').addEventListener('click', loadProviders);
    $('btnTest').addEventListener('click', testConnection);
    $('btnRegion').addEventListener('click', async () => {
      setStatus('正在划图…');
      try {
        const res = await send({ type: 'startRegionSelect' });
        if (!res || !res.ok) throw new Error((res && res.error) || '启动失败');
        setStatus('已切换到网页标签页，拖出一个区域', 'ok');
      } catch (e) {
        setStatus('启动失败：' + e.message, 'bad');
      }
    });
    $('btnReset').addEventListener('click', () => {
      settings = Core.normalizeSettings(null);
      fill();
      persist().catch(() => {});
      setStatus('已恢复默认');
    });

    setStatus('设置已载入');
    loadProviders();
  }

  init().catch((e) => setStatus('初始化失败：' + e.message, 'bad'));
})();
