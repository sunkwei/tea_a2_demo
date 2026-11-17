/**
 * 终末地 · 舰桥观测舱 —— 离线断言
 *
 *   node endfield-ship/tools/selftest.mjs
 *
 * 只测 src/core.js 里的纯逻辑（不碰 DOM、不碰 three）：
 * 格式化、遥测模拟、事件日志、终端指令解析、热点数据完整性。
 *
 * core.js 是 ESM，这里把 export 关键字剥掉后在沙箱里求值，
 * 这样无论上层 package.json 是不是 type: module 都能跑。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '../src/core.js');

const src = fs
  .readFileSync(CORE, 'utf8')
  .replace(/^export\s+(const|let|var|function|class|async)\s/gm, '$1 ');

const EXPORTS = [
  'clamp',
  'lerp',
  'mapRange',
  'makeRandom',
  'pick',
  'formatClock',
  'formatSigned',
  'formatPercent',
  'formatWithUnit',
  'formatBar',
  'formatCompact',
  'padNumber',
  'ShipTelemetry',
  'EventLog',
  'HOTSPOTS',
  'TERMINAL_HELP',
  'parseCommand',
  'SHIP',
  'TELEMETRY_META',
];

const Core = new Function(
  '"use strict";' +
    src +
    '\n;return {' +
    EXPORTS.map((n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(',') +
    '};'
)();

const META = Core.TELEMETRY_META;
const META_KEYS = Object.keys(META);
const META_LIST = META_KEYS.map((k) => META[k]);

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name + (detail ? '  ' + detail : ''));
  } else {
    failed++;
    fails.push(name + (detail ? '  ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? '  ' + detail : ''));
  }
}

function eq(name, actual, expected) {
  const ok = Object.is(actual, expected);
  check(name, ok, ok ? '' : `实际 ${JSON.stringify(actual)} ≠ 期望 ${JSON.stringify(expected)}`);
}

console.log('\n终末地 · 舰桥观测舱 —— 离线断言\n');

/* ------------------------------ 基础工具 ------------------------------ */
console.log('数学与随机');
eq('clamp 夹上限', Core.clamp(120, 0, 100), 100);
eq('clamp 夹下限', Core.clamp(-5, 0, 100), 0);
eq('clamp 区间内', Core.clamp(42, 0, 100), 42);
eq('lerp 线性插值', Core.lerp(0, 10, 0.25), 2.5);
eq('mapRange 映射', Core.mapRange(50, 0, 100, 0, 1), 0.5);
eq('mapRange 越界夹紧', Core.mapRange(200, 0, 100, 0, 1), 1);
check(
  'makeRandom 可复现',
  (() => {
    const a = Core.makeRandom(42);
    const b = Core.makeRandom(42);
    return a() === b() && a() === b();
  })()
);
check(
  'makeRandom 落在 [0,1)',
  (() => {
    const r = Core.makeRandom(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      if (!(v >= 0 && v < 1)) return false;
    }
    return true;
  })()
);
check('pick 从数组取值', ['a', 'b'].includes(Core.pick(Core.makeRandom(3), ['a', 'b'])));

/* ------------------------------ 格式化 ------------------------------ */
console.log('\n格式化');
eq('formatClock 时分秒', Core.formatClock(3661), '01:01:01');
eq('formatClock 补零', Core.formatClock(59), '00:00:59');
eq('formatClock 负数归零', Core.formatClock(-10), '00:00:00');
eq('formatSigned 正号', Core.formatSigned(12.44), '+12.4');
eq('formatSigned 负号', Core.formatSigned(-3.2), '-3.2');
eq('formatPercent 取整', Core.formatPercent(66.6), '67');
eq('formatPercent 夹紧', Core.formatPercent(140), '100');
eq('formatWithUnit', Core.formatWithUnit(21.4, ' ℃', 1), '21.4 ℃');
eq('formatBar 全满', Core.formatBar(100, 6), '▮▮▮▮▮▮');
eq('formatBar 全空', Core.formatBar(0, 6), '▯▯▯▯▯▯');
eq('formatBar 中间', Core.formatBar(50, 4), '▮▮▯▯');
eq('formatCompact 千', Core.formatCompact(12500), '12.5K');
eq('formatCompact 百万', Core.formatCompact(2500000), '2.50M');
eq('padNumber 补零', Core.padNumber(7, 3), '007');
eq('padNumber 负数', Core.padNumber(-42, 3), '-042');

/* ------------------------------ 遥测 ------------------------------ */
console.log('\n舰体遥测');
const tel = new Core.ShipTelemetry(20261117);
eq('初始严重度为 normal', tel.severity, 'normal');
check('初始反应堆有值', typeof tel.state.reactor === 'number' && tel.state.reactor > 0);
const before = { ...tel.state };
// 跑 40 仿真秒（远超第一个事件的触发窗口）
for (let i = 0; i < 2400; i++) tel.step(1 / 60);
const after = tel.state;
check(
  '推进后所有通道仍在合法区间',
  META_KEYS.every((k) => {
    const m = META[k];
    return after[k] >= m.min - 1e-9 && after[k] <= m.max + 1e-9;
  })
);
check(
  '推进后数值确实变化了',
  META_KEYS.some((k) => Math.abs(before[k] - after[k]) > 1e-6)
);
check('事件在推进过程中产生', tel.events.length > 0, `${tel.events.length} 条`);
check(
  '事件带时间戳与级别',
  tel.events.every((e) => typeof e.t === 'number' && !!e.level && !!e.source)
);
check(
  '事件缓冲有上限',
  (() => {
    const t2 = new Core.ShipTelemetry(1);
    for (let i = 0; i < 5000; i++) t2.step(1 / 30);
    return t2.events.length <= 60;
  })()
);
check(
  '固定 seed 产生相同曲线',
  (() => {
    const a = new Core.ShipTelemetry(99);
    const b = new Core.ShipTelemetry(99);
    for (let i = 0; i < 200; i++) {
      a.step(1 / 60);
      b.step(1 / 60);
    }
    return META_KEYS.every((k) => a.state[k] === b.state[k]);
  })()
);
eq('statusOf 正常通道', tel.statusOf('hull'), 'normal');
check(
  'statusOf 能识别危险状态',
  (() => {
    const t3 = new Core.ShipTelemetry(5);
    t3.state.hull = 10;
    t3.recomputeSeverity();
    return t3.statusOf('hull') === 'critical' && t3.severity === 'critical';
  })()
);
check(
  '越大越糟的通道判定正确',
  (() => {
    const t4 = new Core.ShipTelemetry(5);
    t4.state.temperature = 44;
    t4.recomputeSeverity();
    return t4.statusOf('temperature') === 'critical';
  })()
);
check(
  '暂停后状态不再变化',
  (() => {
    const t5 = new Core.ShipTelemetry(5);
    t5.paused = true;
    const snap = { ...t5.state };
    for (let i = 0; i < 100; i++) t5.step(1 / 60);
    return META_KEYS.every((k) => snap[k] === t5.state[k]);
  })()
);
check(
  '大 dt 被夹到 0.25 秒',
  (() => {
    const t6 = new Core.ShipTelemetry(5);
    t6.step(100);
    return t6.elapsed <= 0.25 + 1e-9;
  })()
);

/* ------------------------------ 事件日志 ------------------------------ */
console.log('\n通讯日志');
const log = new Core.EventLog(3);
log.push('info', '总线', '一', 1);
log.push('warn', '生命维持', '二', 2);
log.push('crit', '结构', '三', 3);
eq('日志长度受上限约束', log.entries.length, 3);
log.push('info', '导航', '四', 4);
eq('超限后丢弃最旧', log.entries[0].source, '生命维持');
check(
  'lines() 输出带时间戳',
  /^\[\d{2}:\d{2}:\d{2}\]/.test(log.lines()[0]),
  log.lines()[0]
);
check('lines() 包含来源', log.lines()[0].includes('生命维持'));

/* ------------------------------ 热点 ------------------------------ */
console.log('\n热点数据');
check('热点数量 ≥ 5', Core.HOTSPOTS.length >= 5, `${Core.HOTSPOTS.length} 个`);
check(
  '每个热点字段齐全',
  Core.HOTSPOTS.every(
    (h) =>
      h.id &&
      h.label &&
      h.subtitle &&
      h.kind &&
      h.body &&
      Array.isArray(h.facts) &&
      h.facts.length >= 2 &&
      h.camera &&
      Array.isArray(h.camera.pos) &&
      h.camera.pos.length === 3 &&
      Array.isArray(h.camera.target) &&
      h.camera.target.length === 3
  )
);
check('热点 id 唯一', new Set(Core.HOTSPOTS.map((h) => h.id)).size === Core.HOTSPOTS.length);
check(
  '相机位置是有限数',
  Core.HOTSPOTS.every((h) =>
    h.camera.pos.concat(h.camera.target).every((n) => Number.isFinite(n))
  )
);

/* ------------------------------ 终端指令 ------------------------------ */
console.log('\n终端指令解析');
const res = (cmd) => Core.parseCommand(cmd, { telemetry: tel, log, now: 100 });

const rHelp = res('help');
check('help 成功', rHelp.ok);
check(
  'help 列出全部指令',
  Core.TERMINAL_HELP.every(([c]) => rHelp.lines.some((l) => l.includes(c)))
);

const rStatus = res('status');
check('status 成功', rStatus.ok);
check(
  'status 输出每个通道',
  META_LIST.every((m) => rStatus.lines.some((l) => l.includes(m.label)))
);

const rScan = res('scan');
check('scan 成功且有结论', rScan.ok && rScan.lines.some((l) => l.includes('结论')));

const rLogs = res('logs');
check('logs 成功', rLogs.ok);
check('logs 最多 6 条', rLogs.lines.filter((l) => l.includes('[')).length <= 6);

const rTime = res('time');
check(
  'time 输出舰内时间',
  rTime.ok && rTime.lines.some((l) => l.includes('00:01:40')),
  rTime.lines[0]
);

const rUnknown = res('frobnicate');
check('未知指令失败', !rUnknown.ok);
check('未知指令给出提示', rUnknown.lines.some((l) => l.includes('help')));

const rEmpty = res('   ');
check('空输入不产生输出', !rEmpty.ok && rEmpty.lines.length === 0);

const rFocus = res('focus console');
check('focus 合法目标成功', rFocus.ok && rFocus.action && rFocus.action.type === 'focus');
eq('focus 带回 id', rFocus.action.id, 'console');

const rFocusBad = res('focus nowhere');
check('focus 非法目标失败', !rFocusBad.ok);
check('focus 非法目标列出可选值', rFocusBad.lines.some((l) => l.includes('console')));

const rDroneBad = res('drone');
check('drone 缺参数时失败', !rDroneBad.ok);
const rDrone = res('drone off');
check('drone off 成功', rDrone.ok && rDrone.action.value === false);
eq('drone off 改变了状态', tel.droneOnline, false);
res('drone on');
eq('drone on 恢复了状态', tel.droneOnline, true);

const rAuto = res('autopilot off');
check('autopilot 成功', rAuto.ok && rAuto.action.value === false);
eq('autopilot 改变了状态', tel.autoPilot, false);
res('autopilot on');

const rClear = res('clear');
check('clear 成功且带动作', rClear.ok && rClear.action.type === 'clear');
eq('clear 不产生输出', rClear.lines.length, 0);

check('指令大小写不敏感', Core.parseCommand('HELP', {}).ok);
check('多余空格不影响解析', Core.parseCommand('  focus    console  ', {}).ok);

/* ------------------------------ 汇总 ------------------------------ */
console.log('\n' + '─'.repeat(52));
console.log(`通过 ${passed} / ${passed + failed} 项`);
if (failed) {
  console.log('\n失败项：');
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('✓ 全部通过');
}
