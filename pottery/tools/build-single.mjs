/**
 * 中国陶器史 · 单文件构建
 *
 *   node pottery/tools/build-single.mjs            # 图片内联 → pottery/pottery.html（约 5–7MB）
 *   node pottery/tools/build-single.mjs --no-images# 不内联图片（需连同 assets/ 一起拷）
 *
 * 为什么要单文件：双击就能看，不需要起服务器；AI 仍然可以连本机 tea_a2。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'pottery.html');
const NO_IMAGES = process.argv.includes('--no-images');

const SCRIPTS = [
  'assets/ceramics/sources.js',
  'src/data-ceramics.js',
  'src/core.js',
  'src/audio.js',
  'src/online.js',
  'src/app.js',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 防止源码里的 </script 提前闭合当前脚本块 */
function safeInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function dataUri(rel) {
  const p = path.join(ROOT, rel);
  const ext = path.extname(p).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
}

function imageMap() {
  const map = {};
  const dir = path.join(ROOT, 'assets', 'ceramics');
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
    map[path.basename(file, path.extname(file))] = dataUri(path.join('assets', 'ceramics', file));
  }
  return map;
}

function main() {
  let html = read('index.html');

  // 1) CSS
  const cssTag = /<link rel="stylesheet" href="src\/styles\.css"\s*\/?>/;
  if (!cssTag.test(html)) throw new Error('找不到 styles.css 的 link');
  html = html.replace(cssTag, () => '<style>\n' + read('src/styles.css') + '\n</style>');

  // 2) 图片映射（单文件版里 app.js 会优先用它）
  let inject = '';
  if (!NO_IMAGES) {
    inject = 'window.POTTERY_IMAGE_DATA = ' + JSON.stringify(imageMap()) + ';\n';
  }

  // 3) 逐个替换外链脚本
  for (const rel of SCRIPTS) {
    const tag = new RegExp('<script src="' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"></script>');
    if (!tag.test(html)) throw new Error('找不到脚本标签：' + rel);
    let body = safeInline(read(rel));
    if (inject) body = inject + body;
    inject = '';
    html = html.replace(tag, () => '<script>\n' + body + '\n</script>');
  }

  fs.writeFileSync(OUT, html, 'utf8');
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log('已生成 ' + path.relative(process.cwd(), OUT) + '（' + mb + ' MB）');
  if (NO_IMAGES) console.log('注意：--no-images 模式需要把 assets/ceramics/ 一起拷走。');
}

main();
