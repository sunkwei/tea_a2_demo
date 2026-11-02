/**
 * 贪吃蛇竞赛 · UI 主程序
 */

import { createGame, DEATH_LABEL } from './engine.js';
import { STRATEGIES, STRATEGY_IDS } from './ai/bots.js';
import { runTick, TICK_BUDGET_MS } from './runner.js';
import { Renderer } from './render.js';

const COLORS = ['#4ade80', '#f472b6', '#60a5fa', '#fbbf24'];
const NAMES = ['青竹', '绯樱', '碧海', '金瞳'];
const DEFAULT_STRATEGY = ['random', 'safe', 'hunter', 'territorial'];

const $ = (sel) => document.querySelector(sel);

const canvas = $('#board');
const renderer = new Renderer(canvas);

const ui = {
  tick: $('#stat-tick'),
  alive: $('#stat-alive'),
  last: $('#stat-last'),
  max: $('#stat-max'),
  segCount: $('#seg-count'),
  segFood: $('#seg-food'),
  speed: $('#speed'),
  speedLabel: $('#speed-label'),
  snakeConfig: $('#snake-config'),
  scoreboard: $('#scoreboard'),
  btnStart: $('#btn-start'),
  btnPause: $('#btn-pause'),
  btnRestart: $('#btn-restart'),
  overlay: $('#overlay'),
  overlayTitle: $('#overlay-title'),
  overlayDesc: $('#overlay-desc'),
  overlayBtn: $('#overlay-btn'),
  budgetFill: $('#budget-fill'),
  budgetLast: $('#budget-last'),
  budgetMax: $('#budget-max'),
  budgetBot: $('#budget-bot'),
  budgetViolations: $('#budget-violations'),
  history: $('#history'),
};

let snakeCount = 4;
let foodMode = 0; // 0 = 随蛇数，1 = 标准单食物
let selections = [...DEFAULT_STRATEGY];
let game = null;
let paused = false;
let started = false;
let acc = 0;
let lastTs = 0;
let matchNo = 0;
const history = [];

/* ------------------------------------------------------------------ */
/* 配置面板                                                            */
/* ------------------------------------------------------------------ */

function buildSnakeConfig() {
  ui.snakeConfig.innerHTML = '';
  for (let i = 0; i < snakeCount; i++) {
    const row = document.createElement('div');
    row.className = 'snake-row';
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = COLORS[i];
    dot.style.color = COLORS[i];
    const sel = document.createElement('select');
    for (const id of STRATEGY_IDS) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = STRATEGIES[id].name;
      if (selections[i] === id) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      const choice = sel.value;
      if (choice === 'random') {
        // 规则约束：场上只允许一条「随机避障」蛇，其它必须是设计过的算法
        const other = selections.findIndex((v, k) => v === 'random' && k !== i);
        if (other >= 0) selections[other] = 'safe';
      }
      selections[i] = choice;
      buildSnakeConfig();
    });
    row.append(dot, sel);
    ui.snakeConfig.appendChild(row);

    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = STRATEGIES[selections[i]].desc;
    ui.snakeConfig.appendChild(desc);
  }
}

function buildScoreboard() {
  ui.scoreboard.innerHTML = '';
  if (!game) return;
  for (const s of game.snakes) {
    const row = document.createElement('div');
    row.className = 'sb-row' + (s.alive ? '' : ' dead') + (game.winnerId === s.id ? ' winner' : '');
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = s.color;
    const name = document.createElement('div');
    name.className = 'sb-name';
    const nm = document.createElement('span');
    nm.textContent = s.name;
    const st = document.createElement('small');
    st.textContent = s.alive
      ? STRATEGIES[s.strategy].name
      : `${STRATEGIES[s.strategy].name} · ${DEATH_LABEL[s.deathCause] || '出局'}`;
    name.append(nm, st);
    const stat = document.createElement('div');
    stat.className = 'sb-stat';
    const len = document.createElement('b');
    len.textContent = s.body.length;
    const sub = document.createElement('span');
    sub.textContent = `长度 · ${s.foodEaten} 食物`;
    stat.append(len, sub);
    row.append(dot, name, stat);
    ui.scoreboard.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/* 游戏流程                                                            */
/* ------------------------------------------------------------------ */

function startMatch() {
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  const snakes = [];
  for (let i = 0; i < snakeCount; i++) {
    snakes.push({
      id: i,
      name: NAMES[i],
      color: COLORS[i],
      strategy: selections[i] || 'safe',
    });
  }
  game = createGame({
    width: 32,
    height: 20,
    snakes,
    seed,
    foodCount: foodMode === 1 ? 1 : null,
  });
  renderer.reset();
  renderer.resize(game);
  renderer.sync(game, []);
  paused = false;
  started = true;
  acc = 0;
  ui.btnPause.textContent = '暂停';
  ui.overlay.classList.add('hidden');
  buildScoreboard();
}

function endMatch() {
  const winner = game.snakes.find((s) => s.id === game.winnerId);
  matchNo++;
  history.unshift({
    no: matchNo,
    winner: winner ? winner.name : '无人存活',
    strategy: winner ? STRATEGIES[winner.strategy].name : '-',
    ticks: game.ticks,
    result: game.result,
  });
  if (history.length > 12) history.pop();
  renderHistory();

  ui.overlay.classList.remove('hidden');
  if (winner) {
    ui.overlayTitle.textContent = `🏆 ${winner.name} 获胜`;
    const why = {
      survivor: '成为场上最后一条蛇',
      'board-full': '填满棋盘，长度最长',
      timeout: '回合上限，按长度判定',
      draw: '全员阵亡',
    }[game.result] || '';
    ui.overlayDesc.textContent = `${STRATEGIES[winner.strategy].name} · 坚持 ${game.ticks} 回合 · ${why}`;
  } else {
    ui.overlayTitle.textContent = '全员阵亡';
    ui.overlayDesc.textContent = `坚持了 ${game.ticks} 回合`;
  }
  ui.overlayBtn.textContent = '再来一局';
  ui.btnPause.textContent = '暂停';
  paused = false;
}

function renderHistory() {
  if (!history.length) {
    ui.history.textContent = '还没有比赛记录';
    return;
  }
  ui.history.innerHTML = '';
  for (const h of history) {
    const row = document.createElement('div');
    const left = document.createElement('span');
    left.textContent = `#${h.no} ${h.winner}`;
    const right = document.createElement('span');
    right.textContent = `${h.strategy} · ${h.ticks} 回合`;
    row.append(left, right);
    ui.history.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function updateHud() {
  if (!game) return;
  const st = game.stats;
  ui.tick.textContent = game.ticks;
  ui.alive.textContent = game.snakes.filter((s) => s.alive).length;
  ui.last.textContent = `${st.lastTickMs.toFixed(1)} ms`;
  ui.max.textContent = `${st.maxTickMs.toFixed(1)} ms`;

  ui.budgetLast.textContent = `${st.lastTickMs.toFixed(2)} ms`;
  ui.budgetMax.textContent = `${st.maxTickMs.toFixed(2)} ms`;
  ui.budgetBot.textContent = `${st.maxBotMs.toFixed(2)} ms`;
  ui.budgetViolations.textContent = st.overBudgetTicks;

  const ratio = Math.min(1, st.lastTickMs / TICK_BUDGET_MS);
  ui.budgetFill.style.width = `${(ratio * 100).toFixed(1)}%`;
  ui.budgetFill.className = ratio > 0.8 ? 'bad' : ratio > 0.5 ? 'warn' : '';

  buildScoreboard();
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

function frame(ts) {
  requestAnimationFrame(frame);
  if (!lastTs) lastTs = ts;
  const dt = Math.min(120, ts - lastTs);
  lastTs = ts;

  const stepMs = 1000 / Number(ui.speed.value);
  if (game && started && !paused && game.status === 'running') {
    acc += dt;
    let guard = 0;
    while (acc >= stepMs && game.status === 'running' && guard++ < 6) {
      acc -= stepMs;
      runTick(game);
      renderer.sync(game, game.events);
    }
  }

  if (game) {
    const alpha = game.status === 'running' ? Math.min(1, acc / stepMs) : 1;
    renderer.draw(game, alpha);
    updateHud();
    if (game.status === 'over' && !paused) {
      paused = true;
      endMatch();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

ui.segCount.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  [...ui.segCount.children].forEach((b) => b.classList.toggle('active', b === btn));
  snakeCount = Number(btn.dataset.n);
  const next = selections.slice(0, snakeCount);
  while (next.length < snakeCount) next.push(DEFAULT_STRATEGY[next.length] || 'safe');
  selections = next;
  buildSnakeConfig();
});

ui.segFood.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  [...ui.segFood.children].forEach((b) => b.classList.toggle('active', b === btn));
  foodMode = Number(btn.dataset.f);
});

ui.speed.addEventListener('input', () => {
  ui.speedLabel.textContent = ui.speed.value;
});

ui.btnStart.addEventListener('click', () => startMatch());
ui.btnRestart.addEventListener('click', () => startMatch());
ui.btnPause.addEventListener('click', () => {
  if (!game || game.status !== 'running') return;
  paused = !paused;
  ui.btnPause.textContent = paused ? '继续' : '暂停';
});
ui.overlayBtn.addEventListener('click', () => startMatch());

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    ui.btnPause.click();
  } else if (e.key === 'r' || e.key === 'R') {
    startMatch();
  }
});

window.addEventListener('resize', () => {
  if (game) renderer.resize(game);
});

buildSnakeConfig();
renderHistory();
requestAnimationFrame(frame);

// 调试钩子：便于在控制台或无头脚本里检查对局状态
window.snakeArena = {
  get game() {
    return game;
  },
  startMatch,
  runTick,
  strategies: STRATEGIES,
  get history() {
    return history;
  },
};
