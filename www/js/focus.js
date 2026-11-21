/* =========================================================================
 * focus.js — 专注系统
 *  1) 番茄钟：自定义时长、后台准确计时、暂停/恢复、自动休息、结束温和提醒
 *  2) 深度专注：全屏纯色护眼、无倒计时干扰、长按结束、记录纯专注时长
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  const RING_R = 136;
  const RING_C = 2 * Math.PI * RING_R;

  /* ========================= 番茄钟状态 ========================= */
  const T = {
    mode: null,        // 'focus' | 'break'
    running: false,
    totalMs: 0,
    endAt: 0,
    remainMs: 0,
    rounds: 0,         // 已完成的专注轮数（本轮循环内）
    taskId: null,
    ticker: null
  };

  let wakeLock = null;
  let deep = { active: false, start: 0, limitMin: 0, timer: null, holdTimer: null, revealed: false };
  let lastNotifiedMode = '';

  /* ========================= 工具 ========================= */
  function circ() {
    const bar = U.$('#ringBar');
    if (bar) {
      bar.style.strokeDasharray = RING_C;
      bar.style.strokeDashoffset = RING_C;
    }
  }

  function setRing(progress) {
    const bar = U.$('#ringBar');
    if (!bar) return;
    const p = U.clamp(progress, 0, 1);
    bar.style.strokeDashoffset = RING_C * (1 - p);
  }

  function minutesForMode(mode) {
    const st = S.settings;
    if (mode === 'break') {
      const isLong = T.rounds > 0 && T.rounds % Math.max(1, st.roundsBeforeLong) === 0;
      return isLong ? st.longBreakMin : st.breakMin;
    }
    return st.focusMin;
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) { /* 静默失败：部分 WebView 不支持 */ }
    if (global.AndroidBridge && global.AndroidBridge.keepScreenOn) {
      try { global.AndroidBridge.keepScreenOn(true); } catch (e) {}
    }
  }
  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
    if (global.AndroidBridge && global.AndroidBridge.keepScreenOn) {
      try { global.AndroidBridge.keepScreenOn(false); } catch (e) {}
    }
  }

  /* ========================= 计时核心 ========================= */
  function start(mode, minutesOverride) {
    const minutes = minutesOverride || minutesForMode(mode);
    T.mode = mode;
    T.totalMs = minutes * 60000;
    T.remainMs = T.totalMs;
    T.endAt = Date.now() + T.remainMs;
    T.running = true;
    lastNotifiedMode = '';
    requestWakeLock();
    loop();
    renderTimer();
    persist();
    U.haptic('light');
    if (mode === 'focus') U.beep('focus');
  }

  function resume() {
    if (!T.mode) return;
    T.endAt = Date.now() + T.remainMs;
    T.running = true;
    requestWakeLock();
    loop();
    renderTimer();
    persist();
  }

  function pause() {
    if (!T.running) return;
    T.remainMs = Math.max(0, T.endAt - Date.now());
    T.running = false;
    stopLoop();
    renderTimer();
    persist();
    U.haptic('light');
  }

  function stop(silent) {
    if (T.mode && T.running) {
      // 中断：按实际已专注时长记录（≥1 分钟才算）
      const elapsedMs = T.totalMs - Math.max(0, T.endAt - Date.now());
      const mins = Math.round(elapsedMs / 6000) / 10;
      if (T.mode === 'focus' && mins >= 1) {
        S.addSession({ mode: 'pomodoro', minutes: mins, start: Date.now() - elapsedMs, end: Date.now(), taskId: T.taskId, completed: false });
      }
    }
    T.mode = null; T.running = false; T.totalMs = 0; T.remainMs = 0; T.endAt = 0;
    stopLoop();
    releaseWakeLock();
    renderTimer();
    persist();
    if (!silent) U.toast('已结束本次专注');
  }

  function loop() {
    stopLoop();
    T.ticker = setInterval(tick, 250);
    tick();
  }
  function stopLoop() {
    if (T.ticker) { clearInterval(T.ticker); T.ticker = null; }
  }

  function tick() {
    if (!T.running) return;
    const left = T.endAt - Date.now();
    if (left <= 0) {
      complete();
      return;
    }
    renderTimer(left);
  }

  function complete() {
    const finishedMode = T.mode;
    const totalMs = T.totalMs;
    const taskId = T.taskId;
    stopLoop();
    T.running = false;
    T.remainMs = 0;

    if (finishedMode === 'focus') {
      S.addSession({
        mode: 'pomodoro',
        minutes: Math.round(totalMs / 60000),
        start: Date.now() - totalMs,
        end: Date.now(),
        taskId: taskId,
        completed: true
      });
      T.rounds += 1;
      if (S.settings.notify) { U.beep('focus'); U.haptic('success'); }
      U.toast('专注完成，' + (S.settings.autoBreak ? '休息一下' : '干得漂亮'));

      if (S.settings.autoBreak) {
        T.mode = null;
        setTimeout(function () { start('break'); }, 600);
      } else {
        T.mode = null;
        T.totalMs = 0;
        releaseWakeLock();
      }
    } else {
      // 休息结束
      if (S.settings.notify) { U.beep('break'); U.haptic('medium'); }
      U.toast('休息结束，继续');
      T.mode = null;
      T.totalMs = 0;
      releaseWakeLock();
    }
    renderTimer();
    persist();
    notifyNative(finishedMode);
  }

  /** 通知原生层：可以让 App 在被切到后台时也震动（可选扩展点） */
  function notifyNative(mode) {
    if (global.AndroidBridge && global.AndroidBridge.onTimerEnd) {
      try { global.AndroidBridge.onTimerEnd(mode); } catch (e) {}
    }
  }

  function persist() {
    S.setTimer(T.mode ? {
      mode: T.mode, running: T.running, endAt: T.endAt,
      remainMs: T.remainMs, totalMs: T.totalMs, rounds: T.rounds, taskId: T.taskId
    } : null);
  }

  /** 从存储恢复未结束的番茄钟（App 被杀掉后重进也能续上） */
  function restore() {
    const snap = S.state.timer;
    if (!snap || !snap.mode) return;
    T.mode = snap.mode;
    T.totalMs = snap.totalMs || 0;
    T.rounds = snap.rounds || 0;
    T.taskId = snap.taskId || null;
    if (snap.running) {
      const left = snap.endAt - Date.now();
      if (left > 1000) {
        T.endAt = snap.endAt;
        T.remainMs = left;
        T.running = true;
        requestWakeLock();
        loop();
      } else {
        // 后台期间已结束：按计划时长补记一条完整记录
        if (snap.mode === 'focus') {
          S.addSession({
            mode: 'pomodoro', minutes: Math.round((snap.totalMs || 0) / 60000),
            start: (snap.endAt || Date.now()) - (snap.totalMs || 0), end: snap.endAt || Date.now(),
            taskId: snap.taskId, completed: true
          });
          T.rounds += 1;
        }
        T.mode = null; T.running = false;
        persist();
      }
    } else {
      T.remainMs = snap.remainMs || T.totalMs;
    }
    renderTimer();
  }

  /* ========================= 番茄钟渲染 ========================= */
  function renderTimer(leftMs) {
    const timeEl = U.$('#timerTime');
    const modeEl = U.$('#timerMode');
    const hintEl = U.$('#timerHint');
    const btn = U.$('#btnToggle');
    const bar = U.$('#ringBar');
    if (!timeEl) return;

    if (!T.mode) {
      const m = S.settings.focusMin;
      timeEl.textContent = U.pad2(m) + ':00';
      modeEl.textContent = '专注';
      hintEl.textContent = '准备开始';
      btn.textContent = '开始专注';
      setRing(0);
      if (bar) bar.style.stroke = 'var(--accent)';
      renderRounds();
      renderTaskPick();
      updateTitle();
      return;
    }

    const left = leftMs != null ? leftMs : (T.running ? T.endAt - Date.now() : T.remainMs);
    const secs = Math.max(0, Math.ceil(left / 1000));
    timeEl.textContent = U.fmtClock(secs);
    const isBreak = T.mode === 'break';
    modeEl.textContent = isBreak ? '休息' : '专注';
    hintEl.textContent = T.running ? (isBreak ? '放松一下眼睛' : '保持节奏') : '已暂停';
    btn.textContent = T.running ? '暂停' : (left < T.totalMs ? '继续' : '开始专注');
    if (bar) bar.style.stroke = isBreak ? 'var(--q3)' : 'var(--accent)';
    setRing(T.totalMs ? 1 - left / T.totalMs : 0);
    renderRounds();
    renderTaskPick();
    updateTitle(secs, isBreak);
  }

  function updateTitle(secs, isBreak) {
    if (secs != null && T.running) {
      document.title = (isBreak ? '休息 ' : '') + U.fmtClock(secs) + ' · Focus';
    } else {
      document.title = 'Focus · 专注';
    }
  }

  function renderRounds() {
    const el = U.$('#roundDots');
    if (!el) return;
    const total = Math.max(1, S.settings.roundsBeforeLong || 4);
    let html = '';
    for (let i = 0; i < total; i++) {
      const doneCount = T.rounds % total;
      let cls = 'rounds__dot';
      if (i < doneCount) cls += ' is-on';
      else if (i === doneCount && T.mode === 'focus' && T.running) cls += ' is-now';
      html += '<span class="' + cls + '"></span>';
    }
    el.innerHTML = html;
  }

  function renderTaskPick() {
    const label = U.$('#taskPickLabel');
    const dot = U.$('.task-pick__dot');
    if (!label) return;
    const t = T.taskId ? S.tasks.find(function (x) { return x.id === T.taskId; }) : null;
    if (t) {
      label.textContent = t.title;
      dot.classList.add('is-on');
    } else {
      label.textContent = '未绑定任务';
      dot.classList.remove('is-on');
    }
  }

  /* ========================= 专注页其它区块 ========================= */
  function renderQuick() {
    const el = U.$('#focusQuick');
    if (!el) return;
    const st = S.settings;
    el.innerHTML = '' +
      '<div class="mini-card"><div class="mini-card__label">专注时长</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">' +
          '<span class="mini-card__val">' + st.focusMin + '<small style="font-size:11px;color:var(--ink-3)"> 分</small></span>' +
          '<div class="stepper" data-key="focusMin" data-min="10" data-max="120" data-step="5">' +
            '<button data-act="dec" type="button">−</button><button data-act="inc" type="button">+</button></div>' +
        '</div></div>' +
      '<div class="mini-card"><div class="mini-card__label">休息时长</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">' +
          '<span class="mini-card__val">' + st.breakMin + '<small style="font-size:11px;color:var(--ink-3)"> 分</small></span>' +
          '<div class="stepper" data-key="breakMin" data-min="1" data-max="30" data-step="1">' +
            '<button data-act="dec" type="button">−</button><button data-act="inc" type="button">+</button></div>' +
        '</div></div>';

    U.$$('.stepper', el).forEach(function (node) {
      const key = node.dataset.key;
      node.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        const min = +node.dataset.min, max = +node.dataset.max, step = +node.dataset.step;
        const next = U.clamp(S.settings[key] + (btn.dataset.act === 'inc' ? step : -step), min, max);
        if (next === S.settings[key]) return;
        S.setSetting(key, next);
        U.haptic('light');
      });
    });
  }

  function renderTodaySessions() {
    const el = U.$('#sessionList');
    const totalEl = U.$('#todayFocusTotal');
    if (!el) return;
    const from = U.startOfDay(), to = from + U.DAY_MS;
    const list = S.sessionsBetween(from, to).slice().sort(function (a, b) { return b.end - a.end; });
    const total = list.filter(function (s) { return s.mode !== 'break'; })
      .reduce(function (a, s) { return a + s.minutes; }, 0);
    if (totalEl) totalEl.textContent = total ? U.fmtMinutes(total) + ' · ' + list.filter(function (s) { return s.mode === 'pomodoro' && s.completed; }).length + ' 个番茄' : '还没有记录';

    if (!list.length) {
      el.innerHTML = '<div class="empty-hint">今天还没有专注记录，从 25 分钟开始</div>';
      return;
    }
    el.innerHTML = list.slice(0, 8).map(function (s) {
      const t = s.taskId ? S.tasks.find(function (x) { return x.id === s.taskId; }) : null;
      const isBreak = s.mode === 'break';
      const name = isBreak ? '休息' : (t ? t.title : (s.mode === 'deep' ? '深度专注' : '自由专注'));
      const iconName = isBreak ? 'clock' : (s.mode === 'deep' ? 'deep' : 'tomato');
      const d = new Date(s.end);
      return '' +
        '<div class="session">' +
          '<span class="session__icon session__icon--' + (isBreak ? 'deep' : s.mode) + '">' + U.icon(iconName) + '</span>' +
          '<div class="session__main">' +
            '<div class="session__name">' + U.escapeHtml(name) + '</div>' +
            '<div class="session__time">' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()) +
              (s.completed ? ' · 已完成' : ' · 中断') + '</div>' +
          '</div>' +
          '<span class="session__len">' + s.minutes + '′</span>' +
        '</div>';
    }).join('');
  }

  function renderDeepStats() {
    const el = U.$('#deepStats');
    if (!el) return;
    const from = U.startOfDay(), to = from + U.DAY_MS;
    const wkFrom = U.startOfWeek();
    const sum = function (a, b) {
      return S.sessionsBetween(a, b).filter(function (s) { return s.mode === 'deep'; })
        .reduce(function (x, s) { return x + s.minutes; }, 0);
    };
    const today = sum(from, to);
    const week = sum(wkFrom, wkFrom + 7 * U.DAY_MS);
    const all = S.state.sessions.filter(function (s) { return s.mode === 'deep'; })
      .reduce(function (x, s) { return x + s.minutes; }, 0);
    const cell = function (v, label) {
      return '<div class="stat-cell"><div class="stat-cell__val">' +
        (v >= 60 ? (v / 60).toFixed(1) + 'h' : Math.round(v) + '′') +
        '</div><div class="stat-cell__label">' + label + '</div></div>';
    };
    el.innerHTML = cell(today, '今日') + cell(week, '本周') + cell(all, '累计');
  }

  /* ========================= 深度专注 ========================= */
  function enterDeep() {
    const layer = U.$('#deepLayer');
    const limitBtn = U.$('#deepDuration .chip.is-active');
    const limitMin = limitBtn ? parseInt(limitBtn.dataset.min, 10) || 0 : 0;

    deep.active = true;
    deep.start = Date.now();
    deep.limitMin = limitMin;
    deep.revealed = false;
    lastNotifiedMode = '';

    layer.dataset.tone = S.settings.deepTone === 'black' ? 'black' : 'white';
    layer.classList.add('is-open');
    layer.classList.remove('is-revealed');
    layer.setAttribute('aria-hidden', 'false');
    U.$('#deepHint').textContent = '长按 2 秒结束';
    U.$('#deepLabel').textContent = limitMin ? limitMin + ' 分钟目标' : '专注中';
    U.$('#deepTime').textContent = '';

    requestWakeLock();
    if (global.AndroidBridge && global.AndroidBridge.immersive) {
      try { global.AndroidBridge.immersive(true); } catch (e) {}
    }
    U.haptic('medium');
    renderDeepTime();
    deep.timer = setInterval(renderDeepTime, 1000);
  }

  function renderDeepTime() {
    if (!deep.active) return;
    const mins = Math.floor((Date.now() - deep.start) / 60000);
    const secs = Math.floor((Date.now() - deep.start) / 1000) % 60;
    const el = U.$('#deepTime');
    if (el && deep.revealed) el.textContent = U.pad2(mins) + ':' + U.pad2(secs);

    // 到点自动结束（只震动一次，不显示倒计时）
    if (deep.limitMin > 0 && lastNotifiedMode !== 'deep-end') {
      const left = deep.limitMin * 60000 - (Date.now() - deep.start);
      if (left <= 0) {
        lastNotifiedMode = 'deep-end';
        exitDeep(true);
      }
    }
  }

  function toggleDeepReveal() {
    if (!deep.active) return;
    deep.revealed = !deep.revealed;
    const layer = U.$('#deepLayer');
    layer.classList.toggle('is-revealed', deep.revealed);
    renderDeepTime();
    if (deep.revealed) {
      clearTimeout(toggleDeepReveal._t);
      toggleDeepReveal._t = setTimeout(function () {
        deep.revealed = false;
        layer.classList.remove('is-revealed');
      }, 3200);
    }
  }

  function exitDeep(auto) {
    if (!deep.active) return;
    const ms = Date.now() - deep.start;
    const minutes = Math.round(ms / 6000) / 10;
    deep.active = false;
    clearInterval(deep.timer);
    deep.timer = null;

    const layer = U.$('#deepLayer');
    layer.classList.remove('is-open', 'is-revealed');
    layer.setAttribute('aria-hidden', 'true');
    releaseWakeLock();
    if (global.AndroidBridge && global.AndroidBridge.immersive) {
      try { global.AndroidBridge.immersive(false); } catch (e) {}
    }

    if (minutes >= 1) {
      S.addSession({ mode: 'deep', minutes: minutes, start: Date.now() - ms, end: Date.now(), completed: true });
      U.toast('本次深度专注 ' + U.fmtMinutes(minutes) + (auto ? '，目标达成' : '，已记录'));
      if (S.settings.notify) { U.beep('focus'); U.haptic('success'); }
    } else {
      U.toast('时间太短，未记录');
    }
  }

  /* ========================= 事件绑定 ========================= */
  function bind() {
    circ();

    const btn = U.$('#btnToggle');
    btn.addEventListener('click', function () {
      U.haptic('light');
      if (!T.mode) { start('focus'); return; }
      if (T.running) pause(); else resume();
    });

    U.$('#btnReset').addEventListener('click', function () {
      if (!T.mode && T.rounds === 0) return;
      stop(true);
      T.rounds = 0;
      renderTimer();
      persist();
      U.toast('已重置');
    });

    U.$('#taskPick').addEventListener('click', function () {
      global.Tasks.pickTask(T.taskId, function (id) {
        T.taskId = id;
        renderTaskPick();
        persist();
      });
    });

    // 番茄 / 深度 切换
    U.$('#focusSeg').addEventListener('click', function (e) {
      const b = e.target.closest('.seg__btn');
      if (!b) return;
      U.$$('.seg__btn', U.$('#focusSeg')).forEach(function (x) { x.classList.toggle('is-active', x === b); });
      const mode = b.dataset.mode;
      U.$('#pomodoroPane').hidden = mode !== 'pomodoro';
      U.$('#deepPane').hidden = mode !== 'deep';
    });

    // 深度专注时长
    U.$('#deepDuration').addEventListener('click', function (e) {
      const b = e.target.closest('.chip');
      if (!b) return;
      U.$$('.chip', U.$('#deepDuration')).forEach(function (x) { x.classList.toggle('is-active', x === b); });
      U.haptic('light');
    });

    U.$('#btnDeepStart').addEventListener('click', enterDeep);

    // 深度层：轻点显示时间，长按 2 秒退出
    const layer = U.$('#deepLayer');
    const hint = U.$('#deepHint');
    let startX = 0, startY = 0, moved = false;

    layer.addEventListener('pointerdown', function (e) {
      startX = e.clientX; startY = e.clientY; moved = false;
      hint.classList.add('is-holding');
      deep.holdTimer = setTimeout(function () {
        if (moved) return;
        hint.classList.remove('is-holding');
        exitDeep(false);
      }, 2000);
    });
    layer.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12) {
        moved = true;
        clearTimeout(deep.holdTimer);
        hint.classList.remove('is-holding');
      }
    });
    layer.addEventListener('pointerup', function (e) {
      clearTimeout(deep.holdTimer);
      hint.classList.remove('is-holding');
      if (!moved && deep.active) toggleDeepReveal();
    });
    layer.addEventListener('pointercancel', function () {
      clearTimeout(deep.holdTimer);
      hint.classList.remove('is-holding');
    });

    // 深度底色设置变化时同步
    global.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && deep.active) exitDeep(false);
    });
  }

  /* ========================= 渲染入口 ========================= */
  function render() {
    renderQuick();
    renderTodaySessions();
    renderDeepStats();
    renderTimer();
  }

  function init() {
    bind();
    restore();
    render();
  }

  global.Focus = {
    init: init,
    render: render,
    renderTimer: renderTimer,
    start: start,
    stop: stop,
    isRunning: function () { return T.running; },
    isDeep: function () { return deep.active; },
    exitDeep: exitDeep,
    /** 供原生返回键调用：返回 true 表示事件已被消费 */
    handleBack: function () {
      if (deep.active) { exitDeep(false); return true; }
      if (U.$('#taskSheet').classList.contains('is-open') || U.$('#pickSheet').classList.contains('is-open')) {
        global.Sheet.closeAll();
        return true;
      }
      return false;
    }
  };
})(window);
