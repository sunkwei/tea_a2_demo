/**
 * 播放器封装：优先 hls.js（MSE），Safari 走原生 HLS，直链（mp4/ts）直接给 <video>。
 * 负责：错误恢复、备用线路切换、清晰度切换、统计回调。
 */

import Hls from 'hls.js';

const MANIFEST_RE = /\.(m3u8|m3u)(\?|$)/i;

export function isManifest(url) {
  return MANIFEST_RE.test(url || '');
}

/**
 * @param {HTMLVideoElement} video
 * @param {{onState?:Function,onError?:Function,onLevels?:Function,onStats?:Function}} hooks
 */
export function createPlayer(video, hooks = {}) {
  let hls = null;
  let current = null; // { entry, urls: [...] }
  let destroyed = false;
  let retryCount = 0;
  let altIndex = 0;

  const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
  const useHlsJs = Hls.isSupported();

  const emit = (state, payload) => hooks.onState?.(state, payload);

  function destroyHls() {
    if (hls) {
      try {
        hls.destroy();
      } catch {
        /* ignore */
      }
      hls = null;
    }
  }

  function setupHls(url, entry) {
    destroyHls();
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 60,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      liveSyncDurationCount: 3,
      manifestLoadingMaxRetry: 3,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 4,
      // 兼容部分需要特定 UA 的源
      xhrSetup: (xhr) => {
        const ua = entry?.headers?.['user-agent'];
        const ref = entry?.headers?.referrer;
        if (ua) xhr.setRequestHeader('User-Agent', ua);
        if (ref) {
          try {
            xhr.setRequestHeader('Referer', ref);
          } catch {
            /* 浏览器禁止设置 Referer，忽略 */
          }
        }
      },
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      retryCount = 0;
      emit('manifest-parsed', { levels: hls.levels });
      hooks.onLevels?.(hls.levels.map((l, i) => ({ index: i, height: l.height, bitrate: l.bitrate, name: labelOf(l, i) })), hls.currentLevel);
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      const lvl = hls.levels[data.level];
      hooks.onStats?.({ level: data.level, bitrate: lvl?.bitrate || 0, height: lvl?.height || 0 });
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (retryCount < 2) {
          retryCount++;
          emit('retry', { reason: '网络错误，重试中' });
          hls.startLoad();
          return;
        }
        // 换备用线路
        if (nextAlt()) return;
        hooks.onError?.(data, current);
        emit('fatal', data);
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        emit('retry', { reason: '解码错误，恢复中' });
        hls.recoverMediaError();
        return;
      }
      if (nextAlt()) return;
      hooks.onError?.(data, current);
      emit('fatal', data);
    });

    hls.loadSource(url);
    hls.attachMedia(video);
  }

  function labelOf(level, index) {
    if (!level) return `线路 ${index + 1}`;
    if (level.height) return `${level.height}p`;
    if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
    return `线路 ${index + 1}`;
  }

  /** 切到下一条备用地址；没有备用则返回 false */
  function nextAlt() {
    const alts = current?.alts || [];
    if (altIndex < alts.length) {
      const alt = alts[altIndex++];
      emit('alt', alt);
      startUrl(alt.url, current.entry, true);
      return true;
    }
    return false;
  }

  function startUrl(url, entry, isAlt = false) {
    current = current || { entry, urls: [] };
    current.entry = entry;
    if (!isAlt) altIndex = 0;
    emit('loading', { url, entry });
    if (isManifest(url)) {
      if (useHlsJs) setupHls(url, entry);
      else if (nativeHls) {
        destroyHls();
        video.src = url;
      } else {
        hooks.onError?.({ reason: '浏览器不支持 HLS' }, current);
        emit('fatal', { reason: '浏览器不支持 HLS' });
      }
    } else {
      destroyHls();
      video.src = url;
    }
    const p = video.play?.();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 浏览器拦截自动播放：等用户交互
        emit('autoplay-blocked', {});
      });
    }
  }

  return {
    get hls() {
      return hls;
    },
    get current() {
      return current;
    },
    get mode() {
      return useHlsJs ? 'hls.js' : nativeHls ? '原生 HLS' : '直链';
    },
    /** 播放一个频道（entry 需含 url，可带 alts 备用地址） */
    play(entry) {
      if (!entry?.url) return;
      retryCount = 0;
      altIndex = 0;
      current = { entry, alts: entry.alts || [] };
      startUrl(entry.url, entry);
    },
    /** 切清晰度，-1 = 自动 */
    setLevel(index) {
      if (hls) hls.currentLevel = index;
    },
    levels() {
      if (!hls) return [];
      return hls.levels.map((l, i) => ({ index: i, height: l.height, bitrate: l.bitrate, name: labelOf(l, i) }));
    },
    stop() {
      destroyHls();
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* ignore */
      }
      emit('stopped', {});
    },
    destroy() {
      destroyed = true;
      destroyHls();
    },
    get destroyed() {
      return destroyed;
    },
  };
}
