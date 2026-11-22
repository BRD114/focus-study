/* =========================================================================
 * app.js — 应用装配层
 *  数据初始化 → 各模块装载 → 路由 / 主题 / 通知 → 原生桥接
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  const PAGE_META = {
    tasks: { title: function () { return U.greeting(); }, sub: subTasks },
    todo: { title: function () { return '日程待办'; }, sub: subTodo },
    focus: { title: function () { return '专注'; }, sub: subFocus },
    stats: { title: function () { return '学习数据'; }, sub: function () { return '看清投入，才知道往哪加力'; } },
    me: { title: function () { return '我的'; }, sub: function () { return '本地存储 · 无广告 · 无推送'; } }
  };

  let currentPage = 'tasks';

  /* ========================= 顶栏文案 ========================= */
  function subTasks() {
    const st = S.streak();
    const open = S.tasks.filter(function (t) { return !t.done; }).length;
    return U.todayLabel() + (st > 0 ? ' · 连续 ' + st + ' 天' : '') + (open ? ' · ' + open + ' 项待推进' : '');
  }
  function subTodo() {
    const t = S.state.todos.filter(function (x) { return !x.done; }).length;
    const g = S.state.goals.filter(function (x) { return !x.archived; }).length;
    return '待办 ' + t + ' 项 · 进行中目标 ' + g + ' 个';
  }
  function subFocus() {
    const s = S.settings;
    return '专注 ' + s.focusMin + ' 分钟 · 休息 ' + s.breakMin + ' 分钟';
  }

  function updateTop() {
    const meta = PAGE_META[currentPage];
    if (!meta) return;
    const titleEl = U.$('#topTitle'), subEl = U.$('#topSub');
    if (titleEl) titleEl.textContent = meta.title();
    if (subEl) subEl.textContent = meta.sub();
  }

  /* ========================= 路由 ========================= */
  function go(page, opts) {
    if (!PAGE_META[page]) page = 'tasks';
    currentPage = page;
    U.$$('.page').forEach(function (p) { p.classList.toggle('is-active', p.dataset.page === page); });
    U.$$('.tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.page === page); });
    updateTop();
    // 切换后刷新对应页面数据
    if (page === 'stats') global.Stats.render();
    if (page === 'focus') global.Focus.render();
    if (page === 'todo') global.Todo.render();
    if (page === 'me') global.Settings.render();
    if (page === 'tasks') global.Tasks.render();
    const vp = U.$('#viewport');
    if (vp && !(opts && opts.keepScroll)) {
      const active = U.$('.page.is-active');
      if (active) active.scrollTop = 0;
    }
  }

  /* ========================= 主题 ========================= */
  function applyTheme() {
    const st = S.settings;
    let theme = st.theme || 'light';
    if (theme === 'auto') {
      theme = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0D100F' : '#F5F6F3');
    // 顶栏按钮：深色时显示太阳（点一下变亮），浅色时显示月亮
    const btn = U.$('#themeBtn');
    if (btn) btn.innerHTML = theme === 'dark' ? U.icon('sun') : U.icon('moon');
    if (global.AndroidBridge && global.AndroidBridge.setDark) {
      try { global.AndroidBridge.setDark(theme === 'dark'); } catch (e) {}
    }
  }

  function toggleTheme() {
    const cur = S.settings.theme === 'auto'
      ? (document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark')
      : (S.settings.theme === 'dark' ? 'light' : 'dark');
    S.setSetting('theme', cur);
    U.haptic('light');
  }

  /* ========================= 首启示例数据 ========================= */
  function seedIfNeeded() {
    if (S.state.seeded) return;
    const tmr = U.startOfDay() + U.DAY_MS;
    const samples = [
      { title: '明天 10:00 交实验报告', q: 1, est: 2, due: tmr + 10 * 3600000, note: '先补数据图，再写结论' },
      { title: '整理高数错题 · 第 3 章', q: 2, est: 3, pinned: true, note: '多元函数求导，重点是链式法则' },
      { title: '蓝桥杯算法训练 × 3 题', q: 2, est: 2, due: tmr + 21 * 3600000 },
      { title: '回班长消息：确认组队名单', q: 3, est: 0 },
      { title: '刷短视频 30 分钟', q: 4, est: 0 }
    ];
    samples.forEach(function (s) { S.addTask(s); });
    S.addTodo('背 50 个考研单词');
    S.addTodo('跑步 3 公里');
    S.addGoal('蓝桥杯省一');
    S.state.seeded = true;
    S.saveNow();
  }

  /* ========================= 全量刷新 ========================= */
  const renderAll = U.debounce(function () {
    global.Tasks.render();
    global.Todo.render();
    global.Focus.render();
    global.Stats.render();
    global.Settings.render();
    updateTop();
  }, 40);

  /* ========================= 原生返回键 ========================= */
  function handleBack() {
    if (global.Focus.isDeep()) { global.Focus.exitDeep(false); return true; }
    if (U.$('.sheet.is-open')) { global.Sheet.closeAll(); return true; }
    if (currentPage !== 'tasks') { go('tasks'); return true; }
    return false; // 交回原生：退出 App
  }

  /* ========================= 事件 ========================= */
  function bind() {
    // 底部导航
    U.$('#tabbar').addEventListener('click', function (e) {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      go(tab.dataset.page);
      U.haptic('light');
    });

    // 昼夜切换
    U.$('#themeBtn').addEventListener('click', toggleTheme);

    // 系统主题变化
    if (global.matchMedia) {
      const mq = global.matchMedia('(prefers-color-scheme: dark)');
      const onChange = function () { if (S.settings.theme === 'auto') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    // 数据变化 → 重绘
    S.on('change', function (meta) {
      if (meta && meta.type === 'settings' && (meta.key === 'theme')) {
        setTimeout(applyTheme, 0);
      }
      renderAll();
    });

    // 回到前台：刷新一次（后台计时已在时间戳层面准确，这里只同步界面）
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        global.Focus.renderTimer();
        global.Focus.render();
        updateTop();
      }
    });

    // 键盘：Esc 关闭面板 / 退出深度专注
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (global.Focus.isDeep()) { global.Focus.exitDeep(false); return; }
        if (U.$('.sheet.is-open')) global.Sheet.closeAll();
      }
    });

    // 禁止双击缩放（部分 WebView 仍会响应）
    let lastTouch = 0;
    document.addEventListener('touchend', function (e) {
      const now = Date.now();
      if (now - lastTouch < 300) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  }

  /* ========================= 启动 ========================= */
  function boot() {
    S.init();
    applyTheme();
    bind();

    global.Tasks.init();
    global.Todo.init();
    global.Focus.init();
    global.Stats.init();
    global.Settings.init();

    seedIfNeeded();
    go('tasks');
    renderAll();

    // 直达入口（便于调试 / 分享到某个页面）：index.html?page=stats&theme=dark
    try {
      const qs = new URLSearchParams(location.search);
      const p = qs.get('page');
      if (p && PAGE_META[p]) go(p);
      const th = qs.get('theme');
      if (th === 'dark' || th === 'light') { S.setSetting('theme', th); applyTheme(); }
    } catch (e) { /* 老 WebView 不支持 URLSearchParams 时忽略 */ }

    // 暴露给原生 WebView 调用
    global.onAndroidBack = function () { return handleBack() ? '1' : '0'; };
    global.FocusApp = {
      go: go,
      handleBack: handleBack,
      // 原生壳回到前台时调用：后台计时靠时间戳本来就准，这里只把界面同步过来
      onResume: function () {
        try {
          global.Focus.renderTimer();
          if (!global.Focus.isDeep || !global.Focus.isDeep()) {
            global.Focus.render();
            updateTop();
          }
        } catch (e) { /* 页面前端未就绪时忽略 */ }
      }
    };

    // PWA：仅在浏览器里注册；APP 内（assets 虚拟站点）不需要 Service Worker
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && !global.AndroidBridge) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存失败不影响主流程 */ });
    }

    // 首次进入给一句提示
    setTimeout(function () {
      if (!S.state.tasks.length) U.toast('按住任务卡片可拖动排序，拖到别的象限可以换区');
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
