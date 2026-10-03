import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HOLIDAYS_API, YEAR_CACHE_TTL_MS,
  parseHolidayResponse, parseHolidayCache, emptyCache, isYearFresh,
  cacheDates, mergeHolidaySets, holidayUrl, yearOf,
} from '../lib/holidays.js';

/** 取自数据源的真实响应片段（含补班日与缺 date 的条目）。 */
const SAMPLE = {
  code: 0,
  holiday: {
    '01-01': { holiday: true, name: '元旦', wage: 3, date: '2026-01-01', rest: 78 },
    '01-02': { holiday: true, name: '元旦', wage: 2, date: '2026-01-02', rest: 1 },
    '01-04': { holiday: false, name: '元旦后补班', wage: 1, after: true, target: '元旦', date: '2026-01-04', rest: 1 },
    '02-14': { holiday: false, name: '春节前补班', wage: 1, after: false, target: '春节', date: '2026-02-14', rest: 21 },
    '02-15': { holiday: true, name: '春节', wage: 2, date: '2026-02-15', rest: 22 },
    '05-01': { holiday: true, name: '劳动节', wage: 3 },
  },
};
const EXPECTED = ['2026-01-01', '2026-01-02', '2026-02-15', '2026-05-01'];

test('解析真实响应：只取放假，过滤补班日', () => {
  assert.deepEqual(parseHolidayResponse(SAMPLE, 2026), EXPECTED);
});

test('缺少 date 的条目用年份加键回填', () => {
  assert.deepEqual(parseHolidayResponse({ code: 0, holiday: { '05-01': { holiday: true } } }, 2026), ['2026-05-01']);
});

test('接受响应文本、拒绝异常结构', () => {
  assert.deepEqual(parseHolidayResponse(JSON.stringify(SAMPLE), 2026), EXPECTED);
  assert.equal(parseHolidayResponse('这不是 JSON', 2026), null);
  assert.equal(parseHolidayResponse({ code: 1, holiday: {} }, 2026), null);
  assert.equal(parseHolidayResponse({ code: 0 }, 2026), null);
  assert.equal(parseHolidayResponse(null, 2026), null);
  assert.equal(parseHolidayResponse({ code: 0, holiday: [] }, 2026), null);
});

test('没有任何放假条目时返回空数组而不是 null', () => {
  assert.deepEqual(parseHolidayResponse({ code: 0, holiday: { '01-04': { holiday: false, date: '2026-01-04' } } }, 2026), []);
});

test('缓存解析：正常、损坏、空、字段缺失', () => {
  const good = JSON.stringify({ version: 1, years: { 2026: { dates: ['2026-01-01', '2026-01-01', 'bad'], fetchedAt: 111 } } });
  const parsed = parseHolidayCache(good);
  assert.deepEqual(parsed.years['2026'].dates, ['2026-01-01']);
  assert.equal(parsed.years['2026'].fetchedAt, 111);
  assert.deepEqual(parseHolidayCache('{坏的').years, {});
  assert.deepEqual(parseHolidayCache('').years, {});
  assert.deepEqual(parseHolidayCache(undefined).years, {});
  assert.deepEqual(parseHolidayCache(JSON.stringify({ years: { 2026: { dates: [] } } })).years, {});
});

test('判断某年缓存是否新鲜', () => {
  const now = 1_000_000_000;
  const cache = { version: 1, years: { 2026: { dates: ['2026-01-01'], fetchedAt: now - 1000 } } };
  assert.equal(isYearFresh(cache, 2026, now), true);
  assert.equal(isYearFresh(cache, 2026, now + YEAR_CACHE_TTL_MS), false);
  assert.equal(isYearFresh(cache, 2027, now), false);
  assert.equal(isYearFresh({ years: { 2026: { dates: [], fetchedAt: now } } }, 2026, now), false);
  assert.equal(isYearFresh(null, 2026, now), false);
});

test('摊平缓存日期并合并多来源', () => {
  const cache = { years: { 2025: { dates: ['2025-10-01'] }, 2026: { dates: ['2026-01-01'] } } };
  assert.deepEqual([...cacheDates(cache)].sort(), ['2025-10-01', '2026-01-01']);
  const merged = mergeHolidaySets(cacheDates(cache), ['2026-01-01', '2026-05-01'], '2026-10-01, 2026-10-02', null, '垃圾');
  assert.deepEqual([...merged].sort(), ['2025-10-01', '2026-01-01', '2026-05-01', '2026-10-01', '2026-10-02']);
});

test('请求地址模板替换与默认值', () => {
  assert.equal(holidayUrl(DEFAULT_HOLIDAYS_API, 2026), 'https://timor.tech/api/holiday/year/2026');
  assert.equal(holidayUrl('https://example.com/{year}/x', 2027), 'https://example.com/2027/x');
  assert.equal(holidayUrl('', 2026), 'https://timor.tech/api/holiday/year/2026');
  assert.equal(holidayUrl('https://example.com/fixed', 2026), 'https://example.com/fixed');
});

test('年份按本机时区取', () => {
  assert.equal(yearOf(new Date(2026, 0, 1, 12, 0, 0).getTime()), 2026);
  assert.deepEqual(emptyCache(), { version: 1, years: {} });
});
