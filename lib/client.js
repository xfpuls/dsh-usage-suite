/**
 * dsh-usage-suite 浏览器半（由 dsh-usage-meter 与 dsh-question-pin 合并而来）。
 *
 * 三个挂载点：
 * - conversation.composer.dock        输入框下方统计行：当前这一轮的花费
 * - sidebar.footer.action             侧栏底部「远程控制」上方：今日 token、消费与计费时段
 * - conversation.session.header.utilities  会话标题栏：钉在对话区顶部的当前提问气泡
 *
 * 用量数据来自宿主半的只读接口 /dsh-usage/state（按 pollSeconds 轮询）；
 * 提问数据来自 Chat 的 useChat 选择器 s.navigation.items()（每轮的提问原文）。
 * 两者都不写文件、不额外存储。
 */

window.__ModuleLoader__.load({

  id: 'dsh-usage-suite',

  factory: (require) => {

    const module = { exports: {} };
    const React = require('react');
    const h = React.createElement;

    /** 官方共享的表单构件（平台基座模块）；取不到时设置卡片整体降级为不显示。 */
    let Primitives = null;
    try {
      Primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch (error) {
      Primitives = null;
    }

    /** 选择器返回的空列表常量：保证引用稳定，避免无谓重渲染。 */
    const EMPTY_LIST = [];
    /** 用量段与置顶段各自的样式前缀。 */
    const U_PREFIX = 'dsum';
    const P_PREFIX = 'dqpin';
    const CSS_TAG_ID = 'dsh-usage-suite/Suite.css';
    /** 置顶气泡与窗口右侧、标题栏底部的间距。 */
    const EDGE_GAP = 24;
    const HEADER_GAP = 8;

    const css = [
      // ---- 用量统计 ----
      '.' + U_PREFIX + '_pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;',
      'border-radius:999px;padding:1px 8px;background:0 0;border:none;font:inherit;',
      'font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.' + U_PREFIX + '_pill strong{color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.' + U_PREFIX + '_card{box-sizing:border-box;display:flex;flex-direction:column;gap:3px;width:100%;',
      'padding:4px 6px 6px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:17px;color:var(--dsw-alias-label-tertiary)}',
      '.' + U_PREFIX + '_row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.' + U_PREFIX + '_label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.' + U_PREFIX + '_value{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.' + U_PREFIX + '_value strong{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.' + U_PREFIX + '_badge{display:inline-flex;align-items:center;gap:4px;padding:0 6px;border-radius:999px;',
      'font-size:11px;line-height:16px;white-space:nowrap;color:var(--dsw-alias-label-secondary);',
      'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.' + U_PREFIX + '_idle{color:#0a7d32;background:rgba(10,125,50,.13)}',
      '.' + U_PREFIX + '_peak{color:#a3560a;background:rgba(163,86,10,.15)}',
      '.' + U_PREFIX + '_dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}',
      '.' + U_PREFIX + '_clock{opacity:.75}',
      '.' + U_PREFIX + '_stale{color:var(--dsw-alias-label-quaternary,inherit);opacity:.6}',
      // ---- 提问置顶 ----
      '.' + P_PREFIX + '_pin{position:fixed;z-index:30;box-sizing:border-box;',
      'display:flex;align-items:flex-start;gap:8px;max-width:min(62%,560px);',
      'padding:8px 12px 8px 10px;border-radius:14px;',
      'border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));',
      'background:var(--dsw-alias-bg-l3,rgba(127,127,127,.16));',
      'color:var(--dsw-alias-label-primary);',
      'box-shadow:0 4px 16px rgba(0,0,0,.10);backdrop-filter:blur(8px);',
      'font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) + 0.5px);line-height:20px;',
      'text-align:left;cursor:pointer;overflow:hidden}',
      '.' + P_PREFIX + '_pin:hover{',
      'border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.45));',
      'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22))}',
      '.' + P_PREFIX + '_pin:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}',
      '.' + P_PREFIX + '_icon{flex:none;font-size:13px;line-height:20px}',
      '.' + P_PREFIX + '_body{min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.' + P_PREFIX + '_meta{flex:none;font-size:11px;line-height:14px;opacity:.65}',
      '.' + P_PREFIX + '_text{min-width:0;display:-webkit-box;-webkit-line-clamp:2;',
      '-webkit-box-orient:vertical;overflow:hidden;white-space:normal;word-break:break-word}',
      '.' + P_PREFIX + '_hint{color:var(--dsw-alias-label-tertiary)}',
      // ---- 设置卡片 ----
      '.' + P_PREFIX + '_settings{display:flex;flex-direction:column;gap:10px;padding:4px 2px 8px}',
      '.' + P_PREFIX + '_settingsTitle{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.' + P_PREFIX + '_settingsRow{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.' + P_PREFIX + '_settingsLabel{flex:1;min-width:0}',
      '.' + P_PREFIX + '_settingsInput{box-sizing:border-box;flex:none;width:190px;padding:3px 8px;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));background:var(--dsw-alias-bg-l2,transparent);',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      '.' + P_PREFIX + '_settingsInput[aria-invalid=true]{border-color:#c05a12}',
      '.' + P_PREFIX + '_settingsActions{display:flex;gap:8px;justify-content:flex-end;padding-top:2px}',
      '.' + P_PREFIX + '_settingsButton{padding:3px 12px;border-radius:6px;cursor:pointer;font:inherit;font-size:12px;',
      'border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));background:0 0;color:var(--dsw-alias-label-secondary)}',
      '.' + P_PREFIX + '_settingsButton:disabled{cursor:default;opacity:.45}',
      '.' + P_PREFIX + '_settingsError{font-size:11px;color:#a3560a}',
    ].join('');

    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-usage-suite';
      tag.dataset.pluginCss = CSS_TAG_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    /** 用量段的类名。 */
    const uCls = (name) => U_PREFIX + '_' + name;
    /** 置顶段的类名。 */
    const pCls = (name) => P_PREFIX + '_' + name;

    // ==================== 用量统计 ====================

    /** 千分位整数；非数字归零。 */
    function formatInt(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '0';
      return Math.round(number).toLocaleString('zh-CN');
    }

    /** token 数的人类可读缩写。 */
    function formatTokens(value) {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) return '0';
      if (number >= 1e9) return (number / 1e9).toFixed(2) + 'B';
      if (number >= 1e6) return (number / 1e6).toFixed(2) + 'M';
      if (number >= 1e3) return (number / 1e3).toFixed(1) + 'K';
      return String(Math.round(number));
    }

    /** 人民币金额，固定四位小数。 */
    function formatYuan(value) {
      const number = Number(value);
      return '¥' + (Number.isFinite(number) ? number : 0).toFixed(4);
    }

    /** 从槽位 props 里找出当前会话标识；拿不到时由宿主兜底到最近活跃会话。 */
    function readSessionId(props) {
      if (!props || typeof props !== 'object') return undefined;
      if (typeof props.sessionId === 'string' && props.sessionId.length > 0) return props.sessionId;
      if (props.session && typeof props.session.id === 'string') return props.session.id;
      if (props.owner && typeof props.owner.sessionId === 'string') return props.owner.sessionId;
      return undefined;
    }

    /** 轮询宿主接口。 */
    function useUsageState(sessionId) {
      const [state, setState] = React.useState({ data: null, error: false });
      const intervalRef = React.useRef(1000);

      React.useEffect(() => {
        let alive = true;
        let timer = null;
        const url = '/dsh-usage/state' + (sessionId ? '?session=' + encodeURIComponent(sessionId) : '');

        const tick = async () => {
          try {
            const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const payload = await response.json();
            if (!alive) return;
            const seconds = payload && payload.settings ? Number(payload.settings.pollSeconds) : NaN;
            if (Number.isFinite(seconds) && seconds > 0) intervalRef.current = Math.min(30000, Math.max(500, seconds * 1000));
            setState({ data: payload, error: false });
          } catch (error) {
            if (alive) setState((previous) => ({ data: previous.data, error: true }));
          } finally {
            if (alive) timer = setTimeout(tick, intervalRef.current);
          }
        };

        tick();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, [sessionId]);

      return state;
    }

    /** 本轮花费的悬浮说明。 */
    function turnTooltip(session, period) {
      if (!session) return '本轮还没有产生用量';
      const buckets = session.buckets || {};
      const lines = [
        '本轮 ' + formatYuan(session.cost) + '（' + (period && period.label ? period.label : '') + '）',
        '未命中输入 ' + formatInt(buckets.uncachedInputTokens) + ' tok',
        '缓存命中 ' + formatInt(buckets.cacheReadTokens) + ' tok',
        '输出 ' + formatInt(buckets.outputTokens) + ' tok',
        '共 ' + formatInt(session.tokens) + ' tok' + (session.model ? ' · ' + session.model : ''),
      ];
      return lines.join('\n');
    }

    /** 今日用量的悬浮说明。 */
    function todayTooltip(today, period) {
      const lines = [
        '今日 ' + formatYuan(today.cost) + ' · ' + formatInt(today.tokens) + ' tokens',
        '请求 ' + formatInt(today.samples) + ' 次 · 会话 ' + formatInt(today.sessions) + ' 个',
        period ? '北京时间 ' + period.clock + ' · ' + period.label : '',
      ];
      return lines.filter((line) => line.length > 0).join('\n');
    }

    /** 输入框下方统计行里的「本轮花费」。 */
    function TurnCostBadge(props) {
      const sessionId = readSessionId(props);
      const { data, error } = useUsageState(sessionId);

      if (!data || data.enabled === false) return null;
      const session = data.session;
      const period = data.period;

      return h('span', {
        className: uCls('pill') + (error ? ' ' + uCls('stale') : ''),
        title: turnTooltip(session, period),
      },
        h('span', null, '本轮'),
        h('strong', null, formatYuan(session ? session.cost : 0)),
      );
    }

    /** 侧栏底部的「今日用量 + 计费时段」。 */
    function TodayUsage(props) {
      const { data, error } = useUsageState(undefined);
      if (!data || data.enabled === false) return null;

      const wide = props ? props.wide !== false : true;
      const today = data.today || { tokens: 0, cost: 0, samples: 0, sessions: 0 };
      const period = data.period || { idle: true, label: '空闲时段', clock: '--:--' };
      const badgeClass = uCls('badge') + ' ' + (period.idle ? uCls('idle') : uCls('peak'));

      return h('div', {
        className: uCls('card') + (error ? ' ' + uCls('stale') : ''),
        title: todayTooltip(today, period),
      },
        h('div', { className: uCls('row') },
          wide ? h('span', { className: uCls('label') }, '今日用量') : null,
          h('span', { className: uCls('value') }, formatTokens(today.tokens) + ' tok'),
        ),
        h('div', { className: uCls('row') },
          wide ? h('span', { className: uCls('label') }, '今日消费') : null,
          h('span', { className: uCls('value') }, h('strong', null, formatYuan(today.cost))),
        ),
        h('div', { className: uCls('row') },
          h('span', { className: badgeClass },
            h('span', { className: uCls('dot') }),
            period.label,
          ),
          h('span', { className: uCls('clock') }, '北京 ' + period.clock),
        ),
      );
    }

    // ==================== 提问置顶 ====================

    /** 折叠空白，避免多行提问把气泡撑坏。 */
    function flatten(text) {
      return String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
    }

    /** 是否开启了「减少动态效果」。 */
    function reducedMotion() {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /** 读取计算样式；测试环境没有它时返回空对象。 */
    function styleOf(element) {
      if (typeof getComputedStyle !== 'function' || !element) return {};
      try {
        return getComputedStyle(element) || {};
      } catch (error) {
        return {};
      }
    }

    /** 这个元素是不是一个纵向可滚动容器。 */
    function isScrollable(element) {
      if (!element) return false;
      const overflowY = String(styleOf(element).overflowY || '');
      const scrollableOverflow = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      return scrollableOverflow && element.scrollHeight > element.clientHeight + 8;
    }

    /** 从某个节点向上找最近的可滚动祖先。 */
    function findScrollableAncestor(node) {
      let element = node && node.parentElement ? node.parentElement : null;
      let guard = 0;
      while (element && guard < 60) {
        if (isScrollable(element)) return element;
        element = element.parentElement;
        guard += 1;
      }
      return null;
    }

    /** 在某个子树里找第一个（最靠上的）可滚动容器。 */
    function findScrollableDescendant(root, limit = 4000) {
      if (!root) return null;
      const queue = [root];
      let visited = 0;
      while (queue.length > 0 && visited < limit) {
        const element = queue.shift();
        visited += 1;
        if (isScrollable(element)) return element;
        const children = element.children;
        if (children) {
          for (let index = 0; index < children.length; index += 1) queue.push(children[index]);
        }
      }
      return null;
    }

    /** 把容器滚到底部；滚动 API 不可用时退回直接赋值。 */
    function scrollToBottom(container, behavior) {
      if (!container) return false;
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior });
        return true;
      }
      if (typeof container.scrollTop === 'number') {
        container.scrollTop = container.scrollHeight;
        return true;
      }
      return false;
    }

    /** 找 DSH 自带轮次导航里指向某一轮的按钮；轮次编号严格匹配。 */
    function findTurnNavButton(turn) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
      const exact = new RegExp('(第\\s*' + turn + '\\s*轮)|(turn\\s*' + turn + '\\b)', 'i');
      const buttons = document.querySelectorAll('[aria-label]');
      for (const button of buttons) {
        const label = button.getAttribute('aria-label') || '';
        if (!/(跳转|jump|go to)/i.test(label)) continue;
        if (exact.test(label)) return button;
      }
      return null;
    }

    /** 目标轮已经渲染在页面上时，直接滚动到它。 */
    function scrollToTurnNode(turn, behavior) {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
      const selectors = ['[data-turn-process="' + turn + '"]', '[data-turn-tail="' + turn + '"]'];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({ block: 'center', behavior });
          return true;
        }
      }
      return false;
    }

    /** 自动巡回到指定轮次：导航按钮 → 轮次锚点 → 最新轮滚底。 */
    function jumpToTurn(turn, isLatest) {
      if (typeof document === 'undefined' || !Number.isFinite(turn)) return false;
      const behavior = reducedMotion() ? 'auto' : 'smooth';

      const button = findTurnNavButton(turn);
      if (button && typeof button.click === 'function') {
        button.click();
        return true;
      }

      if (scrollToTurnNode(turn, behavior)) return true;

      if (isLatest) {
        const anchor = (typeof document.querySelector === 'function' ? document.querySelector('[data-chat-flow]') : null)
          || (typeof document.querySelector === 'function' ? document.querySelector('[data-turn-tail]') : null);
        const container = findScrollableAncestor(anchor) || findScrollableDescendant(document.body);
        if (scrollToBottom(container, behavior)) return true;
      }

      return false;
    }

    /** 算出气泡应该钉在哪个视口坐标。 */
    function measureAnchor() {
      if (typeof document === 'undefined') return null;
      const header = document.querySelector('[data-conversation-header]');
      if (!header || typeof header.getBoundingClientRect !== 'function') return null;
      const rect = header.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.bottom)) return null;
      return { top: Math.round(rect.bottom + HEADER_GAP), right: EDGE_GAP };
    }

    /** 读取轮次导航项的渲染数据。 */
    function useNavigationItems(useChat) {
      const items = useChat((snapshot) => {
        const navigation = snapshot ? snapshot.navigation : undefined;
        if (!navigation || typeof navigation.items !== 'function') return EMPTY_LIST;
        const list = navigation.items();
        return Array.isArray(list) ? list : EMPTY_LIST;
      });
      return Array.isArray(items) ? items : EMPTY_LIST;
    }

    /** 置顶气泡：钉在消息区顶部，点击巡回。 */
    function QuestionPinInner(props) {
      const useChat = props.useChat;
      const items = useNavigationItems(useChat);
      const latest = items.length > 0 ? items[items.length - 1] : undefined;
      const [hint, setHint] = React.useState('');
      const [anchor, setAnchor] = React.useState(() => measureAnchor() ?? { top: 64, right: EDGE_GAP });

      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
        const update = () => {
          const next = measureAnchor();
          if (!next) return;
          setAnchor((previous) => (previous.top === next.top && previous.right === next.right ? previous : next));
        };
        update();
        window.addEventListener('resize', update);
        const timer = setInterval(update, 1000);
        let observer = null;
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(update);
          try {
            observer.observe(document.body);
          } catch (error) {
            observer = null;
          }
        }
        return () => {
          window.removeEventListener('resize', update);
          clearInterval(timer);
          if (observer) observer.disconnect();
        };
      }, []);

      React.useEffect(() => {
        if (hint === '') return undefined;
        const timer = setTimeout(() => setHint(''), 2600);
        return () => clearTimeout(timer);
      }, [hint]);

      const turn = latest && Number.isFinite(Number(latest.turn)) ? Number(latest.turn) : undefined;
      const prompt = latest ? flatten(latest.prompt) : '';
      if (turn === undefined || prompt.length === 0) return null;

      const onClick = () => {
        if (!jumpToTurn(turn, true)) setHint('这一轮还没加载出来，向上滚一点');
      };

      return h('button', {
        type: 'button',
        className: pCls('pin'),
        style: { top: anchor.top + 'px', right: anchor.right + 'px' },
        title: '当前问题（第 ' + turn + ' 轮）：' + prompt + '\n点击回到这一轮',
        'aria-label': '当前问题：' + prompt + '，点击回到第 ' + turn + ' 轮',
        'data-question-pin': 'true',
        onClick,
      },
        h('span', { className: pCls('icon'), 'aria-hidden': 'true' }, '📌'),
        h('span', { className: pCls('body') },
          h('span', { className: pCls('meta') }, '第 ' + turn + ' 轮 · 当前问题 · 点击回到这里'),
          hint.length > 0
            ? h('span', { className: pCls('hint') }, hint)
            : h('span', { className: pCls('text') }, prompt),
        ),
      );
    }

    /** 只在会话作用域（拿得到 useChat）时渲染。 */
    function QuestionPin(props) {
      return typeof props.useChat === 'function' ? h(QuestionPinInner, props) : null;
    }

    // ==================== 注册 ====================

    /** 设置命名空间必须等于 profile 条目 id。 */
    const SETTINGS_NS = 'dsh-usage-suite';
    /** 设置卡片里列出的字段，顺序即显示顺序。 */
    const SETTINGS_FIELDS = [
      { field: 'enabled', kind: 'boolean', label: '启用用量统计与提问置顶' },
      { field: 'autoHolidays', kind: 'boolean', label: '自动获取中国法定节假日' },
      { field: 'holidaysApi', kind: 'text', label: '节假日数据源（{year} 替换成四位年份）' },
      { field: 'holidays', kind: 'text', label: '手动补充的节假日（YYYY-MM-DD，逗号分隔）' },
      { field: 'includeSubagents', kind: 'boolean', label: '把子代理会话计入今日统计' },
      { field: 'pollSeconds', kind: 'number', label: '界面刷新间隔（秒，0.5 - 30）' },
      { field: 'flashCacheHitPeak', kind: 'number', label: 'flash 缓存命中 高峰价（元/百万 tokens）' },
      { field: 'flashCacheHitIdle', kind: 'number', label: 'flash 缓存命中 空闲价' },
      { field: 'flashCacheMissPeak', kind: 'number', label: 'flash 缓存未命中 高峰价' },
      { field: 'flashCacheMissIdle', kind: 'number', label: 'flash 缓存未命中 空闲价' },
      { field: 'flashOutputPeak', kind: 'number', label: 'flash 输出 高峰价' },
      { field: 'flashOutputIdle', kind: 'number', label: 'flash 输出 空闲价' },
      { field: 'proCacheHitPeak', kind: 'number', label: 'pro 缓存命中 高峰价' },
      { field: 'proCacheHitIdle', kind: 'number', label: 'pro 缓存命中 空闲价' },
      { field: 'proCacheMissPeak', kind: 'number', label: 'pro 缓存未命中 高峰价' },
      { field: 'proCacheMissIdle', kind: 'number', label: 'pro 缓存未命中 空闲价' },
      { field: 'proOutputPeak', kind: 'number', label: 'pro 输出 高峰价' },
      { field: 'proOutputIdle', kind: 'number', label: 'pro 输出 空闲价' },
    ];

    /** 布尔字段的转换规则（官方只提供文本与数字两种构件）。 */
    function booleanFieldSpec(field) {
      return {
        field,
        format: (value) => (value === true ? 'true' : 'false'),
        parse: (text) => ({ kind: 'set', value: String(text).trim() !== 'false' }),
      };
    }

    /** 设置卡片：DSH 不会自动生成插件设置页，必须由插件自己注册这张卡。 */
    function UsageSuiteSettings(props) {
      const snapshot = props.hooks ? props.hooks.settings((value) => value) : null;
      if (!snapshot || snapshot.available === false) return null;
      const values = snapshot.values || {};
      const rows = SETTINGS_FIELDS.map((item) => {
        const state = values[item.field] || { text: '', invalid: false };
        if (item.kind === 'boolean') {
          return h('label', { key: item.field, className: pCls('settingsRow') },
            h('span', { className: pCls('settingsLabel') }, item.label),
            h('input', {
              type: 'checkbox',
              checked: state.text === 'true',
              onChange: (event) => props.edit(item.field, event.target.checked ? 'true' : 'false'),
            }),
          );
        }
        return h('label', { key: item.field, className: pCls('settingsRow') },
          h('span', { className: pCls('settingsLabel') }, item.label),
          h('input', {
            type: item.kind === 'number' ? 'number' : 'text',
            className: pCls('settingsInput'),
            'aria-invalid': state.invalid ? 'true' : 'false',
            value: state.text,
            onChange: (event) => props.edit(item.field, event.target.value),
          }),
        );
      });
      return h('div', { className: pCls('settings') },
        h('div', { className: pCls('settingsTitle') }, '用量与置顶'),
        ...rows,
        snapshot.failed ? h('div', { className: pCls('settingsError') }, '保存失败，请检查数值后重试') : null,
        h('div', { className: pCls('settingsActions') },
          h('button', {
            type: 'button', className: pCls('settingsButton'),
            disabled: !snapshot.dirty || snapshot.saving,
            onClick: () => props.save(),
          }, snapshot.saving ? '保存中…' : '保存'),
          h('button', {
            type: 'button', className: pCls('settingsButton'),
            disabled: !snapshot.dirty,
            onClick: () => props.discard(),
          }, '放弃'),
        ),
      );
    }

    module.exports.inject = ['slots', 'configForms'];

    module.exports.apply = function apply(ctx) {
      /** 注册一个槽位条目，任何失败都只静默跳过。 */
      const registerSlot = (name, entry, component) => {
        try {
          if (typeof ctx.slots?.inject === 'function') {
            return ctx.slots.inject(name, () => {
              try {
                return ctx.slots.register(entry, component);
              } catch (error) {
                return undefined;
              }
            });
          }
          if (typeof ctx.slots?.register === 'function') {
            return ctx.slots.register(entry, component);
          }
        } catch (error) {
          /* 槽位不可用时安静跳过 */
        }
        return undefined;
      };

      const mount = () => {
        const disposers = [
          registerSlot('conversation.composer.dock', {
            name: 'conversation.composer.dock', id: 'usage-meter-turn', order: 30,
          }, TurnCostBadge),
          registerSlot('sidebar.footer.action', {
            name: 'sidebar.footer.action', id: 'usage-meter-today', order: 50,
          }, TodayUsage),
          registerSlot('conversation.session.header.utilities', {
            name: 'conversation.session.header.utilities', id: 'question-pin', order: 10,
          }, QuestionPin),
        ];
        return () => {
          for (const dispose of disposers) {
            try {
              if (typeof dispose === 'function') dispose();
            } catch (error) {
              /* 清理失败不影响其它条目 */
            }
          }
        };
      };

      if (typeof ctx.effect === 'function') {
        ctx.effect(mount, 'dsh-usage-suite: slots');
      } else {
        mount();
      }

      // 「设置 -> 插件」里的配置卡片：只有 Host 确实在提供这个命名空间时才注册。
      if (Primitives && Primitives.SettingsFormModel && ctx.configForms && typeof ctx.configForms.get === 'function') {
        ctx.effect(() => {
          let form = null;
          let registration = null;
          try {
            const specs = SETTINGS_FIELDS.map((item) => {
              if (item.kind === 'number') return Primitives.settingsNumberField(item.field);
              if (item.kind === 'boolean') return booleanFieldSpec(item.field);
              return Primitives.settingsTextField(item.field);
            });
            form = new Primitives.SettingsFormModel(ctx.configForms.get(SETTINGS_NS), specs);
            const formRef = form;
            const store = formRef.bind(() => {
              const values = {};
              for (const item of SETTINGS_FIELDS) values[item.field] = formRef.field(item.field);
              return Object.assign({}, formRef.shell(), { values });
            });
            registration = ctx.configForms.whileServed([SETTINGS_NS], () => registerSlot('plugins.item', {
              name: 'plugins.item',
              id: SETTINGS_NS,
              order: 80,
              label: () => '用量与置顶',
              inject: () => Object.assign({ hooks: { settings: store } }, formRef.actions()),
            }, UsageSuiteSettings));
          } catch (error) {
            /* 设置服务不可用时跳过，不影响统计与置顶 */
          }
          return () => {
            try { registration?.(); } catch (error) { /* ignore */ }
            try { form?.dispose(); } catch (error) { /* ignore */ }
          };
        }, 'dsh-usage-suite: settings card');
      }
    };

    return module.exports;
  },

});
