/* AI 三国杀 · 前端（原生 ES module，无框架依赖） */

const els = {
  seats: document.getElementById('seats'),
  fx: document.getElementById('fxLayer'),
  hand: document.getElementById('hand'),
  handTitle: document.getElementById('handTitle'),
  handHint: document.getElementById('handHint'),
  log: document.getElementById('log'),
  modelList: document.getElementById('modelList'),
  deckNum: document.getElementById('deckNum'),
  discardNum: document.getElementById('discardNum'),
  turnBadge: document.getElementById('turnBadge'),
  connBadge: document.getElementById('connBadge'),
  speed: document.getElementById('speed'),
  speedVal: document.getElementById('speedVal'),
  btnStart: document.getElementById('btnStart'),
  btnPeek: document.getElementById('btnPeek'),
};

const MODEL_COLOR = {
  'minimax-m3.1-flash': '#e0703a',
  'deepseek-flash': '#4b8bf5',
  'mimo-v2.6-flash': '#38b48b',
};

let state = null;
let queue = [];
let speed = 2;
let peek = false;
let viewSeat = null;
let source = null;
let bubbleTimer = null;

/* ----------------------------------------------------------------- 工具 */
function cardClass(name) {
  if (name === '杀') return 'kill';
  if (name === '闪') return 'dodge';
  if (name === '桃') return 'peach';
  if (name === '酒') return 'wine';
  if (name === '无懈可击') return 'nullify';
  if (['南蛮入侵', '万箭齐发', '乐不思蜀', '兵粮寸断', '闪电'].includes(name)) return 'trick';
  return 'equip';
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function cardNode(card, small = false) {
  const n = el('div', `card ${cardClass(card.name)}${small ? ' mini' : ''}`);
  n.appendChild(el('div', 'corner tl', card.suit + card.rank));
  n.appendChild(el('div', 'name', card.name));
  n.appendChild(el('div', 'corner br', card.suit + card.rank));
  return n;
}

/* ----------------------------------------------------------------- 连接 */
function connect() {
  if (source) source.close();
  source = new EventSource('/api/events');
  source.onopen = () => {
    els.connBadge.textContent = '已连接';
    els.connBadge.className = 'badge';
  };
  source.onerror = () => {
    els.connBadge.textContent = '连接断开，重试中…';
    els.connBadge.className = 'badge err';
  };
  source.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);
      queue.push(payload);
    } catch (err) {
      console.warn('坏事件', err);
    }
  };
}

/* 按速度逐条消费事件（实现快进 / 慢放） */
function drain() {
  const interval = 320 / speed;
  if (queue.length && Date.now() - (drain.last || 0) > interval) {
    drain.last = Date.now();
    const payload = queue.shift();
    handle(payload.ev, payload.state);
  }
  requestAnimationFrame(drain);
}

/* ----------------------------------------------------------------- 事件 */
function handle(ev, st) {
  if (st) state = st;
  const type = ev.type || 'info';
  const text = ev.text || '';

  switch (type) {
    case 'phase':
      logLine(text, 'phase');
      break;
    case 'say':
      logLine(`「${text}」`, 'say');
      showBubble(ev.player, text);
      break;
    case 'action':
      logLine('→ ' + text, 'action');
      flyCard(ev.player, text);
      break;
    case 'damage':
      logLine('* ' + text, 'damage');
      flashSeat(ev.player);
      break;
    case 'heal':
      logLine('* ' + text, 'heal');
      break;
    case 'death':
      logLine('* ' + text, 'death');
      flashSeat(ev.player);
      break;
    case 'win':
      logLine('★ ' + text, 'win');
      els.turnBadge.textContent = text;
      break;
    case 'result':
      logLine('★ ' + text, 'win');
      els.turnBadge.textContent = text;
      break;
    case 'error':
      logLine('!! ' + text, 'error');
      break;
    case 'think':
      if (ev.phase === 'done' && ev.reasoning) {
        logLine(`（${ev.model} 思考 ${Number(ev.elapsed).toFixed(1)}s）${ev.reasoning.slice(0, 160)}`, 'think');
      }
      break;
    case 'info':
      logLine(text, 'info');
      break;
    default:
      break;
  }
  render();
}

function logLine(text, cls) {
  if (!text) return;
  const n = el('div', `log-line ${cls || ''}`, text);
  els.log.appendChild(n);
  while (els.log.childElementCount > 400) els.log.removeChild(els.log.firstChild);
  els.log.scrollTop = els.log.scrollHeight;
}

/* ----------------------------------------------------------------- 动效 */
function seatCenter(idx) {
  const node = document.querySelector(`.seat-${idx}`);
  if (!node) return { x: 0, y: 0 };
  const r = node.getBoundingClientRect();
  const t = els.fx.getBoundingClientRect();
  return { x: r.left - t.left + r.width / 2, y: r.top - t.top + r.height / 2 };
}

function flyCard(idx, text) {
  if (idx === undefined || idx === null) return;
  const from = seatCenter(idx);
  const t = els.fx.getBoundingClientRect();
  const to = { x: t.width / 2, y: t.height / 2 };
  const m = /使用【([^】]+)】/.exec(text || '');
  const name = m ? m[1] : '牌';
  const n = el('div', `fly ${cardClass(name)}`, name);
  n.style.left = from.x + 'px';
  n.style.top = from.y + 'px';
  n.style.setProperty('--dx', (to.x - from.x) + 'px');
  n.style.setProperty('--dy', (to.y - from.y) + 'px');
  n.style.setProperty('--rot', (Math.random() * 40 - 20).toFixed(1) + 'deg');
  els.fx.appendChild(n);
  setTimeout(() => n.remove(), 800);
}

function flashSeat(idx) {
  if (idx === undefined || idx === null) return;
  const node = document.querySelector(`.seat-${idx}`);
  if (!node) return;
  node.classList.remove('hurt');
  void node.offsetWidth;
  node.classList.add('hurt');
}

function showBubble(idx, text) {
  document.querySelectorAll('.bubble').forEach((b) => b.remove());
  if (idx === undefined || idx === null) return;
  const node = document.querySelector(`.seat-${idx}`);
  if (!node) return;
  const b = el('div', 'bubble', text);
  const parent = node.parentElement;
  parent.appendChild(b);
  const r = node.getBoundingClientRect();
  const p = parent.getBoundingClientRect();
  b.style.left = (r.left - p.left + r.width / 2 - 40) + 'px';
  b.style.top = (r.top - p.top - 34) + 'px';
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => b.remove(), 4200);
}

/* ----------------------------------------------------------------- 渲染 */
function render() {
  if (!state) return;
  els.deckNum.textContent = state.deck;
  els.discardNum.textContent = state.discard;
  const phaseName = {
    judge: '判定', draw: '摸牌', play: '出牌', discard: '弃牌', end: '回合结束', ready: '准备', init: '开局',
  }[state.phase] || state.phase || '';
  const cur = state.players[state.current];
  els.turnBadge.textContent = state.finished
    ? '对局结束'
    : `第 ${state.turn} 回合 · ${cur ? cur.name : ''} · ${phaseName}`;

  renderSeats();
  renderModels();
  renderHand();
}

function renderSeats() {
  const players = state.players || [];
  els.seats.innerHTML = '';
  players.forEach((p) => {
    const node = el('div', `seat seat-${p.idx}`);
    if (p.idx === state.current && !state.finished) node.classList.add('active');
    if (!p.alive) node.classList.add('dead');

    const top = el('div', 'seat-top');
    top.appendChild(el('div', 'seat-name', `${p.idx + 1}号位 · ${p.name}`));
    node.appendChild(top);

    const badge = el('div', 'seat-model', p.model_label);
    badge.style.color = MODEL_COLOR[p.model] || '#9c9287';
    badge.style.borderColor = (MODEL_COLOR[p.model] || '#555') + '66';
    node.appendChild(badge);

    node.appendChild(el('div', 'seat-sub', `${p.faction}·${p.title || p.hero}　${p.skills.map((s) => '【' + s.name + '】').join('')}`));

    const hp = el('div', 'seat-hp');
    for (let i = 0; i < p.max_hp; i++) {
      hp.appendChild(el('span', i < p.hp ? '' : 'lost', i < p.hp ? '❤' : '♡'));
    }
    hp.appendChild(el('span', '', ` ${p.hp}/${p.max_hp}`));
    node.appendChild(hp);

    const row = el('div', 'seat-row');
    row.appendChild(el('span', 'chip handcount', `手牌 ${p.hand.length}`));
    p.equips.forEach((c) => row.appendChild(el('span', 'chip', c.name)));
    p.delayed.forEach((n) => row.appendChild(el('span', 'chip delay', n)));
    node.appendChild(row);

    const st = (state.models || {})[p.model] || {};
    const status = el('div', 'seat-status' + (st.state === '思考中…' ? ' thinking' : ''),
      p.alive ? (st.state || '') : '已阵亡');
    node.appendChild(status);

    node.addEventListener('click', () => {
      viewSeat = viewSeat === p.idx ? null : p.idx;
      renderHand();
    });
    els.seats.appendChild(node);
  });
}

function renderModels() {
  const players = state.players || [];
  els.modelList.innerHTML = '';
  const models = state.models || {};
  players.forEach((p) => {
    const st = models[p.model] || {};
    const item = el('div', 'model-item');
    const top = el('div', 'model-top');
    const dot = el('div', 'dot' + (st.state === '思考中…' ? ' busy' : ''));
    dot.style.background = MODEL_COLOR[p.model] || '#9c9287';
    top.appendChild(dot);
    top.appendChild(el('div', 'model-name', p.model_label));
    top.appendChild(el('div', 'model-time', st.elapsed ? `${Number(st.elapsed).toFixed(1)}s` : ''));
    item.appendChild(top);
    item.appendChild(el('div', 'model-hero', `${p.name}（${p.hero}）· ${p.faction} · ${p.hp}/${p.max_hp} 体力`));
    if (st.say) item.appendChild(el('div', 'model-say', `「${st.say}」`));
    els.modelList.appendChild(item);
  });
}

function renderHand() {
  els.hand.innerHTML = '';
  const players = state.players || [];
  if (!players.length) return;
  let idx = viewSeat !== null && viewSeat !== undefined ? viewSeat : state.current;
  const p = players[idx];
  if (!p) return;
  els.handTitle.textContent = `手牌 · ${p.name}（${p.hero}） · ${p.model_label}`;
  els.handHint.textContent = viewSeat === null
    ? '当前行动角色 · 点击上方座位可查看其他角色手牌'
    : `正在查看 ${p.name} 的手牌 · 再次点击座位取消`;

  const cards = peek ? players.flatMap((x) => x.hand.map((c) => ({ c, owner: x.idx }))) : p.hand;
  if (peek) {
    players.forEach((x) => {
      x.hand.forEach((c) => {
        const node = cardNode(c, true);
        node.title = `${x.name} 的【${c.name}】`;
        els.hand.appendChild(node);
      });
    });
    return;
  }
  p.hand.forEach((c) => {
    const node = cardNode(c);
    node.title = `${c.name} · ${c.suit}${c.rank}`;
    els.hand.appendChild(node);
  });
}

/* ----------------------------------------------------------------- 交互 */
els.btnStart.addEventListener('click', async () => {
  els.btnStart.disabled = true;
  try {
    await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    els.log.innerHTML = '';
    queue = [];
    viewSeat = null;
  } finally {
    setTimeout(() => (els.btnStart.disabled = false), 800);
  }
});

els.btnPeek.addEventListener('click', () => {
  peek = !peek;
  els.btnPeek.textContent = peek ? '隐藏手牌' : '明牌';
  renderHand();
});

els.speed.addEventListener('input', () => {
  speed = Number(els.speed.value);
  els.speedVal.textContent = speed.toFixed(1) + '×';
});

fetch('/api/state').then((r) => r.json()).then((st) => { state = st; render(); }).catch(() => {});
connect();
drain();
