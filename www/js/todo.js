/* =========================================================================
 * todo.js — 日程 & 待办闭环
 *  · 打卡条（连续天数 + 最近 7 天）
 *  · 今日重点（置顶任务 + 今天到期的任务）
 *  · 日常待办清单（回车即存，勾选即完成）
 *  · 长期目标（进度推进 / 100% 自动归档）
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  let showArchived = false;

  /* ========================= 打卡条 ========================= */
  function renderCheckin() {
    const el = U.$('#checkinCard');
    if (!el) return;
    const streak = S.streak();
    const today = U.startOfDay();
    let dots = '';
    for (let i = 6; i >= 0; i--) {
      const ts = U.addDays(today, -i);
      const on = S.isCheckinDay(ts) ? ' is-on' : '';
      const isToday = i === 0 ? ' is-today' : '';
      dots += '<span class="checkin__day' + on + isToday + '" title="' + U.dayKey(ts) + '"></span>';
    }
    el.innerHTML =
      '<div class="checkin__left">' +
        '<div class="checkin__streak"><span class="checkin__num">' + streak + '</span>' +
          '<span class="checkin__unit">天</span></div>' +
        '<div class="checkin__label">连续打卡</div>' +
      '</div>' +
      '<div class="checkin__days">' + dots + '</div>';
  }

  /* ========================= 今日重点 ========================= */
  function todayFocusTasks() {
    const todayEnd = U.startOfDay() + U.DAY_MS;
    const list = S.tasks.filter(function (t) {
      if (t.done) return false;
      if (t.pinned) return true;
      return t.due && t.due < todayEnd;
    });
    return list.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const ad = a.due || Infinity, bd = b.due || Infinity;
      return ad - bd;
    });
  }

  function renderTodayFocus() {
    const el = U.$('#todayFocus');
    if (!el) return;
    const list = todayFocusTasks();
    if (!list.length) {
      el.innerHTML = '<div class="empty-hint">还没有今日重点。在四象限里把任务设为「置顶」，它就会出现在这里。</div>';
      return;
    }
    el.innerHTML = list.map(function (t) {
      const m = U.quad(t.q);
      return '<div class="focus-item" data-task="' + t.id + '">' +
        '<button class="task__check" data-act="done" type="button" aria-label="完成">' + U.icon('check') + '</button>' +
        '<span class="focus-item__title" data-act="edit">' + U.escapeHtml(t.title) + '</span>' +
        '<span class="pick-row__dot" style="background:var(--' + m.cls + ')"></span>' +
        (t.due ? '<span class="task__tag' + (U.isOverdue(t.due) ? ' is-due' : '') + '" style="font-size:10px;color:var(--ink-3)">' +
          U.escapeHtml(U.fmtDue(t.due)) + '</span>' : '') +
      '</div>';
    }).join('');
  }

  /* ========================= 待办清单 ========================= */
  function renderTodos() {
    const el = U.$('#todoList');
    const meta = U.$('#todoCount');
    if (!el) return;
    const list = S.state.todos.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return b.createdAt - a.createdAt;
    });
    const undone = list.filter(function (t) { return !t.done; }).length;
    if (meta) meta.textContent = list.length ? undone + ' 项待办 / 共 ' + list.length + ' 项' : '';

    // 只展示今天和昨天之后创建的，避免无限堆积
    const recent = list.filter(function (t) { return !t.done || (t.doneAt || t.createdAt) > U.startOfDay() - 2 * U.DAY_MS; });

    if (!recent.length) {
      el.innerHTML = '<div class="empty-hint">今天没有待办。想起什么就写在下面，回车保存。</div>';
      return;
    }
    el.innerHTML = recent.map(function (t) {
      return '<div class="todo-item' + (t.done ? ' is-done' : '') + '" data-id="' + t.id + '">' +
        '<button class="task__check' + (t.done ? ' is-on' : '') + '" data-act="toggle" type="button" aria-label="完成">' +
          U.icon('check') + '</button>' +
        '<span class="todo-item__title">' + U.escapeHtml(t.title) + '</span>' +
        '<button class="todo-item__del" data-act="del" type="button" aria-label="删除">' + U.icon('x') + '</button>' +
      '</div>';
    }).join('');
  }

  /* ========================= 长期目标 ========================= */
  function renderGoals() {
    const el = U.$('#goalList');
    const meta = U.$('#goalCount');
    if (!el) return;
    const all = S.state.goals.slice().sort(function (a, b) {
      if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
      return b.createdAt - a.createdAt;
    });
    const active = all.filter(function (g) { return !g.archived; });
    const archived = all.filter(function (g) { return g.archived; });
    if (meta) {
      meta.innerHTML = active.length + ' 个进行中' + (archived.length
        ? ' · <span id="toggleArchived" style="color:var(--accent)">' + (showArchived ? '收起归档' : '查看归档 ' + archived.length) + '</span>'
        : '');
    }

    const shown = showArchived ? all : active;
    if (!shown.length) {
      el.innerHTML = '<div class="empty-hint">还没有长期目标。写一个真正想达成的事，比如「蓝桥杯省一」。</div>';
      return;
    }
    el.innerHTML = shown.map(function (g) {
      const pct = U.clamp(g.progress || 0, 0, 100);
      const days = Math.max(1, Math.round((Date.now() - g.createdAt) / U.DAY_MS));
      return '<div class="goal-item" data-id="' + g.id + '" style="opacity:' + (g.archived ? .55 : 1) + '">' +
        '<div style="flex:1;min-width:0">' +
          '<div class="goal-item__title">' + U.escapeHtml(g.title) + (g.archived ? ' · 已归档' : '') + '</div>' +
          '<div class="goal-item__bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="goal-item__meta">进度 ' + pct + '% · 已坚持 ' + days + ' 天</div>' +
        '</div>' +
        (g.archived
          ? '<button class="goal-item__del" data-act="restore" type="button" style="font-size:11px;color:var(--accent)">恢复</button>'
          : '<button class="goal-item__del" data-act="step" type="button" style="font-size:11px;color:var(--accent)">+10%</button>') +
        '<button class="goal-item__del" data-act="del" type="button" aria-label="删除">' + U.icon('x') + '</button>' +
      '</div>';
    }).join('');
  }

  /* ========================= 渲染入口 ========================= */
  function render() {
    renderCheckin();
    renderTodayFocus();
    renderTodos();
    renderGoals();
  }

  /* ========================= 事件 ========================= */
  function bind() {
    // 今日重点
    const tf = U.$('#todayFocus');
    tf.addEventListener('click', function (e) {
      const row = e.target.closest('[data-task]');
      if (!row) return;
      const id = row.dataset.task;
      if (e.target.closest('[data-act="done"]')) {
        S.toggleTask(id, true);
        U.haptic('success');
        U.toast('完成，继续保持');
      } else if (e.target.closest('[data-act="edit"]')) {
        global.Tasks.openEdit(id);
      }
    });

    // 待办
    const tl = U.$('#todoList');
    tl.addEventListener('click', function (e) {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('[data-act="del"]')) {
        S.deleteTodo(id);
        U.haptic('light');
      } else {
        S.toggleTodo(id);
        U.haptic('success');
      }
    });

    U.$('#todoForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = U.$('#todoInput');
      if (!input.value.trim()) return;
      S.addTodo(input.value);
      input.value = '';
      input.blur();
      U.haptic('light');
    });

    // 目标
    const gl = U.$('#goalList');
    gl.addEventListener('click', function (e) {
      if (e.target.id === 'toggleArchived') {
        showArchived = !showArchived;
        renderGoals();
        return;
      }
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('[data-act="step"]')) {
        S.stepGoal(id, 10);
        U.haptic('light');
        const g = S.state.goals.find(function (x) { return x.id === id; });
        if (g && g.progress >= 100) U.toast('目标达成，已归档');
      } else if (e.target.closest('[data-act="restore"]')) {
        S.archiveGoal(id);
      } else if (e.target.closest('[data-act="del"]')) {
        if (window.confirm('删除这个目标？')) S.deleteGoal(id);
      }
    });

    U.$('#goalForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = U.$('#goalInput');
      if (!input.value.trim()) return;
      S.addGoal(input.value);
      input.value = '';
      input.blur();
      U.haptic('light');
    });
  }

  function init() {
    bind();
    render();
  }

  global.Todo = { init: init, render: render };
})(window);
