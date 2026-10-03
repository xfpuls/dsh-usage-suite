/**
 * 用量折叠与账本。
 *
 * 把会话事件流折叠成两个口径的数字：
 * 1. 今日累计（跨所有会话，按本地自然日，逐样本按时段计价）；
 * 2. 每个会话「当前一轮」的累计（turn/start 时清零）。
 *
 * 折叠规则与 DSH 自带的 tokenUsage 投影保持一致：同一 (turn, step) 的用量样本
 * 以最后一次上报为准（先前样本先撤销再累加），llm/retry-started 会撤销该步已记的
 * 样本，避免重试被重复计费。这样界面上显示的费用与官方统计条的口径一致。
 *
 * @module dsh-usage-meter/usage-fold
 */

import {
  addBuckets, emptyBuckets, localDayKey, microToYuan, normalizeBuckets,
  periodAt, sampleCost, subtractBuckets, totalTokens,
} from './pricing.js';

/**
 * 判断一个用量数字是否是可靠的计数。
 * @param value - 待检查的值。
 * @returns 非负安全整数返回 true。
 */
function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * 从流式事件的 chunk 列表里取最后一个用量样本。
 *
 * assistant/attempt 事件的用量藏在序列化的流里，形状可能是数组或带 chunks 的对象；
 * 形状不认识时返回 undefined，由调用方跳过该事件。
 *
 * @param stream - 事件里的 stream 字段。
 * @returns 用量对象或 undefined。
 */
function usageFromStream(stream) {
  if (!stream || typeof stream !== 'object') return undefined;
  const chunks = Array.isArray(stream) ? stream : Array.isArray(stream.chunks) ? stream.chunks : undefined;
  if (chunks === undefined) return undefined;
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (chunk && chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') return chunk.usage;
  }
  return undefined;
}

/**
 * 取一条事件携带的用量样本。
 * @param event - 会话事件。
 * @returns 用量对象或 undefined。
 */
export function usageOfEvent(event) {
  const data = event?.data;
  if (!data || typeof data !== 'object') return undefined;
  if (data.usage && typeof data.usage === 'object') return data.usage;
  return usageFromStream(data.stream);
}

/**
 * 取一条事件声明的模型名。
 * @param event - 会话事件。
 * @returns 模型名，缺失时返回 undefined。
 */
export function modelOfEvent(event) {
  const source = event?.data?.message?.source;
  if (source && typeof source.model === 'string' && source.model.length > 0) return source.model;
  const direct = event?.data?.model;
  return typeof direct === 'string' && direct.length > 0 ? direct : undefined;
}

/** 新建一个会话折叠状态。 */
function newSessionState() {
  return { turn: 0, buckets: emptyBuckets(), costMicro: 0, last: null };
}

/**
 * 用量账本：可接收回填事件与实时事件，并给出两个口径的快照。
 */
export class UsageLedger {
  /**
   * @param options - table（价目表）、holidays（节假日集合）、day（初始日期键）、now（初始时刻）。
   */
  constructor(options = {}) {
    this.table = options.table ?? {};
    this.holidays = options.holidays ?? new Set();
    this.day = options.day ?? localDayKey(options.now ?? Date.now());
    this.today = { buckets: emptyBuckets(), costMicro: 0, samples: 0, sessions: new Set() };
    this.sessions = new Map();
    this.processed = new Map();
    this.backfilled = false;
    this.lastEventAt = 0;
  }

  /** 切换自然日：日期变化时清空今日累计，返回是否发生了切换。 */
  rollDay(dayKey) {
    if (dayKey === this.day) return false;
    this.day = dayKey;
    this.today = { buckets: emptyBuckets(), costMicro: 0, samples: 0, sessions: new Set() };
    return true;
  }

  /** 取或新建某会话的折叠状态。 */
  sessionState(sessionId) {
    let state = this.sessions.get(sessionId);
    if (state === undefined) {
      state = newSessionState();
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  /** 把一个样本加进今日与本轮。 */
  _apply(sessionId, sample) {
    const state = this.sessionState(sessionId);
    state.buckets = addBuckets(state.buckets, sample.buckets);
    state.costMicro += sample.micro;
    if (sample.day === this.day) {
      this.today.buckets = addBuckets(this.today.buckets, sample.buckets);
      this.today.costMicro += sample.micro;
      this.today.samples += 1;
      this.today.sessions.add(sessionId);
    }
  }

  /** 撤销一个先前记录的样本（替换或重试时使用）。 */
  _unapply(sessionId, sample) {
    const state = this.sessionState(sessionId);
    state.buckets = subtractBuckets(state.buckets, sample.buckets);
    state.costMicro -= sample.micro;
    if (sample.day === this.day) {
      this.today.buckets = subtractBuckets(this.today.buckets, sample.buckets);
      this.today.costMicro -= sample.micro;
      this.today.samples = Math.max(0, this.today.samples - 1);
    }
  }

  /**
   * 处理一条会话事件。
   *
   * @param sessionId - 会话 id。
   * @param event - 会话事件（须带 type、time，用量事件带 data.usage）。
   * @returns 账本是否因此变化。
   */
  ingest(sessionId, event) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return false;

    const seq = Number(event.seq);
    if (Number.isFinite(seq)) {
      const seen = this.processed.get(sessionId);
      if (seen !== undefined && seq <= seen) return false;
      this.processed.set(sessionId, seq);
    }

    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const at = Number.isFinite(Number(event.time)) ? Number(event.time) : Date.now();
    if (at > this.lastEventAt) this.lastEventAt = at;
    this.rollDay(localDayKey(at));

    const state = this.sessionState(sessionId);
    const turn = Number.isFinite(Number(data.turn)) ? Number(data.turn) : state.turn;
    const step = Number.isFinite(Number(data.step)) ? Number(data.step) : -1;

    if (event.type === 'turn/start') {
      state.turn = turn;
      state.buckets = emptyBuckets();
      state.costMicro = 0;
      state.last = null;
      return true;
    }

    if (event.type === 'llm/retry-started') {
      const last = state.last;
      if (last && last.turn === turn && last.step === step) {
        this._unapply(sessionId, last);
        state.last = null;
        return true;
      }
      return false;
    }

    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return false;

    const usage = usageOfEvent(event);
    if (usage === undefined) return false;
    const buckets = normalizeBuckets(usage);
    if (totalTokens(buckets) === 0) return false;

    const priced = sampleCost(buckets, modelOfEvent(event), at, this.table, this.holidays);
    const last = state.last;
    if (last && last.turn === turn && last.step === step) this._unapply(sessionId, last);

    const sample = {
      turn,
      step,
      buckets,
      micro: priced.micro,
      day: localDayKey(at),
      idle: priced.idle,
      model: priced.pricingModel,
    };
    this._apply(sessionId, sample);
    state.last = sample;
    return true;
  }

  /** 记录某会话已处理到的事件序号，供回填与实时衔接时去重。 */
  markProcessed(sessionId, seq) {
    if (!Number.isFinite(Number(seq))) return;
    const seen = this.processed.get(sessionId);
    if (seen === undefined || Number(seq) > seen) this.processed.set(sessionId, Number(seq));
  }

  /** 今日快照。 */
  todaySnapshot() {
    const buckets = { ...this.today.buckets };
    return {
      day: this.day,
      buckets,
      tokens: totalTokens(buckets),
      costMicro: this.today.costMicro,
      cost: microToYuan(this.today.costMicro),
      samples: this.today.samples,
      sessions: this.today.sessions.size,
    };
  }

  /** 某会话当前轮的快照；会话未知时返回 null。 */
  sessionSnapshot(sessionId) {
    const state = this.sessions.get(sessionId);
    if (state === undefined) return null;
    const buckets = { ...state.buckets };
    return {
      id: sessionId,
      turn: state.turn,
      buckets,
      tokens: totalTokens(buckets),
      costMicro: state.costMicro,
      cost: microToYuan(state.costMicro),
      model: state.last?.model ?? null,
    };
  }

  /** 当前时刻的计费时段。 */
  period(now = Date.now()) {
    return periodAt(now, this.holidays);
  }
}
