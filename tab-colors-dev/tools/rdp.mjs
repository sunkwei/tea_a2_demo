/**
 * 极简 RDP（Remote Debugging Protocol）客户端
 * 用来驱动由 `web-ext run` 启动的 Firefox（-start-debugger-server <port>）。
 *
 * 报文格式：<字节长度>:<JSON>
 * 参考：web-ext/lib/firefox/rdp-client.js（思路一致，这里自己实现一份最小版本）
 *
 * 注意 1：老协议里「请求的回复」没有 type 字段，而「事件」有 type 字段
 *         （如 evaluationResult / tabNavigated），必须分开处理，否则会串台。
 * 注意 2：evaluationResult 事件可能比请求回复先到（求值很快时），
 *         所以要缓存最近的事件，按 resultID 匹配，否则会永远等不到。
 */
import net from 'node:net';
import { EventEmitter } from 'node:events';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT = 20000;

export class RdpClient extends EventEmitter {
  constructor(timeout = DEFAULT_TIMEOUT) {
    super();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.active = new Map(); // actor -> deferred
    this.pending = [];
    this.timeout = timeout;
    this.results = new Map(); // resultID -> evaluationResult 事件
  }

  connect(port, host = DEFAULT_HOST) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ port, host });
      this.socket = socket;
      socket.on('error', reject);
      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('close', () => {
        for (const { deferred } of this.active.values()) deferred.reject(new Error('RDP closed'));
        this.active.clear();
      });
      this._expect('root', { resolve, reject });
    });
  }

  _expect(actor, deferred) {
    if (this.active.has(actor)) throw new Error(`${actor} 已有未完成的请求`);
    this.active.set(actor, deferred);
    if (this.timeout) {
      deferred.timer = setTimeout(() => {
        if (this.active.get(actor) === deferred) {
          this.active.delete(actor);
          deferred.reject(new Error(`RDP 请求超时: ${actor}`));
          this._flush();
        }
      }, this.timeout);
    }
  }

  request(props) {
    const request = typeof props === 'string' ? { to: 'root', type: props } : props;
    return new Promise((resolve, reject) => {
      this.pending.push({ request, deferred: { resolve, reject } });
      this._flush();
    });
  }

  _flush() {
    this.pending = this.pending.filter(({ request, deferred }) => {
      if (this.active.has(request.to)) return true; // 同一 actor 串行
      const str = JSON.stringify(request);
      this.socket.write(`${Buffer.from(str).length}:${str}`);
      this._expect(request.to, deferred);
      return false;
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const str = this.buffer.toString();
      const sep = str.indexOf(':');
      if (sep < 1) return;
      const len = parseInt(str.slice(0, sep), 10);
      if (!Number.isFinite(len)) throw new Error('RDP 报文长度解析失败');
      if (this.buffer.length < sep + 1 + len) return;
      const payload = this.buffer.subarray(sep + 1, sep + 1 + len).toString('utf8');
      this.buffer = this.buffer.subarray(sep + 1 + len);
      let msg;
      try {
        msg = JSON.parse(payload);
      } catch {
        continue;
      }
      this._handle(msg);
    }
  }

  _handle(msg) {
    if (msg.from == null) return;
    if (msg.type) {
      // 事件（evaluationResult / tabNavigated / ...）
      if (msg.type === 'evaluationResult' && msg.resultID) {
        this.results.set(msg.resultID, msg);
        if (this.results.size > 100) {
          this.results.delete(this.results.keys().next().value);
        }
      }
      this.emit('event', msg);
      return;
    }
    const deferred = this.active.get(msg.from);
    if (!deferred) return;
    this.active.delete(msg.from);
    if (deferred.timer) clearTimeout(deferred.timer);
    if (msg.error) deferred.reject(new Error(`${msg.error}: ${msg.message || ''}`));
    else deferred.resolve(msg);
    this._flush();
  }

  disconnect() {
    try {
      this.socket?.end();
    } catch { /* ignore */ }
  }
}

/** 取某个 actor 的 consoleActor */
export async function consoleActorOf(client, actor) {
  const target = await client.request({ to: actor, type: 'getTarget' });
  return (
    target.form?.consoleActor ||
    target.frame?.consoleActor ||
    target.process?.consoleActor ||
    null
  );
}

/**
 * 执行 JS 并取回字符串结果。
 * evaluateJSAsync 返回 resultID，真正的值以 evaluationResult 事件形式回来。
 * 被求值的表达式请自己 JSON.stringify 成字符串返回。
 */
export async function evalWith(client, consoleActor, text, { timeout = 15000 } = {}) {
  const reply = await client.request({ to: consoleActor, type: 'evaluateJSAsync', text });
  const resultID = reply.resultID;
  if (!resultID) throw new Error(`evaluateJSAsync 没有返回 resultID: ${JSON.stringify(reply)}`);

  const cached = client.results.get(resultID);
  if (cached) {
    client.results.delete(resultID);
    return unwrap(cached);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('event', onEvent);
      reject(new Error(`等待 evaluationResult 超时 (${resultID})`));
    }, timeout);
    function onEvent(msg) {
      if (msg.type !== 'evaluationResult' || msg.resultID !== resultID) return;
      clearTimeout(timer);
      client.off('event', onEvent);
      resolve(unwrap(msg));
    }
    client.on('event', onEvent);
  });
}

function unwrap(msg) {
  if (msg.hasException) {
    throw new Error(`求值异常: ${msg.exceptionMessage || JSON.stringify(msg.exception)}`);
  }
  return msg.result;
}

/** 在标签页里执行 JS */
export async function evalInTab(client, tabActor, text, opts) {
  const consoleActor = await consoleActorOf(client, tabActor);
  if (!consoleActor) throw new Error(`标签页 ${tabActor} 没有 consoleActor`);
  return evalWith(client, consoleActor, text, opts);
}

/** 在 chrome（父进程）作用域执行 JS */
export async function evalInChrome(client, text, opts) {
  const proc = await client.request({ to: 'root', type: 'getProcess', id: 0 });
  const descriptor = proc.processDescriptor || proc;
  const consoleActor = await consoleActorOf(client, descriptor.actor);
  if (!consoleActor) throw new Error('拿不到 chrome consoleActor');
  return evalWith(client, consoleActor, text, opts);
}
