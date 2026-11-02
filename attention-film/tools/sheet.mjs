// tools/sheet.mjs — 把多张截图拼成一张联系表，方便一次看全
// 用法: node tools/sheet.mjs out.png 2x3 a.png b.png ...
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [out, grid, ...files] = process.argv.slice(2);
if (!out || !files.length) {
  console.error('用法: node tools/sheet.mjs out.png 2x3 a.png b.png ...');
  process.exit(1);
}
const [cols, rows] = grid.split('x').map(Number);
const listFile = path.join(path.dirname(out), '_concat.txt');
fs.writeFileSync(
  listFile,
  files.map((f) => `file '${path.resolve(f).replace(/\\/g, '/')}'`).join('\n'),
  'utf8'
);
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-vf',
    `scale=640:360,tile=${cols}x${rows}`,
    '-frames:v',
    '1',
    out,
  ],
  { stdio: 'inherit' }
);
fs.unlinkSync(listFile);
console.log('sheet ->', out);
