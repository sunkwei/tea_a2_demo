/**
 * Canvas 2D 渲染器：棋盘、食物、蛇（带插值动画）、死亡残影
 */

const lerp = (a, b, t) => a + (b - a) * t;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.prev = new Map();
    this.cur = new Map();
    this.ghosts = [];
    this.cell = 24;
    this.ox = 0;
    this.oy = 0;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.flash = new Map(); // 吃到食物的闪光
  }

  resize(game) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(120, rect.width);
    this.h = Math.max(120, rect.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cell = Math.max(8, Math.floor(Math.min(this.w / game.width, this.h / game.height)));
    this.boardW = this.cell * game.width;
    this.boardH = this.cell * game.height;
    this.ox = Math.floor((this.w - this.boardW) / 2);
    this.oy = Math.floor((this.h - this.boardH) / 2);
  }

  /** 每个 tick 之后调用，推进动画状态 */
  sync(game, events = []) {
    const next = new Map();
    for (const s of game.snakes) {
      next.set(s.id, s.body.map((c) => ({ x: c.x, y: c.y })));
      if (!s.alive && this.cur.has(s.id)) {
        this.ghosts.push({ body: this.cur.get(s.id), color: s.color, born: performance.now(), dir: s.dir });
      }
    }
    this.prev = this.cur;
    this.cur = next;
    for (const e of events || []) {
      if (e.type === 'eat') this.flash.set(e.id, performance.now());
    }
    const cutoff = performance.now() - 1500;
    this.ghosts = this.ghosts.filter((g) => g.born > cutoff);
  }

  reset() {
    this.prev = new Map();
    this.cur = new Map();
    this.ghosts = [];
    this.flash = new Map();
  }

  draw(game, alpha = 1) {
    const ctx = this.ctx;
    const t = performance.now();
    ctx.clearRect(0, 0, this.w, this.h);

    // 背景
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#0a0f1e');
    g.addColorStop(1, '#070b16');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // 棋盘
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.fillStyle = 'rgba(20,30,52,0.72)';
    this.roundRect(0, 0, this.boardW, this.boardH, 10);
    ctx.fill();

    // 网格
    ctx.strokeStyle = 'rgba(120,160,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= game.width; x++) {
      ctx.moveTo(x * this.cell + 0.5, 0);
      ctx.lineTo(x * this.cell + 0.5, this.boardH);
    }
    for (let y = 0; y <= game.height; y++) {
      ctx.moveTo(0, y * this.cell + 0.5);
      ctx.lineTo(this.boardW, y * this.cell + 0.5);
    }
    ctx.stroke();

    // 死亡残影
    for (const ghost of this.ghosts) {
      const k = Math.min(1, (t - ghost.born) / 700);
      this.drawPolyline(ghost.body, ghost.body, 1, ghost.color, (1 - k) * 0.45);
    }

    // 食物
    const pulse = 0.5 + 0.5 * Math.sin(t / 320);
    for (const f of game.foods) {
      const cx = (f.x + 0.5) * this.cell;
      const cy = (f.y + 0.5) * this.cell;
      const r = this.cell * (0.26 + 0.05 * pulse);
      ctx.save();
      ctx.shadowColor = 'rgba(255,120,80,0.9)';
      ctx.shadowBlur = 12 + 8 * pulse;
      ctx.fillStyle = '#ff7a45';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,235,200,0.85)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.28, cy - r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 蛇
    for (const s of game.snakes) {
      if (!s.alive) continue;
      const body = s.body;
      const prev = this.prev.get(s.id) || body;
      const flashAt = this.flash.get(s.id);
      const flash = flashAt ? Math.max(0, 1 - (t - flashAt) / 260) : 0;
      this.drawSnake(body, prev, alpha, s, flash);
    }

    ctx.restore();
  }

  drawSnake(body, prev, alpha, snake, flash = 0) {
    const ctx = this.ctx;
    const cell = this.cell;
    const pts = [];
    for (let i = 0; i < body.length; i++) {
      const to = body[i];
      const from = prev[i] || to;
      const x = (lerp(from.x, to.x, alpha) + 0.5) * cell;
      const y = (lerp(from.y, to.y, alpha) + 0.5) * cell;
      pts.push({ x, y });
    }
    if (!pts.length) return;

    const width = cell * 0.74;

    // 外描边
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = width + 3;
    this.strokePath(pts);

    // 身体
    ctx.strokeStyle = snake.color;
    ctx.lineWidth = width;
    this.strokePath(pts);

    // 吃到食物时的闪光
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.35;
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = width + 5;
      this.strokePath(pts);
      ctx.restore();
    }

    // 头
    const head = pts[0];
    const dir = snake.dir;
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    ctx.fillStyle = snake.color;
    ctx.beginPath();
    ctx.arc(head.x, head.y, cell * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 眼睛
    const ex = cell * 0.17;
    const ey = cell * 0.17;
    const off = cell * 0.13;
    for (const sign of [-1, 1]) {
      const px = head.x + dx * off + (dx === 0 ? sign * ex : 0);
      const py = head.y + dy * off + (dy === 0 ? sign * ey : 0);
      ctx.fillStyle = '#0b1020';
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.075, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  strokePath(pts) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  drawPolyline(a, b, alpha, color, alphaMul) {
    const ctx = this.ctx;
    const cell = this.cell;
    const pts = [];
    for (let i = 0; i < a.length; i++) {
      const to = a[i];
      const from = b[i] || to;
      pts.push({
        x: (lerp(from.x, to.x, alpha) + 0.5) * cell,
        y: (lerp(from.y, to.y, alpha) + 0.5) * cell,
      });
    }
    if (!pts.length) return;
    ctx.save();
    ctx.globalAlpha = alphaMul;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = cell * 0.7;
    this.strokePath(pts);
    ctx.restore();
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
