/**
 * 终末地 · 舰桥观测舱 —— 纯逻辑层
 *
 * 这个文件不依赖 DOM，也不依赖 three.js：
 * 浏览器和 Node 都能加载，所以核心算法（遥测模拟、终端指令解析、格式化）可以离线断言。
 *
 * 设定：泰拉II 轨道站「长明号」的舰桥观测舱。
 */

export const SHIP = {
  callsign: 'ENDFIELD',
  nameCn: '终末地',
  hullCn: '长明号',
  hullEn: 'EVERBRIGHT',
  classCn: '轨道巡防舰',
  stationCn: '泰拉II 轨道中继站',
  operatorCn: '终末地 · 巡回管理员',
  operatorEn: 'ENDMINISTRATOR',
};

export const TIME_SCALE = 1; // 1 实时秒 = 1 舰内秒

/* ------------------------------------------------------------------ *
 *  基础数学 / 随机
 * ------------------------------------------------------------------ */

/** 把 v 夹在 [min, max] 之间 */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** 线性插值 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 把 v 从 [a0,b0] 映射到 [a1,b1]，并夹紧 */
export function mapRange(v, a0, b0, a1, b1) {
  if (b0 === a0) return a1;
  return clamp(lerp(a1, b1, (v - a0) / (b0 - a0)), Math.min(a1, b1), Math.max(a1, b1));
}

/** mulberry32：可复现的伪随机数发生器 */
export function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性拾取：给定随机源，从数组里取一项 */
export function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

/* ------------------------------------------------------------------ *
 *  格式化
 * ------------------------------------------------------------------ */

/** 秒 → HH:MM:SS */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

/** 带符号定点数，例如 +12.4 */
export function formatSigned(v, digits = 1) {
  const n = Number(v) || 0;
  const sign = n >= 0 ? '+' : '-';
  return sign + Math.abs(n).toFixed(digits);
}

/** 百分比整数，例如 87 */
export function formatPercent(v) {
  return String(Math.round(clamp(v, 0, 100)));
}

/** 数值 + 单位 */
export function formatWithUnit(v, unit = '', digits = 0) {
  const n = Number(v) || 0;
  return n.toFixed(digits) + unit;
}

/**
 * 分段条：▮▮▮▯▯▯
 * @param {number} pct 0-100
 * @param {number} width 分段数
 */
export function formatBar(pct, width = 12) {
  const filled = Math.round(clamp(pct, 0, 100) / 100 * width);
  return '▮'.repeat(filled) + '▯'.repeat(Math.max(0, width - filled));
}

/** 大数缩写，12345 → 12.3K */
export function formatCompact(v) {
  const n = Math.abs(v);
  if (n >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}

/** 数字补零，例如 7 → 007 */
export function padNumber(v, len = 3) {
  const s = String(Math.round(Math.abs(v)));
  return (v < 0 ? '-' : '') + s.padStart(len, '0');
}

/* ------------------------------------------------------------------ *
 *  舰体遥测
 * ------------------------------------------------------------------ */

const BASE_TELEMETRY = {
  /** 主反应堆输出 0-100 */
  reactor: 82,
  /** 舰载能源储备 0-100 */
  power: 74,
  /** 生命维持 0-100 */
  lifeSupport: 96,
  /** 舱内压强 kPa */
  cabinPressure: 101.3,
  /** 舰内温度 ℃ */
  temperature: 21.4,
  /** 护盾 0-100 */
  shield: 63,
  /** 船体完整度 0-100 */
  hull: 99,
  /** 信号强度 0-100 */
  signal: 71,
  /** 推进剂余量 0-100 */
  propellant: 63,
  /** 外部辐射 μSv/h */
  radiation: 0.42,
  /** 相对轨道速度 km/s */
  velocity: 7.84,
};

/**
 * 每个通道的元信息。
 *
 * warn / crit 描述的是「危险区间」，而不是「警戒值」：
 *   below —— 低于该值算异常
 *   above —— 高于该值算异常
 * 两个方向都可以只填一个。
 */
export const TELEMETRY_META = {
  reactor: {
    label: '主反应堆', unit: '%', min: 0, max: 100, digits: 0,
    warn: { below: 45 }, crit: { below: 25 },
  },
  power: {
    label: '舰载能源', unit: '%', min: 0, max: 100, digits: 0,
    warn: { below: 35 }, crit: { below: 18 },
  },
  lifeSupport: {
    label: '生命维持', unit: '%', min: 0, max: 100, digits: 0,
    warn: { below: 70 }, crit: { below: 45 },
  },
  cabinPressure: {
    label: '舱内压强', unit: ' kPa', min: 60, max: 130, digits: 1,
    warn: { below: 95, above: 110 }, crit: { below: 88, above: 118 },
  },
  temperature: {
    label: '舰内温度', unit: ' ℃', min: 5, max: 45, digits: 1,
    warn: { above: 34 }, crit: { above: 40 },
  },
  shield: {
    label: '偏导护盾', unit: '%', min: 0, max: 100, digits: 0,
    warn: { below: 40 }, crit: { below: 20 },
  },
  hull: {
    label: '船体完整度', unit: '%', min: 0, max: 100, digits: 0,
    warn: { below: 95 }, crit: { below: 80 },
  },
  signal: {
    label: '深空信号', unit: '%', min: 0, max: 100, digits: 0,
    warn: { below: 35 }, crit: { below: 18 },
  },
  propellant: {
    label: '推进剂', unit: '%', min: 0, max: 100, digits: 0,
    warn: { below: 30 }, crit: { below: 15 },
  },
  radiation: {
    label: '环境辐射', unit: ' μSv/h', min: 0, max: 4, digits: 2,
    warn: { above: 1.5 }, crit: { above: 2.6 },
  },
  velocity: {
    label: '相对速度', unit: ' km/s', min: 0, max: 12, digits: 2,
    warn: { above: 10.5 }, crit: { above: 11.4 },
  },
};

/** 判断 v 是否落在危险区间里 */
function inDanger(v, limit) {
  if (!limit) return false;
  if (limit.below != null && v < limit.below) return true;
  if (limit.above != null && v > limit.above) return true;
  return false;
}

/**
 * 遥测模拟器：每 tick 让所有通道做有界随机游走，并按泊松间隔抛事件。
 * 用固定 seed 就能复现同样的曲线，测试里可以断言。
 */
export class ShipTelemetry {
  constructor(seed = 20261117) {
    this.random = makeRandom(seed);
    this.state = { ...BASE_TELEMETRY };
    this.elapsed = 0;
    this.events = [];
    this.nextEventAt = 6 + this.random() * 5;
    this.droneOnline = true;
    this.autoPilot = true;
    this.paused = false;
    this.severity = 'normal'; // normal | warning | critical
  }

  /** 推进时间；dt 为真实秒 */
  step(dt) {
    if (this.paused) return this.state;
    const d = Math.min(Math.max(dt, 0), 0.25);
    this.elapsed += d;
    const r = this.random;

    const jitter = (key, amount) => {
      const meta = TELEMETRY_META[key];
      this.state[key] = clamp(this.state[key] + (r() - 0.5) * amount, meta.min, meta.max);
    };

    jitter('reactor', 1.4);
    jitter('power', 0.9);
    jitter('lifeSupport', 0.35);
    jitter('cabinPressure', 0.22);
    jitter('temperature', 0.16);
    jitter('shield', 1.1);
    jitter('hull', 0.06);
    jitter('signal', 2.4);
    jitter('propellant', 0.22);
    jitter('radiation', 0.05);
    jitter('velocity', 0.06);

    // 反应堆与能源互相牵制：堆出力高则能源回得快
    this.state.power = clamp(
      this.state.power + (this.state.reactor - 78) * 0.006 * d * 60,
      0,
      100
    );

    if (this.elapsed >= this.nextEventAt) {
      this.nextEventAt = this.elapsed + 7 + r() * 9;
      this.pushEvent();
    }
    this.recomputeSeverity();
    return this.state;
  }

  pushEvent() {
    const r = this.random;
    const pool = [
      { level: 'info', source: '舰载总线', text: '例行自检完成，未发现异常。' },
      { level: 'info', source: '遥测', text: '环境辐射读数已同步至轨道中继站。' },
      { level: 'info', source: '遥测', text: '偏导护盾完成一次边缘刷新。' },
      { level: 'info', source: '导航', text: '轨道参数微调，偏离角修正至 0.02°。' },
      { level: 'warn', source: '生命维持', text: '二区 CO₂ 回收效率下降，已切换至备用滤芯。' },
      { level: 'warn', source: '通讯', text: '深空链路出现 0.4s 抖动，协议已自动重协商。' },
      { level: 'warn', source: '热控', text: '舱外散热片温度偏高，姿态控制已补偿。' },
      { level: 'warn', source: '遥测', text: '检测到微陨石掠过舷窗外侧，无结构损伤。' },
      { level: 'crit', source: '动力', text: '推进剂管路 B 段压力骤降，已隔离该段。' },
      { level: 'crit', source: '结构', text: '右舷 7 号肋骨出现 0.4mm 应力裂纹。' },
    ];
    const e = pick(r, pool);
    this.events.push({ ...e, t: this.elapsed });
    if (this.events.length > 60) this.events.shift();
    return e;
  }

  recomputeSeverity() {
    let worst = 'normal';
    for (const key of Object.keys(TELEMETRY_META)) {
      const meta = TELEMETRY_META[key];
      const v = this.state[key];
      if (inDanger(v, meta.crit)) worst = 'critical';
      else if (inDanger(v, meta.warn) && worst === 'normal') worst = 'warning';
    }
    this.severity = worst;
  }

  /** 单条通道的状态等级 */
  statusOf(key) {
    const meta = TELEMETRY_META[key];
    if (!meta) return 'normal';
    const v = this.state[key];
    if (inDanger(v, meta.crit)) return 'critical';
    if (inDanger(v, meta.warn)) return 'warning';
    return 'normal';
  }

  snapshot() {
    return { ...this.state, elapsed: this.elapsed, severity: this.severity };
  }
}

/* ------------------------------------------------------------------ *
 *  通讯日志
 * ------------------------------------------------------------------ */

export class EventLog {
  constructor(limit = 40) {
    this.limit = limit;
    this.entries = [];
  }

  push(level, source, text, t = 0) {
    const entry = { level, source, text, t, id: this.entries.length };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    return entry;
  }

  lines() {
    return this.entries.map(
      (e) => `[${formatClock(e.t)}] ${e.level.toUpperCase().padEnd(5)} ${e.source} · ${e.text}`
    );
  }
}

/* ------------------------------------------------------------------ *
 *  热点（场景里可点击聚焦的对象）
 *
 * camera.pos 是相机位置，camera.target 是注视点。
 * 坐标系：-Z 是船头（舷窗方向），+X 是货舱闸门侧，-X 是生命维持机柜侧。
 *
 * 机位要「有环境」，不能怼到物体脸上：
 * 全息台那台尤其要注意 —— 沙盘是加性混合的自发光，
 * 离太近会被 Bloom 放大成一团白（实测过曝占比飙到 2.8%）。
 * ------------------------------------------------------------------ */

export const HOTSPOTS = [
  {
    id: 'console',
    label: '舰桥主控台',
    subtitle: 'PRIMARY CONSOLE',
    kind: '交互终端',
    body: '三联主控台接管了舰桥的全部姿态与热控权限。屏幕上的环形读数是偏导护盾的实时相位分布，橙色扇区代表护盾正在补能的方位。',
    facts: [
      ['授权等级', 'S / 管理员'],
      ['刷新率', '120 Hz'],
      ['接入终端', '7'],
    ],
    camera: { pos: [-0.75, 1.95, 1.5], target: [-0.3, 1.15, -2.2] },
  },
  {
    id: 'hologram',
    label: '全息战术台',
    subtitle: 'HOLOGRAPHIC TACTICAL TABLE',
    kind: '沙盘投影',
    body: '战术台把「长明号」的舰体结构与泰拉II 的轨道面叠在一起投影。当前高亮的是舰桥观测舱，数据每 0.5 秒重绘一次。',
    facts: [
      ['投影体积', '1.8 m³'],
      ['数据源', '舰载总线 / 深空测控'],
      ['当前焦点', '舰桥观测舱'],
    ],
    camera: { pos: [3.55, 2.35, 3.9], target: [1.9, 0.95, 1.3] },
  },
  {
    id: 'viewport',
    label: '主舷窗',
    subtitle: 'FORWARD OBSERVATION DOME',
    kind: '观景结构',
    body: '复合装甲穹顶外侧覆有防微陨石层。透过它能看到泰拉II 的晨昏线，以及贯穿行星与轨道的天梯缆索。',
    facts: [
      ['装甲厚度', '142 mm'],
      ['透光率', '71%'],
      ['可见目标', '泰拉II / 天梯'],
    ],
    camera: { pos: [-0.2, 2.5, 2.2], target: [-1.6, 2.4, -7.5] },
  },
  {
    id: 'life',
    label: '生命维持机柜',
    subtitle: 'LIFE SUPPORT RACK',
    kind: '环境控制',
    body: '机柜负责舱内循环：二氧化碳回收、湿度平衡与微量气体筛除。侧面的青色灯条是滤芯余量，绿转橙即表示需要更换。',
    facts: [
      ['处理风量', '480 m³/h'],
      ['滤芯余量', '68%'],
      ['备用回路', '在线'],
    ],
    camera: { pos: [-2.2, 1.85, 2.7], target: [-4.4, 1.45, 1.5] },
  },
  {
    id: 'cargo',
    label: '货舱闸门',
    subtitle: 'CARGO BULKHEAD',
    kind: '货运接口',
    body: '对接式货舱闸门，直通下层货舱。外框的黄黑斜纹是标准危险区标识，闸门状态灯为绿表示气压平衡已锁定。',
    facts: [
      ['闸门规格', '3.2 m × 2.4 m'],
      ['内部压力', '101.1 kPa'],
      ['锁止机构', '已锁止'],
    ],
    camera: { pos: [2.25, 1.8, 2.95], target: [4.5, 1.35, 1.2] },
  },
];

/** 首页机位（主控台在下方作剪影，舷窗里是行星与天梯） */
export const HOME_VIEW = {
  pos: [0.35, 1.95, 4.6],
  target: [-0.5, 2.7, -7.5],
};

/* ------------------------------------------------------------------ *
 *  终端指令解析
 * ------------------------------------------------------------------ */

export const TERMINAL_HELP = [
  ['help', '显示本终端可用指令'],
  ['status', '打印当前舰体遥测摘要'],
  ['scan', '对当前扇区做一次深空扫描'],
  ['logs', '回放最近 6 条通讯记录'],
  ['time', '显示舰内时间与轨道相位'],
  ['drone on|off', '启停巡检无人机'],
  ['autopilot on|off', '启停自动姿态控制'],
  ['focus <id>', '聚焦某个舱段（console/hologram/viewport/life/cargo）'],
  ['clear', '清空终端输出'],
];

/**
 * 解析一条终端指令。
 * @param {string} input 用户输入
 * @param {{telemetry?: ShipTelemetry, log?: EventLog, now?: number}} ctx
 * @returns {{ok: boolean, lines: string[], action?: object}}
 */
export function parseCommand(input, ctx = {}) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, lines: [] };

  const [cmd, ...args] = raw.split(/\s+/);
  const key = cmd.toLowerCase();
  const telemetry = ctx.telemetry;
  const log = ctx.log;
  const now = ctx.now || 0;
  const out = [];

  switch (key) {
    case 'help':
    case '?':
      out.push('可用指令：');
      for (const [c, d] of TERMINAL_HELP) out.push(`  ${c.padEnd(18)}${d}`);
      return { ok: true, lines: out };

    case 'status': {
      if (!telemetry) return { ok: false, lines: ['遥测链路未连接。'] };
      const s = telemetry.snapshot();
      out.push(`— 舰体遥测 · 严重度 ${s.severity.toUpperCase()} —`);
      for (const key2 of Object.keys(TELEMETRY_META)) {
        const meta = TELEMETRY_META[key2];
        const v = s[key2];
        const digits = meta.digits ?? 0;
        const pct =
          meta.min !== undefined && meta.max !== undefined
            ? mapRange(v, meta.min, meta.max, 0, 100)
            : v;
        out.push(
          `  ${meta.label.padEnd(6, '　')}${v.toFixed(digits).padStart(7)}${meta.unit}  ${formatBar(pct, 10)}`
        );
      }
      return { ok: true, lines: out };
    }

    case 'scan': {
      if (!telemetry) return { ok: false, lines: ['遥测链路未连接。'] };
      const r = telemetry.random;
      const debris = (r() * 40).toFixed(1);
      const sig = (telemetry.state.signal * 0.6 + r() * 40).toFixed(1);
      out.push('深空扇区扫描中 …');
      out.push(`  微陨石密度  ${debris} 颗 / 1000 km³`);
      out.push(`  回波信噪比  ${sig} dB`);
      out.push('  结论：无即时威胁，保持当前航路。');
      return { ok: true, lines: out };
    }

    case 'logs': {
      if (!log) return { ok: false, lines: ['通讯缓冲为空。'] };
      const recent = log.entries.slice(-6);
      if (!recent.length) return { ok: true, lines: ['通讯缓冲为空。'] };
      out.push('— 最近通讯记录 —');
      for (const e of recent) {
        out.push(`  [${formatClock(e.t)}] ${e.source} · ${e.text}`);
      }
      return { ok: true, lines: out };
    }

    case 'time': {
      const phase = ((now / 92.4) % 1) * 360;
      out.push(`舰内时间   ${formatClock(now)}`);
      out.push(`轨道相位   ${phase.toFixed(2)}°`);
      out.push(`泰拉II     距中继站 ${(428.6 - (now % 600) * 0.2).toFixed(1)} km`);
      return { ok: true, lines: out };
    }

    case 'drone': {
      const on = String(args[0] || '').toLowerCase();
      if (on !== 'on' && on !== 'off') {
        return { ok: false, lines: ['用法：drone on|off'] };
      }
      if (telemetry) telemetry.droneOnline = on === 'on';
      return {
        ok: true,
        lines: [on === 'on' ? '巡检无人机已唤醒，正在沿舱段巡航。' : '巡检无人机已返航待命。'],
        action: { type: 'drone', value: on === 'on' },
      };
    }

    case 'autopilot': {
      const on = String(args[0] || '').toLowerCase();
      if (on !== 'on' && on !== 'off') {
        return { ok: false, lines: ['用法：autopilot on|off'] };
      }
      if (telemetry) telemetry.autoPilot = on === 'on';
      return {
        ok: true,
        lines: [on === 'on' ? '自动姿态控制已接管。' : '自动姿态控制已释放，转入手动。'],
        action: { type: 'autopilot', value: on === 'on' },
      };
    }

    case 'focus': {
      const id = String(args[0] || '').toLowerCase();
      const spot = HOTSPOTS.find((h) => h.id === id);
      if (!spot) {
        return {
          ok: false,
          lines: [`未找到舱段「${id}」。可选：${HOTSPOTS.map((h) => h.id).join(' / ')}`],
        };
      }
      return {
        ok: true,
        lines: [`已将观测焦点切换至「${spot.label}」。`],
        action: { type: 'focus', id: spot.id },
      };
    }

    case 'clear':
      return { ok: true, lines: [], action: { type: 'clear' } };

    default:
      return { ok: false, lines: [`未知指令「${cmd}」。输入 help 查看可用指令。`] };
  }
}
