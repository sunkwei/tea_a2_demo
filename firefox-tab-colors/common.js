/**
 * 公共定义：颜色板（与 Firefox 原生标签组颜色同名，保证「分组层」和「单标签层」视觉统一）。
 *
 * 用 IIFE + globalThis 挂载，而不是顶层 const：
 * 内容脚本可能被重复注入（动态注册 + executeScript 兜底），
 * 顶层 const 重复声明会抛 SyntaxError，导致整段脚本执行失败。
 */
(function (root) {
  const COLORS = [
    { name: 'red',    hex: '#ff4d4f', emoji: '🔴', cn: '红' },
    { name: 'orange', hex: '#ff9f1c', emoji: '🟠', cn: '橙' },
    { name: 'yellow', hex: '#f7d117', emoji: '🟡', cn: '黄' },
    { name: 'green',  hex: '#3ddc84', emoji: '🟢', cn: '绿' },
    { name: 'cyan',   hex: '#22d3ee', emoji: '🔵', cn: '青' },
    { name: 'blue',   hex: '#3b82f6', emoji: '🟦', cn: '蓝' },
    { name: 'purple', hex: '#a855f7', emoji: '🟪', cn: '紫' },
    { name: 'pink',   hex: '#ff6ec7', emoji: '🌸', cn: '粉' },
    { name: 'gray',   hex: '#9aa0a6', emoji: '⚪', cn: '灰' },
  ];

  const BY_NAME = Object.fromEntries(COLORS.map((c) => [c.name, c]));

  root.TC = {
    COLORS,
    BY_NAME,
    /** 取颜色定义，未知颜色回退灰色 */
    color(name) {
      return BY_NAME[name] || BY_NAME.gray;
    },
    /**
     * 生成标题前缀文本。
     * 占位符：{emoji} 颜色 emoji、{text} 自定义文字、{color} 颜色英文名
     */
    buildPrefix(marker, settings) {
      const c = root.TC.color(marker && marker.color);
      const text = (marker && marker.label) || (settings && settings.prefixText) || '';
      const tpl = (settings && settings.prefixTemplate) || '{emoji} {text}';
      return tpl
        .replaceAll('{emoji}', c.emoji)
        .replaceAll('{text}', text)
        .replaceAll('{color}', c.name)
        .replace(/\s+/g, ' ')
        .trim();
    },
  };
})(globalThis);
