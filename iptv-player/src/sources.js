/**
 * 内置直播源目录 —— 全部托管在 GitHub 上（GitHub Pages / raw.githubusercontent），
 * 均带 `Access-Control-Allow-Origin: *`，浏览器端可直连，无需后端代理。
 *
 * 调研结论（2026-10 验证）：
 *   - iptv-org/iptv        142k★ 官方频道索引，每日 PR 更新；产物在 iptv-org.github.io/iptv
 *   - iptv-org/epg          节目单生成器（EPG 目前需自备 XMLTV 地址）
 *   - Free-TV/IPTV         21k★ 手工维护的免费频道列表
 *   - Guovin/iptv-api      25k★ 自动采集/校验/测速工具（适合自建源）
 *   - freearhey/iptv-checker / Shra1V32/Playlist-AutoUpdater  播放列表体检与每日自动更新
 */

const IPTV_ORG = 'iptv-org/iptv';
const IPTV_ORG_BASE = 'https://iptv-org.github.io/iptv';

/** 国家 / 地区分组 */
export const COUNTRY_GROUPS = [
  {
    id: 'grp-cn',
    name: '中国及港澳台',
    items: [
      ['cn', '中国大陆'],
      ['hk', '中国香港'],
      ['mo', '中国澳门'],
      ['tw', '中国台湾'],
    ],
  },
  {
    id: 'grp-asia',
    name: '亚洲',
    items: [
      ['jp', '日本'],
      ['kr', '韩国'],
      ['sg', '新加坡'],
      ['my', '马来西亚'],
      ['th', '泰国'],
      ['vn', '越南'],
      ['ph', '菲律宾'],
      ['id', '印度尼西亚'],
      ['in', '印度'],
      ['pk', '巴基斯坦'],
      ['mn', '蒙古'],
      ['kz', '哈萨克斯坦'],
      ['ge', '格鲁吉亚'],
    ],
  },
  {
    id: 'grp-eu',
    name: '欧洲',
    items: [
      ['uk', '英国'],
      ['ie', '爱尔兰'],
      ['fr', '法国'],
      ['de', '德国'],
      ['it', '意大利'],
      ['es', '西班牙'],
      ['pt', '葡萄牙'],
      ['nl', '荷兰'],
      ['be', '比利时'],
      ['ch', '瑞士'],
      ['at', '奥地利'],
      ['se', '瑞典'],
      ['no', '挪威'],
      ['dk', '丹麦'],
      ['fi', '芬兰'],
      ['pl', '波兰'],
      ['cz', '捷克'],
      ['hu', '匈牙利'],
      ['ro', '罗马尼亚'],
      ['gr', '希腊'],
      ['ru', '俄罗斯'],
      ['ua', '乌克兰'],
      ['tr', '土耳其'],
      ['il', '以色列'],
    ],
  },
  {
    id: 'grp-amer',
    name: '美洲 / 非洲 / 大洋洲',
    items: [
      ['us', '美国'],
      ['ca', '加拿大'],
      ['mx', '墨西哥'],
      ['br', '巴西'],
      ['ar', '阿根廷'],
      ['cl', '智利'],
      ['co', '哥伦比亚'],
      ['pe', '秘鲁'],
      ['pr', '波多黎各'],
      ['za', '南非'],
      ['ng', '尼日利亚'],
      ['eg', '埃及'],
      ['ma', '摩洛哥'],
      ['ke', '肯尼亚'],
      ['au', '澳大利亚'],
      ['nz', '新西兰'],
    ],
  },
];

/** 分类分组（iptv-org 官方 category 列表） */
export const CATEGORY_GROUPS = [
  {
    id: 'grp-cat',
    name: '主题分类',
    items: [
      ['news', '新闻'],
      ['sports', '体育'],
      ['movies', '电影'],
      ['series', '剧集'],
      ['music', '音乐'],
      ['kids', '少儿'],
      ['documentary', '纪录片'],
      ['entertainment', '娱乐'],
      ['general', '综合'],
      ['lifestyle', '生活'],
      ['science', '科技'],
      ['travel', '旅行'],
    ],
  },
];

/** 语言分组 */
export const LANGUAGE_GROUPS = [
  {
    id: 'grp-lang',
    name: '语言',
    items: [
      ['zho', '中文'],
      ['eng', '英文'],
      ['jpn', '日文'],
      ['kor', '韩文'],
      ['rus', '俄文'],
      ['spa', '西文'],
      ['ara', '阿拉伯文'],
    ],
  },
];

/** 地区分组（一次拉取整个大区） */
export const REGION_GROUPS = [
  {
    id: 'grp-region',
    name: '大区',
    items: [
      ['asia', '亚洲'],
      ['europe', '欧洲'],
      ['north-america', '北美洲'],
      ['south-america', '南美洲'],
      ['africa', '非洲'],
      ['oceania', '大洋洲'],
      ['middle-east', '中东'],
    ],
  },
];

/** 其它 GitHub 项目 */
export const OTHER_SOURCES = [
  {
    id: 'test:stream',
    name: '测试流（Mux 官方样例）',
    group: '其它 GitHub 项目',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    repo: null,
    path: null,
    note: '用于验证播放器是否正常（带 CORS，无需代理）',
  },
  {
    id: 'freetv:global',
    name: 'Free-TV 全球免费台',
    group: '其它 GitHub 项目',
    url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
    repo: 'Free-TV/IPTV',
    path: 'playlist.m3u8',
    note: '21k★ 社区维护的免费频道清单',
  },
  {
    id: 'freetv:us',
    name: 'Free-TV 美国',
    group: '其它 GitHub 项目',
    url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_united_states.m3u8',
    repo: 'Free-TV/IPTV',
    path: 'playlists/playlist_united_states.m3u8',
    note: '按国家拆分的免费频道',
  },
  {
    id: 'freetv:cn',
    name: 'Free-TV 中国',
    group: '其它 GitHub 项目',
    url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_china.m3u8',
    repo: 'Free-TV/IPTV',
    path: 'playlists/playlist_china.m3u8',
    note: '按国家拆分的免费频道',
  },
];

function fromGroups(groups, kind) {
  const out = [];
  for (const g of groups) {
    for (const [code, name] of g.items) {
      out.push({
        id: `iptv-org:${kind}:${code}`,
        name,
        group: g.name,
        kind: 'builtin',
        url: `${IPTV_ORG_BASE}/${kind}/${code}.m3u`,
        repo: IPTV_ORG,
        // 国家列表对应仓库里的单个文件；分类/语言/地区由 scripts/generators 生成
        path: kind === 'countries' ? `streams/${code}.m3u` : 'scripts/generators',
        note:
          kind === 'countries'
            ? '国家/地区频道'
            : kind === 'categories'
              ? '主题频道'
              : kind === 'languages'
                ? '语言频道'
                : '大区频道',
      });
    }
  }
  return out;
}

/** 全部内置源 */
export function builtinSources() {
  return [
    ...fromGroups(COUNTRY_GROUPS, 'countries'),
    ...fromGroups(CATEGORY_GROUPS, 'categories'),
    ...fromGroups(LANGUAGE_GROUPS, 'languages'),
    ...fromGroups(REGION_GROUPS, 'regions'),
    ...OTHER_SOURCES,
  ];
}

/** 默认启用的源（首屏不至于拉太多流量） */
export const DEFAULT_ENABLED = [
  'iptv-org:countries:cn',
  'iptv-org:countries:hk',
  'iptv-org:countries:tw',
  'iptv-org:countries:jp',
  'iptv-org:countries:kr',
  'iptv-org:countries:us',
  'iptv-org:countries:uk',
  'iptv-org:categories:news',
  'iptv-org:categories:sports',
  'freetv:global',
];

/** 源分组（用于源管理器里的分区） */
export function sourceGroups(sources) {
  const map = new Map();
  for (const s of sources) {
    const g = s.group || '自定义';
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(s);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
}
