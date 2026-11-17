/**
 * 源码语法自检：node --check 逐个文件跑一遍
 *
 *   node endfield-ship/tools/lint.mjs
 *
 * 这个项目不用打包器，浏览器直接跑原生 ESM，
 * 所以一个逗号打错就会整页白屏 —— 这个脚本能在提交前把低级语法错误拦下来。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

let bad = 0;
for (const f of walk(SRC).sort()) {
  const rel = path.relative(SRC, f).replace(/\\/g, '/');
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log('  ✓ ' + rel);
  } catch (e) {
    bad++;
    console.log('  ✗ ' + rel);
    console.log(
      (e.stderr || Buffer.alloc(0))
        .toString()
        .split('\n')
        .slice(0, 6)
        .join('\n')
    );
  }
}

console.log(`\n${bad ? '✗ ' + bad + ' 个文件有语法错误' : '✓ 全部文件语法正确'}`);
process.exitCode = bad ? 1 : 0;
