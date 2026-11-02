import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

/**
 * 把构建产物里的 CSS / JS 全部内联进单个 HTML。
 *
 * 为什么要单独一份构建：
 *   双击打开 index.html 时用的是 file:// 协议，浏览器禁止加载外部 ES 模块
 *   （CORS：origin 为 null），因此普通的多文件构建在 file:// 下必然白屏。
 *   把所有代码内联成一个 <script type="module"> 后就不再需要 fetch 任何模块，
 *   file:// 下可以直接运行。
 */
/** 产物改名：dist-single/index.html → dist-single/iptv-player.html（更好认） */
function renameOutput() {
  return {
    name: 'rename-output',
    closeBundle() {
      const dir = r('./iptv-player/dist-single');
      const from = path.join(dir, 'index.html');
      const to = path.join(dir, 'iptv-player.html');
      if (fs.existsSync(from)) fs.renameSync(from, to);
    },
  };
}

function inlineEverything() {
  return {
    name: 'inline-everything',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlFile = Object.values(bundle).find((f) => f.fileName.endsWith('.html'));
      if (!htmlFile) return;
      let source = String(htmlFile.source);

      const escapeScript = (code) => code.replace(/<\/script>/gi, '<\\/script>');

      for (const [fileName, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !fileName.endsWith('.css')) continue;
        const css = String(asset.source);
        const re = new RegExp(`<link[^>]*href="[^"]*${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
        source = source.replace(re, () => `<style>\n${css}\n</style>`);
        delete bundle[fileName];
      }

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !fileName.endsWith('.js')) continue;
        const js = escapeScript(String(chunk.code));
        const re = new RegExp(`<script[^>]*src="[^"]*${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`);
        const isModule = /type="module"/.test(source.match(re)?.[0] || '');
        source = source.replace(re, () => `<script${isModule ? ' type="module"' : ''}>\n${js}\n</script>`);
        delete bundle[fileName];
      }

      // modulepreload 链接在单文件里没意义
      source = source.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');

      htmlFile.source = source;
    },
  };
}

export default defineConfig({
  root: r('./iptv-player'),
  base: './',
  plugins: [...(process.env.SKIP_INLINE ? [] : [inlineEverything()]), renameOutput()],
  build: {
    target: 'es2020',
    outDir: r('./iptv-player/dist-single'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { 'iptv-player.html': r('./iptv-player/index.html') },
      output: { entryFileNames: 'assets/iptv.js', assetFileNames: 'assets/[name][extname]' },
    },
  },
});
