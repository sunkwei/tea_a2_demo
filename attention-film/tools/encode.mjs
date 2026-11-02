// tools/encode.mjs — 帧序列 → MP4（可选叠加程序化生成的背景音乐）
// 用法: node tools/encode.mjs [fps] [framesDir] [outFile]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = process.argv[2] || '30';
const FRAMES = path.resolve(HERE, process.argv[3] || '../release/frames');
const OUT = path.resolve(HERE, process.argv[4] || '../release/attention-film.mp4');
const SILENT = OUT.replace(/\.mp4$/, '-silent.mp4');
const MUSIC = path.resolve(HERE, '../release/music.wav');

const run = (args) => {
  console.log('ffmpeg', args.join(' '));
  execFileSync('ffmpeg', ['-y', ...args], { stdio: 'inherit' });
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });

run([
  '-framerate',
  FPS,
  '-i',
  path.join(FRAMES, 'f%05d.jpg'),
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  SILENT,
]);

if (fs.existsSync(MUSIC)) {
  run([
    '-i',
    SILENT,
    '-i',
    MUSIC,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-shortest',
    '-movflags',
    '+faststart',
    OUT,
  ]);
} else {
  fs.copyFileSync(SILENT, OUT);
  console.log('（未找到 music.wav，只输出无声版）');
}
console.log('成片 →', OUT);
