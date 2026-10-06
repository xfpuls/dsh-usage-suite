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

    /** 官方开关要用 React 渲染；取不到时退化为文字按钮。 */
    let ReactDOM = null;
    try {
      ReactDOM = require('react-dom');
    } catch (error) {
      ReactDOM = null;
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
      '.' + U_PREFIX + '_probe{font-size:10px;line-height:1.4;opacity:.5;white-space:nowrap;}',
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
      '.' + P_PREFIX + '_settingsGroup{display:flex;flex-direction:column;gap:8px;padding:2px 0 8px 26px}',
      '.' + P_PREFIX + '_settingsGroupTitle{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);padding:2px 0 4px}',
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
      '.' + P_PREFIX + '_desktopActions{display:flex;align-items:center;gap:6px;padding:2px 10px 6px}',
      '.' + P_PREFIX + '_desktopAction{flex:1 1 0;min-width:0;white-space:nowrap;font-size:11px;padding-left:2px;padding-right:2px}',
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

    /**
     * 账户余额（元）。由下面的轮询更新；拿不到时保持 null，界面会回退到设置项里手填的余额。
     *
     * 数据来自 DSH 自己的账号接口 ctx.remote.account.getBalance —— 也就是设置页
     * 「账户」里显示的同一份数据，因此不需要用户手动填写。
     */
    let accountBalance = null;
    /** 最近一次余额请求的结果，显示在诊断行里，便于判断为什么没读到。 */
    let accountBalanceStatus = '尚未请求';
    const balanceListeners = new Set();

    function setAccountBalance(next) {
      if (accountBalance === next) return;
      accountBalance = next;
      for (const listener of balanceListeners) {
        try { listener(next); } catch (error) { /* 忽略单个订阅者 */ }
      }
    }

    /** 主动查一次平台钱包余额；任何环节不可用就当作「查不到」。 */
    async function requestAccountBalance(ctx) {
      try {
        if (ctx === undefined || ctx === null) return;
        accountBalanceStatus = 'remote 不可用';
        const remote = ctx.remote ?? (typeof ctx.get === 'function' ? ctx.get('remote') : undefined);
        if (!remote || !remote.account) {
          accountBalanceStatus = remote ? 'remote.account 不可用' : 'remote 不可用';
          return;
        }
        const account = remote.account;
        if (typeof account.getBalance !== 'function') {
          accountBalanceStatus = 'getBalance 不存在';
          return;
        }
        accountBalanceStatus = '已请求…';
        const boot = typeof window !== 'undefined' ? window.__DSH_BOOT__ : undefined;
        const version = boot && typeof boot.version === 'string' && boot.version.length > 0
          ? boot.version
          : '0.0.0';
        let locale = 'zh';
        try {
          const snapshot = ctx.locale && typeof ctx.locale.getSnapshot === 'function' ? ctx.locale.getSnapshot() : undefined;
          if (snapshot && typeof snapshot.active === 'string' && snapshot.active.length > 0) locale = snapshot.active;
        } catch (error) { /* 语言取不到就用默认 */ }
        const result = await account.getBalance({
          version,
          locale,
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        });
        if (!result || result.ok !== true) {
          accountBalanceStatus = '请求失败：' + String((result && result.error && result.error.code) || 'ok!=true');
          return;
        }
        // 层级：getBalance() -> { ok, value }；这个 value 里才是
        // { status, value: [钱包], bonusWallets: [赠送] }。
        // 钱包数组在 result.value.value —— 少读一层就永远找不到余额。
        const outcome = result.value && typeof result.value === 'object' ? result.value : {};
        const wallets = Array.isArray(outcome.value) ? outcome.value : [];
        const bonus = Array.isArray(outcome.bonusWallets) ? outcome.bonusWallets : [];
        const all = wallets.concat(bonus);
        const cny = all.find((wallet) => wallet && String(wallet.currency).toUpperCase() === 'CNY');
        const parsed = cny ? Number(cny.balance) : NaN;
        if (Number.isFinite(parsed)) {
          accountBalanceStatus = '成功';
          setAccountBalance(parsed);
        } else {
          // 没找到人民币钱包时，把真实结构写进诊断，便于定位层级、状态或币种差异。
          accountBalanceStatus = '未见 CNY｜status=' + String(outcome.status)
            + ' 充值钱包=' + wallets.length
            + ' 赠送钱包=' + bonus.length
            + '｜' + JSON.stringify(result).slice(0, 60);
        }
      } catch (error) {
        accountBalanceStatus = '异常：' + String((error && error.message) || error);
      }
    }

    /** 订阅余额变化。 */
    function useAccountBalance() {
      const [value, setValue] = React.useState(accountBalance);
      React.useEffect(() => {
        let alive = true;
        const listener = (next) => { if (alive) setValue(next); };
        balanceListeners.add(listener);
        listener(accountBalance);
        return () => { alive = false; balanceListeners.delete(listener); };
      }, []);
      return value;
    }

    /** 余额那一行在「没读到」时显示的说明。 */
    function budgetStateText(autoBalance, status) {
      if (status === '已请求…' || status === '尚未请求') return '读取中…';
      return status || '未读取';
    }

    /** 侧栏底部的「今日用量 + 计费时段」。 */
    function TodayUsage(props) {
      const { data, error } = useUsageState(undefined);
      // 所有 Hook 必须在任何提前 return 之前调用。
      // 放在 return 之后属于「条件式调用 Hook」，React 会直接报错、整个组件不渲染 ——
      // 表现就是侧栏的用量信息整块消失。
      const autoBalance = useAccountBalance();
      if (!data || data.enabled === false) return null;

      const wide = props ? props.wide !== false : true;
      const today = data.today || { tokens: 0, cost: 0, samples: 0, sessions: 0 };
      const period = data.period || { idle: true, label: '空闲时段', clock: '--:--' };
      // 余额优先用从账号自动读到的；读不到才回退到设置项里手填的值。
      const manualBudget = Number(data.settings && data.settings.budget) || 0;
      const budget = Number.isFinite(autoBalance) && autoBalance > 0 ? autoBalance : manualBudget;
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
        budget > 0
          ? h('div', { className: uCls('row'), title: (Number.isFinite(autoBalance) && autoBalance > 0 ? '账户余额（自动读取）' : '账户余额（设置里手填）') + ' ' + formatYuan(budget) + ' − 今日消费 ' + formatYuan(today.cost) },
            wide ? h('span', { className: uCls('label') }, '剩余费用') : null,
            h('span', { className: uCls('value') }, formatYuan(Math.max(0, budget - today.cost))),
          )
          : h('div', { className: uCls('row'), title: '没有读到账户余额，也没有在设置里填写。' + accountBalanceStatus },
            wide ? h('span', { className: uCls('label') }, '剩余费用') : null,
            h('span', { className: uCls('clock') }, budgetStateText(autoBalance, accountBalanceStatus)),
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

    /**
     * 会话内容是否已被别的面板盖住（文件预览、diff、终端等）。
     *
     * 取聊天列中心偏上的一点做命中测试：如果那一点的最上层元素不属于聊天内容，
     * 说明对话区已经被别的面板遮住，此时气泡必须让位，否则会挡住别人的内容。
     *
     * @returns 被盖住返回 true。
     */
    /**
     * 气泡将要占据的那一点，是否仍然属于对话区。
     *
     * 只检查「气泡自己的位置」：右侧的 diff / 预览 / 终端面板常常只占右边一条，
     * 对话区中间依然可见，但气泡钉的右上角已经被压住了 —— 这种情况也必须隐藏。
     * 用 elementsFromPoint 取该点从上层到下层所有元素，跳过气泡自身再看下一层。
     * 任何异常或取不到信息时一律放行，优先保证气泡能显示。
     *
     * @param anchorTop - 气泡上沿的视口 y 坐标。
     * @returns 该位置可用返回 true。
     */
    /**
     * 会盖住对话区右侧的浮动面板容器。
     *
     * 这些属性来自 DSH 自己渲染的右侧停靠面板（diff、文件预览、交付物、文件树），
     * 面板折叠或关闭时元素不存在，命中测试自然也就不会返回它们。
     */
    const COVERING_PANEL_SELECTOR = [
      '[data-sidebar-right-panel]',
      '[data-document-preview]',
      '[data-deliverables]',
      '[data-files-root]',
      '[data-changed-files]',
    ].join(',');

    /**
     * 气泡将要占据的那一点，是否仍然空着。
     *
     * 判断方向是「只认明确的面板」：命中右侧面板容器才让位，其它任何情况一律放行。
     * 这样即使某个角落本来就在聊天列的留白里，也不会把气泡误判成被盖住而永久隐藏。
     *
     * @param anchorTop - 气泡上沿的视口 y 坐标。
     * @returns 该位置可用返回 true。
     */
    function isAnchorSpotAvailable(anchorTop) {
      if (typeof document === 'undefined') return true;
      const viewportWidth = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 9999;
      const x = Math.max(4, viewportWidth - EDGE_GAP - 24);
      const y = Math.max(4, anchorTop + 14);
      let stack = null;
      try {
        if (typeof document.elementsFromPoint === 'function') {
          stack = document.elementsFromPoint(x, y);
        } else if (typeof document.elementFromPoint === 'function') {
          const single = document.elementFromPoint(x, y);
          stack = single ? [single] : [];
        }
      } catch (error) {
        return true;
      }
      if (!Array.isArray(stack) || stack.length === 0) return true;
      for (const element of stack) {
        if (!element || typeof element.closest !== 'function') continue;
        if (element.closest('[data-question-pin]')) continue;
        return !element.closest(COVERING_PANEL_SELECTOR);
      }
      return true;
    }

    /**
     * 取某一轮在视口里的最高处（≈ 该轮用户提问的顶部）。
     *
     * DSH 把每一轮渲染成若干带 data-chat-turn 的容器，容器顶部就是这一轮的第一条内容，
     * 也就是用户的提问。同一轮可能对应多个容器，取最靠上的那个。
     *
     * @param turn - 轮次号。
     * @returns 视口坐标里的 top；取不到返回 null。
     */
    /**
     * 归一化提问文本：去掉首尾空白，把连续空白（含换行）折叠成一个空格。
     * 「内容一模一样」按这个结果判等 —— 用户眼里字面相同的两条提问就算重复。
     */
    function normalizePrompt(text) {
      return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    }

    /**
     * 视口里是否出现了另一条「内容一模一样」的提问。
     *
     * 与 promptVisible 的分工：那个只管「当前这一轮的提问还在不在屏幕上」，
     * 这个函数则扫遍所有轮次，找出与当前置顶内容相同、且确实显示在屏幕上的那一条。
     * 命中就说明用户已经能看到同样的内容了，置顶气泡没有继续占位的必要。
     */
    function duplicatePromptVisible(items, currentTurn, currentPrompt) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return false;
      if (typeof document.querySelectorAll !== 'function') return false;
      const normalized = normalizePrompt(currentPrompt);
      if (normalized.length === 0) return false;
      const viewportHeight = Number(window.innerHeight) || 0;
      if (viewportHeight <= 0) return false;
      for (const item of items) {
        if (!item) continue;
        const otherTurn = Number.isFinite(Number(item.turn)) ? Number(item.turn) : undefined;
        if (otherTurn === undefined || otherTurn === currentTurn) continue;
        if (normalizePrompt(flatten(item.prompt)) !== normalized) continue;
        let nodes = [];
        try {
          nodes = document.querySelectorAll('[data-chat-turn="' + otherTurn + '"]');
        } catch (error) {
          continue;
        }
        for (const element of nodes) {
          if (!element || typeof element.getBoundingClientRect !== 'function') continue;
          if (element.isConnected === false) continue;
          const rect = element.getBoundingClientRect();
          if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) continue;
          if (rect.width === 0 && rect.height === 0) continue;
          // 与视口有交集就算「出现在视口里」。
          if (rect.bottom > 0 && rect.top < viewportHeight) return true;
        }
      }
      return false;
    }

    /**
     * 找出代表这一轮提问的节点，按可靠性从高到低依次尝试。
     * 找不到任何节点时返回空数组；节点查询本身出错时返回 null（调用方据此放弃判断）。
     */
    function promptNodesOf(turn) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
      const QUERY = '[data-chat-turn="' + turn + '"]';
      // 按可靠性从高到低依次尝试，取第一个有结果的：
      //
      // 1. 提问本身。DSH 会把 flow-kind="user" 和 turn 打在同一行上
      //    （见 @deepseek-ai/dsh-client-ui-chat/lib/client.js 第 1765-1766 行，
      //    以及第 5234 行用 kind === "user" 判定用户消息）。这是唯一精确指向
      //    「用户提问」的标记，量到的就是提问自己的方块。
      // 2. 排除过程分组容器后的整轮行。一轮里除提问外还包含回复，
      //    容器方块会大得多，只能算次选。
      // 3. 兜底：所有带该轮标记的节点。宁可判不准，也不要因为查不到而不隐藏。
      const PREFERRED = QUERY + '[data-chat-flow-kind="user"]';
      const FALLBACK = QUERY
        + ':not([hidden]):not([hidden *])'
        + ':not([data-step-process]):not([data-turn-process-member]):not([data-turn-process-hidden])';
      try {
        const exact = document.querySelectorAll(PREFERRED);
        if (exact.length > 0) return exact;
        const fallback = document.querySelectorAll(FALLBACK);
        if (fallback.length > 0) return fallback;
        return document.querySelectorAll(QUERY);
      } catch (error) {
        return null;
      }
    }

    /**
     * 提问现在是否还看得见 —— 用「提问方块与视口是否有交集」判断，而不是只看顶部。
     *
     * 这一点是踩过坑的：提问可能很长（例如带了图片），它的顶部滚出视口上方时，
     * 底部仍然留在屏幕里。只比较 top 会得出「已经翻过去了」的错误结论，于是气泡
     * 赖着不走 —— 用户明明还看着那条提问。
     */
    function promptVisible(turn) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return false;
      if (typeof document.querySelectorAll !== 'function') return false;
      const viewportHeight = Number(window.innerHeight) || 0;
      if (viewportHeight <= 0) return false;
      // 只认「精确指向提问」的节点。
      //
      // 这里必须克制：整轮的容器、过程分组容器跨度极大（一轮从提问一直包到回复），
      // 它们几乎永远与视口有交集 —— 拿它们判断会让「看得见」恒为真，气泡再也不出现。
      // 查不到精确节点就保守地当作「看不见」，气泡照常显示。
      let nodes = null;
      try {
        nodes = document.querySelectorAll('[data-chat-turn="' + turn + '"][data-chat-flow-kind="user"]');
      } catch (error) {
        return false;
      }
      if (!nodes || nodes.length === 0) return false;
      for (const element of nodes) {
        if (!element || typeof element.getBoundingClientRect !== 'function') continue;
        if (element.isConnected === false) continue;
        const rect = element.getBoundingClientRect();
        if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) continue;
        // 尺寸为 0 说明这一轮还没真正渲染出来，不能当作「看得见」。
        if (rect.width === 0 && rect.height === 0) continue;
        // 上边在视口下方以内、下边在视口上方以外 —— 只要有交集就是看得见。
        if (rect.bottom > 0 && rect.top < viewportHeight) return true;
      }
      return false;
    }

    /** 算出气泡应该钉在哪个视口坐标；那个位置被别的面板压住时把 covered 标出来。 */
    function measureAnchor() {
      if (typeof document === 'undefined') return null;
      const header = document.querySelector('[data-conversation-header]');
      if (!header || typeof header.getBoundingClientRect !== 'function') return null;
      const rect = header.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.bottom)) return null;
      const top = Math.round(rect.bottom + HEADER_GAP);
      return { top, right: EDGE_GAP, covered: !isAnchorSpotAvailable(top) };
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

    /**
     * 临时诊断：把气泡的判定依据直接写在标题栏上。
     *
     * 只读取数据、不做任何判断，也不影响气泡本身 —— 排查完就删。
     */
    function PinProbe(props) {
      const useChat = props ? props.useChat : undefined;
      const items = useNavigationItems(useChat);
      // 取「最后一个带提问的轮次」，而不是死取最后一项。
      //
      // 最新一轮未必有用户提问 —— 例如自动任务触发、或系统续跑的轮次，它的 prompt 是空的。
      // 旧写法在这种情况下会拿到空提问，随即因为「提问为空」而整个不显示气泡。
      let latest;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const candidate = items[index];
        if (candidate && flatten(candidate.prompt).length > 0) {
          latest = candidate;
          break;
        }
      }
      const turn = latest && Number.isFinite(Number(latest.turn)) ? Number(latest.turn) : undefined;
      const prompt = latest ? flatten(latest.prompt) : '';
      const visible = turn === undefined ? null : promptVisible(turn);
      const text = 'items=' + items.length
        + ' turn=' + (turn === undefined ? '无' : turn)
        + ' 提问=' + (prompt.length > 0 ? prompt.slice(0, 6) : '空')
        + ' 可见=' + (visible === null ? '未知' : String(visible))
        + ' useChat=' + (typeof useChat === 'function' ? '有' : '无')
        + ' 余额=' + accountBalanceStatus;
      return h('span', { className: uCls('probe'), title: text }, text);
    }

    /** 置顶气泡：钉在消息区顶部，点击巡回。 */
    function QuestionPinInner(props) {
      const useChat = props.useChat;
      const items = useNavigationItems(useChat);
      // 取「最后一个带提问的轮次」，而不是死取最后一项。
      //
      // 最新一轮未必有用户提问 —— 例如自动任务触发、或系统续跑的轮次，它的 prompt 是空的。
      // 旧写法在这种情况下会拿到空提问，随即因为「提问为空」而整个不显示气泡。
      let latest;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const candidate = items[index];
        if (candidate && flatten(candidate.prompt).length > 0) {
          latest = candidate;
          break;
        }
      }
      const [hint, setHint] = React.useState('');
      const [layout, setLayout] = React.useState(() => measureAnchor() ?? { top: 64, right: EDGE_GAP, covered: false });

      // 这两个是普通计算，必须写在下面的 hooks 之前 —— effect 的依赖数组要引用 turn。
      const turn = latest && Number.isFinite(Number(latest.turn)) ? Number(latest.turn) : undefined;
      const prompt = latest ? flatten(latest.prompt) : '';

      // 用 useCallback 固定引用，好让「切换会话/轮次」时能触发下面这个 effect 立即重算，
      // 而不是干等下一次 1 秒轮询 —— 那正是气泡切换后迟迟不出现的原因。
      const update = React.useCallback(() => {
        const next = measureAnchor();
        if (!next) return;
        setLayout((previous) => (
          previous.top === next.top && previous.right === next.right && previous.covered === next.covered
            ? previous
            : next
        ));
      }, []);

      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
        update();
        window.addEventListener('resize', update);
        // 捕获阶段监听，滚动发生在任意内部滚动容器里都能收到。
        window.addEventListener('scroll', update, true);
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
          window.removeEventListener('scroll', update, true);
          clearInterval(timer);
          if (observer) observer.disconnect();
        };
      }, [update, turn]);

      React.useEffect(() => {
        if (hint === '') return undefined;
        const timer = setTimeout(() => setHint(''), 2600);
        return () => clearTimeout(timer);
      }, [hint]);

      if (turn === undefined || prompt.length === 0) return null;
      // 对话区被别的面板盖住时让位，避免挡住用户正在看的内容。
      if (layout.covered) return null;
      // 屏幕上已经出现一条内容一模一样的提问时也让位：
      // 用户既然看得到同样的内容，气泡再钉着就是重复信息。
      if (duplicatePromptVisible(items, turn, prompt)) return null;
      // 提问还看得见就不钉。判断的是「提问方块与视口有没有交集」，
      // 因为提问可能很长：顶部滚上去、底部还在屏幕里时，用户依然看得见它。
      const stillVisible = promptVisible(turn);
      if (stillVisible) return null;

      const onClick = () => {
        if (!jumpToTurn(turn, true)) setHint('这一轮还没加载出来，向上滚一点');
      };

      return h('button', {
        type: 'button',
        className: pCls('pin'),
        style: { top: layout.top + 'px', right: layout.right + 'px' },
        // 不设 title：悬停时弹出的黑框会盖住正文。按钮的用途由 aria-label 承载，
        // 屏幕阅读器照常能念出来。
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

    /**
     * 侧栏底部的一对桌面端操作：「重启桌面端」与「重载界面」。
     *
     * 重启走桌面端 preload 暴露的 window.desktopNext.command，DSH 自己会再弹一次确认框，
     * 所以不会误触；不在桌面端（浏览器里打开）时这个按钮自动禁用。
     */
    function DesktopActions() {
      const desktop = typeof window !== 'undefined' ? window.desktopNext : null;
      const canRestart = Boolean(desktop && typeof desktop.command === 'function');
      const ActionButton = Primitives && Primitives.Button ? Primitives.Button : 'button';

      // 不做「点击后禁用」：DSH 自己会弹确认框，用户取消时我们收不到通知，
      // 一旦禁用就再也点不动了。重复点击也无害。
      const restart = () => {
        if (!canRestart) return;
        try {
          const pending = desktop.command({ type: 'restart-app' });
          if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        } catch (error) {
          /* 请求失败时不额外提示，DSH 自己会反馈 */
        }
      };

      const reload = () => {
        try {
          window.location.reload();
        } catch (error) {
          /* 忽略 */
        }
      };

      return h('div', { className: pCls('desktopActions') },
        h(ActionButton, {
          size: 'sm',
          className: pCls('desktopAction'),
          onClick: restart,
          disabled: !canRestart,
          title: canRestart ? '重启桌面端（会先弹出确认）' : '仅在桌面端可用',
        }, '重启桌面端'),
        h(ActionButton, {
          size: 'sm',
          className: pCls('desktopAction'),
          onClick: reload,
          title: '重新加载当前界面',
        }, '重载界面'),
      );
    }

    /** 「新会话」按钮的几种文案，用来定位侧栏顶部。 */
    const NEW_CHAT_LABELS = ['新会话', '新建会话', '新对话', 'New chat', 'New session', 'New Chat'];

    /**
     * 把桌面操作按钮挂到侧栏最上方（「新会话」按钮之上）。
     *
     * DSH 的窗口顶栏属于外壳文档（dsh-app://shell），插件够不到，侧栏顶部也没有插槽，
     * 所以这里按「新会话」按钮的位置就近注入。找不到目标时安静不做事。
     *
     * @returns 清理函数。
     */
    function installSidebarTopActions() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return () => {};
      if (!ReactDOM) return () => {};

      let installed = null;

      const findAnchor = () => {
        let candidates = [];
        try {
          candidates = document.querySelectorAll('button, a, [role="button"]');
        } catch (error) {
          return null;
        }
        // 用包含匹配：按钮里通常还带图标或其它字符，精确比较会漏掉。
        for (const element of candidates) {
          const text = (element.textContent || '').trim();
          if (!text || !element.parentElement) continue;
          if (NEW_CHAT_LABELS.some((label) => text.includes(label))) return element;
        }
        return null;
      };

      const teardown = () => {
        if (!installed) return;
        try {
          if (installed.root && typeof installed.root.unmount === 'function') installed.root.unmount();
        } catch (error) {
          /* 卸载失败不影响页面 */
        }
        if (installed.host && installed.host.parentElement) installed.host.parentElement.removeChild(installed.host);
        installed = null;
      };

      const sync = () => {
        const anchor = findAnchor();
        if (!anchor) { teardown(); return; }
        if (installed && installed.anchor === anchor && installed.host.isConnected) return;
        teardown();
        const host = document.createElement('div');
        host.setAttribute('data-desktop-actions', 'top');
        host.className = pCls('desktopActions');
        anchor.parentElement.insertBefore(host, anchor);
        const root = ReactDOM.createRoot(host);
        root.render(h(DesktopActions, {}));
        installed = { anchor, host, root };
      };

      sync();
      const timer = setInterval(sync, 800);
      return () => { clearInterval(timer); teardown(); };
    }

    /** 只在会话作用域（拿得到 useChat）时渲染。 */
    function QuestionPin(props) {
      return typeof props.useChat === 'function' ? h(QuestionPinInner, props) : null;
    }

    // ==================== 注册 ====================

    /** 设置命名空间必须等于 profile 条目 id。 */
    const SETTINGS_NS = 'dsh-usage-suite';
    /** 设置卡片的分组：每个分组用官方折叠行收起，顺序即显示顺序。 */
    const SETTINGS_GROUPS = [
      {
        title: '基础设置',
        fields: [
          { field: 'enabled', kind: 'boolean', label: '启用用量统计与提问置顶' },
          { field: 'includeSubagents', kind: 'boolean', label: '把子代理会话计入今日统计' },
          { field: 'pollSeconds', kind: 'number', label: '界面刷新间隔（秒，0.5 - 30）' },
          { field: 'budget', kind: 'number', label: '账户余额（元，留 0 则不显示剩余费用）' },
        ],
      },
      {
        title: '法定节假日',
        fields: [
          { field: 'autoHolidays', kind: 'boolean', label: '自动获取中国法定节假日' },
          { field: 'holidaysApi', kind: 'text', label: '数据源（{year} 替换成四位年份）' },
          { field: 'holidays', kind: 'text', label: '手动补充（北京时间 YYYY-MM-DD，逗号分隔）' },
        ],
      },
      {
        title: '价目表（元 / 百万 tokens）',
        fields: [
          { field: 'flashCacheHitPeak', kind: 'number', label: 'flash 缓存命中 · 高峰' },
          { field: 'flashCacheHitIdle', kind: 'number', label: 'flash 缓存命中 · 空闲' },
          { field: 'flashCacheMissPeak', kind: 'number', label: 'flash 缓存未命中 · 高峰' },
          { field: 'flashCacheMissIdle', kind: 'number', label: 'flash 缓存未命中 · 空闲' },
          { field: 'flashOutputPeak', kind: 'number', label: 'flash 输出 · 高峰' },
          { field: 'flashOutputIdle', kind: 'number', label: 'flash 输出 · 空闲' },
          { field: 'proCacheHitPeak', kind: 'number', label: 'pro 缓存命中 · 高峰' },
          { field: 'proCacheHitIdle', kind: 'number', label: 'pro 缓存命中 · 空闲' },
          { field: 'proCacheMissPeak', kind: 'number', label: 'pro 缓存未命中 · 高峰' },
          { field: 'proCacheMissIdle', kind: 'number', label: 'pro 缓存未命中 · 空闲' },
          { field: 'proOutputPeak', kind: 'number', label: 'pro 输出 · 高峰' },
          { field: 'proOutputIdle', kind: 'number', label: 'pro 输出 · 空闲' },
        ],
      },
    ];
    /** 展平后的字段列表：构造表单与读取当前值时用。 */
    const SETTINGS_FIELDS = SETTINGS_GROUPS.flatMap((group) => group.fields);
    /** 列表卡片与详情页顶部显示的一行说明。 */
    const SETTINGS_SUMMARY = '输入框下方显示本轮花费、侧栏底部显示今日用量与计费时段；最新提问钉在对话顶部，点击可跳回那一轮';

    /** 布尔字段的转换规则（官方只提供文本与数字两种构件）。 */
    function booleanFieldSpec(field) {
      return {
        field,
        format: (value) => (value === true ? 'true' : 'false'),
        parse: (text) => ({ kind: 'set', value: String(text).trim() !== 'false' }),
      };
    }

    /** 渲染一行「说明 + 控件」。 */
    function settingsRow(item, state, props) {
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
    }

    /**
     * 设置卡片。
     *
     * DSH 会把同一个组件渲染两次：view 为 summary 时是列表卡片上的一行说明，
     * 为 page 时是详情页里的表单。两者是两个独立的组件实例，各自 hook 互不影响。
     */
    function UsageSuiteSettings(props) {
      // hooks 必须写在所有分支之前。
      const [openGroups, setOpenGroups] = React.useState({ 0: true });

      if (props.view === 'summary') return h('span', null, SETTINGS_SUMMARY);

      const snapshot = props.hooks ? props.hooks.settings((value) => value) : null;
      if (!snapshot) return null;
      // 配置命名空间还没就绪时也要显示，否则用户根本不知道有没有装上。
      if (snapshot.available === false) {
        return h('div', { className: pCls('settings') },
          h('div', { className: pCls('settingsError') }, '配置暂不可用：宿主还没有提供这个插件的配置命名空间。'),
        );
      }

      const values = snapshot.values || {};
      const Collapsible = Primitives && Primitives.DisclosureRow ? Primitives.DisclosureRow : null;
      const groups = SETTINGS_GROUPS.map((group, index) => {
        const body = h('div', { className: pCls('settingsGroup') },
          group.fields.map((item) => settingsRow(item, values[item.field] || { text: '', invalid: false }, props)),
        );
        if (!Collapsible) {
          return h('div', { key: group.title },
            h('div', { className: pCls('settingsGroupTitle') }, group.title),
            body,
          );
        }
        return h(Collapsible, {
          key: group.title,
          title: group.title,
          open: openGroups[index] === true,
          expandable: true,
          onToggle: () => setOpenGroups((previous) => Object.assign({}, previous, { [index]: previous[index] !== true })),
        }, body);
      });

      const SaveButton = Primitives && Primitives.Button ? Primitives.Button : 'button';
      return h('div', { className: pCls('settings') },
        ...groups,
        snapshot.failed ? h('div', { className: pCls('settingsError') }, '保存失败，请检查数值后重试') : null,
        h('div', { className: pCls('settingsActions') },
          h(SaveButton, {
            disabled: !snapshot.dirty || snapshot.saving,
            onClick: () => props.save(),
          }, snapshot.saving ? '保存中…' : '保存'),
          h(SaveButton, {
            disabled: !snapshot.dirty,
            onClick: () => props.discard(),
          }, '放弃'),
        ),
      );
    }

    /**
     * 在插件页「官方」分组标题右侧挂一个折叠按钮。
     *
     * DSH 没有为分组标题预留插槽，只能在页面里直接注入。定位只依赖它渲染时带上的
     * data-plugin-group="official" 与组内的列表容器；结构一旦变化就安静地不做事，
     * 绝不改动页面自身的内容。按钮样式直接抄页面上已有的官方按钮类名，保证一致。
     *
     * @returns 清理函数：停止轮询并移除按钮。
     */
    function installGroupToggle() {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return () => {};

      let installed = null;
      // 状态存本地：注入会随页面重渲染反复进行，不记住的话每次都会弹回展开。
      const storedExpanded = () => {
        try {
          const raw = window.localStorage.getItem('dsh-usage-suite:official-group-expanded');
          return raw === null ? true : raw === 'true';
        } catch (error) {
          return true;
        }
      };
      const rememberExpanded = (value) => {
        try {
          window.localStorage.setItem('dsh-usage-suite:official-group-expanded', value ? 'true' : 'false');
        } catch (error) {
          /* 存不了就只在本次会话里生效 */
        }
      };
      let expanded = storedExpanded();

      /** 抄一个页面上已有官方按钮的类名，供退化路径使用。 */
      const sampleButtonClass = () => {
        const sample = document.querySelector('[data-plugin-panel="true"] button');
        return sample && typeof sample.className === 'string' ? sample.className : '';
      };

      /** 把展开状态应用到卡片列表。 */
      const paint = () => {
        if (!installed) return;
        installed.list.style.display = expanded ? '' : 'none';
      };

      /** 把官方开关渲染进宿主节点，返回清理函数；组件不可用时返回 null。 */
      const renderOfficialSwitch = (host) => {
        const Switch = Primitives && Primitives.Switch;
        if (typeof Switch !== 'function' || !ReactDOM) return null;
        const holder = {};
        const draw = () => {
          const node = h(Switch, {
            checked: expanded,
            label: '收起或展开官方插件列表',
            title: expanded ? '收起官方插件列表' : '展开官方插件列表',
            onChange: (next) => {
              expanded = next === true;
              rememberExpanded(expanded);
              paint();
              draw();
            },
          });
          if (typeof ReactDOM.createRoot === 'function') {
            if (!holder.root) holder.root = ReactDOM.createRoot(host);
            holder.root.render(node);
            return;
          }
          if (typeof ReactDOM.render === 'function') ReactDOM.render(node, host);
        };
        draw();
        return () => {
          try {
            if (holder.root) holder.root.unmount();
            else if (typeof ReactDOM.unmountComponentAtNode === 'function') ReactDOM.unmountComponentAtNode(host);
          } catch (error) {
            /* 卸载失败不影响页面 */
          }
        };
      };

      const teardown = () => {
        if (!installed) return;
        try {
          if (typeof installed.dispose === 'function') installed.dispose();
        } catch (error) {
          /* 忽略 */
        }
        if (installed.host && installed.host.parentElement) installed.host.parentElement.removeChild(installed.host);
        installed = null;
      };

      const sync = () => {
        const section = document.querySelector('[data-plugin-group="official"]');
        if (!section) { teardown(); return; }
        if (installed && installed.section === section && installed.host.isConnected) { paint(); return; }
        teardown();
        const head = section.firstElementChild;
        const list = section.querySelector('ul');
        if (!head || !list) return;
        const host = document.createElement('span');
        host.setAttribute('data-plugin-group-toggle', 'official');
        host.style.marginLeft = 'auto';
        host.style.display = 'inline-flex';
        host.style.alignItems = 'center';
        head.appendChild(host);
        installed = { section, list, host, dispose: null };
        const dispose = renderOfficialSwitch(host);
        if (dispose) {
          installed.dispose = dispose;
        } else {
          // 退化：官方按钮样式 + 不换行的文字
          const button = document.createElement('button');
          button.type = 'button';
          button.className = sampleButtonClass();
          button.style.whiteSpace = 'nowrap';
          button.setAttribute('aria-label', '收起或展开官方插件列表');
          button.textContent = expanded ? '收起' : '展开';
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            expanded = !expanded;
            rememberExpanded(expanded);
            button.textContent = expanded ? '收起' : '展开';
            paint();
          });
          host.appendChild(button);
        }
        paint();
      };

      sync();
      const timer = setInterval(sync, 800);
      return () => { clearInterval(timer); teardown(); };
    }

    // remote 是 DSH 的远程能力命名空间，remote.account 是其中的账号子命名空间。
    // 只声明 remote 是不够的：没有 remote.account 时 ctx.remote.account 是 undefined，
    // 余额请求根本发不出去。官方账号插件的声明里这两项都有。
    module.exports.inject = ['slots', 'configForms', 'remote', 'remote.account'];

    module.exports.apply = function apply(ctx) {
      // 账户余额：进入界面后立刻查一次，之后每分钟刷新。
      // 放在这里而不是组件里，是为了避免每次渲染都发一次请求。
      try {
        requestAccountBalance(ctx);
        const balanceTimer = setInterval(() => requestAccountBalance(ctx), 60000);
        // 不让这个定时器拖住进程退出（Node 里定时器默认会 keep-alive）。
        if (balanceTimer && typeof balanceTimer.unref === 'function') balanceTimer.unref();
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => () => clearInterval(balanceTimer), 'dsh-usage-suite: account balance');
        }
      } catch (error) {
        /* 取不到余额不影响用量统计 */
      }

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
          // 临时诊断，排查完删除
          registerSlot('conversation.session.header.utilities', {
            name: 'conversation.session.header.utilities', id: 'pin-probe', order: 11,
          }, PinProbe),
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
        ctx.effect(installGroupToggle, 'dsh-usage-suite: official group toggle');
        ctx.effect(installSidebarTopActions, 'dsh-usage-suite: sidebar top actions');
      } else {
        mount();
        installGroupToggle();
        installSidebarTopActions();
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
            // 不用 whileServed 挡着：先无条件把卡片挂上，配置没就绪时由卡片自己显示状态。
            registration = registerSlot('plugins.item', {
              name: 'plugins.item',
              id: SETTINGS_NS,
              order: 80,
              label: () => '用量与置顶',
              inject: () => Object.assign({ hooks: { settings: store } }, formRef.actions()),
            }, UsageSuiteSettings);
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
