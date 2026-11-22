/* =========================================================================
 * store.js — 数据层
 * 单一数据源 + localStorage 持久化（防丢失：写入去抖 + 页面隐藏立刻落盘）
 * 全部数据留在本地，不联网、不上传。
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.U;
  const KEY = 'focus.study.v1';
  const VERSION = 1;

  const DEFAULT_SETTINGS = {
    focusMin: 25,          // 专注时长
    breakMin: 5,           // 短休息
    longBreakMin: 15,      // 长休息
    roundsBeforeLong: 4,   // 几轮后长休息
    autoBreak: true,       // 结束后自动进入休息
    notify: true,          // 结束震动 + 提示音
    vibrate: true,
    sound: true,
    theme: 'light',        // light | dark | auto
    deepTone: 'white',     // white | black
    statsRange: 'week'     // day | week | month
  };

  function emptyState() {
    return {
      version: VERSION,
      createdAt: Date.now(),
      tasks: [],
      todos: [],
      goals: [],
      sessions: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
      timer: null,
      seeded: false
    };
  }

  /* ----------------------------- 内部状态 ----------------------------- */
  let state = emptyState();
  const listeners = { change: [], tick: [] };
  let storageOK = true;

  /* ----------------------------- 持久化 ----------------------------- */
  function readRaw() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[store] 读取本地数据失败，将使用空数据', e);
      storageOK = false;
      return null;
    }
  }

  function writeNow() {
    if (!storageOK) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[store] 写入失败', e);
      storageOK = false;
    }
  }
  const writeSoon = U.debounce(writeNow, 260);

  /* ------------------------- 排序 ------------------------- */
  /** 显示顺序：先未完成、后已完成；同组内按 ord 升序（ord 由拖拽写入） */
  function displayOrder(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ao = a.ord == null ? Infinity : a.ord;
    const bo = b.ord == null ? Infinity : b.ord;
    if (ao !== bo) return ao - bo;
    return b.createdAt - a.createdAt;
  }

  /** 老数据没有 ord：按升级前的规则（置顶 → 截止近 → 新建早）落成一份显式顺序 */
  function normalizeOrd(tasks) {
    const groups = {};
    tasks.forEach(function (t) { (groups[t.q] || (groups[t.q] = [])).push(t); });
    Object.keys(groups).forEach(function (q) {
      const list = groups[q];
      if (list.every(function (t) { return t.ord != null; })) return;
      list.sort(function (a, b) {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const ad = a.due || Infinity, bd = b.due || Infinity;
        if (ad !== bd) return ad - bd;
        return b.createdAt - a.createdAt;
      }).forEach(function (t, i) { t.ord = (i + 1) * 10; });
    });
  }

  /** 组内最靠前的 ord 再往上挪一格：新增 / 置顶时用 */
  function topOrd(q, done, excludeId) {
    let min = Infinity;
    state.tasks.forEach(function (t) {
      if (t.q === q && !!t.done === !!done && t.id !== excludeId && typeof t.ord === 'number') {
        if (t.ord < min) min = t.ord;
      }
    });
    return min === Infinity ? 10 : min - 10;
  }

  /** 数据迁移 / 结构补全：保证旧版本数据不会因缺字段崩溃 */
  function migrate(raw) {
    const s = Object.assign(emptyState(), raw || {});
    s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    s.tasks = (s.tasks || []).filter(function (t) { return t && t.title; }).map(function (t) {
      return {
        id: t.id || U.uid('t'),
        title: String(t.title).slice(0, 120),
        note: t.note || '',
        q: U.clamp(parseInt(t.q, 10) || 2, 1, 4),
        done: !!t.done,
        pinned: !!t.pinned,
        due: t.due || null,
        est: t.est == null ? 0 : t.est,
        spent: t.spent || 0,
        ord: typeof t.ord === 'number' && isFinite(t.ord) ? t.ord : null,
        createdAt: t.createdAt || Date.now(),
        doneAt: t.doneAt || null
      };
    });
    normalizeOrd(s.tasks);
    s.todos = (s.todos || []).filter(function (t) { return t && t.title; });
    s.goals = (s.goals || []).filter(function (g) { return g && g.title; });
    s.sessions = (s.sessions || []).filter(function (x) { return x && x.start; });
    s.version = VERSION;
    return s;
  }

  /* ----------------------------- 事件 ----------------------------- */
  function on(evt, fn) {
    (listeners[evt] || (listeners[evt] = [])).push(fn);
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error('[store] listener error', e); }
    });
  }
  function changed(meta) {
    writeSoon();
    emit('change', meta || {});
  }

  /* ============================ 任务 ============================ */
  function addTask(data) {
    const task = {
      id: U.uid('t'),
      title: String(data.title || '').trim().slice(0, 120),
      note: String(data.note || '').slice(0, 400),
      q: U.clamp(data.q || 2, 1, 4),
      done: false,
      pinned: !!data.pinned,
      due: data.due || null,
      est: data.est == null ? 0 : U.clamp(data.est, 0, 24),
      spent: 0,
      createdAt: Date.now(),
      doneAt: null
    };
    if (!task.title) return null;
    task.ord = topOrd(task.q, false, null);   // 新任务落在未完成组最前面
    state.tasks.unshift(task);
    changed({ type: 'task:add', task: task });
    return task;
  }

  function updateTask(id, patch) {
    const t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return null;
    const wasPinned = !!t.pinned;
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    // 新置顶：浮到所在组的最前面（之后仍可用拖拽自由调整）
    if (!wasPinned && t.pinned) t.ord = topOrd(t.q, t.done, t.id);
    changed({ type: 'task:update', task: t });
    return t;
  }

  function deleteTask(id) {
    const i = state.tasks.findIndex(function (x) { return x.id === id; });
    if (i < 0) return;
    state.tasks.splice(i, 1);
    if (state.timer && state.timer.taskId === id) state.timer.taskId = null;
    changed({ type: 'task:delete', id: id });
  }

  function toggleTask(id, force) {
    const t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    t.done = force == null ? !t.done : !!force;
    t.doneAt = t.done ? Date.now() : null;
    changed({ type: 'task:toggle', task: t });
  }

  function moveTask(id, q) {
    const t = state.tasks.find(function (x) { return x.id === id; });
    if (!t || t.q === q) return;
    t.q = U.clamp(q, 1, 4);
    changed({ type: 'task:move', task: t });
  }

  function togglePin(id) {
    const t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    t.pinned = !t.pinned;
    // 置顶＝一键浮到所在组的最前面，之后仍可用拖拽自由调整
    if (t.pinned) t.ord = topOrd(t.q, t.done, t.id);
    changed({ type: 'task:pin', task: t });
  }

  /**
   * 拖拽排序：把任务放到象限 q 的 beforeId 之前（beforeId 为空＝放到组末）。
   * 完成 / 未完成为两个分组，落点自动吸附到所属分组的边界内。
   * 返回是否真的发生了变化。
   */
  function reorderTask(id, q, beforeId) {
    const t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return false;
    const targetQ = U.clamp(parseInt(q, 10) || t.q, 1, 4);
    const prevQ = t.q;

    const list = state.tasks
      .filter(function (x) { return x.q === targetQ && x.id !== id; })
      .sort(displayOrder);

    let idx = list.length;
    if (beforeId) {
      const j = list.findIndex(function (x) { return x.id === beforeId; });
      if (j >= 0) idx = j;
    }
    // 不允许跨「完成状态」分组落位
    const openCount = list.filter(function (x) { return !x.done; }).length;
    const from = t.done ? openCount : 0;
    const to = t.done ? list.length : openCount;
    idx = U.clamp(idx, from, to);

    const beforeOrder = state.tasks
      .filter(function (x) { return x.q === targetQ; })
      .sort(displayOrder)
      .map(function (x) { return x.id; })
      .join('|');

    list.splice(idx, 0, t);
    t.q = targetQ;
    list.forEach(function (x, i) { x.ord = (i + 1) * 10; });

    const afterOrder = list.map(function (x) { return x.id; }).join('|');
    if (prevQ === targetQ && beforeOrder === afterOrder) return false;

    changed({ type: 'task:reorder', task: t });
    return true;
  }

  /* ============================ 待办 ============================ */
  function addTodo(title) {
    const text = String(title || '').trim().slice(0, 60);
    if (!text) return null;
    const todo = { id: U.uid('td'), title: text, done: false, createdAt: Date.now(), day: U.dayKey() };
    state.todos.unshift(todo);
    changed({ type: 'todo:add' });
    return todo;
  }
  function toggleTodo(id) {
    const t = state.todos.find(function (x) { return x.id === id; });
    if (!t) return;
    t.done = !t.done;
    if (t.done) t.doneAt = Date.now();
    changed({ type: 'todo:toggle' });
  }
  function deleteTodo(id) {
    const i = state.todos.findIndex(function (x) { return x.id === id; });
    if (i < 0) return;
    state.todos.splice(i, 1);
    changed({ type: 'todo:delete' });
  }

  /* ============================ 长期目标 ============================ */
  function addGoal(title) {
    const text = String(title || '').trim().slice(0, 60);
    if (!text) return null;
    const goal = { id: U.uid('g'), title: text, progress: 0, archived: false, createdAt: Date.now() };
    state.goals.unshift(goal);
    changed({ type: 'goal:add' });
    return goal;
  }
  function stepGoal(id, delta) {
    const g = state.goals.find(function (x) { return x.id === id; });
    if (!g) return;
    g.progress = U.clamp((g.progress || 0) + delta, 0, 100);
    if (g.progress >= 100) g.archived = true;
    changed({ type: 'goal:step' });
  }
  function archiveGoal(id) {
    const g = state.goals.find(function (x) { return x.id === id; });
    if (!g) return;
    g.archived = !g.archived;
    changed({ type: 'goal:archive' });
  }
  function deleteGoal(id) {
    const i = state.goals.findIndex(function (x) { return x.id === id; });
    if (i < 0) return;
    state.goals.splice(i, 1);
    changed({ type: 'goal:delete' });
  }

  /* ============================ 专注记录 ============================ */
  /** @param {{mode:'pomodoro'|'deep'|'break', minutes:number, start:number, end:number, taskId?:string, completed?:boolean}} s */
  function addSession(s) {
    if (!s || !(s.minutes > 0)) return null;
    const session = {
      id: U.uid('s'),
      mode: s.mode || 'pomodoro',
      minutes: Math.round(s.minutes * 10) / 10,
      start: s.start || Date.now() - s.minutes * 60000,
      end: s.end || Date.now(),
      taskId: s.taskId || null,
      completed: s.completed !== false
    };
    state.sessions.unshift(session);
    // 只保留最近 180 天，避免无限膨胀
    const cutoff = U.startOfDay() - 180 * U.DAY_MS;
    state.sessions = state.sessions.filter(function (x) { return x.end >= cutoff; });

    // 挂到任务上的专注时间累计
    if (session.taskId && session.mode !== 'break') {
      const t = state.tasks.find(function (x) { return x.id === session.taskId; });
      if (t) t.spent = (t.spent || 0) + session.minutes;
    }
    changed({ type: 'session:add', session: session });
    return session;
  }

  /* ============================ 计时器快照 ============================ */
  function setTimer(snapshot) {
    state.timer = snapshot;
    changed({ type: 'timer' });
  }

  /* ============================ 设置 ============================ */
  function setSetting(key, value) {
    state.settings[key] = value;
    changed({ type: 'settings', key: key, value: value });
  }

  /* ============================ 统计查询 ============================ */
  function sessionsBetween(from, to) {
    return state.sessions.filter(function (s) { return s.end >= from && s.end < to; });
  }
  function focusMinutesBetween(from, to) {
    return sessionsBetween(from, to)
      .filter(function (s) { return s.mode !== 'break'; })
      .reduce(function (sum, s) { return sum + s.minutes; }, 0);
  }
  function pomodoroCountBetween(from, to) {
    return sessionsBetween(from, to).filter(function (s) {
      return s.mode === 'pomodoro' && s.completed;
    }).length;
  }
  function tasksDoneBetween(from, to) {
    return state.tasks.filter(function (t) { return t.done && t.doneAt >= from && t.doneAt < to; }).length;
  }
  /** 某天是否有打卡（有 ≥10 分钟专注 或 完成过任务） */
  function isCheckinDay(dayTs) {
    const from = U.startOfDay(dayTs), to = from + U.DAY_MS;
    if (focusMinutesBetween(from, to) >= 10) return true;
    return state.tasks.some(function (t) { return t.done && t.doneAt >= from && t.doneAt < to; });
  }
  function streak() {
    let n = 0;
    let cursor = U.startOfDay();
    // 今天还没打卡不算断，从今天开始往前数
    if (!isCheckinDay(cursor)) cursor = U.addDays(cursor, -1);
    while (isCheckinDay(cursor) && n < 999) { n++; cursor = U.addDays(cursor, -1); }
    return n;
  }
  function totalFocusMinutes() {
    return state.sessions.filter(function (s) { return s.mode !== 'break'; })
      .reduce(function (a, s) { return a + s.minutes; }, 0);
  }

  /* ============================ 导入 / 导出 / 重置 ============================ */
  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }
  function importJSON(text) {
    const raw = JSON.parse(text);
    state = migrate(raw);
    writeNow();
    emit('change', { type: 'import' });
    return true;
  }
  function reset() {
    state = emptyState();
    writeNow();
    emit('change', { type: 'reset' });
  }

  /* ============================ 初始化 ============================ */
  function init() {
    const raw = readRaw();
    state = migrate(raw);
    // 页面隐藏 / 退出前强制落盘，尽量避免丢数据
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') writeNow();
    });
    global.addEventListener('pagehide', writeNow);
    global.addEventListener('beforeunload', writeNow);
    return state;
  }

  /* ============================ 对外 API ============================ */
  global.Store = {
    init: init,
    on: on,
    emit: emit,
    saveNow: writeNow,
    get state() { return state; },
    get tasks() { return state.tasks; },
    get settings() { return state.settings; },
    addTask: addTask, updateTask: updateTask, deleteTask: deleteTask,
    toggleTask: toggleTask, moveTask: moveTask, togglePin: togglePin,
    reorderTask: reorderTask, displayOrder: displayOrder,
    addTodo: addTodo, toggleTodo: toggleTodo, deleteTodo: deleteTodo,
    addGoal: addGoal, stepGoal: stepGoal, archiveGoal: archiveGoal, deleteGoal: deleteGoal,
    addSession: addSession, setTimer: setTimer, setSetting: setSetting,
    sessionsBetween: sessionsBetween, focusMinutesBetween: focusMinutesBetween,
    pomodoroCountBetween: pomodoroCountBetween, tasksDoneBetween: tasksDoneBetween,
    isCheckinDay: isCheckinDay, streak: streak, totalFocusMinutes: totalFocusMinutes,
    exportJSON: exportJSON, importJSON: importJSON, reset: reset
  };
})(window);
