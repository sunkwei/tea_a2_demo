/*
 * 打包：把扩展打成 zip（Firefox 可直接「临时加载附加组件」；正式发布需要签名）。
 *   node tea-select/tools/build.mjs
 * 产物：tea-select/dist/tea-select-<版本>.zip
 *
 * 注意：GNU tar 的 `-a` 只会按后缀猜 gzip/bzip2/xz，猜不到 zip 就原样打成 tar
 * （文件叫 .zip、内容却是 tar，Firefox 装不上）。所以这里自己挑打包器：
 * bsdtar（-a 认 .zip）→ zip 命令 → 都没有就报错。打完还要验一下 ZIP 魔数。
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

function which(cmd) {
  const res = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : '';
}

const bsdtar = which('bsdtar');
const zipBin = which('zip');
if (!bsdtar && !zipBin) {
  console.error('打包失败：找不到 bsdtar，也没有 zip 命令');
  process.exit(1);
}

const cmd = bsdtar
  ? { bin: bsdtar, args: ['-a', '-c', '-f', outFile] }
  : { bin: zipBin, args: ['-r', '-q', outFile] };

const res = spawnSync(cmd.bin, [...cmd.args, ...items], { cwd: root, stdio: 'inherit' });
if (res.status !== 0) {
  console.error('打包失败（退出码 ' + res.status + '）');
  process.exit(1);
}

// 验一下：真的是 zip 吗？manifest.json 在根目录吗？
const head = fs.readFileSync(outFile).subarray(0, 4);
if (!(head[0] === 0x50 && head[1] === 0x4b)) {
  console.error('打包失败：产物不是 zip（开头字节 ' + head.toString('hex') + '）');
  process.exit(1);
}
const list = spawnSync('unzip', ['-Z1', outFile], { encoding: 'utf8' });
if (list.status === 0 && !list.stdout.split('\n').includes('manifest.json')) {
  console.error('打包失败：manifest.json 不在压缩包根目录');
  process.exit(1);
}

const size = fs.statSync(outFile).size;
console.log('已打包：' + outFile + '（' + (size / 1024).toFixed(1) + ' KB）');
console.log('安装：Firefox → about:debugging#/runtime/this-firefox → 临时载入附加组件 → 选这个 zip');
