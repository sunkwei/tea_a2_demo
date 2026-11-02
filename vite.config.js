import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { proxyMiddleware } from './iptv-player/tools/proxy.mjs';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

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
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: r('./index.html'),
        snake: r('./snake-race/index.html'),
        film: r('./attention-film/index.html'),
        iptv: r('./iptv-player/index.html'),
      },
    },
  },
});
