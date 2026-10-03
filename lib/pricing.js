/**
 * 计价与计费时段判定。
 *
 * 本模块是纯函数集合，不依赖 Cordis，便于单独测试。
 *
 * 单位约定：
 * - 对外价格（设置项里填写的）＝ 元 / 百万 tokens；
 * - 内部费用 ＝ 微元（1e-6 元）整数，避免浮点累加误差；
 * - token 数量本身是整数。
 *
 * 计费时段（DeepSeek 官方规则）：北京时间周一至周五 09:00-12:00、14:00-18:00
 * 为高峰时段，其余（含周末与法定节假日全天）为空闲时段。两档价格分别保存，
 * 因此官方调整折扣比例时只需改设置，不必改代码。
 *
 * @module dsh-usage-meter/pricing
 */

/** 北京时间的固定 UTC 偏移（分钟）。中国大陆不实行夏令时，因此是常量。 */
export const BEIJING_OFFSET_MINUTES = 480;

/** 一元的微元数。 */
export const MICRO_PER_YUAN = 1000000;

/** 价格单位中的 token 数。 */
export const TOKENS_PER_MILLION = 1000000;

/** 每个模型需要填写的六个价格字段。 */
export const PRICE_FIELDS = [
  'cacheHitPeak', 'cacheHitIdle',
  'cacheMissPeak', 'cacheMissIdle',
  'outputPeak', 'outputIdle',
];

/**
 * 内置价目表（元 / 百万 tokens）。
 *
 * 来源：DeepSeek 开放平台「模型 & 价格」页（api-docs.deepseek.com/zh-cn/quick_start/pricing），
 * 采集于 2026-10-03。官方调价后请在插件设置里改。
 */
export const DEFAULT_PRICING = {
  'deepseek-flash': {
    cacheHitPeak: 0.04, cacheHitIdle: 0.02,
    cacheMissPeak: 2, cacheMissIdle: 1,
    outputPeak: 8, outputIdle: 4,
  },
  'deepseek-v4-pro': {
    cacheHitPeak: 0.3, cacheHitIdle: 0.15,
    cacheMissPeak: 9, cacheMissIdle: 4.5,
    outputPeak: 27, outputIdle: 13.5,
  },
};

/** 价格表里找不到模型时使用的模型键。 */
export const FALLBACK_MODEL = 'deepseek-flash';

/** 空的 token 桶。 */
export function emptyBuckets() {
  return { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
}

/** 把任意形状的 token 桶规整为非负整数桶，缺失字段补 0。 */
export function normalizeBuckets(value) {
  const num = (input) => {
    const n = Number(input);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  return {
    uncachedInputTokens: num(value?.uncachedInputTokens ?? value?.inputTokens),
    cacheReadTokens: num(value?.cacheReadTokens),
    cacheWriteTokens: num(value?.cacheWriteTokens),
    outputTokens: num(value?.outputTokens),
  };
}

/** 一个桶里的 token 总数。 */
export function totalTokens(buckets) {
  const b = normalizeBuckets(buckets);
  return b.uncachedInputTokens + b.cacheReadTokens + b.cacheWriteTokens + b.outputTokens;
}

/** 两个桶相加（不修改入参）。 */
export function addBuckets(left, right) {
  const a = normalizeBuckets(left);
  const b = normalizeBuckets(right);
  return {
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

/** left 减 right（逐字段，结果可为负，用于「替换旧样本」）。 */
export function subtractBuckets(left, right) {
  const a = normalizeBuckets(left);
  const b = normalizeBuckets(right);
  return {
    uncachedInputTokens: a.uncachedInputTokens - b.uncachedInputTokens,
    cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens - b.cacheWriteTokens,
    outputTokens: a.outputTokens - b.outputTokens,
  };
}

/** 两个桶是否相等。 */
export function bucketsEqual(left, right) {
  const a = normalizeBuckets(left);
  const b = normalizeBuckets(right);
  return a.uncachedInputTokens === b.uncachedInputTokens
    && a.cacheReadTokens === b.cacheReadTokens
    && a.cacheWriteTokens === b.cacheWriteTokens
    && a.outputTokens === b.outputTokens;
}

/** 某个售价对应的微元数（元 × 1e6），四舍五入到整数微元；非法输入返回 0。 */
export function microPerMillion(priceYuanPerMillion) {
  const value = Number(priceYuanPerMillion);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * MICRO_PER_YUAN);
}

/** tokens ×（元/百万 tokens）的精确微元成本。 */
export function priceMicro(tokens, priceYuanPerMillion) {
  const count = Number(tokens);
  if (!Number.isFinite(count) || count <= 0) return 0;
  const unit = microPerMillion(priceYuanPerMillion);
  if (unit === 0) return 0;
  return Math.round((count * unit) / TOKENS_PER_MILLION);
}

/** 微元转元（用于序列化给客户端，客户端只做展示）。 */
export function microToYuan(micro) {
  return Math.round(Number(micro) || 0) / MICRO_PER_YUAN;
}

/**
 * 把插件设置里的价格字段整理成 { 模型键: { 六个价格 } }。
 *
 * 设置项形如 flashCacheHitPeak、proOutputIdle；前缀通过 modelPrefixes
 * 映射到模型键，未填写的字段沿用 DEFAULT_PRICING。
 *
 * @param config - 插件设置对象。
 * @param modelPrefixes - { 设置前缀: 模型键 }。
 * @param extraModels - 额外模型定义（可选）。
 * @returns 归一化价目表。
 */
export function buildPricingTable(config = {}, modelPrefixes = {}, extraModels = {}) {
  const table = {};
  for (const [model, defaults] of Object.entries({ ...DEFAULT_PRICING, ...extraModels })) {
    table[model] = { ...defaults };
  }
  for (const [prefix, model] of Object.entries(modelPrefixes)) {
    const target = table[model] ?? (table[model] = {});
    for (const field of PRICE_FIELDS) {
      const key = prefix + field.charAt(0).toUpperCase() + field.slice(1);
      const raw = config?.[key];
      if (raw === undefined || raw === null || raw === '') continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) target[field] = value;
    }
  }
  return table;
}

/** 解析逗号、分号、顿号、空白分隔的节假日日期串为 Set（YYYY-MM-DD）。 */
export function parseHolidays(input) {
  const text = typeof input === 'string' ? input : Array.isArray(input) ? input.join(',') : '';
  const set = new Set();
  for (const item of text.split(/[\s,;，、]+/)) {
    const value = item.trim();
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) set.add(value);
  }
  return set;
}

/** 把毫秒时间戳按固定偏移换算成墙上时钟字段。 */
export function partsAt(ms, offsetMinutes) {
  const shifted = new Date(Number(ms) + offsetMinutes * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}

/** 两位补零。 */
function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 把墙上时钟字段格式化成 YYYY-MM-DD。 */
export function formatDay(parts) {
  return String(parts.year) + '-' + pad2(parts.month) + '-' + pad2(parts.day);
}

/** 本地时区的日期键（YYYY-MM-DD）。 */
export function localDayKey(ms) {
  const date = new Date(Number(ms));
  return String(date.getFullYear()) + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

/** 北京时间（UTC+8）的日期键。 */
export function beijingDayKey(ms) {
  return formatDay(partsAt(ms, BEIJING_OFFSET_MINUTES));
}

/** 北京时间的 HH:MM。 */
export function beijingClock(ms) {
  const parts = partsAt(ms, BEIJING_OFFSET_MINUTES);
  return pad2(parts.hour) + ':' + pad2(parts.minute);
}

/** 本地时区当天的 0 点毫秒时间戳。 */
export function localDayStart(ms) {
  const date = new Date(Number(ms));
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 判断某个时刻是否处于空闲时段（计费打折时段）。
 *
 * 官方规则：北京时间周一至周五 09:00-12:00、14:00-18:00 为高峰，
 * 其余时段（含周末与中国法定节假日全天）为空闲。法定节假日无法自动获取，
 * 由设置项 holidays 显式列出。
 *
 * @param ms - 毫秒时间戳。
 * @param holidays - 节假日日期集合（北京时间日期键）。
 * @returns 空闲时段返回 true。
 */
export function isIdleAt(ms, holidays = new Set()) {
  const parts = partsAt(ms, BEIJING_OFFSET_MINUTES);
  if (holidays.has(formatDay(parts))) return true;
  if (parts.weekday === 0 || parts.weekday === 6) return true;
  const morning = parts.hour >= 9 && parts.hour < 12;
  const afternoon = parts.hour >= 14 && parts.hour < 18;
  return !(morning || afternoon);
}

/** 某个时刻使用的时段描述。 */
export function periodAt(ms, holidays = new Set()) {
  const idle = isIdleAt(ms, holidays);
  return {
    idle,
    label: idle ? '空闲时段' : '高峰时段',
    clock: beijingClock(ms),
    dayKey: beijingDayKey(ms),
  };
}

/**
 * 一组 token 桶在指定时段、指定价格下的费用（微元）。
 *
 * 缓存写入（cacheWriteTokens）没有单独官方价，按「输入（缓存未命中）」计价。
 */
export function costMicroOf(buckets, pricing, idle) {
  const table = pricing && typeof pricing === 'object' ? pricing : {};
  const suffix = idle ? 'Idle' : 'Peak';
  const b = normalizeBuckets(buckets);
  return priceMicro(b.uncachedInputTokens, table['cacheMiss' + suffix])
    + priceMicro(b.cacheReadTokens, table['cacheHit' + suffix])
    + priceMicro(b.cacheWriteTokens, table['cacheMiss' + suffix])
    + priceMicro(b.outputTokens, table['output' + suffix]);
}

/**
 * 单个用量样本的成本：模型到价目到时段。
 *
 * @param buckets - token 桶。
 * @param model - 模型名（如 deepseek-flash）。
 * @param at - 事件发生时刻（毫秒）。
 * @param table - 价目表。
 * @param holidays - 节假日集合。
 * @returns micro / idle / pricingModel 三项。
 */
export function sampleCost(buckets, model, at, table, holidays = new Set()) {
  const pricingModel = table && Object.prototype.hasOwnProperty.call(table, model) ? model : FALLBACK_MODEL;
  const pricing = (table && table[pricingModel]) ?? DEFAULT_PRICING[FALLBACK_MODEL];
  const idle = isIdleAt(at, holidays);
  return { micro: costMicroOf(buckets, pricing, idle), idle, pricingModel };
}
