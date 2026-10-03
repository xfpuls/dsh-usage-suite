/**
 * 中国法定节假日的自动获取、解析与缓存。
 *
 * 为什么需要它：费用计算里最关键的是「空闲时段」判定，而空闲时段依赖法定节假日 ——
 * 官方规则把节假日全天算作空闲（高峰价的一半）。放假安排由国务院每年年底公布，
 * 程序无法自行推算，所以这里从公开接口获取并按年缓存到本地。
 *
 * 默认数据源（免费、无需 key、不需要登录）：
 *   https://timor.tech/api/holiday/year/<年份>
 * 返回形如：
 *   {"code":0,"holiday":{"01-01":{"holiday":true,"name":"元旦","date":"2026-01-01"},...}}
 *   holiday === true  → 放假（法定节假日及其调休连休）
 *   holiday === false → 周末补班
 *
 * 计价只关心「放假」：官方对高峰时段的定义是「周一至周五（不含法定节假日）」，
 * 周六周日整体算空闲，因此补班日不进入节假日集合。
 *
 * 隐私：请求只包含年份，不带任何本机信息；可在设置里关闭 autoHolidays。
 *
 * @module dsh-usage-suite/holidays
 */

/** 默认数据源模板，{year} 会替换成四位年份。 */
export const DEFAULT_HOLIDAYS_API = 'https://timor.tech/api/holiday/year/{year}';

/** 某一年的数据缓存多久（毫秒）。当年的安排定下来后基本不变，取 30 天。 */
export const YEAR_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 单次网络请求超时（毫秒）。 */
export const REQUEST_TIMEOUT_MS = 8000;

/** 按本机时区取年份。 */
export function yearOf(ms) {
  return new Date(Number(ms)).getFullYear();
}

/** 日期字符串是否合法。 */
function isDateString(value) {
  return typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);
}

/**
 * 解析数据源返回的节假日表。
 *
 * @param payload - 响应对象或响应文本。
 * @param year - 请求的年份，用于回填只有 MM-DD 的键。
 * @returns 排序去重的 YYYY-MM-DD 数组；这次没拿到可用数据时返回 null。
 */
export function parseHolidayResponse(payload, year) {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (error) {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  if (data.code !== undefined && Number(data.code) !== 0) return null;
  const table = data.holiday;
  if (!table || typeof table !== 'object' || Array.isArray(table)) return null;

  const dates = new Set();
  for (const [key, entry] of Object.entries(table)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.holiday !== true) continue;
    let date = isDateString(entry.date) ? entry.date : '';
    if (date === '' && Number.isFinite(Number(year)) && /^[0-9]{2}-[0-9]{2}$/.test(key)) {
      date = String(year) + '-' + key;
    }
    if (isDateString(date)) dates.add(date);
  }
  return [...dates].sort();
}

/** 新建一个空缓存。 */
export function emptyCache() {
  return { version: 1, years: {} };
}

/**
 * 解析缓存文件内容；文件缺失、损坏或版本不符时返回空缓存。
 * @param text - 文件文本。
 * @returns 缓存对象。
 */
export function parseHolidayCache(text) {
  if (typeof text !== 'string' || text.trim() === '') return emptyCache();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return emptyCache();
  }
  if (!data || typeof data !== 'object') return emptyCache();
  const years = {};
  const source = data.years && typeof data.years === 'object' ? data.years : {};
  for (const [year, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object') continue;
    if (!Array.isArray(entry.dates)) continue;
    const dates = entry.dates.filter(isDateString);
    const fetchedAt = Number(entry.fetchedAt);
    if (dates.length === 0) continue;
    years[year] = { dates: [...new Set(dates)].sort(), fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0 };
  }
  return { version: 1, years };
}

/** 某一年缓存的数据是否还新鲜。 */
export function isYearFresh(cache, year, now, ttl = YEAR_CACHE_TTL_MS) {
  const entry = cache && cache.years ? cache.years[String(year)] : undefined;
  if (!entry || !Array.isArray(entry.dates) || entry.dates.length === 0) return false;
  const at = Number(entry.fetchedAt);
  if (!Number.isFinite(at)) return false;
  return Number(now) - at < ttl;
}

/** 把缓存里所有年份的日期摊平成一个集合。 */
export function cacheDates(cache) {
  const dates = new Set();
  const source = cache && cache.years ? cache.years : {};
  for (const entry of Object.values(source)) {
    if (!entry || !Array.isArray(entry.dates)) continue;
    for (const date of entry.dates) if (isDateString(date)) dates.add(date);
  }
  return dates;
}

/**
 * 合并若干来源的节假日日期。
 * @param sources - 集合、数组或字符串（逗号分隔）任意组合。
 * @returns 合并后的 Set。
 */
export function mergeHolidaySets(...sources) {
  const dates = new Set();
  for (const source of sources) {
    if (source === undefined || source === null) continue;
    if (source instanceof Set) {
      for (const date of source) if (isDateString(date)) dates.add(date);
      continue;
    }
    if (Array.isArray(source)) {
      for (const date of source) if (isDateString(date)) dates.add(date);
      continue;
    }
    if (typeof source === 'string') {
      for (const item of source.split(/[\s,;，、]+/)) {
        if (isDateString(item.trim())) dates.add(item.trim());
      }
    }
  }
  return dates;
}

/** 把 {year} 模板换成具体年份；模板里没有占位符时原样返回。 */
export function holidayUrl(template, year) {
  const text = typeof template === 'string' && template.trim() !== '' ? template.trim() : DEFAULT_HOLIDAYS_API;
  return text.replace('{year}', String(year));
}
