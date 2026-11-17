/**
 * PRTS 风格终端：全屏覆盖层 + 指令解析（复用 core.js 的 parseCommand）
 */

import { parseCommand, formatClock, SHIP } from '../core.js';

export class Terminal {
  constructor(root, { telemetry, log, onAction } = {}) {
    this.telemetry = telemetry;
    this.log = log;
    this.onAction = onAction || (() => {});
    this.open = false;

    const wrap = document.createElement('div');
    wrap.id = 'terminal';
    wrap.innerHTML = `
      <div class="term">
        <div class="term__head">
          <b>PRTS 舰载终端</b>
          <span>${SHIP.hullEn} / OBS-DECK-04 · SECURE CHANNEL</span>
          <div class="x" title="关闭">✕</div>
        </div>
        <div class="term__body"></div>
        <div class="term__foot">
          <span class="prompt">&gt;</span>
          <input type="text" autocomplete="off" spellcheck="false" placeholder="输入指令，help 查看全部" />
          <span class="term__hint">ESC 关闭</span>
        </div>
      </div>`;
    root.appendChild(wrap);
    this.wrap = wrap;
    this.body = wrap.querySelector('.term__body');
    this.input = wrap.querySelector('input');

    wrap.querySelector('.x').addEventListener('click', () => this.hide());
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) this.hide();
    });

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = this.input.value;
        this.input.value = '';
        this.run(v);
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });
  }

  write(text, cls = '') {
    const line = document.createElement('div');
    line.className = 'term__line' + (cls ? ' ' + cls : '');
    line.textContent = text;
    this.body.appendChild(line);
    this.body.scrollTop = this.body.scrollHeight;
  }

  writeHtml(html, cls = '') {
    const line = document.createElement('div');
    line.className = 'term__line' + (cls ? ' ' + cls : '');
    line.innerHTML = html;
    this.body.appendChild(line);
    this.body.scrollTop = this.body.scrollHeight;
  }

  show() {
    this.open = true;
    this.wrap.classList.add('show');
    if (!this.body.children.length) {
      this.writeHtml(
        `<span class="hl">PRTS-CORE v4.21</span> · 终端会话已建立`,
        'dim'
      );
      this.writeHtml(`舰载系统就绪。输入 <span class="hl">help</span> 获取可用指令。`, 'dim');
      this.write('');
    }
    setTimeout(() => this.input.focus(), 60);
  }

  hide() {
    this.open = false;
    this.wrap.classList.remove('show');
    this.input.blur();
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  run(cmdText) {
    if (!cmdText || !cmdText.trim()) return;
    this.writeHtml(`&gt; <span class="hl">${escapeHtml(cmdText)}</span>`, 'cmd');
    const res = parseCommand(cmdText, {
      telemetry: this.telemetry,
      log: this.log,
      now: this.telemetry ? this.telemetry.elapsed : 0,
    });
    for (const line of res.lines) {
      if (line.includes('未知指令')) this.write(line, 'err');
      else this.write(line);
    }
    if (!res.lines.length && res.ok) this.write('（已清空）', 'dim');
    if (res.action) this.onAction(res.action);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export { formatClock };
