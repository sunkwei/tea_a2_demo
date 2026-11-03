/* 设置页离线测试台的桩：假的 browser API + 挂载 src/options.html */
(function () {
  'use strict';

  window.__saved = [];
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push('error: ' + (e.message || e.type)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push('reject: ' + e.reason));
  const origError = console.error.bind(console);
  console.error = (...a) => {
    window.__errors.push('console: ' + a.map(String).join(' '));
    origError(...a);
  };

  window.__fakeProviders = {
    providers: [
      { name: 'deepseek', models: ['deepseek-flash'], default_model: 'deepseek-flash', supports_search: true },
      { name: 'mimo', models: ['mimo-v2.6-flash', 'mimo-v2.6-pro'], default_model: 'mimo-v2.6-flash', supports_search: false },
    ],
    active: { provider: 'deepseek', model: 'deepseek-flash' },
  };

  window.browser = {
    storage: {
      local: {
        get: async () => ({ settings: undefined }),
        set: async (obj) => {
          window.__saved.push(JSON.parse(JSON.stringify(obj)));
        },
      },
    },
    runtime: {
      sendMessage: async (msg) => {
        window.__sent = (window.__sent || []).concat([msg]);
        if (msg && msg.type === 'providers') return { ok: true, providers: window.__fakeProviders };
        if (msg && msg.type === 'test') return { ok: true, content: '连接成功' };
        return { ok: true, settings: {} };
      },
    },
  };

  // core.js 必须先加载（options.js 依赖 globalThis.TeaCore）
  const core = document.createElement('script');
  core.src = '../src/core.js';
  core.onload = () => {
    fetch('../src/options.html')
      .then((r) => r.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const mount = document.getElementById('mount');
        const nodes = Array.from(doc.body.childNodes).map((n) => document.importNode(n, true));
        mount.replaceChildren(...nodes);
        const s = document.createElement('script');
        s.src = '../src/options.js';
        document.body.appendChild(s);
        window.__mounted = true;
      })
      .catch((e) => {
        document.getElementById('mount').textContent = '挂载失败：' + e;
      });
  };
  document.body.appendChild(core);
})();
