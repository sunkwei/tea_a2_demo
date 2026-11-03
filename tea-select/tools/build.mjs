/*
 * 打包：把扩展打成 zip（Firefox 可直接「临时加载附加组件」；正式发布需要签名）。
 *   node tea-select/tools/build.mjs
 * 产物：tea-select/dist/tea-select-<version>.zip
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const outName = `tea-select-${manifest.version}.zip`;
const outFile = path.join(dist, outName);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// 只打包运行期需要的文件：manifest.json / src / icons
const items = ['manifest.json', 'src', 'icons'].filter((it) => fs.existsSync(path.join(root, it)));

const res = spawnSync('tar', ['-a', '-c', '-f', outFile, ...items], { cwd: root, stdio: 'inherit' });
if (res.status !== 0) {
  console.error('打包失败（tar 退出码 ' + res.status + '）');
  process.exit(1);
}

const size = fs.statSync(outFile).size;
console.log('已打包：' + outFile + '（' + (size / 1024).toFixed(1) + ' KB）');
console.log('安装：Firefox → about:debugging#/runtime/this-firefox → 临时载入附加组件 → 选这个 zip');
