/**
 * 独立静态服务器：托管 dist/ 并提供 /api/proxy 流代理。
 *
 *   node iptv-player/tools/serve.mjs          # 默认 5180 端口
 *   PORT=8080 node iptv-player/tools/serve.mjs
 *
 * 之所以需要它：直播服务器大多不带 CORS 头，浏览器直连会被拦。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './proxy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const PORT = Number(process.env.PORT || 5180);

if (!fs.existsSync(path.join(ROOT, 'iptv-player', 'index.html'))) {
  console.error('找不到 dist/iptv-player/index.html，请先执行 npm run build');
  process.exit(1);
}

createStaticServer(ROOT).listen(PORT, '127.0.0.1', () => {
  console.log(`IPTV 剧场 → http://127.0.0.1:${PORT}/iptv-player/index.html`);
  console.log(`流代理    → http://127.0.0.1:${PORT}/api/proxy?url=<编码后的地址>`);
});
