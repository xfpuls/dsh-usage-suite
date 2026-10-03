import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let definition = null;
globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value; } } };

await import('../lib/client.js');

const React = require('react');

function renderDeep(component, props) {
  let node = component(props);
  let guard = 0;
  while (node && typeof node === 'object' && typeof node.type === 'function' && guard < 6) {
    node = node.type(node.props);
    guard += 1;
  }
  return node;
}

function render(component, props, data) {
  const originals = { useState: React.useState, useEffect: React.useEffect, useRef: React.useRef };
  React.useState = (initial) => {
    const value = data === undefined || data === null
      ? (typeof initial === 'function' ? initial() : initial)
      : { data, error: false };
    return [value, () => {}];
  };
  React.useEffect = () => {};
  React.useRef = (value) => ({ current: value });
  try {
    return renderDeep(component, props);
  } finally {
    React.useState = originals.useState;
    React.useEffect = originals.useEffect;
    React.useRef = originals.useRef;
  }
}

function collectText(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) collectText(child, out); return out; }
  if (typeof node === 'object' && node.props) collectText(node.props.children, out);
  return out;
}

function fakeUseChat(items) {
  return (selector) => selector({ navigation: { items: () => items } });
}

const ITEMS = [
  { turn: 1, anchorKey: 'a', prompt: '第一个问题', response: '' },
  { turn: 3, anchorKey: 'c', prompt: '第三个问题：\n把用量插件做出来', response: '' },
];

const USAGE = {
  ok: true, version: 1, enabled: true, ready: true, day: '2026-10-03',
  today: { day: '2026-10-03', tokens: 6597882, cost: 0.574946, samples: 64, sessions: 1, buckets: {} },
  period: { idle: true, label: '空闲时段', clock: '09:30' },
  session: {
    id: 'session-a', turn: 13, tokens: 6597882, cost: 0.4384, model: 'deepseek-flash',
    buckets: { uncachedInputTokens: 103259, cacheReadTokens: 5869056, cacheWriteTokens: 0, outputTokens: 80088 },
  },
  settings: { pollSeconds: 1, currency: 'CNY' },
};

/** 注册三个槽位并回传组件表。 */
function registry() {
  const plugin = definition.factory(require);
  const byId = new Map();
  plugin.apply({
    effect: (fn) => { fn(); return () => {}; },
    slots: {
      inject: (_name, factory) => { factory(); return () => {}; },
      register: (entry, component) => { byId.set(entry.id, { entry, component }); return () => {}; },
    },
  });
  return byId;
}

test('模块以 dsh-usage-suite 注册并导出 inject/apply', () => {
  assert.ok(definition);
  assert.equal(definition.id, 'dsh-usage-suite');
  const plugin = definition.factory(require);
  assert.deepEqual(plugin.inject, ['slots']);
  assert.equal(typeof plugin.apply, 'function');
});

test('一次注册三个挂载点', () => {
  const byId = registry();
  assert.equal(byId.size, 3);
  assert.equal(byId.get('usage-meter-turn').entry.name, 'conversation.composer.dock');
  assert.equal(byId.get('usage-meter-today').entry.name, 'sidebar.footer.action');
  assert.equal(byId.get('question-pin').entry.name, 'conversation.session.header.utilities');
});

test('本轮花费按四位小数显示并带明细提示', () => {
  const turn = registry().get('usage-meter-turn').component;
  const tree = render(turn, {}, USAGE);
  const text = collectText(tree).join('');
  assert.ok(text.includes('本轮'));
  assert.ok(text.includes('¥0.4384'), '实际: ' + text);
  assert.ok(tree.props.title.includes('缓存命中 5,869,056 tok'));
});

test('今日卡片显示 token、消费与计费时段', () => {
  const today = registry().get('usage-meter-today').component;
  const tree = render(today, { wide: true }, USAGE);
  const text = collectText(tree).join('');
  assert.ok(text.includes('6.60M tok'), '实际: ' + text);
  assert.ok(text.includes('¥0.5749'));
  assert.ok(text.includes('空闲时段'));
  assert.ok(text.includes('北京 09:30'));
});

test('用量接口不可用时两个组件都不渲染', () => {
  const byId = registry();
  const disabled = { ...USAGE, enabled: false };
  assert.equal(render(byId.get('usage-meter-turn').component, {}, null), null);
  assert.equal(render(byId.get('usage-meter-today').component, {}, null), null);
  assert.equal(render(byId.get('usage-meter-turn').component, {}, disabled), null);
});

test('侧栏折叠时省略文字标签', () => {
  const today = registry().get('usage-meter-today').component;
  const text = collectText(render(today, { wide: false }, USAGE)).join('');
  assert.ok(!text.includes('今日用量'));
  assert.ok(text.includes('6.60M tok'));
});

test('没有会话上下文时置顶气泡不渲染', () => {
  assert.equal(registry().get('question-pin').component({}), null);
});

test('置顶气泡显示图钉、最新提问与轮次', () => {
  const pin = registry().get('question-pin').component;
  const tree = render(pin, { useChat: fakeUseChat(ITEMS) });
  const text = collectText(tree).join('');
  assert.ok(text.includes('📌'));
  assert.ok(text.includes('第 3 轮'));
  assert.ok(text.includes('第三个问题'));
  assert.ok(text.includes('点击回到这里'));
  assert.ok(!text.includes('第一个问题'));
  assert.equal(tree.type, 'button');
});

test('提问为空时置顶气泡静默退出', () => {
  const pin = registry().get('question-pin').component;
  assert.equal(render(pin, { useChat: fakeUseChat([]) }), null);
  assert.equal(render(pin, { useChat: fakeUseChat([{ turn: 1, prompt: '  ' }]) }), null);
  assert.equal(render(pin, { useChat: (selector) => selector({}) }), null);
});

test('点击置顶优先使用 DSH 自带的轮次导航按钮', () => {
  const pin = registry().get('question-pin').component;
  const tree = render(pin, { useChat: fakeUseChat(ITEMS) });
  let clicked = 0;
  globalThis.document = {
    querySelectorAll: () => [{ getAttribute: () => '加载并跳转到第 3 轮', click: () => { clicked += 1; } }],
    querySelector: () => null,
    body: {},
  };
  try { tree.props.onClick(); } finally { delete globalThis.document; }
  assert.equal(clicked, 1);
});

test('轮次编号严格匹配，第 3 轮不会被第 13 轮误命中', () => {
  const pin = registry().get('question-pin').component;
  const tree = render(pin, { useChat: fakeUseChat(ITEMS) });
  let clicked = 0;
  globalThis.document = {
    querySelectorAll: () => [{ getAttribute: () => '跳转到第 13 轮', click: () => { clicked += 1; } }],
    querySelector: () => null,
    body: {},
  };
  try { tree.props.onClick(); } finally { delete globalThis.document; }
  assert.equal(clicked, 0);
});

test('没有导航按钮但该轮已渲染时滚动到该轮', () => {
  const pin = registry().get('question-pin').component;
  const tree = render(pin, { useChat: fakeUseChat(ITEMS) });
  const scrolled = [];
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector(selector) {
      if (selector === '[data-turn-process="3"]') return { scrollIntoView: (options) => scrolled.push(options) };
      return null;
    },
    body: {},
  };
  try { tree.props.onClick(); } finally { delete globalThis.document; }
  assert.equal(scrolled.length, 1);
  assert.equal(scrolled[0].block, 'center');
});

test('最新一轮没有标记时滚到对话底部', () => {
  const pin = registry().get('question-pin').component;
  const tree = render(pin, { useChat: fakeUseChat(ITEMS) });
  const calls = [];
  const scroller = { scrollHeight: 2000, clientHeight: 800, scrollTo: (options) => calls.push(options) };
  const flow = { parentElement: scroller };
  globalThis.getComputedStyle = () => ({ overflowY: 'auto' });
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector(selector) {
      if (selector === '[data-chat-flow]') return flow;
      return null;
    },
    body: {},
  };
  try { tree.props.onClick(); } finally { delete globalThis.document; delete globalThis.getComputedStyle; }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].top, 2000);
});

test('完全定位不到时不抛错', () => {
  const pin = registry().get('question-pin').component;
  const tree = render(pin, { useChat: fakeUseChat(ITEMS) });
  globalThis.document = { querySelectorAll: () => [], querySelector: () => null, body: {} };
  try {
    assert.doesNotThrow(() => tree.props.onClick());
  } finally {
    delete globalThis.document;
  }
});
