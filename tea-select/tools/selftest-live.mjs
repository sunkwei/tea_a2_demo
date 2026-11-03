/*
 * 联调自测（需要 tea_a2 在跑）：用假的 browser API 把 src/background.js 加载起来，
 * 直接跑它的消息处理，验证真实请求体、模型拒收思考强度时的降级重试等。
 *
 *   node tea-select/tools/selftest-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

const store = {};
let listener = null;

globalThis.browser = {
  storage: {
    local: {
      get: async (key) => {
        if (typeof key === 'string') return key in store ? { [key]: store[key] } : {};
        return Object.assign({}, store);
      },
      set: async (obj) => {
        Object.assign(store, obj);
      },
    },
  },
  runtime: {
    onMessage: { addListener: (fn) => { listener = fn; } },
    onInstalled: { addListener: () => {} },
    onConnect: { addListener: () => {} },
    getURL: (p) => 'moz-extension://fake/' + p,
  },
  tabs: { create: async () => {} },
  commands: { onCommand: { addListener: () => {} } },
};

vm.runInThisContext(fs.readFileSync(path.join(srcDir, 'core.js'), 'utf8'), { filename: 'core.js' });
vm.runInThisContext(fs.readFileSync(path.join(srcDir, 'background.js'), 'utf8'), { filename: 'background.js' });

function send(msg) {
  return new Promise((resolve) => listener(msg, {}, resolve));
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else {
    failed++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

const BASE = process.env.TEA_API || 'http://localhost:8383';

console.log('\n[1] MiniMax 拒收 reasoning_effort=none 时自动降级');
store.settings = {
  apiBase: BASE,
  provider: 'minimax',
  model: 'MiniMax-M3.1-Flash',
  translateProvider: 'minimax',
  translateModel: 'MiniMax-M3.1-Flash',
};
let res = await send({ type: 'run', task: 'translate', text: '今天天气不错。' });
check('翻译没报错', res && res.ok, res && res.error);
if (res && res.ok) {
  check('译文是英文', /weather|nice|today/i.test(res.content), res.content);
  check('提示了降级', /思考强度/.test(res.note || ''), res.note);
  console.log('    译文：' + String(res.content).slice(0, 80).replace(/\n/g, ' '));
  console.log('    提示：' + (res.note || '(无)'));
}

console.log('\n[2] 同一个模型再翻译一次（应直接走降级后的请求，不再失败）');
res = await send({ type: 'run', task: 'translate', text: '今天天气不错。' });
check('第二次也成功', res && res.ok, res && res.error);
check('记住了这个模型，不再重复降级', res && !(res.note || ''), res && res.note);

console.log('\n[3] 总结（这个模型支持思考强度）');
store.settings.summarizeProvider = 'minimax';
store.settings.summarizeModel = 'MiniMax-M3.1-Flash';
store.settings.summarizeReasoning = 'medium';
res = await send({ type: 'run', task: 'summarize', text: '光合作用是绿色植物利用光能，把二氧化碳和水转化成有机物并释放氧气的过程。' });
check('总结成功', res && res.ok, res && res.error);
if (res && res.ok) console.log('    结果：' + String(res.content).slice(0, 100).replace(/\n/g, ' '));

console.log('\n[4] 思考强度选 auto 时不发送该字段');
store.settings = {
  apiBase: BASE,
  provider: 'minimax',
  model: 'MiniMax-M3.1-Flash',
  translateReasoning: 'auto',
};
const body = globalThis.TeaCore.buildChatBody('translate', '今天天气不错。', globalThis.TeaCore.normalizeSettings(store.settings));
check('请求体里没有 reasoning_effort', body.reasoning_effort === undefined, JSON.stringify(body));
check('系统提示词仍然是不思考', body.system === '将下面内容翻译为英文，不思考', body.system);

console.log('\n[5] 错误判定');
check('能认出 MiniMax 那条错', globalThis.TeaCore.isReasoningError('invalid params, model "MiniMax-M3.1-Flash" requires adaptive thinking; reasoning effort none is not allowed'));
check('普通错误不会误判', !globalThis.TeaCore.isReasoningError('HTTP 500: internal error'));

console.log('\n结果：' + (failed ? failed + ' 项失败' : '全部通过'));
process.exit(failed ? 1 : 0);
