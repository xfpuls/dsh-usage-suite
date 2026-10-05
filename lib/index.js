/**
 * dsh-usage-suite 宿主半。
 *
 * 职责：
 * 1. 装载时扫描今天被写过的会话日志，回填「今日用量与费用」；
 * 2. 订阅 session/event 实时累加；
 * 3. 通过 /dsh-usage/state 把两个口径（今日累计、每会话当前轮）与计费时段暴露给浏览器半。
 *
 * 设计取舍：
 * - 不注册自定义 session 投影，避免依赖内部 schema 库；用量数据只在内存里，重启后由回填重建。
 * - 唯一写到磁盘的是法定节假日缓存（$DSH_HOME/usage-suite/holidays.json）：它来自网络、
 *   按年有效，缓存下来就不必每次启动都请求，网络失败时也能沿用上一份数据。
 * - 回填在装载完成后的下一个宏任务里跑，不阻塞界面；期间到达的实时事件先入缓冲区，
 *   回填结束后按事件序号去重合并。
 *
 * @module dsh-usage-suite
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';
import { UsageLedger } from './usage-fold.js';
import { backfillToday, isSubagentSession } from './log-scan.js';
import { buildPricingTable, parseHolidays } from './pricing.js';
import {
  REQUEST_TIMEOUT_MS, cacheDates, holidayUrl, isYearFresh, mergeHolidaySets,
  parseHolidayCache, parseHolidayResponse, yearOf,
} from './holidays.js';

/** 插件名，需与 package.json 的 name 以及 cordis.patch.yml 里的条目一致。 */
export const name = 'dsh-usage-suite';

/** 只依赖 webServer（提供 /dsh-usage 路由）。 */
export const inject = ['webServer'];

/** 路由前缀。 */
const ROUTE_PREFIX = '/dsh-usage';

/**
 * 插件设置。
 *
 * 每个价格字段都标了 volatile：DSH 用 volatile 字段生成插件设置表单，
 * 因此用户可以直接在「设置 → 插件」里改价，无需改代码。
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile().description('启用用量与费用统计'),
  includeSubagents: z.boolean().default(false).volatile().description('把子代理（子会话）的用量也计入今日统计'),
  pollSeconds: z.number().default(1).volatile().description('界面刷新间隔（秒，0.5 - 30）'),
  autoHolidays: z.boolean().default(true).volatile().description('自动从网络获取中国法定节假日（只发送年份，不含任何本机信息）'),
  holidaysApi: z.string().default('https://timor.tech/api/holiday/year/{year}').volatile().description('法定节假日数据源；{year} 会替换成四位年份'),
  holidays: z.string().default('').volatile().description('手动补充的节假日（北京时间 YYYY-MM-DD，逗号分隔）；与自动获取的结果合并'),

  flashCacheHitPeak: z.number().default(0.04).volatile().description('deepseek-flash 输入（缓存命中）高峰价，元/百万 tokens'),
  flashCacheHitIdle: z.number().default(0.02).volatile().description('deepseek-flash 输入（缓存命中）空闲价，元/百万 tokens'),
  flashCacheMissPeak: z.number().default(2).volatile().description('deepseek-flash 输入（缓存未命中）高峰价，元/百万 tokens'),
  flashCacheMissIdle: z.number().default(1).volatile().description('deepseek-flash 输入（缓存未命中）空闲价，元/百万 tokens'),
  flashOutputPeak: z.number().default(8).volatile().description('deepseek-flash 输出高峰价，元/百万 tokens'),
  flashOutputIdle: z.number().default(4).volatile().description('deepseek-flash 输出空闲价，元/百万 tokens'),

  proCacheHitPeak: z.number().default(0.3).volatile().description('deepseek-v4-pro 输入（缓存命中）高峰价，元/百万 tokens'),
  proCacheHitIdle: z.number().default(0.15).volatile().description('deepseek-v4-pro 输入（缓存命中）空闲价，元/百万 tokens'),
  proCacheMissPeak: z.number().default(9).volatile().description('deepseek-v4-pro 输入（缓存未命中）高峰价，元/百万 tokens'),
  proCacheMissIdle: z.number().default(4.5).volatile().description('deepseek-v4-pro 输入（缓存未命中）空闲价，元/百万 tokens'),
  proOutputPeak: z.number().default(27).volatile().description('deepseek-v4-pro 输出高峰价，元/百万 tokens'),
  proOutputIdle: z.number().default(13.5).volatile().description('deepseek-v4-pro 输出空闲价，元/百万 tokens'),
});

/** 设置前缀到模型名的映射。 */
const MODEL_PREFIXES = { flash: 'deepseek-flash', pro: 'deepseek-v4-pro' };

/** 计算「配置指纹」：只有价格、节假日、子代理开关变化才需要重建账本。 */
function signatureOf(settings) {
  return JSON.stringify(SIGNIFICANT_FIELDS.map((field) => settings?.[field]));
}

/** 判断一条会话（事件里的 session 对象或日志头）是否属于子代理。 */
function isSubagentLike(session) {
  if (!session || typeof session !== 'object') return false;
  if (isSubagentSession(session)) return true;
  const depth = Number(session.header?.delegationDepth);
  return Number.isFinite(depth) && depth > 0;
}

/** 参与「配置变更检测」的字段：这些变化会触发账本重建与重新回填。 */
const SIGNIFICANT_FIELDS = [
  'includeSubagents', 'holidays', 'autoHolidays', 'holidaysApi',
  'flashCacheHitPeak', 'flashCacheHitIdle', 'flashCacheMissPeak', 'flashCacheMissIdle', 'flashOutputPeak', 'flashOutputIdle',
  'proCacheHitPeak', 'proCacheHitIdle', 'proCacheMissPeak', 'proCacheMissIdle', 'proOutputPeak', 'proOutputIdle',
];

/**
 * 拆开 volatile 包装：DSH 的 volatile 字段在 Loader 里是 Volatile 盒子，
 * 需要调用 .get() 才能拿到实际值。
 * @param value - 任意设置值。
 * @returns 去掉盒子的纯数据。
 */
export function plainConfig(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(plainConfig);
  if (typeof value.get === 'function') return plainConfig(value.get());
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainConfig(item)]));
}

/** 解析 DSH 主目录：显式 $DSH_HOME 优先，否则回退 ~/.dsh。 */
function resolveDshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), '.dsh');
}

/** 判断请求是否来自本机（只允许本机访问统计接口）。 */
function isTrustedCaller(req) {
  const remote = String(req?.socket?.remoteAddress ?? req?.connection?.remoteAddress ?? '').toLowerCase();
  if (remote === '::1' || remote === '127.0.0.1' || remote.startsWith('127.') || remote.startsWith('::ffff:127.')) return true;
  const host = String(req?.headers?.host ?? '').split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** 写一个 JSON 响应，绝不让序列化失败冒泡成 500。 */
function respond(res, statusCode, payload) {
  let body;
  try {
    body = JSON.stringify(payload);
  } catch {
    body = '{"ok":false,"error":"serialize failed"}';
    statusCode = 500;
  }
  res.statusCode = statusCode;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(body);
}

/** 把秒数限制在合理区间。 */
function clampPollSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 1;
  return Math.min(30, Math.max(0.5, seconds));
}

/**
 * 插件入口。
 * @param ctx - Cordis 上下文。
 * @param config - 插件设置（volatile 盒子）。
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ? ctx.logger('usage-meter') : console;
  try {
    return install(ctx, config, logger);
  } catch (error) {
    logger.warn?.('[dsh-usage-suite] 装载失败:', error?.message ?? error);
    return undefined;
  }
}

/**
 * 实际装载逻辑。每一步失败都被隔离成日志：插件装载本身绝不抛错，
 * 以免拖累整个 DSH profile 的启动。
 *
 * @param ctx - Cordis 上下文。
 * @param config - 插件设置（volatile 盒子）。
 * @param logger - 日志器。
 */
function install(ctx, config, logger) {
  const sessionsRoot = path.join(resolveDshHome(), 'sessions');

  /** 运行时状态容器。 */
  const state = {
    signature: '',
    settings: plainConfig(config) ?? {},
    ready: false,
    buffer: [],
    lastSeen: new Map(),
    ledger: null,
    holidayCache: null,
  };

  /**
   * 节假日缓存文件：自动获取的结果按年存放，避免每次都请求网络。
   *
   * 注意这两个定义必须排在下面建账本之前 —— 见紧随其后的注释。
   */
  const holidaysCacheFile = path.join(resolveDshHome(), 'usage-suite', 'holidays.json');

  /** 读本地缓存；文件不存在或损坏时返回空缓存。 */
  const readHolidayCache = () => {
    try {
      return parseHolidayCache(fs.readFileSync(holidaysCacheFile, 'utf8'));
    } catch (error) {
      return { version: 1, years: {} };
    }
  };

  /**
   * 先把磁盘上的节假日缓存装进 state，再建账本 —— 这两步的顺序很关键。
   *
   * 如果反了（先建账本、后读缓存），第一帧就会在「没有节假日」的前提下算时段：
   * 节假日期间的周一 16:27 会被判成下午高峰，等缓存或网络补齐后再跳回空闲，
   * 用户就会看到侧栏先显示「高峰时段」、过几秒才变成「空闲时段」的闪变。
   */
  state.holidayCache = readHolidayCache();

  /** 依据当前设置新建账本（价格与节假日）。 */
  const createLedger = (settings) => new UsageLedger({
    table: buildPricingTable(settings, MODEL_PREFIXES),
    holidays: mergeHolidaySets(
      state.holidayCache ? cacheDates(state.holidayCache) : undefined,
      parseHolidays(settings.holidays),
    ),
  });

  state.ledger = createLedger(state.settings);
  state.signature = signatureOf(state.settings);

  /** 原子写回缓存（先写临时文件再改名，避免半个文件）。 */
  const writeHolidayCache = (cache) => {
    try {
      fs.mkdirSync(path.dirname(holidaysCacheFile), { recursive: true });
      const temporary = holidaysCacheFile + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(cache, null, 2), 'utf8');
      fs.renameSync(temporary, holidaysCacheFile);
    } catch (error) {
      logger.warn?.('[dsh-usage-suite] 写节假日缓存失败:', error?.message ?? error);
    }
  };

  /** 把「自动获取的」与「手动补的」合并进账本。 */
  const applyHolidays = (cache) => {
    state.holidayCache = cache;
    const manual = parseHolidays(state.settings.holidays);
    const auto = state.settings.autoHolidays === false ? undefined : cacheDates(cache);
    state.ledger.holidays = mergeHolidaySets(auto, manual);
  };

  /**
   * 确保今年与明年的法定节假日可用。
   * 当年的安排定下来后基本不变，缓存 30 天；明年的通常要到年底才公布，
   * 拿不到就沿用已有数据并在下一轮再试，绝不因为网络失败影响计价。
   */
  const refreshHolidays = async () => {
    const settings = state.settings;
    if (settings.autoHolidays === false) {
      applyHolidays({ version: 1, years: {} });
      return;
    }
    const now = Date.now();
    const cache = readHolidayCache();
    const stale = [yearOf(now), yearOf(now) + 1].filter((year) => !isYearFresh(cache, year, now));
    if (stale.length === 0) {
      applyHolidays(cache);
      return;
    }
    let changed = false;
    for (const year of stale) {
      try {
        const response = await fetch(holidayUrl(settings.holidaysApi, year), {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { Accept: 'application/json', 'User-Agent': 'dsh-usage-suite' },
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const dates = parseHolidayResponse(await response.json(), year);
        if (dates === null) throw new Error('响应结构不可用');
        cache.years[String(year)] = { dates, fetchedAt: now };
        changed = true;
        logger.info?.('[dsh-usage-suite] 已获取 ' + year + ' 年法定节假日 ' + dates.length + ' 天');
      } catch (error) {
        logger.warn?.('[dsh-usage-suite] 获取 ' + year + ' 年法定节假日失败（沿用已有数据）:', error?.message ?? error);
      }
    }
    if (changed) writeHolidayCache(cache);
    applyHolidays(cache);
  };

  /** 回填今日数据；完成前收到的实时事件先缓存。 */
  const scheduleBackfill = () => {
    state.ready = false;
    const run = () => {
      const ledger = state.ledger;
      try {
        const stats = backfillToday(ledger, {
          sessionsRoot,
          now: Date.now(),
          includeSubagents: state.settings.includeSubagents === true,
          logger,
        });
        logger.info?.('[dsh-usage-suite] 今日回填完成:', JSON.stringify(stats));
      } catch (error) {
        logger.warn?.('[dsh-usage-suite] 回填失败:', error?.message ?? error);
      }
      state.ready = true;
      const pending = state.buffer;
      state.buffer = [];
      for (const [sessionId, event] of pending) {
        try {
          ledger.ingest(sessionId, event);
        } catch (error) {
          logger.warn?.('[dsh-usage-suite] 缓冲事件处理失败:', error?.message ?? error);
        }
      }
    };
    const timer = setTimeout(run, 0);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearTimeout(timer);
  };

  /** 把一条实时事件交给账本（回填未完成时先入缓冲）。 */
  const feed = (sessionId, event) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    state.lastSeen.set(sessionId, Date.now());
    if (state.settings.enabled === false) return;
    if (!state.ready) {
      // 缓冲上限，避免异常情况下无限增长。
      if (state.buffer.length < 5000) state.buffer.push([sessionId, event]);
      return;
    }
    state.ledger.ingest(sessionId, event);
  };

  /** 检测设置变化，变化时用新价目重建账本并重新回填。 */
  const syncConfiguration = (fresh) => {
    const settings = fresh ?? (plainConfig(config) ?? {});
    const signature = signatureOf(settings);
    if (signature === state.signature) return;
    state.signature = signature;
    state.settings = settings;
    state.ledger = createLedger(settings);
    scheduleBackfill();
    // 开关或数据源变了：按新设置重新解析节假日（关闭时立即清空自动部分）。
    refreshHolidays().catch((error) => logger.warn?.('[dsh-usage-suite] 节假日刷新失败:', error?.message ?? error));
  };

  // 1. 订阅会话事件：用量样本、轮次边界、重试都从这里来。
  ctx.effect(() => {
    let dispose;
    try {
      dispose = ctx.on('session/event', (session, event) => {
        try {
          if (!state.settings.includeSubagents && isSubagentLike(session)) return;
          feed(session?.id, event);
        } catch (error) {
          logger.warn?.('[dsh-usage-suite] 处理会话事件失败:', error?.message ?? error);
        }
      }, { global: true });
    } catch (error) {
      logger.warn?.('[dsh-usage-suite] 订阅会话事件失败:', error?.message ?? error);
    }
    return () => {
      try {
        dispose?.();
      } catch (error) {
        /* 取消订阅失败无需处理 */
      }
    };
  }, 'dsh-usage-suite: session events');

  // 2. 装载后异步回填，避免拖慢启动。
  ctx.effect(() => {
    const cancel = scheduleBackfill();
    return cancel;
  }, 'dsh-usage-suite: backfill');

  // 3. 自动获取法定节假日：启动后延迟一次，之后每 6 小时检查是否过期。
  ctx.effect(() => {
    let disposed = false;
    const run = () => {
      if (disposed) return;
      refreshHolidays().catch((error) => logger.warn?.('[dsh-usage-suite] 节假日刷新失败:', error?.message ?? error));
    };
    const initial = setTimeout(run, 1500);
    const timer = setInterval(run, 6 * 60 * 60 * 1000);
    if (typeof initial.unref === 'function') initial.unref();
    if (typeof timer.unref === 'function') timer.unref();
    return () => {
      disposed = true;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, 'dsh-usage-suite: holidays');

  // 4. 暴露给浏览器半的只读接口。
  if (ctx?.webServer?.register) {
    ctx.effect(() => {
      let unregister;
      try {
        unregister = ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
          try {
            if (!isTrustedCaller(req)) {
              respond(res, 403, { ok: false, error: 'forbidden' });
              return;
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              respond(res, 405, { ok: false, error: 'method not allowed' });
              return;
            }
            const url = new URL(req.url ?? ROUTE_PREFIX, 'http://localhost');
            const settings = plainConfig(config) ?? {};
            syncConfiguration(settings);
            const ledger = state.ledger;

            if (url.pathname === ROUTE_PREFIX + '/state' || url.pathname === ROUTE_PREFIX + '/state/') {
              const requested = url.searchParams.get('session');
              const active = activeSessionId(state);
              const sessionId = requested && requested.length > 0 ? requested : active;
              respond(res, 200, {
                ok: true,
                version: 1,
                enabled: settings.enabled !== false,
                ready: state.ready,
                day: ledger.day,
                today: ledger.todaySnapshot(),
                period: ledger.period(Date.now()),
                session: sessionId === undefined ? null : ledger.sessionSnapshot(sessionId),
                activeSession: active ?? null,
                settings: {
                  currency: 'CNY',
                  pollSeconds: clampPollSeconds(settings.pollSeconds),
                  includeSubagents: settings.includeSubagents === true,
                  holidays: settings.holidays ?? '',
                },
              });
              return;
            }

            if (url.pathname === ROUTE_PREFIX + '/health' || url.pathname === ROUTE_PREFIX + '/health/') {
              respond(res, 200, { ok: true, ready: state.ready, sessions: ledger.sessions.size });
              return;
            }

            respond(res, 404, { ok: false, error: 'not found' });
          } catch (error) {
            logger.warn?.('[dsh-usage-suite] 请求处理失败:', error?.message ?? error);
            respond(res, 500, { ok: false, error: 'internal error' });
          }
        },
        });
      } catch (error) {
        logger.warn?.('[dsh-usage-suite] 注册路由失败:', error?.message ?? error);
      }
      return () => {
        try {
          unregister?.();
        } catch (error) {
          logger.warn?.('[dsh-usage-suite] 注销路由失败:', error?.message ?? error);
        }
      };
    }, 'dsh-usage-suite: routes');
  } else {
    logger.warn?.('[dsh-usage-suite] 未注入 webServer，浏览器半将拿不到数据');
  }
}

/** 取最近活跃的会话 id：用于浏览器半拿不到会话标识时兜底。 */
function activeSessionId(state) {
  let best;
  let bestAt = -1;
  for (const [id, at] of state.lastSeen) {
    if (at > bestAt) {
      bestAt = at;
      best = id;
    }
  }
  return best;
}
