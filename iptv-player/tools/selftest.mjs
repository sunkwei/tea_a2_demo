/**
 * IPTV 剧场的无头自测：M3U 解析 / 去重合并 / 排序 / 源目录体检。
 *
 *   node iptv-player/tools/selftest.mjs           离线用例
 *   node iptv-player/tools/selftest.mjs --online  额外拉一个真实源验证
 */

import { parseM3U, parseAttributes, parseTvgId, channelKey, mergeChannels, sortChannels, normalizeName } from '../src/m3u.js';
import { builtinSources, DEFAULT_ENABLED, sourceGroups } from '../src/sources.js';

let pass = 0;
let fail = 0;

function ok(cond, name, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function eq(a, b, name) {
  ok(a === b, name, `（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);
}

console.log('\n[1] 属性与 tvg-id 解析');
{
  const a = parseAttributes('tvg-id="CGTN.us@SD" tvg-logo="https://x/y.png" group-title="News"');
  eq(a['tvg-id'], 'CGTN.us@SD', 'tvg-id');
  eq(a['tvg-logo'], 'https://x/y.png', 'tvg-logo');
  eq(a['group-title'], 'News', 'group-title');

  const t = parseTvgId('CGTNChina.us@SD');
  eq(t.channel, 'CGTNChina', 'tvg-id 频道名');
  eq(t.country, 'us', 'tvg-id 国家');
  eq(t.feed, 'SD', 'tvg-id 清晰度');

  const t2 = parseTvgId('NoCountry');
  eq(t2.country, '', '无国家后缀时 country 为空');
}

console.log('\n[2] M3U 解析');
const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="CGTN.us@SD" tvg-logo="https://img/cgtn.png" group-title="News",CGTN English (1080p)
https://example.com/cgtn/index.m3u8
#EXTINF:-1 tvg-id="CCTV1.cn@HD" tvg-logo="https://img/cctv1.png" group-title="General",CCTV-1 综合, 高清
http://example.com/cctv1.m3u8
#EXTGRP:Sports
#EXTVLCOPT:http-user-agent=Mozilla/5.0 Custom
#EXTINF:-1 tvg-id="ESPN.us@SD",ESPN
https://example.com/espn.m3u8
https://example.com/bare-stream.m3u8
`;
{
  const { entries, stats } = parseM3U(SAMPLE, { id: 's1', name: '测试源' });
  eq(entries.length, 4, '条目数量');
  eq(stats.total, 4, 'stats.total');

  eq(entries[0].name, 'CGTN English (1080p)', '频道名');
  eq(entries[0].logo, 'https://img/cgtn.png', '台标');
  eq(entries[0].group, 'News', '分组');
  eq(entries[0].country, 'us', '国家');
  eq(entries[0].sourceId, 's1', '来源 id');
  ok(entries[0].key.startsWith('tvg:'), 'key 使用 tvg-id');

  eq(entries[1].name, 'CCTV-1 综合, 高清', '标题中的逗号不被截断');
  eq(entries[1].group, 'General', 'group-title 优先');

  eq(entries[2].group, 'Sports', '#EXTGRP 生效');
  eq(entries[2].headers['user-agent'], 'Mozilla/5.0 Custom', '#EXTVLCOPT 生效');

  eq(entries[3].url, 'https://example.com/bare-stream.m3u8', '裸地址也能成条');
  eq(entries[3].name, 'https://example.com/bare-stream.m3u8', '裸地址用 URL 当名字');
}

console.log('\n[3] 合并去重');
{
  const a = parseM3U(SAMPLE, { id: 'a' }).entries;
  const b = parseM3U(SAMPLE.replace(/https:\/\/example\.com\/cgtn\/index\.m3u8/, 'https://backup.example.com/cgtn.m3u8'), { id: 'b' }).entries;
  const merged = mergeChannels([a, b]);
  eq(merged.length, 4, '重复频道被合并');
  const cgtn = merged.find((e) => e.tvgId === 'CGTN.us@SD');
  eq(cgtn.alts.length, 1, '备用线路被记录');
  eq(cgtn.alts[0].sourceId, 'b', '备用线路来源正确');
}

console.log('\n[4] 排序与搜索归一化');
{
  const list = [
    { key: '1', name: 'Zebra (1080p)', group: 'B' },
    { key: '2', name: 'Alpha', group: 'A' },
    { key: '3', name: '中文字幕', group: 'A' },
  ];
  const sorted = sortChannels(list);
  eq(sorted[0].group, 'A', '按分组排序');
  eq(normalizeName('CCTV-1 综合 (1080p) [HD]'), 'cctv 1 综合', '归一化去掉清晰度后缀');
}

console.log('\n[5] 源目录体检');
{
  const all = builtinSources();
  ok(all.length > 50, `内置源数量 ${all.length} > 50`);
  const ids = new Set(all.map((s) => s.id));
  eq(ids.size, all.length, '源 id 无重复');
  const bad = all.filter((s) => !/^https:\/\//.test(s.url));
  eq(bad.length, 0, '所有源都是 https');
  const noRepo = all.filter((s) => s.repo && !s.path);
  eq(noRepo.length, 0, '带仓库信息的源都有仓库内路径');
  const withRepo = all.filter((s) => s.repo);
  ok(withRepo.length >= 80, `${withRepo.length} 个源可做 GitHub 提交检测`);
  const groups = sourceGroups(all);
  ok(groups.length >= 6, `源分组 ${groups.length} 组`);
  for (const id of DEFAULT_ENABLED) ok(ids.has(id), `默认源存在：${id}`);
  const dup = all.map((s) => s.url).filter((u, i, arr) => arr.indexOf(u) !== i);
  eq(dup.length, 0, '源地址无重复');
  const shape = /^https:\/\/iptv-org\.github\.io\/iptv\/(countries|categories|languages|regions)\/[a-z-]+\.m3u$/;
  const badShape = all.filter((s) => s.url.startsWith('https://iptv-org.github.io/') && !shape.test(s.url));
  eq(badShape.length, 0, 'iptv-org 源地址结构正确（无重复路径段）');
  if (badShape.length) console.log('   例：', badShape.slice(0, 3).map((s) => s.url).join(' | '));
  const countryPath = all.find((s) => s.id === 'iptv-org:countries:cn');
  eq(countryPath.path, 'streams/cn.m3u', '国家源对应仓库内文件路径');
}

console.log('\n[6] 频道 key 兜底');
{
  eq(channelKey({ tvgId: 'A.us@SD' }), 'tvg:a.us@sd', '有 tvg-id 时用 tvg');
  eq(channelKey({ url: 'HTTP://X/y.m3u8' }), 'url:http://x/y.m3u8', '无 tvg-id 时用 url');
}

if (process.argv.includes('--online')) {
  console.log('\n[7] 真实源联调（网络）');
  const src = builtinSources().find((s) => s.id === 'iptv-org:countries:cn');
  try {
    const res = await fetch(src.url, { headers: { 'User-Agent': 'iptv-selftest' } });
    ok(res.ok, `拉取 ${src.url} → ${res.status}`);
    const text = await res.text();
    const { entries } = parseM3U(text, src);
    ok(entries.length > 100, `解析出 ${entries.length} 个频道`);
    const withLogo = entries.filter((e) => e.logo).length;
    ok(withLogo > entries.length * 0.8, `${withLogo}/${entries.length} 个频道带台标`);
    const cors = res.headers.get('access-control-allow-origin');
    ok(cors === '*', `CORS 头为 *（实际 ${cors}）`);
  } catch (err) {
    ok(false, '真实源联调', err.message);
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
