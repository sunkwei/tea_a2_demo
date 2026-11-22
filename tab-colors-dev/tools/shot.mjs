/**
 * 抓标签页内容截图（devtools 截图通道）
 *   node tools/shot.mjs <port> <out.png> <tabUrlPart> [width] [height]
 */
import fs from 'node:fs';
import { RdpClient } from './rdp.mjs';

const port = Number(process.argv[2]);
const out = process.argv[3] || 'shot.png';
const urlPart = process.argv[4] || '';
const W = Number(process.argv[5] || 0);
const H = Number(process.argv[6] || 0);

const client = new RdpClient(20000);
await client.connect(port);

const root = await client.request('getRoot');
const tabs = await client.request({ to: 'root', type: 'listTabs' });
const hit = urlPart ? tabs.tabs.find((t) => (t.url || '').includes(urlPart)) : tabs.tabs[0];
if (!hit) throw new Error('找不到标签页 ' + urlPart);

const target = await client.request({ to: hit.actor, type: 'getTarget' });
const bcID = target.frame.browsingContextID;

const candidates = [];
if (W && H) {
  candidates.push({ browsingContextID: bcID, rect: { left: 0, top: 0, width: W, height: H }, snapshotScale: 1, disableFlash: true });
}
candidates.push({ browsingContextID: bcID, snapshotScale: 0.5, disableFlash: true });
candidates.push({ browsingContextID: bcID, snapshotScale: 0.25, disableFlash: true });

let saved = null;
for (const args of candidates) {
  try {
    const res = await client.request({ to: root.screenshotActor, type: 'capture', args });
    const data = res.value && res.value.data;
    if (data) {
      const b64 = data.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(out, Buffer.from(b64, 'base64'));
      saved = out;
      console.log('saved', out, fs.statSync(out).size, 'bytes  args=', JSON.stringify(args));
      break;
    }
    console.log('失败:', JSON.stringify(res.value && res.value.messages));
  } catch (e) {
    console.log('capture 异常:', e.message);
  }
}
if (!saved) process.exit(1);
client.disconnect();
