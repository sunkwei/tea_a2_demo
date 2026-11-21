/**
 * 中药大全 · 单文件构建
 *
 * 用法：
 *   node tcm-herb/tools/build-single.mjs              # 内联图片 → 真正单文件（约 26MB）
 *   node tcm-herb/tools/build-single.mjs --no-images  # 不内联图片（需连同 assets/ 一起拷）
 *
 * 产物：tcm-herb/tcm-herb.html
 *
 * 注意：所有 String.replace 的替换值都用函数返回。
 * 源码里存在 '$' + '&' 这类序列，直接当替换串会被当成特殊语法展开（会把页面拼坏）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'tcm-herb.html');
const NO_IMAGES = process.argv.includes('--no-images');

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 防止源码里的 </script 提前闭合当前脚本块 */
function safeInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function loadCredits() {
  const src = read('assets/herbs/sources.js');
  const fake = {};
  new Function('window', src)(fake);
  return fake.TCM_IMAGE_CREDITS || {};
}

function dataUri(rel) {
  const p = path.join(ROOT, rel);
  const ext = path.extname(p).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
}

function main() {
  let html = read('index.html');

  /* 1) CSS 内联 */
  const cssTag = /<link rel="stylesheet" href="src\/styles\.css"\s*\/?>/;
  if (!cssTag.test(html)) throw new Error('找不到 styles.css 的 link 标签');
  const css = read('src/styles.css');
  html = html.replace(cssTag, () => '<style>\n' + css + '\n</style>');

  /* 2) 图片 → data URI（改写 sources.js 的 file 字段） */
  const credits = loadCredits();
  let imageBytes = 0;
  const inlineCredits = {};
  Object.keys(credits).forEach((id) => {
    const c = Object.assign({}, credits[id]);
    if (!NO_IMAGES && c.file && fs.existsSync(path.join(ROOT, c.file))) {
      imageBytes += fs.statSync(path.join(ROOT, c.file)).size;
      c.file = dataUri(c.file);
    }
    inlineCredits[id] = c;
  });

  /* 3) 逐个 script 内联 */
  const scriptRe = /<script src="([^"]+)"><\/script>/g;
  const scripts = [];
  let m;
  while ((m = scriptRe.exec(html)) !== null) scripts.push(m[1]);
  if (!scripts.length) throw new Error('没找到外链 script');

  scripts.forEach((rel) => {
    let code = read(rel);
    if (rel === 'assets/herbs/sources.js') {
      code = 'window.TCM_IMAGE_CREDITS = ' + JSON.stringify(inlineCredits) + ';\n';
    }
    const tag = '<script src="' + rel + '"></script>';
    if (html.indexOf(tag) < 0) throw new Error('找不到脚本标签：' + rel);
    const block = '<script>\n' + safeInline(code) + '\n</script>';
    html = html.replace(tag, () => block);
  });

  /* 4) 标记来源，便于排查 */
  html = html.replace('<head>', () => '<head>\n  <!-- 单文件版：由 tools/build-single.mjs 生成，图片 ' + (NO_IMAGES ? '未内联' : '已内联') + ' -->');

  fs.writeFileSync(OUT, html, 'utf8');

  const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
  console.log('✓ 已生成 tcm-herb.html（' + mb + ' MB）');
  console.log('  内联脚本 ' + scripts.length + ' 个；图片 ' +
    (NO_IMAGES ? '未内联' : '已内联，原始 ' + (imageBytes / 1024 / 1024).toFixed(1) + ' MB'));
  console.log('  验证：node tcm-herb/tools/verify.mjs --single');
}

main();
