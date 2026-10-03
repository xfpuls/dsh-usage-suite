import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageLedger, usageOfEvent, modelOfEvent } from '../lib/usage-fold.js';
import { DEFAULT_PRICING, localDayKey } from '../lib/pricing.js';

const FLASH = { 'deepseek-flash': DEFAULT_PRICING['deepseek-flash'] };
// 北京时间周二 10:00 = 高峰；13:00 = 空闲。用 UTC 串保证与运行机器时区无关。
const PEAK = Date.parse('2026-10-06T02:00:00Z');
const IDLE = Date.parse('2026-10-06T05:00:00Z');

const message = (seq, time, turn, step, usage, model = 'deepseek-flash') => ({
  type: 'assistant/message', seq, time, data: { turn, step, usage, message: { source: { kind: 'model', provider: 'deepseek-account', model } } },
});

test('同一 (turn, step) 的重复上报以最后一次为准', () => {
  const ledger = new UsageLedger({ table: FLASH });
  ledger.ingest('s1', { type: 'turn/start', seq: 1, time: PEAK, data: { turn: 1 } });
  ledger.ingest('s1', message(2, PEAK, 1, 1, { inputTokens: 1000000, outputTokens: 0 }));
  ledger.ingest('s1', message(3, PEAK, 1, 1, { inputTokens: 1000000, outputTokens: 1000000 }));
  const today = ledger.todaySnapshot();
  assert.equal(today.buckets.uncachedInputTokens, 1000000);
  assert.equal(today.buckets.outputTokens, 1000000);
  assert.equal(today.costMicro, 10000000); // 2 元 + 8 元
  assert.equal(today.cost, 10);
});

test('turn/start 清零本轮，今日累计保留', () => {
  const ledger = new UsageLedger({ table: FLASH });
  ledger.ingest('s1', { type: 'turn/start', seq: 1, time: PEAK, data: { turn: 1 } });
  ledger.ingest('s1', message(2, PEAK, 1, 1, { inputTokens: 1000000, outputTokens: 0 }));
  const before = ledger.sessionSnapshot('s1');
  assert.equal(before.costMicro, 2000000);
  ledger.ingest('s1', { type: 'turn/start', seq: 3, time: PEAK, data: { turn: 2 } });
  const after = ledger.sessionSnapshot('s1');
  assert.equal(after.turn, 2);
  assert.equal(after.costMicro, 0);
  assert.equal(ledger.todaySnapshot().costMicro, 2000000);
});

test('llm/retry-started 撤销该步样本，重试后的样本重新计入', () => {
  const ledger = new UsageLedger({ table: FLASH });
  ledger.ingest('s1', { type: 'turn/start', seq: 1, time: PEAK, data: { turn: 1 } });
  ledger.ingest('s1', { type: 'step/start', seq: 2, time: PEAK, data: { turn: 1, step: 1 } });
  ledger.ingest('s1', message(3, PEAK, 1, 1, { inputTokens: 1000000 }));
  assert.equal(ledger.todaySnapshot().costMicro, 2000000);
  ledger.ingest('s1', { type: 'llm/retry-started', seq: 4, time: PEAK, data: { turn: 1, step: 1 } });
  assert.equal(ledger.todaySnapshot().costMicro, 0);
  ledger.ingest('s1', message(5, PEAK, 1, 1, { inputTokens: 2000000 }));
  assert.equal(ledger.todaySnapshot().costMicro, 4000000);
});

test('重复序号的事件不会重复计费', () => {
  const ledger = new UsageLedger({ table: FLASH });
  const event = message(7, PEAK, 1, 1, { inputTokens: 1000000 });
  ledger.ingest('s1', event);
  ledger.ingest('s1', event);
  ledger.ingest('s1', { ...event });
  assert.equal(ledger.todaySnapshot().costMicro, 2000000);
  assert.equal(ledger.todaySnapshot().samples, 1);
});

test('空闲时段按半价计价', () => {
  const ledger = new UsageLedger({ table: FLASH });
  ledger.ingest('s1', { type: 'turn/start', seq: 1, time: IDLE, data: { turn: 1 } });
  ledger.ingest('s1', message(2, IDLE, 1, 1, { inputTokens: 1000000, outputTokens: 1000000, cacheReadTokens: 1000000 }));
  // 空闲：1 + 4 + 0.02 = 5.02 元
  assert.equal(ledger.todaySnapshot().cost, 5.02);
});

test('跨本地自然日重置今日累计', () => {
  const ledger = new UsageLedger({ table: FLASH });
  const dayA = new Date(2026, 9, 5, 10, 0, 0).getTime();
  const dayB = new Date(2026, 9, 6, 10, 0, 0).getTime();
  ledger.ingest('s1', message(1, dayA, 1, 1, { inputTokens: 1000000 }));
  assert.equal(ledger.todaySnapshot().day, '2026-10-05');
  assert.ok(ledger.todaySnapshot().tokens > 0);
  ledger.ingest('s1', message(2, dayB, 1, 2, { inputTokens: 500000 }));
  assert.equal(ledger.todaySnapshot().day, '2026-10-06');
  assert.equal(ledger.todaySnapshot().buckets.uncachedInputTokens, 500000);
});

test('assistant/attempt 从流里取用量；未知模型回退', () => {
  const attempt = {
    type: 'assistant/attempt', seq: 1, time: IDLE,
    data: { turn: 1, step: 1, stream: [{ type: 'delta', text: 'x' }, { type: 'usage', usage: { inputTokens: 1000000, outputTokens: 0 } }] },
  };
  assert.deepEqual(usageOfEvent(attempt), { inputTokens: 1000000, outputTokens: 0 });
  const ledger = new UsageLedger({ table: FLASH });
  ledger.ingest('s1', attempt);
  assert.equal(ledger.todaySnapshot().cost, 1);
  assert.equal(ledger.sessionSnapshot('s1').model, 'deepseek-flash');
});

test('容量保护：未知模型与未知事件类型不抛错', () => {
  const ledger = new UsageLedger({ table: {} });
  assert.equal(ledger.ingest('s1', { type: 'tool/call', seq: 1, time: PEAK, data: {} }), false);
  assert.equal(ledger.ingest('s1', null), false);
  assert.equal(ledger.ingest('', { type: 'turn/start' }), false);
  assert.equal(ledger.ingest('s1', { type: 'assistant/message', seq: 2, time: PEAK, data: { turn: 1, step: 1, usage: { outputTokens: 10 } } }) !== undefined, true);
  assert.equal(modelOfEvent({ data: {} }), undefined);
});

test('时段快照给出空闲标记', () => {
  const ledger = new UsageLedger({ table: FLASH });
  assert.equal(ledger.period(PEAK).idle, false);
  assert.equal(ledger.period(IDLE).idle, true);
  assert.equal(ledger.period(PEAK).label, '高峰时段');
});
