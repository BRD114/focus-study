/* =========================================================================
 * stats.js — 学习数据统计面板
 *  · 今日 / 本周 / 本月 三段视角
 *  · 专注时长、番茄数、完成任务数、打卡天数 + 环比
 *  · 纯手写 SVG 折线趋势图（零依赖）
 *  · 象限完成率 + 规则化「效率复盘」文案
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  /* ========================= 周期计算 ========================= */
  function period(range) {
    const now = Date.now();
    if (range === 'day') {
      const from = U.startOfDay(now);
      return { from: from, to: from + U.DAY_MS, prevFrom: from - U.DAY_MS, prevTo: from, label: '今日' };
    }
    if (range === 'month') {
      const from = U.startOfMonth(now);
      const next = new Date(from); next.setMonth(next.getMonth() + 1);
      const prev = new Date(from); prev.setMonth(prev.getMonth() - 1);
      return { from: from, to: next.getTime(), prevFrom: prev.getTime(), prevTo: from, label: '本月' };
    }
    const from = U.startOfWeek(now);
    return { from: from, to: from + 7 * U.DAY_MS, prevFrom: from - 7 * U.DAY_MS, prevTo: from, label: '本周' };
  }

  /* ========================= KPI ========================= */
  function renderKPI(p) {
    const el = U.$('#kpiGrid');
    if (!el) return;

    const focus = S.focusMinutesBetween(p.from, p.to);
    const focusPrev = S.focusMinutesBetween(p.prevFrom, p.prevTo);
    const pomo = S.pomodoroCountBetween(p.from, p.to);
    const pomoPrev = S.pomodoroCountBetween(p.prevFrom, p.prevTo);
    const done = S.tasksDoneBetween(p.from, p.to);
    const donePrev = S.tasksDoneBetween(p.prevFrom, p.prevTo);
    const days = Math.max(1, Math.round((Math.min(p.to, Date.now()) - p.from) / U.DAY_MS));
    let checkin = 0;
    for (let i = 0; i < days + 1; i++) {
      const t = p.from + i * U.DAY_MS;
      if (t >= p.to) break;
      if (S.isCheckinDay(t)) checkin++;
    }

    function delta(cur, prev, unit) {
      if (!prev && !cur) return '<div class="kpi__delta">还没有数据</div>';
      if (!prev) return '<div class="kpi__delta is-up">新增记录</div>';
      const d = Math.round((cur - prev) / prev * 100);
      if (d === 0) return '<div class="kpi__delta">与上期持平</div>';
      return '<div class="kpi__delta ' + (d > 0 ? 'is-up' : 'is-down') + '">' +
        (d > 0 ? '↑ ' : '↓ ') + Math.abs(d) + '% 环比</div>';
    }

    el.innerHTML = '' +
      '<div class="kpi"><div class="kpi__label">专注时长</div>' +
        '<div class="kpi__val">' + (focus >= 60 ? (focus / 60).toFixed(1) + '<small>h</small>' : Math.round(focus) + '<small>min</small>') + '</div>' +
        delta(focus, focusPrev) + '</div>' +
      '<div class="kpi"><div class="kpi__label">番茄个数</div>' +
        '<div class="kpi__val">' + pomo + '<small>个</small></div>' + delta(pomo, pomoPrev) + '</div>' +
      '<div class="kpi"><div class="kpi__label">完成任务</div>' +
        '<div class="kpi__val">' + done + '<small>项</small></div>' + delta(done, donePrev) + '</div>' +
      '<div class="kpi"><div class="kpi__label">打卡天数</div>' +
        '<div class="kpi__val">' + checkin + '<small>天</small></div>' +
        '<div class="kpi__delta">连续 ' + S.streak() + ' 天</div></div>';
  }

  /* ========================= 趋势数据 ========================= */
  function series(range, p) {
    const out = [];
    if (range === 'day') {
      // 06:00 - 24:00 每小时
      for (let h = 6; h < 24; h++) {
        const from = p.from + h * 3600000;
        out.push({ label: h + '时', value: S.focusMinutesBetween(from, from + 3600000) });
      }
      return { points: out, unit: 'min' };
    }
    const days = Math.round((p.to - p.from) / U.DAY_MS);
    const startOfWeek = p.from;
    for (let i = 0; i < days; i++) {
      const from = startOfWeek + i * U.DAY_MS;
      const d = new Date(from);
      out.push({
        label: range === 'week' ? '周' + U.WEEK_CN[d.getDay()] : (d.getMonth() + 1) + '/' + d.getDate(),
        value: S.focusMinutesBetween(from, from + U.DAY_MS)
      });
    }
    return { points: out, unit: 'min' };
  }

  /* ========================= 折线图 ========================= */
  function lineChart(points) {
    const W = 320, H = 132;
    const padT = 14, padB = 20, padL = 4, padR = 4;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const values = points.map(function (p) { return p.value; });
    const rawMax = Math.max.apply(null, values.concat([10]));
    // 取整到「好看」的刻度
    let max = Math.ceil(rawMax / 15) * 15;
    if (max < 15) max = 15;

    const n = points.length;
    const stepX = n > 1 ? innerW / (n - 1) : 0;
    const x = function (i) { return padL + i * stepX; };
    const y = function (v) { return padT + innerH - (v / max) * innerH; };

    // 平滑曲线（Catmull-Rom 转贝塞尔）
    let d = '';
    points.forEach(function (pt, i) {
      const px = x(i), py = y(pt.value);
      if (i === 0) { d += 'M' + px.toFixed(1) + ',' + py.toFixed(1); return; }
      const p0 = points[i - 1];
      const x0 = x(i - 1), y0 = y(p0.value);
      const cx = (x0 + px) / 2;
      d += ' C' + cx.toFixed(1) + ',' + y0.toFixed(1) + ' ' + cx.toFixed(1) + ',' + py.toFixed(1) +
           ' ' + px.toFixed(1) + ',' + py.toFixed(1);
    });
    const area = d + ' L' + x(n - 1).toFixed(1) + ',' + (padT + innerH) + ' L' + padL + ',' + (padT + innerH) + ' Z';

    // 网格线
    let grid = '';
    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      const gy = padT + innerH - k * innerH;
      grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) +
        '" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4" opacity=".7"/>';
    });
    // y 轴最大刻度
    grid += '<text x="' + padL + '" y="' + (padT - 4) + '" font-size="8" fill="var(--ink-3)">' + max + 'min</text>';

    // 数据点
    let dots = '';
    const peak = values.indexOf(Math.max.apply(null, values));
    points.forEach(function (pt, i) {
      if (n > 12 && i % 2 !== 0 && i !== peak) return;
      const isPeak = i === peak && pt.value > 0;
      dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(pt.value).toFixed(1) + '" r="' + (isPeak ? 3 : 2) +
        '" fill="' + (isPeak ? 'var(--accent)' : 'var(--surface)') + '" stroke="var(--accent)" stroke-width="1.5"/>';
    });

    // x 轴标签（自动抽稀 + 防重叠）
    let labels = '';
    let lastX = -999;
    const every = n <= 7 ? 1 : (n <= 15 ? 3 : 5);
    points.forEach(function (pt, i) {
      if (i % every !== 0 && i !== n - 1) return;
      if (x(i) - lastX < 32) return;   // 太挤就跳过，保证可读
      lastX = x(i);
      labels += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 5) + '" font-size="8" text-anchor="middle" fill="var(--ink-3)">' +
        pt.label + '</text>';
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="var(--accent)" stop-opacity=".22"/>' +
        '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      grid +
      '<path d="' + area + '" fill="url(#areaGrad)"/>' +
      '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      dots + labels +
      '</svg>';
  }

  function renderTrend(range, p) {
    const box = U.$('#trendChart');
    if (!box) return;
    const data = series(range, p);
    box.innerHTML = lineChart(data.points);
    const total = data.points.reduce(function (a, x) { return a + x.value; }, 0);
    const meta = U.$('#trendMeta');
    if (meta) meta.textContent = total ? '共 ' + U.fmtMinutesShort(total) + ' / ' + p.label : p.label;
  }

  /* ========================= 象限完成率 ========================= */
  function renderQuadStats(p) {
    const el = U.$('#quadStats');
    if (!el) return;
    el.innerHTML = U.QUADS.map(function (m) {
      const all = S.tasks.filter(function (t) { return t.q === m.q; });
      const done = all.filter(function (t) { return t.done; }).length;
      const ratio = all.length ? Math.round(done / all.length * 100) : 0;
      return '<div class="qs">' +
        '<span class="qs__name">' + m.act + '</span>' +
        '<div class="qs__track"><i style="width:' + ratio + '%;background:var(--' + m.cls + ')"></i></div>' +
        '<span class="qs__val">' + done + '/' + all.length + '</span>' +
      '</div>';
    }).join('');
  }

  /* ========================= 效率复盘 ========================= */
  function renderReview(range, p) {
    const el = U.$('#reviewList');
    if (!el) return;

    const focus = S.focusMinutesBetween(p.from, p.to);
    const focusPrev = S.focusMinutesBetween(p.prevFrom, p.prevTo);
    const pomo = S.pomodoroCountBetween(p.from, p.to);
    const done = S.tasksDoneBetween(p.from, p.to);
    const data = series(range, p).points;
    const items = [];

    /* 1. 总量 + 环比 */
    if (focus <= 0) {
      items.push(p.label + '还没有专注记录。先从一个 25 分钟开始，比计划一整天更有效。');
    } else {
      let line = p.label + '累计专注 ' + U.fmtMinutes(focus) + '，完成 ' + pomo + ' 个番茄、' + done + ' 项任务';
      if (focusPrev > 0) {
        const d = Math.round((focus - focusPrev) / focusPrev * 100);
        line += d >= 0 ? '，比上期多 ' + d + '%' : '，比上期少 ' + Math.abs(d) + '%';
      }
      items.push(line + '。');
    }

    /* 2. 峰值日 */
    const peak = data.reduce(function (a, b) { return b.value > a.value ? b : a; }, { value: 0, label: '' });
    if (peak.value > 0) {
      items.push('「' + peak.label + '」是你的高效时段，专注 ' + U.fmtMinutes(peak.value) + '，可以把这个时段固定下来做最难的事。');
    }

    /* 3. 象限结构：Q2 占比 */
    const q2 = S.tasks.filter(function (t) { return t.q === 2; });
    const q2Done = q2.filter(function (t) { return t.done; }).length;
    const q1open = S.tasks.filter(function (t) { return t.q === 1 && !t.done; }).length;
    if (q2.length) {
      items.push('「重点深耕」共 ' + q2.length + ' 项、已完成 ' + q2Done + ' 项（' +
        Math.round(q2Done / q2.length * 100) + '%）。刷题和备考这类事不紧急但决定结果，它的完成率最值得盯。');
    }
    if (q1open >= 3) {
      items.push('「重要且紧急」还压着 ' + q1open + ' 项，说明有些事被拖到了最后。试着把它们提前放进「重点深耕」，减少救火。');
    }

    /* 4. 深度专注 */
    const deepMin = S.sessionsBetween(p.from, p.to)
      .filter(function (s) { return s.mode === 'deep'; })
      .reduce(function (a, s) { return a + s.minutes; }, 0);
    if (deepMin > 0) {
      items.push('深度专注 ' + U.fmtMinutes(deepMin) + '，这是最高质量的一段时间，建议固定成每天的习惯。');
    } else if (focus > 0) {
      items.push('本期还没有用过深度专注。关掉一切通知连续 45 分钟，比断断续续两小时更值。');
    }

    /* 5. 打卡与节奏 */
    const st = S.streak();
    if (st >= 3) items.push('已连续打卡 ' + st + ' 天，节奏正在形成，别断在明天。');
    else if (focus > 0) items.push('打卡 ' + st + ' 天。连续性是效率的复利，先守住每天 25 分钟。');

    el.innerHTML = items.map(function (t) { return '<li>' + U.escapeHtml(t) + '</li>'; }).join('');
  }

  /* ========================= 入口 ========================= */
  function render() {
    const range = S.settings.statsRange || 'week';
    const p = period(range);
    renderKPI(p);
    renderTrend(range, p);
    renderQuadStats(p);
    renderReview(range, p);
    const seg = U.$('#statsSeg');
    if (seg) {
      U.$$('.seg__btn', seg).forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.range === range);
      });
    }
  }

  function init() {
    const seg = U.$('#statsSeg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        const b = e.target.closest('.seg__btn');
        if (!b) return;
        S.setSetting('statsRange', b.dataset.range);
        render();
      });
    }
    render();
    global.addEventListener('resize', U.debounce(render, 250));
  }

  global.Stats = { init: init, render: render };
})(window);
