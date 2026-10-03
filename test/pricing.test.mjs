import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIdleAt, localDayKey, beijingDayKey, beijingClock, priceMicro, microToYuan,
  costMicroOf, sampleCost, normalizeBuckets, addBuckets, subtractBuckets,
  parseHolidays, buildPricingTable, DEFAULT_PRICING, totalTokens,
} from '../lib/pricing.js';

// 北京时间固定 UTC+8；测试用带 Z 的 ISO 串构造时刻，避免受运行机器时区影响。
const at = (iso) => Date.parse(iso);
const pad2 = (n) => String(n).padStart(2, '0');

test('高峰时段：北京时间周二 10:00 为高峰', () => {
  assert.equal(isIdleAt(at('2026-10-06T02:00:00Z')), false);
});
test('高峰时段：北京时间周二 13:00 为空闲（午休）', () => {
  assert.equal(isIdleAt(at('2026-10-06T05:00:00Z')), true);
});
test('高峰时段：北京时间周二 15:00 为高峰', () => {
  assert.equal(isIdleAt(at('2026-10-06T07:00:00Z')), false);
});
test('高峰时段：北京时间周二 18:00 整为空闲（区间右开）', () => {
  assert.equal(isIdleAt(at('2026-10-06T10:00:00Z')), true);
});
test('高峰时段：周六全天空闲', () => {
  assert.equal(isIdleAt(at('2026-10-10T02:00:00Z')), true);
});
test('节假日覆盖高峰判定', () => {
  const holidays = parseHolidays('2026-10-06, 2026-10-07');
  assert.equal(isIdleAt(at('2026-10-06T02:00:00Z'), holidays), true);
  assert.equal(isIdleAt(at('2026-10-07T02:00:00Z'), holidays), true);
  assert.equal(isIdleAt(at('2026-10-08T02:00:00Z'), holidays), false);
});
test('北京时间日期与时钟不受本机时区影响', () => {
  assert.equal(beijingDayKey(at('2026-10-05T20:00:00Z')), '2026-10-06');
  assert.equal(beijingClock(at('2026-10-06T02:34:00Z')), '10:34');
});
test('本地日期键使用本机时区', () => {
  const ms = at('2026-10-06T02:00:00Z');
  const d = new Date(ms);
  const expected = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  assert.equal(localDayKey(ms), expected);
});

test('计价：0.02 元/百万 × 3,000,000 tokens = 0.06 元', () => {
  assert.equal(priceMicro(3000000, 0.02), 60000);
  assert.equal(microToYuan(60000), 0.06);
});
test('计价：4.5 元/百万 × 1,000,001 tokens', () => {
  assert.equal(priceMicro(1000001, 4.5), 4500005);
  assert.equal(microToYuan(4500005), 4.500005);
});
test('计价：非法价格与负 token 归零', () => {
  assert.equal(priceMicro(1000, -1), 0);
  assert.equal(priceMicro(1000, 'x'), 0);
  assert.equal(priceMicro(-5, 1), 0);
});

test('四桶合成计价（空闲与高峰）', () => {
  const buckets = { uncachedInputTokens: 1000000, cacheReadTokens: 2000000, cacheWriteTokens: 0, outputTokens: 1000000 };
  // 空闲：未命中 1 元 + 命中 0.02×2=0.04 元 + 输出 4 元 = 5.04 元
  assert.equal(costMicroOf(buckets, DEFAULT_PRICING['deepseek-flash'], true), 5040000);
  // 高峰：2 元 + 0.08 元 + 8 元 = 10.08 元
  assert.equal(costMicroOf(buckets, DEFAULT_PRICING['deepseek-flash'], false), 10080000);
});

test('未知模型回退到 flash 价', () => {
  const table = { 'deepseek-flash': DEFAULT_PRICING['deepseek-flash'] };
  const sample = sampleCost({ outputTokens: 1000000 }, 'no-such-model', at('2026-10-06T02:00:00Z'), table);
  assert.equal(sample.pricingModel, 'deepseek-flash');
  assert.equal(sample.micro, 8000000); // 高峰输出 8 元
});

test('桶运算与规整', () => {
  assert.deepEqual(normalizeBuckets({ inputTokens: 10, cacheReadTokens: -3, outputTokens: 'x' }), {
    uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
  });
  const a = { uncachedInputTokens: 1, outputTokens: 2 };
  const b = { uncachedInputTokens: 3, outputTokens: 4 };
  assert.equal(totalTokens(addBuckets(a, b)), 10);
  assert.deepEqual(subtractBuckets(a, b), { uncachedInputTokens: -2, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: -2 });
});

test('设置项覆盖内置价目表', () => {
  const table = buildPricingTable({ flashOutputPeak: 9.9, proCacheHitIdle: 0.01 }, { flash: 'deepseek-flash', pro: 'deepseek-v4-pro' });
  assert.equal(table['deepseek-flash'].outputPeak, 9.9);
  assert.equal(table['deepseek-v4-pro'].cacheHitIdle, 0.01);
  assert.equal(table['deepseek-flash'].outputIdle, 4);
});
