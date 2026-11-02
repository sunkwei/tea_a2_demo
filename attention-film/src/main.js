// main.js — 播放器：播放 / 暂停 / 拖拽进度 / 快捷键
import { W, H } from './draw.js';
import { renderFrame, DURATION } from './film.js';
import { renderMusic } from './music.js';

const canvas = document.getElementById('film');
const ctx = canvas.getContext('2d', { alpha: false });
const playBtn = document.getElementById('play');
const seek = document.getElementById('seek');
const clock = document.getElementById('clock');
const muteBtn = document.getElementById('mute');

const params = new URLSearchParams(location.search);
const clean = params.get('clean') === '1';
if (clean) document.body.classList.add('clean');

let time = 0;
let playing = !clean && params.get('play') !== '0';
let last = 0;
let scrubbing = false;
let audio = null;
let audioOn = false;

seek.max = String(DURATION);

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function draw() {
  renderFrame(ctx, time);
  seek.value = String(time);
  clock.textContent = `${fmt(time)} / ${fmt(DURATION)}`;
}

function tick(now) {
  if (!last) last = now;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (playing && !scrubbing) {
    time += dt;
    if (time >= DURATION) {
      time = DURATION;
      playing = false;
      playBtn.textContent = '▶';
    }
    if (audio && audioOn && Number.isFinite(audio.duration)) audio.currentTime = Math.min(time, audio.duration);
  }
  draw();
  requestAnimationFrame(tick);
}

playBtn.addEventListener('click', () => {
  if (time >= DURATION) time = 0;
  playing = !playing;
  playBtn.textContent = playing ? '⏸' : '▶';
  if (playing && audio && audioOn) audio.play().catch(() => {});
  else if (audio) audio.pause();
});

seek.addEventListener('pointerdown', () => {
  scrubbing = true;
});
seek.addEventListener('pointerup', () => {
  scrubbing = false;
});
seek.addEventListener('input', () => {
  time = Number(seek.value);
  draw();
});

/* 背景音乐（程序化生成，首次点击时启用） */
async function toggleMusic() {
  if (!audio) {
    const buf = await renderMusic(DURATION);
    const blob = new Blob([buf], { type: 'audio/wav' });
    audio = new Audio(URL.createObjectURL(blob));
    audio.loop = true;
    audio.volume = 0.55;
  }
  audioOn = !audioOn;
  muteBtn.textContent = audioOn ? '♪' : '♪̸';
  if (audioOn) {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(time, audio.duration);
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}
muteBtn.addEventListener('click', toggleMusic);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    playBtn.click();
  } else if (e.code === 'ArrowRight') {
    time = Math.min(DURATION, time + (e.shiftKey ? 5 : 1));
    draw();
  } else if (e.code === 'ArrowLeft') {
    time = Math.max(0, time - (e.shiftKey ? 5 : 1));
    draw();
  } else if (e.key === 'm' || e.key === 'M') {
    toggleMusic();
  }
});

/* 供无头渲染使用 */
window.__film = {
  duration: DURATION,
  get time() {
    return time;
  },
  setTime(t) {
    time = Math.max(0, Math.min(DURATION, t));
    playing = false;
    draw();
    return time;
  },
  play() {
    playing = true;
    playBtn.textContent = '⏸';
  },
  pause() {
    playing = false;
    playBtn.textContent = '▶';
  },
  render: (t) => renderFrame(ctx, t),
  music: () => renderMusic(DURATION),
  width: W,
  height: H,
};

if (params.has('t')) {
  time = Number(params.get('t'));
}
draw();
requestAnimationFrame(tick);
window.__filmReady = true;
