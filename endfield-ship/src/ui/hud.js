/**
 * HUD 层：构建 DOM、绑定交互、每帧刷新数据
 *
 * 界面语言完全照着明日方舟来：
 * 斜切面板、角标括号、黄黑警示条、中英双语标签、等宽数据、终端流。
 */

import {
  SHIP,
  HOTSPOTS,
  TELEMETRY_META,
  formatClock,
  formatBar,
  formatPercent,
} from '../core.js';

/* --------------------------- SVG 素材 --------------------------- */

const ICONS = {
  radar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v18M3 12h18" opacity=".5"/><path d="M12 12l6-5" stroke-width="2"/></svg>`,
  terminal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="4" width="19" height="16"/><path d="M6 9l3 3-3 3M12 15h5"/></svg>`,
  crew: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 20c1.6-4 4-5.6 7.5-5.6s5.9 1.6 7.5 5.6"/></svg>`,
  log: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h16M4 10h16M4 15h11M4 20h7"/></svg>`,
  map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>`,
};

/** 终端管理员的抽象肖像（几何化的战术头盔剪影） */
const PORTRAIT = `
<svg viewBox="0 0 100 100">
  <defs>
    <linearGradient id="pg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#243342"/>
      <stop offset="1" stop-color="#080d13"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#pg)"/>
  <g stroke="#5ff0e4" stroke-width="1" opacity=".35" fill="none">
    <path d="M0 22h100M0 44h100M0 66h100M0 88h100M22 0v100M44 0v100M66 0v100M88 0v100"/>
  </g>
  <g fill="#c9d6e2">
    <path d="M50 20c-11 0-19 8-19 19v13l5 6v13h28V58l5-6V39c0-11-8-19-19-19z"/>
    <path d="M31 58h38v10c0 3-2 5-5 5H36c-3 0-5-2-5-5z"/>
  </g>
  <g fill="#1b2630">
    <path d="M36 40h28v9H36z"/>
  </g>
  <g fill="#5ff0e4">
    <rect x="38" y="42" width="9" height="4"/>
    <rect x="53" y="42" width="9" height="4"/>
  </g>
  <path d="M50 12l3 7h-6z" fill="#ffb01f"/>
</svg>`;

/** 聚焦面板的插画：按 kind 生成的抽象图形 */
function heroSvg(kind) {
  const head = `<svg viewBox="0 0 200 200" fill="none">`;
  const tail = `</svg>`;
  switch (kind) {
    case '沙盘投影':
      return `${head}
        <circle cx="100" cy="120" r="62" stroke="#5ff0e4" stroke-width="1.2" opacity=".7"/>
        <circle cx="100" cy="120" r="44" stroke="#5ff0e4" stroke-width=".8" opacity=".45"/>
        <circle cx="100" cy="120" r="26" stroke="#ffb01f" stroke-width=".8" opacity=".6"/>
        <path d="M38 120h124M100 58v124" stroke="#5ff0e4" stroke-width=".6" opacity=".3"/>
        <path d="M100 120L160 82" stroke="#5ff0e4" stroke-width="1.6" opacity=".85"/>
        <path d="M60 76l14-10 12 8-10 12zM120 140l16-8 10 14-14 8z" fill="#5ff0e4" opacity=".18" stroke="#5ff0e4" stroke-width=".8"/>
        <ellipse cx="100" cy="120" rx="62" ry="18" stroke="#5ff0e4" stroke-width=".7" opacity=".3"/>
        ${tail}`;
    case '观景结构':
      return `${head}
        <circle cx="100" cy="100" r="66" fill="#0d1a26"/>
        <circle cx="100" cy="100" r="66" stroke="#ffb01f" stroke-width="1.4"/>
        <path d="M40 128c22-30 42-16 60-40s34-12 52-34" stroke="#5ff0e4" stroke-width="1.2" opacity=".8"/>
        <path d="M34 100h132M100 34v132" stroke="#5ff0e4" stroke-width=".7" opacity=".45"/>
        <circle cx="100" cy="100" r="84" stroke="#5ff0e4" stroke-width=".5" opacity=".25" stroke-dasharray="4 6"/>
        ${tail}`;
    case '环境控制':
      return `${head}
        <rect x="62" y="34" width="76" height="132" fill="#101a24" stroke="#5ff0e4" stroke-width="1.2"/>
        <g stroke="#5ff0e4" stroke-width="1" opacity=".5">
          <path d="M72 58h56M72 70h56M72 82h56M72 94h56M72 106h56M72 118h56M72 130h56M72 142h56M72 154h56"/>
        </g>
        <rect x="70" y="42" width="8" height="116" fill="#5ff0e4" opacity=".55"/>
        <circle cx="116" cy="50" r="7" stroke="#ffb01f" stroke-width="1.2"/>
        ${tail}`;
    case '货运接口':
      return `${head}
        <rect x="44" y="30" width="112" height="140" fill="#14181d" stroke="#ffb01f" stroke-width="1.6"/>
        <path d="M100 30v140" stroke="#ffb01f" stroke-width="1.2"/>
        <g fill="#ffb01f" opacity=".85">
          <rect x="54" y="44" width="26" height="8"/><rect x="120" y="44" width="26" height="8"/>
          <rect x="54" y="148" width="26" height="8"/><rect x="120" y="148" width="26" height="8"/>
        </g>
        <circle cx="100" cy="100" r="12" stroke="#6effa8" stroke-width="1.4"/>
        <circle cx="100" cy="100" r="4" fill="#6effa8"/>
        ${tail}`;
    default:
      return `${head}
        <rect x="40" y="46" width="120" height="108" fill="#101820" stroke="#5ff0e4" stroke-width="1.2"/>
        <rect x="50" y="58" width="46" height="34" fill="#5ff0e4" opacity=".25" stroke="#5ff0e4" stroke-width=".8"/>
        <rect x="104" y="58" width="46" height="34" fill="#ffb01f" opacity=".22" stroke="#ffb01f" stroke-width=".8"/>
        <g stroke="#5ff0e4" stroke-width="1" opacity=".45">
          <path d="M50 104h100M50 116h100M50 128h100M50 140h70"/>
        </g>
        ${tail}`;
  }
}

/* --------------------------- 工具 --------------------------- */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

function bracketSet() {
  return (
    '<i class="bracket bracket--tl"></i><i class="bracket bracket--tr"></i>' +
    '<i class="bracket bracket--bl"></i><i class="bracket bracket--br"></i>'
  );
}

/**
 * 把通道当前值映射成 0-100 的「健康度」。
 * 危险区间的通道（越低越糟）直接用百分比；
 * 区间型通道（压强/温度）按离安全区间的距离算。
 */
function healthPct(key, v, meta) {
  const { min, max } = meta;
  if (min == null || max == null) return v;
  const badBelow = meta.warn.below != null ? meta.warn.below : meta.crit.below;
  const badAbove = meta.warn.above != null ? meta.warn.above : meta.crit.above;
  if (badBelow != null) {
    // 越低越糟：低于警戒线时按比例掉
    if (v >= badBelow) return 100;
    return Math.max(0, (v / badBelow) * 100);
  }
  if (badAbove != null) {
    // 越高越糟：高于警戒线时按比例掉
    if (v <= badAbove) return 100;
    const span = max - badAbove;
    return span <= 0 ? 0 : Math.max(0, 100 - ((v - badAbove) / span) * 100);
  }
  return ((v - min) / (max - min)) * 100;
}

/* --------------------------- HUD 类 --------------------------- */

export class Hud {
  constructor(root, { onFocus, onHotspot, onCommand } = {}) {
    this.root = root;
    this.onFocus = onFocus || (() => {});
    this.onHotspot = onHotspot || (() => {});
    this.onCommand = onCommand || (() => {});
    this.currentFocus = null;
    this.hovered = null;
    this.telRows = new Map();
    this.build();
  }

  /* -------------------- 构建 DOM -------------------- */

  build() {
    const hud = el('div');
    hud.id = 'hud';
    this.hud = hud;

    /* --- 单位铭牌 --- */
    const unit = el('div', 'hud-el d1');
    unit.id = 'unit';
    unit.innerHTML = `
      <div class="unit__portrait">${PORTRAIT}</div>
      <div class="unit__meta">
        <div class="unit__name">${SHIP.operatorCn}</div>
        <div class="unit__code">${SHIP.operatorEn} · ${SHIP.hullEn}-CREW</div>
        <div class="unit__tags">
          <span class="tag tag--on" id="tag-link">数据链在线</span>
          <span class="tag" id="tag-drone">无人机</span>
          <span class="tag" id="tag-auto">自动姿态</span>
        </div>
      </div>`;
    hud.appendChild(unit);

    /* --- 顶部舰名条 --- */
    const bar = el('div', 'hud-el d2');
    bar.id = 'shipbar';
    bar.innerHTML = `
      <div class="shipbar__seg"><em>Vessel</em><strong>${SHIP.hullCn} · ${SHIP.hullEn}</strong></div>
      <div class="shipbar__seg"><em>Class</em><strong>${SHIP.classCn}</strong></div>
      <div class="shipbar__seg"><em>Station</em><strong>${SHIP.stationCn}</strong></div>
      <div class="shipbar__seg"><em>Severity</em><strong id="sev">NOMINAL</strong></div>
      <div class="shipbar__seg"><em>Power</em><strong class="mono" id="ship-power">--</strong></div>`;
    hud.appendChild(bar);

    /* --- 时钟 --- */
    const clock = el('div', 'hud-el d3');
    clock.id = 'clock';
    clock.innerHTML = `
      <div class="clock__t" id="clock-t">00:00:00</div>
      <div class="clock__d">Orbital Time / 舰内时间</div>
      <div class="clock__s"><i></i><span id="clock-s">链路正常</span></div>`;
    hud.appendChild(clock);

    /* --- 右侧导航 --- */
    const rail = el('div', 'hud-el d4');
    rail.id = 'rail';
    const railDefs = [
      ['radar', '态势', 'RADAR'],
      ['terminal', '终端', 'TERM'],
      ['crew', '乘员', 'CREW'],
      ['log', '日志', 'LOG'],
      ['map', '星图', 'CHART'],
      ['gear', '设置', 'CFG'],
    ];
    railDefs.forEach(([icon, zh, en], i) => {
      const b = el('div', 'rail__item' + (i === 0 ? ' active' : ''));
      b.innerHTML = `${ICONS[icon]}<span class="zh">${zh}</span><span style="font-family:var(--font-head);font-size:8px;letter-spacing:.16em">${en}</span>`;
      b.title = `${zh} (${en})`;
      b.addEventListener('click', () => {
        rail.querySelectorAll('.rail__item').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        if (icon === 'terminal') this.onCommand('open-terminal');
        else if (icon === 'radar') this.onCommand('radar');
        else if (icon === 'log') this.onCommand('toggle-log');
        else this.onCommand('rail', { icon, zh, en });
      });
      rail.appendChild(b);
    });
    hud.appendChild(rail);

    /* --- 遥测面板 --- */
    const tel = el('div', 'panel hud-el d5');
    tel.id = 'telemetry';
    tel.innerHTML = `
      ${bracketSet()}
      <div class="head"><b>舰体遥测</b><span>Hull Telemetry</span><i id="tel-state">OK</i></div>
      <div class="hazard"></div>
      <div class="body"></div>`;
    const body = tel.querySelector('.body');
    const keys = [
      'reactor',
      'power',
      'lifeSupport',
      'shield',
      'propellant',
      'signal',
      'temperature',
      'radiation',
    ];
    for (const key of keys) {
      const meta = TELEMETRY_META[key];
      const row = el('div', 'tel-row');
      row.innerHTML = `
        <div class="tel-row__top">
          <span class="tel-row__k">${meta.label}</span>
          <span class="tel-row__v" data-v>--</span>
          <span class="tel-row__u">${meta.unit.trim()}</span>
        </div>
        <div class="bar"><i data-b style="width:0%"></i></div>`;
      body.appendChild(row);
      this.telRows.set(key, {
        row,
        v: row.querySelector('[data-v]'),
        bar: row.querySelector('[data-b]'),
        meta,
      });
    }
    hud.appendChild(tel);

    /* --- 通讯日志 --- */
    const comms = el('div', 'panel hud-el d6');
    comms.id = 'comms';
    comms.innerHTML = `
      ${bracketSet()}
      <div class="head"><b>通讯记录</b><span>Comms Log</span><i id="comms-count">0</i></div>
      <div class="hazard"></div>
      <div class="comms__body"></div>`;
    this.commsBody = comms.querySelector('.comms__body');
    this.commsCount = comms.querySelector('#comms-count');
    hud.appendChild(comms);

    /* --- 准星 --- */
    const ret = el('div', 'hud-el d6');
    ret.id = 'reticle';
    ret.innerHTML = '<div class="reticle__box"></div><div class="reticle__dot"></div>';
    hud.appendChild(ret);

    /* --- 悬停提示 --- */
    const tip = el('div');
    tip.id = 'tip';
    hud.appendChild(tip);
    this.tip = tip;

    /* --- 聚焦面板 --- */
    const focus = el('div', 'panel panel--quad');
    focus.id = 'focus';
    focus.innerHTML = `
      ${bracketSet()}
      <div class="focus__hero">
        <div class="focus__kind"></div>
        <div class="focus__title"></div>
        <div class="focus__sub"></div>
      </div>
      <div class="focus__body"></div>
      <div class="focus__facts"></div>
      <div class="focus__foot">
        <div class="focus__btn" data-act="lock">锁定观测</div>
        <div class="focus__btn" data-act="close">关闭</div>
      </div>`;
    this.focusPanel = focus;
    this.focusHero = focus.querySelector('.focus__hero');
    hud.appendChild(focus);
    focus.querySelector('[data-act="close"]').addEventListener('click', () => this.closeFocus());
    focus.querySelector('[data-act="lock"]').addEventListener('click', () => {
      if (this.currentFocus) this.onCommand('lock-focus', { id: this.currentFocus });
    });

    /* --- 通知 --- */
    const toasts = el('div');
    toasts.id = 'toasts';
    hud.appendChild(toasts);
    this.toasts = toasts;

    /* --- 底部提示 --- */
    const hints = el('div', 'hud-el d6');
    hints.id = 'hints';
    hints.innerHTML = `
      <span><kbd>拖拽</kbd>环视</span>
      <span><kbd>滚轮</kbd>推拉</span>
      <span><kbd>点击</kbd>聚焦目标</span>
      <span><kbd>T</kbd>终端</span>
      <span><kbd>H</kbd>隐藏界面</span>
      <span><kbd>Esc</kbd>返回全景</span>`;
    hud.appendChild(hints);

    this.root.appendChild(hud);
  }

  /* -------------------- 聚焦面板 -------------------- */

  openFocus(id) {
    const spot = HOTSPOTS.find((h) => h.id === id);
    if (!spot) return;
    this.currentFocus = id;
    this.focusPanel.querySelector('.focus__kind').textContent = spot.kind;
    this.focusPanel.querySelector('.focus__title').textContent = spot.label;
    this.focusPanel.querySelector('.focus__sub').textContent = spot.subtitle;
    this.focusPanel.querySelector('.focus__body').textContent = spot.body;
    const facts = this.focusPanel.querySelector('.focus__facts');
    facts.innerHTML = spot.facts
      .map(
        ([k, v]) =>
          `<div class="row"><span class="row__k">${k}</span><span class="row__v">${v}</span></div>`
      )
      .join('');
    // 换插画
    const old = this.focusHero.querySelector('svg');
    if (old) old.remove();
    this.focusHero.insertAdjacentHTML('afterbegin', heroSvg(spot.kind));
    this.focusPanel.classList.add('show');
    this.onFocus(spot);
  }

  closeFocus() {
    this.currentFocus = null;
    this.focusPanel.classList.remove('show');
    this.onCommand('close-focus');
  }

  /* -------------------- 悬停提示 -------------------- */

  setHover(id) {
    if (id === this.hovered) return;
    this.hovered = id;
    if (id) {
      const s = HOTSPOTS.find((h) => h.id === id);
      if (s) {
        this.tip.innerHTML = `${s.label}<em>${s.subtitle}</em><kbd>点击聚焦</kbd>`;
        this.tip.classList.add('show');
        return;
      }
    }
    this.tip.classList.remove('show');
  }

  /* -------------------- 日志 -------------------- */

  pushLog(entry) {
    const line = el('div', 'comms__line is-' + entry.level);
    line.innerHTML = `
      <span class="comms__t">${formatClock(entry.t)}</span>
      <span class="comms__s">${entry.source}</span>
      <span class="comms__x">${entry.text}</span>`;
    this.commsBody.appendChild(line);
    while (this.commsBody.children.length > 26) this.commsBody.removeChild(this.commsBody.firstChild);
    this.commsBody.scrollTop = this.commsBody.scrollHeight;
    this.commsCount.textContent = String(this.commsBody.children.length);
  }

  /* -------------------- 通知 -------------------- */

  toast(text, level = 'info', en = '') {
    const t = el('div', 'toast' + (level !== 'info' ? ' is-' + level : ''));
    t.innerHTML = `${text}${en ? `<em>${en}</em>` : ''}`;
    this.toasts.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 420);
    }, 3600);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
  }

  /* -------------------- 每帧刷新 -------------------- */

  update(telemetry, now) {
    const s = telemetry.snapshot();

    this.hud.querySelector('#clock-t').textContent = formatClock(now);
    const sevEl = this.hud.querySelector('#sev');
    sevEl.textContent =
      { normal: 'NOMINAL', warning: 'CAUTION', critical: 'CRITICAL' }[s.severity];
    sevEl.style.color =
      s.severity === 'critical'
        ? 'var(--c-red)'
        : s.severity === 'warning'
          ? 'var(--c-yellow)'
          : '';

    this.hud.querySelector('#ship-power').textContent = formatPercent(s.power) + '%';
    this.hud.querySelector('#tel-state').textContent =
      s.severity === 'critical' ? 'ERR' : s.severity === 'warning' ? 'WARN' : 'OK';

    const link = this.hud.querySelector('#clock-s');
    link.textContent =
      s.signal < 25 ? '信号微弱' : s.signal < 45 ? '链路不稳' : '链路正常';

    for (const [key, r] of this.telRows) {
      const meta = r.meta;
      const v = s[key];
      const status = telemetry.statusOf(key);
      r.v.textContent = meta.digits ? v.toFixed(meta.digits) : formatPercent(v);
      r.bar.style.width = Math.max(0, Math.min(100, healthPct(key, v, meta))) + '%';
      r.row.classList.toggle('is-warn', status === 'warning');
      r.row.classList.toggle('is-crit', status === 'critical');
      r.bar.parentElement.classList.toggle('is-warn', status === 'warning');
      r.bar.parentElement.classList.toggle('is-crit', status === 'critical');
    }

    this.hud.querySelector('#tag-drone').classList.toggle('tag--on', telemetry.droneOnline);
    this.hud.querySelector('#tag-auto').classList.toggle('tag--on', telemetry.autoPilot);
    this.hud.querySelector('#tag-link').classList.toggle('tag--on', s.signal > 25);
  }

  setLive(on) {
    this.hud.classList.toggle('live', on);
  }
}

/* ==================================================================
 *  启动序列
 * ================================================================== */

const BOOT_LINES = [
  '<b>PRTS-CORE</b> 内核握手 · 握手完成',
  '舰载总线 <i>EVERBRIGHT-BUS</i> 枚举 214 个节点',
  '反应堆冷却回路压力归一 · <u>NOMINAL</u>',
  '生命维持系统自检 36 项 · <u>全部通过</u>',
  '偏导护盾阵列充能 <i>63%</i> · 等待指令',
  '深空链路锁定 <b>泰拉II 轨道中继站</b>',
  '全息沙盘投影仪预热 · 分辨率 2048×2048',
  '观测舷窗复合装甲状态 <u>无损伤</u>',
  '巡检无人机 <i>ODIN-07</i> 已唤醒',
  '自动姿态控制接管 · 偏离角 0.02°',
  '<b>长明号</b> 舰桥观测舱 · 全部系统就绪',
];

/**
 * 跑启动序列，结束后回调。
 * @returns {{skip: Function, promise: Promise<void>}}
 */
export function runBootSequence(root) {
  const boot = el('div');
  boot.id = 'boot';
  boot.innerHTML = `
    <div class="boot__stripe"></div>
    <div class="boot__stripe boot__stripe--bottom"></div>
    <div class="boot__mark">
      <svg viewBox="0 0 120 120" fill="none">
        <path d="M60 8 112 34v52L60 112 8 86V34z" stroke="#ffb01f" stroke-width="2.4"/>
        <path d="M60 26 96 45v30L60 94 24 75V45z" stroke="#ffb01f" stroke-width="1" opacity=".55"/>
        <path d="M38 44h44l-24 32h24L40 78" stroke="#ffd23f" stroke-width="4" stroke-linecap="square"/>
      </svg>
      <div class="zh">终末地</div>
      <div class="en">ENDFIELD</div>
    </div>
    <div class="boot__title">舰桥观测舱</div>
    <div class="boot__sub">Observation Deck 04 · EVERBRIGHT</div>
    <div class="boot__log"></div>
    <div class="boot__prog">
      <div class="bar"><i style="width:0%"></i></div>
      <div class="meta"><span id="boot-status">系统自检中</span><b id="boot-pct">0%</b></div>
    </div>
    <button class="boot__enter" type="button">进 入 舰 桥</button>`;
  root.appendChild(boot);

  const log = boot.querySelector('.boot__log');
  const fill = boot.querySelector('.bar > i');
  const pct = boot.querySelector('#boot-pct');
  const status = boot.querySelector('#boot-status');
  const enter = boot.querySelector('.boot__enter');

  let done = false;
  let resolveFn;
  const promise = new Promise((r) => (resolveFn = r));

  BOOT_LINES.forEach((t, i) => {
    setTimeout(() => {
      if (done) return;
      const n = el('div', 'boot__line', `> ${t}`);
      log.appendChild(n);
      while (log.children.length > 9) log.removeChild(log.firstChild);
      const p = Math.round(((i + 1) / BOOT_LINES.length) * 100);
      fill.style.width = p + '%';
      pct.textContent = p + '%';
      status.textContent = i < 6 ? '系统自检中' : '加载观测舱资源';
    }, 200 + i * 190);
  });

  const finish = () => {
    if (done) return;
    done = true;
    fill.style.width = '100%';
    pct.textContent = '100%';
    status.textContent = '就绪';
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 800);
    resolveFn();
  };

  setTimeout(() => {
    if (done) return;
    enter.classList.add('ready');
    status.textContent = '等待指令';
  }, 200 + BOOT_LINES.length * 190);

  enter.addEventListener('click', finish);

  boot.addEventListener('click', (e) => {
    if (e.target === boot && enter.classList.contains('ready')) finish();
  });

  return { skip: finish, promise, boot };
}
