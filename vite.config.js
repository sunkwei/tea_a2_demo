import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { proxyMiddleware } from './iptv-player/tools/proxy.mjs';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

/**
 * 终末地页面自带 importmap，这样脱离打包器、用普通静态服务器也能直接跑
 * （node endfield-ship/tools/serve.mjs）。
 *
 * 但走 vite 时，three 会被解析/打包，importmap 就成了多余的死配置；
 * 更麻烦的是它可能在 dev 模式里抢在 vite 的解析之前接管 bare specifier，
 * 导致页面加载出「两份 three 实例」。所以这里在 vite 下把它摘掉。
 */
function stripImportMap() {
  return {
    name: 'endfield-strip-importmap',
    transformIndexHtml(html, ctx) {
      if (!ctx.path.includes('endfield-ship')) return html;
      return html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    {
      // 直播服务器大多不带 CORS 头，这里提供同源转发，前端自动探测后启用
      name: 'iptv-stream-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => proxyMiddleware(req, res, next));
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => proxyMiddleware(req, res, next));
      },
    },
    stripImportMap(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false,
    proxy: {
      // AI 三国杀的后端（SSE 事件流 + 对局接口）
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        // 根 index.html 是「全仓库项目索引页」，各项目在各自目录里
        index: r('./index.html'),
        meow: r('./meow-mart/index.html'),
        snake: r('./snake-race/index.html'),
        film: r('./attention-film/index.html'),
        iptv: r('./iptv-player/index.html'),
        sanguosha: r('./sanguosha-ai/web/index.html'),
        endfield: r('./endfield-ship/index.html'),
      },
    },
  },
});
