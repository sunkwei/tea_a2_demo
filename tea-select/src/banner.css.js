/* 横幅样式（注入到 shadow root 里，不受页面样式影响） */
(function (root) {
  'use strict';
  root.TeaBannerCSS = `
:host {
  all: initial;
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  z-index: 2147483647;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; }
.wrap {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: auto;
  transform: translate(-9999px, -9999px);
}
.bar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px;
  background: rgba(28, 30, 34, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(6px);
  white-space: nowrap;
}
.bar button.task {
  appearance: none;
  border: 0;
  background: transparent;
  color: #e9eaec;
  font-size: 13px;
  line-height: 1;
  padding: 7px 12px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.bar button.task:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.bar button.task:active { background: rgba(255, 255, 255, 0.2); }
.bar button.task.busy { color: #7f8896; cursor: default; }
.bar .sep { width: 1px; background: rgba(255, 255, 255, 0.14); margin: 4px 3px; }
.bar button.close {
  appearance: none;
  border: 0;
  background: transparent;
  color: #9aa0a6;
  font-size: 15px;
  line-height: 1;
  padding: 6px 8px;
  border-radius: 7px;
  cursor: pointer;
}
.bar button.close:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.panel {
  margin-top: 6px;
  width: 380px;
  max-width: 82vw;
  background: rgba(24, 26, 30, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  display: none;
}
.panel.open { display: block; }
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px 7px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  background: rgba(255, 255, 255, 0.03);
}
.panel-title {
  font-size: 12px;
  color: #b9bec6;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-head button {
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.08);
  color: #d7dade;
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 6px;
  cursor: pointer;
}
.panel-head button:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
.panel-head button.close-btn {
  background: rgba(255, 255, 255, 0.14);
  color: #e8eaed;
  margin-left: 2px;
}
.panel-head button.close-btn:hover { background: rgba(232, 90, 90, 0.85); color: #fff; }
.panel-body {
  padding: 10px 12px;
  max-height: 300px;
  overflow: auto;
  font-size: 13.5px;
  line-height: 1.62;
  color: #eceef1;
  white-space: pre-wrap;
  word-break: break-word;
}
.panel-body .loading { color: #9aa0a6; }
.panel-body .error { color: #ff9c9c; }
.panel-body details { margin-top: 10px; color: #9aa0a6; font-size: 12px; }
.panel-body summary { cursor: pointer; }
.panel-body pre {
  margin: 6px 0 0;
  padding: 8px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
.panel-sources {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  font-size: 12px;
  color: #aab0b8;
}
.panel-sources a { color: #7fb0ff; text-decoration: none; display: block; margin: 3px 0; }
.panel-sources a:hover { text-decoration: underline; }
/* 识图：横幅上的三个任务按钮用不上，藏掉；面板里放抓到的图 */
.wrap.vision-mode .bar { display: none; }
.panel-body img.shot {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}
`;

  // 划图（选区）覆盖层的样式
  root.TeaPickerCSS = `
:host {
  all: initial;
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  z-index: 2147483647;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; }
.pick-layer {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  cursor: crosshair;
  pointer-events: auto;
  background: rgba(10, 12, 16, 0.18);
}
.pick-box {
  position: fixed;
  display: none;
  border: 1.5px solid #4c8dff;
  background: rgba(76, 141, 255, 0.1);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.42);
  pointer-events: none;
}
.pick-box.on { display: block; }
.pick-hint {
  position: fixed;
  left: 50%;
  top: 26px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(28, 30, 34, 0.95);
  color: #e9eaec;
  font-size: 13px;
  line-height: 1.2;
  white-space: nowrap;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.32);
  pointer-events: none;
}
`;
})(typeof globalThis !== 'undefined' ? globalThis : this);
