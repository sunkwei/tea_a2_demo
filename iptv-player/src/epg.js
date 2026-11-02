/**
 * 可选 EPG（XMLTV）支持。
 *
 * iptv-org 官方的 EPG 生成器（iptv-org/epg）目前不再直接发布统一的 XMLTV，
 * 公开的免费 EPG 站点也时常不可用，所以这里做成「用户自填地址」的增强功能：
 * 支持 .xml 与 .xml.gz（浏览器 DecompressionStream）。
 */

export async function loadEpg(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`EPG 拉取失败：HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let text;
  const isGz = /\.gz(\?|$)/i.test(url) || res.headers.get('content-encoding')?.includes('gzip');
  if (isGz) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 gzip 解压');
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder('utf-8').decode(buf);
  }
  return parseXmltv(text);
}

export function parseXmltv(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XMLTV 解析失败');
  const programmes = new Map();
  for (const p of doc.querySelectorAll('programme')) {
    const id = p.getAttribute('channel');
    if (!id) continue;
    const title = p.querySelector('title')?.textContent?.trim() || '';
    const desc = p.querySelector('desc')?.textContent?.trim() || '';
    const start = parseTime(p.getAttribute('start'));
    const stop = parseTime(p.getAttribute('stop'));
    if (!programmes.has(id)) programmes.set(id, []);
    programmes.get(id).push({ start, stop, title, desc });
  }
  const channels = new Map();
  for (const c of doc.querySelectorAll('channel')) {
    const id = c.getAttribute('id');
    if (!id) continue;
    channels.set(id, {
      id,
      name: c.querySelector('display-name')?.textContent?.trim() || id,
      icon: c.querySelector('icon')?.getAttribute('src') || '',
    });
  }
  return { programmes, channels };
}

/** XMLTV 时间格式：20240101120000 +0800 */
function parseTime(v) {
  if (!v) return 0;
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/);
  if (!m) return Date.parse(v) || 0;
  const [, y, mo, d, h, mi, s, tz] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s || '00'}${tz ? tz.slice(0, 3) + ':' + tz.slice(3) : ''}`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** 取某频道此刻与接下来的节目 */
export function nowNext(epg, channelIds, at = Date.now()) {
  const ids = Array.isArray(channelIds) ? channelIds : [channelIds];
  for (const id of ids) {
    if (!id) continue;
    const list = epg?.programmes?.get(id);
    if (!list) continue;
    const current = list.find((p) => p.start <= at && (!p.stop || p.stop > at));
    const upcoming = list.filter((p) => p.start > at).sort((a, b) => a.start - b.start)[0];
    if (current || upcoming) {
      const meta = epg.channels?.get(id);
      return { now: current || null, next: upcoming || null, name: meta?.name || id };
    }
  }
  return null;
}
