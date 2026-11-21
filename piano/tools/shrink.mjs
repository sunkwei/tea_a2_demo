/* 把 1280x720 的截图缩小，便于连续查看 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');

/* 用 Edge（无头）把 PNG 缩一半，纯靠浏览器 canvas 实现，避免引第三方依赖 */
import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const targets = process.argv.slice(2);
if (!targets.length) targets.push('01-free.png');

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--allow-file-access-from-files', '--no-first-run']
});
const page = await browser.newPage();

for (const name of targets) {
  const src = path.join(SHOTS, name);
  const b64 = fs.readFileSync(src).toString('base64');
  const out = await page.evaluate(async (b64, scale) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png').split(',')[1];
  }, b64, 0.62);
  const dst = path.join(SHOTS, 'small-' + name);
  fs.writeFileSync(dst, Buffer.from(out, 'base64'));
  console.log('已生成', path.basename(dst));
}

await browser.close();
