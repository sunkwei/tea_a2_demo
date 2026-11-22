/**
 * 李清照 · 漱玉词 —— 单文件构建
 *
 *   node li-qingzhao/tools/build-single.mjs              # 图片 + 音频全部内联 → li-qingzhao/li-qingzhao.html
 *   node li-qingzhao/tools/build-single.mjs --no-images  # 不内联图片（需连同 assets/images/ 一起拷）
 *   node li-qingzhao/tools/build-single.mjs --no-audio   # 不内联音频（需连同 assets/audio/ 一起拷）
 *
 * 为什么要单文件：双击就能看，不需要起服务器；AI 仍然可以连本机 tea_a2。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'li-qingzhao.html');
const NO_IMAGES = process.argv.includes('--no-images');
const NO_AUDIO = process.argv.includes('--no-audio');

const SCRIPTS = [
  'assets/images/sources.js',
  'src/data-life.js',
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

function dataUri(p, mime) {
  return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
}

function imageMap() {
  const map = {};
  const dir = path.join(ROOT, 'assets', 'images');
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    map['assets/images/' + file] = dataUri(path.join(dir, file), mime);
  }
  return map;
}

function main() {
  let html = read('index.html');

  const cssTag = /<link rel="stylesheet" href="src\/styles\.css"\s*\/?>/;
  if (!cssTag.test(html)) throw new Error('找不到 styles.css 的 link');
  html = html.replace(cssTag, () => '<style>\n' + read('src/styles.css') + '\n</style>');

  let inject = '';
  if (!NO_IMAGES) {
    inject = 'window.LI_QINGZHAO_IMAGE_DATA = ' + JSON.stringify(imageMap()) + ';\n';
  }
  if (!NO_AUDIO) {
    const audioFile = path.join(ROOT, 'assets', 'audio', 'yangguan-sandie.mp3');
    if (fs.existsSync(audioFile)) {
      inject += 'window.LI_QINGZHAO_AUDIO_DATA = ' + JSON.stringify(dataUri(audioFile, 'audio/mpeg')) + ';\n';
    } else {
      console.warn('没有找到 assets/audio/yangguan-sandie.mp3，单文件版将不带音频。');
    }
  }

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
  if (NO_IMAGES) console.log('注意：--no-images 模式需要把 assets/images/ 一起拷走。');
  if (NO_AUDIO) console.log('注意：--no-audio 模式需要把 assets/audio/ 一起拷走。');
}

main();
