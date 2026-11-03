/*
 * 核心逻辑自测（纯 node，不依赖浏览器）：
 *   node tea-select/tools/selftest.mjs
 * core.js 不碰 DOM 也不碰 browser API，用 new Function 加载后从 globalThis.TeaCore 取。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const corePath = path.join(here, '..', 'src', 'core.js');
const src = fs.readFileSync(corePath, 'utf8');
vm.runInThisContext(src, { filename: corePath });
const Core = globalThis.TeaCore;

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, 'got: ' + JSON.stringify(actual) + ' want: ' + JSON.stringify(expected));
}

console.log('\n[1] 语言判断');
eq('中文 → zh', Core.detectLanguage('今天天气不错。'), 'zh');
eq('英文 → en', Core.detectLanguage('The weather is nice today.'), 'en');
eq('中英混排（中文为主）→ zh', Core.detectLanguage('这是 hello 世界'), 'zh');
eq('中英混排（英文为主）→ en', Core.detectLanguage('the quick brown fox 跳跃'), 'en');
eq('空串 → unknown', Core.detectLanguage(''), 'unknown');

console.log('\n[2] 翻译方向与系统提示词');
eq('中文选区 → 英文', Core.translateTarget('今天天气不错。'), '英文');
eq('非中文选区 → 中文', Core.translateTarget('The weather is nice today.'), '中文');
eq(
  '中文选区提示词',
  Core.translateSystemPrompt('今天天气不错。'),
  '将下面内容翻译为英文，不思考'
);
eq(
  '英文选区提示词',
  Core.translateSystemPrompt('The weather is nice today.'),
  '将下面内容翻译为中文，不思考'
);

console.log('\n[3] 请求体构造');
const settings = Core.normalizeSettings({
  apiBase: 'http://localhost:8282/',
  provider: 'deepseek',
  model: 'deepseek-flash',
});

const tr = Core.buildChatBody('translate', '今天天气不错。', settings);
eq('翻译用默认 provider', tr.provider, 'deepseek');
eq('翻译用默认 model', tr.model, 'deepseek-flash');
eq('翻译系统提示词', tr.system, '将下面内容翻译为英文，不思考');
eq('翻译不思考', tr.reasoning_effort, 'none');
eq('翻译走 messages', tr.messages[0].role, 'user');
eq('翻译带上原文', tr.messages[0].content, '今天天气不错。');
eq('翻译不流式', tr.stream, false);

const trEn = Core.buildChatBody('translate', 'The weather is nice.', settings);
eq('英文选区 → 译成中文', trEn.system, '将下面内容翻译为中文，不思考');

const sum = Core.buildChatBody('summarize', '光合作用是……', settings);
ok('总结用思考', ['low', 'medium', 'high'].includes(sum.reasoning_effort), sum.reasoning_effort);
ok('总结有系统提示词', /总结/.test(sum.system), sum.system);

const overridden = Core.normalizeSettings({
  provider: 'deepseek',
  model: 'deepseek-flash',
  summarizeProvider: 'mimo',
  summarizeModel: 'mimo-v2.6-pro',
});
const sum2 = Core.buildChatBody('summarize', '随便一段文字', overridden);
eq('总结用覆盖的 provider', sum2.provider, 'mimo');
eq('总结用覆盖的 model', sum2.model, 'mimo-v2.6-pro');
eq('翻译不受覆盖影响', Core.buildChatBody('translate', '你好', overridden).provider, 'deepseek');

console.log('\n[4] 设置归一化');
const norm = Core.normalizeSettings({ provider: 42, minChars: '7', searchAiSummary: 'no' });
eq('数字 provider 转字符串', norm.provider, '42');
eq('字符串数字转 number', norm.minChars, 7);
eq('假值布尔保持 false', norm.searchAiSummary, false);
eq('缺省补齐 apiBase', norm.apiBase, 'http://localhost:8383');
eq('尾部斜杠去掉', Core.normalizeSettings({ apiBase: 'http://x:8282///' }).apiBase, 'http://x:8282');
eq('非法搜索引擎回落', Core.normalizeSettings({ searchEngine: 'nope' }).searchEngine, 'bing');
eq('非法思考强度回落', Core.normalizeSettings({ summarizeReasoning: 'nope' }).summarizeReasoning, 'medium');

console.log('\n[5] 搜索');
eq(
  'Bing 搜索地址',
  Core.buildSearchUrl('hello world', settings),
  'https://www.bing.com/search?q=hello%20world'
);
eq(
  '自定义模板',
  Core.buildSearchUrl('tea a2', Core.normalizeSettings({ searchEngine: 'custom', searchUrlTemplate: 'https://s.example/?wd={q}' })),
  'https://s.example/?wd=tea%20a2'
);

const bingHtml = [
  '<ol id="b_results">',
  '<li class="b_algo" data-id="1"><h2 class=""><a href="https://example.com/a">标题 A</a></h2>',
  '<div class="b_caption"><p>摘要 A 的内容</p></div></li>',
  '<li class="b_algo"><h2><a href="https://example.com/b">标题 B</a></h2><p>摘要 B</p></li>',
  '<li class="b_algo"><h2><a href="javascript:void(0)">广告</a></h2><p>广告文案</p></li>',
  '</ol>',
].join('\n');
const bing = Core.parseBingResults(bingHtml);
eq('Bing 结果条数（跳过广告）', bing.length, 2);
eq('Bing 第一条标题', bing[0].title, '标题 A');
eq('Bing 第一条地址', bing[0].url, 'https://example.com/a');
eq('Bing 第一条摘要', bing[0].snippet, '摘要 A 的内容');
eq('Bing 第二条标题', bing[1].title, '标题 B');

const ddgHtml =
  '<a rel="nofollow" class="result__a" href="https://example.org/x">DDG 标题</a>' +
  '<a class="result__snippet" href="https://example.org/x">DDG 摘要</a>';
const ddg = Core.parseDuckduckgoResults(ddgHtml);
eq('DuckDuckGo 结果条数', ddg.length, 1);
eq('DuckDuckGo 标题', ddg[0].title, 'DDG 标题');
eq('DuckDuckGo 摘要', ddg[0].snippet, 'DDG 摘要');

const fmt = Core.formatSearchResults([{ title: 'T', url: 'https://u', snippet: 'S' }]);
ok('搜索结果编号', fmt.indexOf('[1] T') === 0, fmt);
ok('搜索结果带地址', fmt.indexOf('https://u') >= 0, fmt);

const extSettings = Core.normalizeSettings({ searchMode: 'extension' });
const searchBody = Core.buildSearchBody('问题是什么', [{ title: 'T', url: 'https://u', snippet: 'S' }], extSettings);
ok('搜索带上问题', searchBody.messages[0].content.indexOf('问题是什么') >= 0);
ok('搜索带上材料', searchBody.messages[0].content.indexOf('https://u') >= 0);
ok('搜索系统提示词提到来源', /标注信息来源/.test(searchBody.system), searchBody.system);
ok(
  'api 模式用「先联网搜索」那套提示词',
  /先联网搜索/.test(Core.buildSearchBody('q', [], settings).system),
  Core.buildSearchBody('q', [], settings).system
);

const rssXml =
  '<rss><channel><item><title>茶馆（老舍创作的话剧）_百度百科</title>' +
  '<link>https://baike.baidu.com/item/x</link>' +
  '<description>《茶馆》是现代文学家老舍于1956年创作的话剧</description></item></channel></rss>';
const rss = Core.parseBingRss(rssXml);
eq('RSS 结果条数', rss.length, 1);
eq('RSS 标题', rss[0].title, '茶馆（老舍创作的话剧）_百度百科');
eq('RSS 地址', rss[0].url, 'https://baike.baidu.com/item/x');
ok('RSS 摘要', rss[0].snippet.indexOf('老舍') >= 0, rss[0].snippet);
eq('parseSearchResults 认得 RSS', Core.parseSearchResults(rssXml, 'bing').length, 1);
eq(
  'Bing 抓取地址带 format=rss',
  Core.buildSearchFetchUrl('茶馆', settings),
  'https://www.bing.com/search?q=%E8%8C%B6%E9%A6%86&format=rss'
);
eq('浏览器打开用普通搜索页', Core.buildSearchUrl('茶馆', settings), 'https://www.bing.com/search?q=%E8%8C%B6%E9%A6%86');

eq('非法搜索方式回落', Core.normalizeSettings({ searchMode: 'nope' }).searchMode, 'api');
eq('默认搜索方式是 api', Core.normalizeSettings({}).searchMode, 'api');
ok('auto 模式请求带 search 标记', Core.buildSearchBody('q', [], Core.normalizeSettings({})).search === true);
ok(
  'extension 模式不带 search 标记',
  Core.buildSearchBody('q', [], Core.normalizeSettings({ searchMode: 'extension' })).search === undefined
);
ok(
  'api 模式请求带 search 标记',
  Core.buildSearchBody('q', [], Core.normalizeSettings({ searchMode: 'api' })).search === true
);
ok(
  'api 模式不带搜索材料',
  Core.buildSearchBody('q', [{ title: 'T', url: 'https://u', snippet: 'S' }], Core.normalizeSettings({ searchMode: 'api' }))
    .messages[0].content.indexOf('https://u') < 0
);

eq('auto 不发送 reasoning_effort', Core.buildChatBody('translate', '你好', Core.normalizeSettings({ translateReasoning: 'auto' })).reasoning_effort, undefined);
eq('none 仍然发送', Core.buildChatBody('translate', '你好', settings).reasoning_effort, 'none');
ok('认得出思考强度报错', Core.isReasoningError('invalid params, model "MiniMax-M3.1-Flash" requires adaptive thinking; reasoning effort none is not allowed'));
ok('普通错误不误判', !Core.isReasoningError('HTTP 500 internal error'));

eq('none 降级到 minimal', Core.nextEffort('none', []), 'minimal');
eq('minimal 降级到 low', Core.nextEffort('minimal', []), 'low');
eq('low 降级到不指定', Core.nextEffort('low', []), 'omit');
eq('high 降级到 medium', Core.nextEffort('high', []), 'medium');
eq('试过的档位会跳过', Core.nextEffort('none', ['minimal']), 'low');
eq('阶梯走完返回 null', Core.nextEffort('none', ['minimal', 'low', 'omit']), null);

console.log('\n[6] 文本工具');
eq('实体解码', Core.decodeEntities('a&lt; b&#39;c&quot;d&nbsp;e'), "a< b'c\"d e");
eq('去标签', Core.stripTags('<b>粗体</b> <i>斜体</i>'), '粗体 斜体');
eq('超长截断', Core.clampText('abcdefghij', 4), 'abcd');

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);
