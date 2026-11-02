/**
 * 单文件构建自检：把生成的 HTML 里的内联脚本抠出来做语法检查，
 * 并确认没有残留外部资源引用（否则 file:// 下仍然打不开）。
 *
 *   node iptv-player/tools/check-single.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '../dist-single/iptv-player.html');

if (!fs.existsSync(FILE)) {
  console.error('找不到单文件产物，请先执行 npm run iptv:single');
  process.exit(1);
}

const html = fs.readFileSync(FILE, 'utf8');
const problems = [];

// 1) 不得还有外部 script / stylesheet
if (/<script[^>]*\ssrc=/i.test(html)) problems.push('仍有外部 script 引用');
if (/<link[^>]*stylesheet/i.test(html)) problems.push('仍有外部样式表引用');
if (/rel="modulepreload"/i.test(html)) problems.push('仍有 modulepreload 引用');

// 2) 内联脚本必须语法正确
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) {
  problems.push('找不到内联的 module 脚本');
} else {
  const tmp = path.resolve(HERE, '../../.tea_agent_run/tmp/single-check.mjs');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, m[1]);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    problems.push('内联脚本语法错误：' + String(e.stderr).split('\n').slice(0, 4).join(' '));
  }
}

// 3) 关键内容要在（防止把页面截断）
for (const needle of ['IPTV 剧场', 'channels', '#EXTM3U']) {
  if (!html.includes(needle)) problems.push(`产物里找不到「${needle}」`);
}

const size = (fs.statSync(FILE).size / 1024).toFixed(0);
if (problems.length) {
  console.error('单文件自检未通过：');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log(`✓ 单文件自检通过：${FILE}（${size} KB，可直接双击打开）`);
process.exit(0);
