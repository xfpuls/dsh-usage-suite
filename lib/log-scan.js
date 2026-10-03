/**
 * 会话日志读取与「今日回填」。
 *
 * DSH 的会话日志是**追加写的 zstd 多帧文件**（每条记录一帧，文件名形如
 * session.v4.jsonl.zstd）。Node 内置的 zstdDecompressSync 只解第一帧，因此这里
 * 按帧魔数切分后逐帧解压，再把文本拼起来按行解析 JSON。
 *
 * 回填只处理「今天被写过」的日志文件：mtime 早于今天 0 点的会话不可能包含今天的
 * 用量，直接跳过，避免每次启动都全量解压历史。
 *
 * @module dsh-usage-meter/log-scan
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { localDayStart } from './pricing.js';

/** zstd 帧魔数。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 单个日志文件的大小上限（64 MiB），超过则跳过以免启动卡顿。 */
const MAX_LOG_BYTES = 64 * 1024 * 1024;

/** 单个日志文件解析出的事件数上限。 */
const MAX_EVENTS_PER_LOG = 500000;

/**
 * 按帧魔数切分 zstd 缓冲区。
 *
 * 魔数在压缩数据里偶发出现时，该帧会解压失败；调用方按帧容错，只丢那一小段。
 *
 * @param buffer - 整个文件内容。
 * @returns 帧切片数组。
 */
export function splitZstdFrames(buffer) {
  const offsets = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const at = buffer.indexOf(ZSTD_MAGIC, cursor);
    if (at < 0) break;
    offsets.push(at);
    cursor = at + 4;
  }
  const frames = [];
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index];
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length;
    frames.push(buffer.subarray(start, end));
  }
  return frames;
}

/**
 * 解压一个 zstd 多帧文件为文本。
 * @param filePath - 日志文件路径。
 * @returns { text, frames, failedFrames }。
 */
export function decompressLogFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const frames = splitZstdFrames(buffer);
  const parts = [];
  let failedFrames = 0;
  for (const frame of frames) {
    try {
      parts.push(zlib.zstdDecompressSync(frame).toString('utf8'));
    } catch {
      failedFrames += 1;
    }
  }
  return { text: parts.join(''), frames: frames.length, failedFrames };
}

/**
 * 读取一个会话日志。
 *
 * @param filePath - 日志文件路径。
 * @returns { header, events, frames, failedFrames, truncated }；header 为会话头记录（可能为 null）。
 */
export function readSessionLog(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_LOG_BYTES) {
    return { header: null, events: [], frames: 0, failedFrames: 0, truncated: true };
  }
  const { text, frames, failedFrames } = decompressLogFile(filePath);
  let header = null;
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!record || typeof record !== 'object') continue;
    if (record.type === 'session' && header === null) {
      header = record;
      continue;
    }
    if (typeof record.type !== 'string') continue;
    events.push(record);
    if (events.length >= MAX_EVENTS_PER_LOG) break;
  }
  return { header, events, frames, failedFrames, truncated: false };
}

/**
 * 列出 sessions 根目录下的全部会话日志文件。
 * @param sessionsRoot - $DSH_HOME/sessions。
 * @returns 日志文件绝对路径数组。
 */
export function listSessionLogs(sessionsRoot) {
  const results = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/^session.*\.jsonl\.zstd$/i.test(entry.name)) results.push(full);
    }
  };
  walk(sessionsRoot, 0);
  return results;
}

/**
 * 判断一个会话头是否属于子代理（子会话）。
 * @param header - 会话头记录。
 * @returns 是子代理会话返回 true。
 */
export function isSubagentSession(header) {
  if (!header || typeof header !== 'object') return false;
  const depth = Number(header.delegationDepth);
  return Number.isFinite(depth) && depth > 0;
}

/**
 * 回填「今天」的用量到账本。
 *
 * 只喂今天的事件，因此昨天的样本不会被计入今日；同一 (turn, step) 的替换规则
 * 仍然生效，因为每条用量事件自带 turn/step。
 *
 * @param ledger - UsageLedger 实例。
 * @param options - { sessionsRoot, now, includeSubagents, logger }。
 * @returns 统计信息 { files, scanned, skipped, parsedEvents, failedFrames }。
 */
export function backfillToday(ledger, options = {}) {
  const {
    sessionsRoot,
    now = Date.now(),
    includeSubagents = false,
    logger = null,
  } = options;
  const stats = { files: 0, scanned: 0, skipped: 0, parsedEvents: 0, failedFrames: 0, sessions: 0 };
  if (typeof sessionsRoot !== 'string' || sessionsRoot.length === 0) return stats;
  const dayStart = localDayStart(now);
  for (const file of listSessionLogs(sessionsRoot)) {
    stats.files += 1;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      stats.skipped += 1;
      continue;
    }
    // 今天没有被写过的会话，不可能包含今天的用量。
    if (stat.mtimeMs < dayStart) {
      stats.skipped += 1;
      continue;
    }
    let parsed;
    try {
      parsed = readSessionLog(file);
    } catch (error) {
      stats.skipped += 1;
      if (logger) logger.warn('[dsh-usage-meter] 读取会话日志失败:', file, error?.message ?? error);
      continue;
    }
    stats.scanned += 1;
    stats.failedFrames += parsed.failedFrames;
    if (!includeSubagents && isSubagentSession(parsed.header)) {
      stats.skipped += 1;
      continue;
    }
    const sessionId = typeof parsed.header?.id === 'string' && parsed.header.id.length > 0
      ? parsed.header.id
      : path.basename(path.dirname(file));
    let maxSeq = Number.NEGATIVE_INFINITY;
    for (const event of parsed.events) {
      const at = Number(event.time);
      if (Number.isFinite(at) && at < dayStart) continue;
      ledger.ingest(sessionId, event);
      stats.parsedEvents += 1;
      if (Number.isFinite(Number(event.seq)) && Number(event.seq) > maxSeq) maxSeq = Number(event.seq);
    }
    if (Number.isFinite(maxSeq)) ledger.markProcessed(sessionId, maxSeq);
    stats.sessions += 1;
  }
  ledger.backfilled = true;
  return stats;
}
