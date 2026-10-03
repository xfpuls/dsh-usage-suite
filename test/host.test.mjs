import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

// 隔离到临时 DSH 主目录：回填只会看到本测试构造的会话日志。
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-meter-home-'));
process.env.DSH_HOME = tmpHome;

const { Config, apply } = await import('../lib/index.js');

/** 把记录写成 DSH 的 zstd 多帧日志格式。 */
function writeLog(file, records) {
  const parts = records.map((record) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(record) + '\n', 'utf8')));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat(parts));
}

/** 今天中午的本地时间戳，保证事件落在「今日」。 */
const todayNoon = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();

/** 所有价格都设为 1 元/百万，使费用断言与计费时段无关。 */
const rawConfig = {
  enabled: true, includeSubagents: false, pollSeconds: 1, holidays: '', autoHolidays: false,
  flashCacheHitPeak: 1, flashCacheHitIdle: 1, flashCacheMissPeak: 1, flashCacheMissIdle: 1, flashOutputPeak: 1, flashOutputIdle: 1,
  proCacheHitPeak: 1, proCacheHitIdle: 1, proCacheMissPeak: 1, proCacheMissIdle: 1, proOutputPeak: 1, proOutputIdle: 1,
};

/** 最小 Cordis 上下文替身。 */
function createFakeCtx() {
  const handlers = new Map();
  const routes = [];
  return {
    handlers,
    routes,
    logger: () => ({ info: () => {}, warn: () => {} }),
    effect: (fn) => { const dispose = fn(); return () => { try { if (typeof dispose === 'function') dispose(); } catch { /* noop */ } }; },
    on: (name, callback) => { handlers.set(name, callback); return () => handlers.delete(name); },
    webServer: { register: (options) => { routes.push(options); return () => { const index = routes.indexOf(options); if (index >= 0) routes.splice(index, 1); }; } },
  };
}

/** 调用注册的路由处理器，收集响应。 */
function callRoute(route, url, options = {}) {
  const { method = 'GET', remote = '127.0.0.1', host = 'localhost:1234' } = options;
  return new Promise((resolve) => {
    const req = { method, url, headers: { host }, socket: { remoteAddress: remote } };
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      end(chunk) { if (chunk) this.body += chunk; let json = null; try { json = JSON.parse(this.body); } catch { json = null; } resolve({ status: this.statusCode, headers: this.headers, json }); },
    };
    route.handler(req, res);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 会话 A：今日 1,000,000 缓存命中 token；会话 B 是子代理。
writeLog(path.join(tmpHome, 'sessions', '--w--', 'session-a', 'session.v4.jsonl.zstd'), [
  { type: 'session', id: 'session-a', delegationDepth: 0, createdAt: todayNoon - 1000 },
  { type: 'turn/start', seq: 1, time: todayNoon - 500, data: { turn: 1 } },
  { type: 'assistant/message', seq: 2, time: todayNoon, data: { turn: 1, step: 1, usage: { cacheReadTokens: 1000000 }, message: { source: { model: 'deepseek-flash' } } } },
]);
writeLog(path.join(tmpHome, 'sessions', '--w--', 'session-b', 'session.v4.jsonl.zstd'), [
  { type: 'session', id: 'session-b', delegationDepth: 1, createdAt: todayNoon - 1000 },
  { type: 'assistant/message', seq: 1, time: todayNoon, data: { turn: 1, step: 1, usage: { cacheReadTokens: 9000000 }, message: { source: { model: 'deepseek-flash' } } } },
]);

const ctx = createFakeCtx();
apply(ctx, Config(rawConfig));
await sleep(60); // 等回填的 setTimeout(0) 跑完

const route = () => {
  const found = ctx.routes.find((item) => item.path === '/dsh-usage');
  assert.ok(found, '应注册 /dsh-usage 路由');
  return found;
};

test('回填今日用量并给出本轮与今日两个口径', async () => {
  const response = await callRoute(route(), '/dsh-usage/state?session=session-a');
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.enabled, true);
  assert.equal(response.json.today.tokens, 1000000);
  assert.equal(response.json.today.cost, 1);
  assert.equal(response.json.session.id, 'session-a');
  assert.equal(response.json.session.cost, 1);
  assert.equal(response.json.session.turn, 1);
  assert.ok(['空闲时段', '高峰时段'].includes(response.json.period.label));
});

test('子代理会话默认不计入今日统计', async () => {
  const response = await callRoute(route(), '/dsh-usage/state?session=session-a');
  assert.equal(response.json.today.tokens, 1000000); // 不是 10,000,000
  assert.equal(response.json.today.sessions, 1);
});

test('实时事件累加到今日与当前轮，且忽略子代理会话', async () => {
  const onEvent = ctx.handlers.get('session/event');
  assert.equal(typeof onEvent, 'function');
  onEvent({ id: 'session-a', delegationDepth: 0 }, {
    type: 'assistant/message', seq: 900, time: Date.now(),
    data: { turn: 1, step: 2, usage: { outputTokens: 500000 }, message: { source: { model: 'deepseek-flash' } } },
  });
  onEvent({ id: 'session-sub', delegationDepth: 2 }, {
    type: 'assistant/message', seq: 1, time: Date.now(),
    data: { turn: 1, step: 1, usage: { outputTokens: 4000000 }, message: { source: { model: 'deepseek-flash' } } },
  });
  const response = await callRoute(route(), '/dsh-usage/state?session=session-a');
  assert.equal(response.json.today.tokens, 1500000);
  assert.equal(response.json.today.cost, 1.5);
  assert.equal(response.json.session.tokens, 1500000);
  assert.equal(response.json.session.cost, 1.5);
});

test('未指定会话时回退到最近活跃会话', async () => {
  const response = await callRoute(route(), '/dsh-usage/state');
  assert.equal(response.json.session.id, 'session-a');
  assert.equal(response.json.activeSession, 'session-a');
});

test('会话不存在时返回 null 而不是报错', async () => {
  const response = await callRoute(route(), '/dsh-usage/state?session=nope');
  assert.equal(response.status, 200);
  assert.equal(response.json.session, null);
});

test('只允许本机访问，其它来源返回 403', async () => {
  const response = await callRoute(route(), '/dsh-usage/state', { remote: '10.1.2.3', host: 'evil.example' });
  assert.equal(response.status, 403);
  assert.equal(response.json.ok, false);
});

test('未知路径 404、非 GET 405、健康检查可用', async () => {
  assert.equal((await callRoute(route(), '/dsh-usage/nope')).status, 404);
  assert.equal((await callRoute(route(), '/dsh-usage/state', { method: 'POST' })).status, 405);
  const health = await callRoute(route(), '/dsh-usage/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.ready, true);
});

test.after(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* noop */ }
});
