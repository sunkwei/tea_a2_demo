/**
 * 便笺 · 单文件打包
 *
 *   node sticky-notes/tools/build-single.mjs
 *
 * 把 index.html + src/styles.css + src/core.js + src/app.js 内联成一个
 * sticky-notes.html —— 单个文件拷到哪都能双击打开（不需要 src/ 目录）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 内联脚本里的 </script> 会提前闭合标签 */
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

let html = read('index.html');

// 用函数式 replacer：源码里的 $&、$' 等不会被当成替换模式
html = html.replace(
  /<link rel="stylesheet" href="src\/styles\.css" \/>/,
  () => '<style>\n' + read('src/styles.css') + '\n</style>'
);
html = html.replace(
  /<script src="src\/core\.js"><\/script>/,
  () => '<script>\n' + safe(read('src/core.js')) + '\n</script>'
);
html = html.replace(
  /<script src="src\/ai\.js"><\/script>/,
  () => '<script>\n' + safe(read('src/ai.js')) + '\n</script>'
);
html = html.replace(
  /<script src="src\/ai-ui\.js"><\/script>/,
  () => '<script>\n' + safe(read('src/ai-ui.js')) + '\n</script>'
);
html = html.replace(
  /<script src="src\/app\.js"><\/script>/,
  () => '<script>\n' + safe(read('src/app.js')) + '\n</script>'
);

if (/(href|src)="src\//.test(html)) {
  console.error('✗ 仍有未内联的外部资源引用');
  process.exit(1);
}

const out = path.join(ROOT, 'sticky-notes.html');
fs.writeFileSync(out, html);
const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`✓ 单文件版已生成：sticky-notes/sticky-notes.html（${kb} KB）`);
console.log('  双击即可运行；也可执行 node sticky-notes/tools/verify.mjs sticky-notes.html 验证。');
