import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { splitZstdFrames, readSessionLog, listSessionLogs, backfillToday, isSubagentSession } from '../lib/log-scan.js';
import { UsageLedger } from '../lib/usage-fold.js';
import { DEFAULT_PRICING } from '../lib/pricing.js';

const FLASH = { 'deepseek-flash': DEFAULT_PRICING['deepseek-flash'] };

/** 把若干 JSON 记录写成多帧 zstd 文件，模拟 DSH 的追加写格式。 */
function writeLog(file, records) {
  const parts = records.map((record) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(record) + '\n', 'utf8')));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat(parts));
}

test('多帧 zstd 文件按帧切分并逐帧解压', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-meter-'));
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  writeLog(file, [
    { type: 'session', id: 's-1', delegationDepth: 0, createdAt: 1 },
    { type: 'assistant/message', seq: 2, time: 1000, data: { turn: 1, step: 1, usage: { outputTokens: 5 } } },
    { type: 'turn/end', seq: 3, time: 2000, data: { turn: 1 } },
  ]);
  const raw = fs.readFileSync(file);
  assert.equal(splitZstdFrames(raw).length, 3);
  const parsed = readSessionLog(file);
  assert.equal(parsed.header.id, 's-1');
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.failedFrames, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('子代理会话按 delegationDepth 识别', () => {
  assert.equal(isSubagentSession({ delegationDepth: 0 }), false);
  assert.equal(isSubagentSession({ delegationDepth: 2 }), true);
  assert.equal(isSubagentSession(null), false);
});

test('回填只统计今天的事件，并跳过子代理会话', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-meter-'));
  const root = path.join(dir, 'sessions');
  const today = new Date();
  const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0).getTime();
  const yesterdayNoon = todayNoon - 24 * 60 * 60 * 1000;

  writeLog(path.join(root, '--w--', 'session-a', 'session.v4.jsonl.zstd'), [
    { type: 'session', id: 'session-a', delegationDepth: 0 },
    { type: 'assistant/message', seq: 1, time: yesterdayNoon, data: { turn: 1, step: 1, usage: { inputTokens: 1000000 }, message: { source: { model: 'deepseek-flash' } } } },
    { type: 'assistant/message', seq: 2, time: todayNoon, data: { turn: 2, step: 1, usage: { inputTokens: 1000000 }, message: { source: { model: 'deepseek-flash' } } } },
  ]);
  writeLog(path.join(root, '--w--', 'session-b', 'session.v4.jsonl.zstd'), [
    { type: 'session', id: 'session-b', delegationDepth: 1 },
    { type: 'assistant/message', seq: 1, time: todayNoon, data: { turn: 1, step: 1, usage: { inputTokens: 5000000 }, message: { source: { model: 'deepseek-flash' } } } },
  ]);

  const ledger = new UsageLedger({ table: FLASH });
  const stats = backfillToday(ledger, { sessionsRoot: root, now: todayNoon });
  assert.equal(stats.scanned, 2);      // 两个文件都解析了
  assert.equal(stats.skipped, 1);      // 子代理会话被排除
  assert.equal(stats.sessions, 1);     // 只采纳了一个会话
  assert.equal(ledger.todaySnapshot().buckets.uncachedInputTokens, 1000000);

  // 打开 includeSubagents 后子代理会话被计入
  const ledger2 = new UsageLedger({ table: FLASH });
  backfillToday(ledger2, { sessionsRoot: root, now: todayNoon, includeSubagents: true });
  assert.equal(ledger2.todaySnapshot().buckets.uncachedInputTokens, 6000000);

  assert.equal(listSessionLogs(root).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('回填后实时事件按序号去重；新步骤正常累加', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-meter-'));
  const root = path.join(dir, 'sessions');
  const now = Date.now();
  const usageEvent = { type: 'assistant/message', seq: 10, time: now, data: { turn: 1, step: 1, usage: { inputTokens: 1000000 }, message: { source: { model: 'deepseek-flash' } } } };
  writeLog(path.join(root, '--w--', 'session-c', 'session.v4.jsonl.zstd'), [
    { type: 'session', id: 'session-c', delegationDepth: 0 },
    usageEvent,
  ]);
  const ledger = new UsageLedger({ table: FLASH });
  backfillToday(ledger, { sessionsRoot: root, now });
  const afterBackfill = ledger.todaySnapshot().buckets.uncachedInputTokens;
  assert.equal(afterBackfill, 1000000);
  ledger.ingest('session-c', usageEvent); // 同一事件重复到达：按 seq 去重
  assert.equal(ledger.todaySnapshot().buckets.uncachedInputTokens, afterBackfill);
  // 同一步的新样本仍然走「替换」语义，不重复计费
  ledger.ingest('session-c', { ...usageEvent, seq: 11, time: now + 1000 });
  assert.equal(ledger.todaySnapshot().buckets.uncachedInputTokens, afterBackfill);
  // 新步骤正常累加
  ledger.ingest('session-c', { ...usageEvent, seq: 12, time: now + 2000, data: { ...usageEvent.data, step: 2 } });
  assert.equal(ledger.todaySnapshot().buckets.uncachedInputTokens, afterBackfill + 1000000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('损坏或缺失的目录不会抛错', () => {
  const ledger = new UsageLedger({ table: FLASH });
  const stats = backfillToday(ledger, { sessionsRoot: 'Z:\\definitely-missing-path-xyz', now: Date.now() });
  assert.equal(stats.files, 0);
  assert.deepEqual(listSessionLogs('Z:\\definitely-missing-path-xyz'), []);
});
