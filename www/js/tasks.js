/* =========================================================================
 * tasks.js — 艾森豪威尔四象限任务系统
 *  · 2×2 矩阵 / 分组清单 两种视图
 *  · 长按拖拽跨象限移动（触屏 + 鼠标双支持）
 *  · 新建/编辑面板：智能归类建议、备注、截止时间、置顶、预计番茄
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  let editingId = null;
  let sheetQ = 2;          // 面板当前选中的象限
  let suggestQ = 0;        // 智能建议的象限：只做提示，绝不自动切换选中态
  let userPickedQ = false; // 用户是否手动选过象限
  let view = 'matrix';     // matrix | list
  let justDragged = false; // 拖拽结束后抑制一次 click

  /* ========================= 通用 Stepper ========================= */
  function bindStepper(node, onChange) {
    if (!node) return;
    const valEl = U.$('.stepper__val', node);
    const min = parseInt(node.dataset.min, 10) || 0;
    const max = parseInt(node.dataset.max, 10) || 100;
    const step = parseInt(node.dataset.step, 10) || 1;
    node.addEventListener('click', function (e) {
      const btn = e.target.closest('button');
      if (!btn) return;
      const cur = parseInt(valEl.textContent, 10) || 0;
      const next = U.clamp(cur + (btn.dataset.act === 'inc' ? step : -step), min, max);
      if (next === cur) return;
      valEl.textContent = next;
      U.haptic('light');
      if (onChange) onChange(next);
    });
  }
  global.Stepper = { bind: bindStepper, set: function (node, v) { const el = U.$('.stepper__val', node); if (el) el.textContent = v; } };

  /* ========================= 面板控制 ========================= */
  function openSheet(id) {
    const el = U.$(id);
    if (!el) return;
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
  }
  function closeSheet(el) {
    if (typeof el === 'string') el = U.$(el);
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
  }
  function closeAllSheets() {
    U.$$('.sheet').forEach(function (s) {
      s.classList.remove('is-open');
      s.setAttribute('aria-hidden', 'true');
    });
  }
  global.Sheet = { open: openSheet, close: closeSheet, closeAll: closeAllSheets };

  /* ========================= 渲染：矩阵 ========================= */
  function taskOrder(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ad = a.due || Infinity, bd = b.due || Infinity;
    if (ad !== bd) return ad - bd;
    return b.createdAt - a.createdAt;
  }

  function tasksOf(q) {
    return S.tasks.filter(function (t) { return t.q === q; }).sort(taskOrder);
  }

  function metaHtml(t) {
    const bits = [];
    if (t.due) {
      const over = U.isOverdue(t.due) && !t.done;
      bits.push('<span class="task__tag' + (over ? ' is-due' : '') + '">' +
        (over ? '逾期 ' : '') + U.escapeHtml(U.fmtDue(t.due)) + '</span>');
    }
    if (t.est) bits.push('<span class="task__tag">' + t.est + ' 番茄</span>');
    if (t.note) bits.push('<span class="task__tag">有备注</span>');
    if (!bits.length) return '';
    return '<div class="task__meta">' + bits.join('') + '</div>';
  }

  function taskHtml(t, animate) {
    return '' +
      '<div class="task' + (t.done ? ' is-done' : '') + (t.pinned && !t.done ? ' is-pinned' : '') +
        (animate ? ' is-enter' : '') + '" data-id="' + t.id + '">' +
        '<button class="task__check" data-act="toggle" type="button" aria-label="完成">' + U.icon('check') + '</button>' +
        '<div class="task__main" data-act="edit">' +
          '<p class="task__title">' + U.escapeHtml(t.title) + '</p>' +
          metaHtml(t) +
        '</div>' +
        (t.pinned && !t.done ? '<span class="task__pin">' + U.icon('pin') + '</span>' : '') +
      '</div>';
  }

  /* 象限在平面上的位置：横轴＝紧急程度（右增），纵轴＝重要程度（上增）。
     所以 Ⅱ 在左上、Ⅰ 在右上、Ⅳ 在左下、Ⅲ 在右下 —— 位置本身就说明了含义。 */
  const P = { 2: '1 / 1', 1: '1 / 2', 4: '2 / 1', 3: '2 / 2' };
  const NUM = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ', 4: 'Ⅳ' };

  function renderMatrix() {
    const wrap = U.$('#matrix');
    if (!wrap) return;

    // 轴线层：一根横轴 + 一根竖轴 + 原点
    const axes =
      '<div class="plane__axes" aria-hidden="true">' +
        '<i class="plane__x"></i><i class="plane__y"></i>' +
        '<i class="plane__origin"></i>' +
      '</div>';

    wrap.innerHTML = axes + U.QUADS.map(function (m) {
      const list = tasksOf(m.q);
      const done = list.filter(function (t) { return t.done; }).length;
      const ratio = list.length ? Math.round(done / list.length * 100) : 0;
      const body = list.length
        ? list.map(function (t) { return taskHtml(t, false); }).join('')
        : '<div class="quad__empty">' + emptyHint(m.q) + '</div>';
      return '' +
        '<section class="quad" data-q="' + m.q + '" style="grid-area:' + P[m.q] + '">' +
          '<header class="quad__head">' +
            '<span class="quad__no" aria-hidden="true">' + NUM[m.q] + '</span>' +
            '<h3 class="quad__title">' + m.name + '</h3>' +
            '<span class="quad__count">' + done + '/' + list.length + '</span>' +
            '<button class="quad__add" data-add="' + m.q + '" type="button" aria-label="在此象限添加任务">' +
              U.icon('plus') + '</button>' +
          '</header>' +
          // 进度紧贴标题：区域底部要留给坐标轴，别在轴旁边再画一条平行线
          '<div class="quad__foot">' +
            '<div class="quad__track"><i style="width:' + ratio + '%"></i></div>' +
            '<span class="quad__ratio">' + (list.length ? ratio + '%' : '—') + '</span>' +
          '</div>' +
          '<div class="quad__body" data-drop="' + m.q + '">' + body + '</div>' +
        '</section>';
    }).join('');

    syncScrollMask();
  }

  /** 内容超出一屏才加渐隐，内容正好放得下时不淡化最后一张卡 */
  function syncScrollMask() {
    U.$$('#matrix .quad__body').forEach(function (b) {
      b.classList.toggle('is-scroll', b.scrollHeight - b.clientHeight > 2);
    });
  }

  function emptyHint(q) {
    return {
      1: '暂无急事<br>很稳',
      2: '主线区空着<br>加一道今天的题',
      3: '暂无杂事',
      4: '很好<br>别往里加东西'
    }[q] || '暂无任务';
  }

  function renderList() {
    const wrap = U.$('#listView');
    if (!wrap) return;
    wrap.innerHTML = U.QUADS.map(function (m) {
      const list = tasksOf(m.q);
      const done = list.filter(function (t) { return t.done; }).length;
      const body = list.length
        ? list.map(function (t) { return taskHtml(t, false); }).join('')
        : '<div class="empty-hint">' + m.desc + ' · 暂无任务</div>';
      return '' +
        '<div class="lgroup" data-q="' + m.q + '">' +
          '<div class="lgroup__head">' +
            '<span class="lgroup__dot" style="background:var(--' + m.cls + ')"></span>' +
            '<span class="lgroup__title">' + m.name + '</span>' +
            '<span class="lgroup__desc">' + done + '/' + list.length + ' · ' + m.act + '</span>' +
          '</div>' + body +
        '</div>';
    }).join('');
  }

  function renderOverview() {
    const el = U.$('#tasksOverview');
    if (!el) return;
    const total = S.tasks.length;
    const done = S.tasks.filter(function (t) { return t.done; }).length;
    const pct = total ? Math.round(done / total * 100) : 0;
    el.innerHTML =
      '<span>完成进度</span>' +
      '<div class="overview__bar"><i style="width:' + pct + '%"></i></div>' +
      '<span class="overview__val">' + done + '/' + total + '</span>';
  }

  function render() {
    renderOverview();
    renderMatrix();
    renderList();
    const matrix = U.$('#matrix'), list = U.$('#listView'), legend = U.$('#planeLegend');
    if (matrix) matrix.hidden = view !== 'matrix';
    if (list) list.hidden = view !== 'list';
    if (legend) legend.hidden = view !== 'matrix';   // 清单视图不需要坐标轴图例
    if (matrix) matrix.style.display = view === 'matrix' ? 'grid' : 'none';
  }

  /* ========================= 拖拽 ========================= */
  let drag = null;

  function beginDrag(taskEl, startEvent) {
    const id = taskEl.dataset.id;
    const task = S.tasks.find(function (t) { return t.id === id; });
    if (!task) return;

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = task.title;
    document.body.appendChild(ghost);

    drag = { id: id, ghost: ghost, from: task.q, over: null, sourceEl: taskEl, pointerId: startEvent.pointerId };
    taskEl.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    U.haptic('medium');

    moveGhost(startEvent.clientX, startEvent.clientY);

    // 拖拽期间锁定滚动，避免手势冲突
    document.addEventListener('touchmove', blockTouchMove, { passive: false });
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }

  function blockTouchMove(e) { e.preventDefault(); }

  function moveGhost(x, y) {
    if (!drag) return;
    drag.ghost.style.left = (x - 76) + 'px';
    drag.ghost.style.top = (y - 30) + 'px';
  }

  function onDragMove(e) {
    if (!drag) return;
    moveGhost(e.clientX, e.clientY);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const quad = under && under.closest ? under.closest('.quad') : null;
    const q = quad ? parseInt(quad.dataset.q, 10) : null;
    if (drag.over !== q) {
      U.$$('.quad').forEach(function (n) { n.classList.remove('is-over'); });
      if (quad && q !== drag.from) quad.classList.add('is-over');
      drag.over = q;
    }
  }

  function onDragEnd() {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ghost.remove();
    document.body.style.userSelect = '';
    U.$$('.quad').forEach(function (n) { n.classList.remove('is-over'); });
    document.removeEventListener('touchmove', blockTouchMove);
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);

    justDragged = true;
    setTimeout(function () { justDragged = false; }, 320);

    if (d.over && d.over !== d.from) {
      S.moveTask(d.id, d.over);
      U.haptic('success');
      U.toast('已移动到「' + U.quad(d.over).name + '」');
    } else {
      render();
    }
  }

  /* ========================= 事件绑定 ========================= */
  function bind() {
    const matrix = U.$('#matrix');

    // —— 长按拖拽 + 点按编辑（矩阵 & 清单共用同一套逻辑）——
    function attach(container) {
      if (!container) return;
      let pressTimer = null, startX = 0, startY = 0, candidate = null, dragging = false;

      container.addEventListener('pointerdown', function (e) {
        const card = e.target.closest('.task');
        if (!card || e.button > 0) return;
        if (e.target.closest('[data-act="toggle"]')) return; // 勾选不进入拖拽
        candidate = card;
        dragging = false;
        startX = e.clientX; startY = e.clientY;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(function () {
          if (!candidate) return;
          dragging = true;
          beginDrag(candidate, { clientX: startX, clientY: startY, pointerId: e.pointerId });
        }, 280);
      }, { passive: true });

      container.addEventListener('pointermove', function (e) {
        if (!candidate || dragging) return;
        if (Math.abs(e.clientX - startX) > 9 || Math.abs(e.clientY - startY) > 9) {
          clearTimeout(pressTimer);
          candidate = null;
        }
      }, { passive: true });

      function cancelPress() {
        clearTimeout(pressTimer);
        if (!dragging) candidate = null;
        dragging = false;
      }
      container.addEventListener('pointerup', cancelPress);
      container.addEventListener('pointercancel', cancelPress);
      container.addEventListener('pointerleave', function () { clearTimeout(pressTimer); });

      // 点击行为
      container.addEventListener('click', function (e) {
        if (justDragged) { e.stopPropagation(); return; }
        const addBtn = e.target.closest('[data-add]');
        if (addBtn) { openAdd(parseInt(addBtn.dataset.add, 10)); return; }
        const toggleBtn = e.target.closest('[data-act="toggle"]');
        const editArea = e.target.closest('[data-act="edit"]');
        const card = e.target.closest('.task');
        if (!card) return;
        if (toggleBtn) {
          const id = card.dataset.id;
          const t = S.tasks.find(function (x) { return x.id === id; });
          S.toggleTask(id);
          U.haptic(t && t.done ? 'light' : 'success');
          if (t && t.done) U.toast('完成，继续保持');
          return;
        }
        if (editArea) openEdit(card.dataset.id);
      });
    }
    attach(matrix);
    attach(U.$('#listView'));

    // —— 尺寸变化：重新判断是否需要底部渐隐 ——
    let resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(syncScrollMask, 160);
    });

    // —— 视图切换 ——
    const seg = U.$('#tasksSeg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        const btn = e.target.closest('.seg__btn');
        if (!btn) return;
        view = btn.dataset.view;
        U.$$('.seg__btn', seg).forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        render();
      });
    }

    // —— 面板关闭 ——
    U.$$('.sheet').forEach(function (sheet) {
      sheet.addEventListener('click', function (e) {
        if (e.target.closest('[data-close]')) closeSheet(sheet);
      });
    });

    // —— 新建（顶栏 + / 象限内 +） ——
    ['#btnQuickAdd', '#fabAdd'].forEach(function (sel) {
      const btn = U.$(sel);
      if (btn) btn.addEventListener('click', function () { openAdd(); });
    });

    // —— 智能归类 + 象限选择 ——
    const titleInput = U.$('#fTitle');
    const noteInput = U.$('#fNote');
    const dueInput = U.$('#fDue');
    const suggest = U.$('#suggestChip');
    const suggestText = U.$('#suggestText');

    const runClassify = U.debounce(function () {
      const title = titleInput.value.trim();
      if (!title) { suggest.hidden = true; return; }
      const due = dueInput.value ? new Date(dueInput.value).getTime() : null;
      const r = U.classify(title, noteInput.value, due);
      suggest.hidden = false;
      suggestText.textContent = '建议 · ' + r.reason;
      // 关键：这里不再调用 selectQuad —— 建议只提示，选哪个象限由用户决定
      suggestQ = r.q;
      syncSuggestUse();
    }, 200);

    // 「采用」：用户主动点，才把倾向切到建议的象限
    const suggestUse = U.$('#suggestUse');
    if (suggestUse) {
      suggestUse.addEventListener('click', function () {
        if (!suggestQ) return;
        selectQuad(suggestQ, true);
        syncSuggestUse();
        U.haptic('light');
      });
    }

    if (titleInput) {
      titleInput.addEventListener('input', runClassify);
      noteInput.addEventListener('input', runClassify);
      dueInput.addEventListener('change', runClassify);
    }

    const pick = U.$('#quadPick');
    if (pick) {
      pick.addEventListener('click', function (e) {
        const btn = e.target.closest('.quad-pick__btn');
        if (!btn) return;
        userPickedQ = true;
        selectQuad(parseInt(btn.dataset.q, 10), false);
        syncSuggestUse();
        U.haptic('light');
      });
    }

    // —— 保存 / 删除 ——
    const saveBtn = U.$('#sheetSave');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const delBtn = U.$('#sheetDelete');
    if (delBtn) delBtn.addEventListener('click', function () {
      if (!editingId) return;
      if (!window.confirm('删除这个任务？删除后不可恢复。')) return;
      S.deleteTask(editingId);
      closeSheet('#taskSheet');
      U.toast('已删除');
    });

    // —— 预计番茄数 ——
    bindStepper(U.$('#fEst'), null);
  }

  function selectQuad(q, markUser) {
    sheetQ = q;
    if (markUser) userPickedQ = true;
    U.$$('#quadPick .quad-pick__btn').forEach(function (b) {
      b.classList.toggle('is-active', parseInt(b.dataset.q, 10) === q);
    });
  }

  /** 建议的象限与当前选中一致（或没有建议/正在编辑）时，不必显示「采用」 */
  function syncSuggestUse() {
    const btn = U.$('#suggestUse');
    if (!btn) return;
    btn.hidden = !suggestQ || suggestQ === sheetQ || !!editingId;
  }

  /* ========================= 新建 / 编辑 ========================= */
  function resetForm() {
    U.$('#fTitle').value = '';
    U.$('#fNote').value = '';
    U.$('#fDue').value = '';
    U.$('#fPin').checked = false;
    U.$('#suggestChip').hidden = true;
    suggestQ = 0;
    syncSuggestUse();
    // 预计番茄数默认 0：不预设工作量，需要再自己加
    global.Stepper.set(U.$('#fEst'), 0);
    userPickedQ = false;
    selectQuad(2, false);
  }

  /** 新建任务；q 为预设象限（在某个象限里点加号时用） */
  function openAdd(q) {
    editingId = null;
    resetForm();
    // 从某个象限的 + 进入时预选该象限（这是用户的操作上下文，不是建议）；
    // 输入内容后智能建议只做提示，不会改写这个选择
    if (q) selectQuad(q, false);
    U.$('#sheetTitle').textContent = '新建任务';
    U.$('#sheetDelete').style.display = 'none';
    openSheet('#taskSheet');
    setTimeout(function () { U.$('#fTitle').focus(); }, 320);
  }

  function openEdit(id) {
    const t = S.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    editingId = id;
    resetForm();
    U.$('#sheetTitle').textContent = '编辑任务';
    U.$('#fTitle').value = t.title;
    U.$('#fNote').value = t.note || '';
    U.$('#fDue').value = t.due ? toLocalInput(t.due) : '';
    U.$('#fPin').checked = !!t.pinned;
    global.Stepper.set(U.$('#fEst'), t.est || 0);
    selectQuad(t.q, true);
    userPickedQ = true;
    U.$('#sheetDelete').style.display = '';
    openSheet('#taskSheet');
  }

  function toLocalInput(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate()) +
      'T' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  }

  function save() {
    const title = U.$('#fTitle').value.trim();
    if (!title) {
      U.toast('先写下来要做什么');
      U.$('#fTitle').focus();
      return;
    }
    const dueVal = U.$('#fDue').value;
    const payload = {
      title: title,
      note: U.$('#fNote').value.trim(),
      q: sheetQ,
      due: dueVal ? new Date(dueVal).getTime() : null,
      pinned: U.$('#fPin').checked,
      est: parseInt(U.$('.stepper__val', U.$('#fEst')).textContent, 10) || 0
    };
    if (editingId) {
      S.updateTask(editingId, payload);
      U.toast('已保存');
    } else {
      S.addTask(payload);
      U.toast('已加入「' + U.quad(sheetQ).name + '」');
      U.haptic('success');
    }
    closeSheet('#taskSheet');
  }

  /* ========================= 任务选择器（供专注页绑定） ========================= */
  function pickTask(currentId, onPick) {
    const body = U.$('#pickBody');
    const titleEl = U.$('#pickTitle');
    if (!body) return;
    titleEl.textContent = '这次专注于哪件事？';

    const open = S.tasks.filter(function (t) { return !t.done; });
    let html = '<button class="pick-row" data-id="" type="button">' +
      '<span class="pick-row__dot"></span>' +
      '<span class="pick-row__main"><span class="pick-row__title">不绑定任务</span>' +
      '<span class="pick-row__sub">只记录专注时长</span></span></button>';

    if (!open.length) {
      html += '<div class="empty-hint">还没有进行中的任务，先去「任务」里加一个</div>';
    } else {
      U.QUADS.forEach(function (m) {
        const list = open.filter(function (t) { return t.q === m.q; });
        if (!list.length) return;
        html += '<div style="font-size:11px;color:var(--ink-3);margin:10px 2px 2px">' + m.name + '</div>';
        html += list.map(function (t) {
          return '<button class="pick-row' + (t.id === currentId ? ' is-active' : '') + '" data-id="' + t.id + '" type="button">' +
            '<span class="pick-row__dot" style="background:var(--' + m.cls + ')"></span>' +
            '<span class="pick-row__main"><span class="pick-row__title">' + U.escapeHtml(t.title) + '</span>' +
            '<span class="pick-row__sub">' + (t.est ? '预计 ' + t.est + ' 个番茄 · ' : '') +
            (t.due ? U.fmtDue(t.due) : '无截止时间') + '</span></span></button>';
        }).join('');
      });
    }
    body.innerHTML = html;
    openSheet('#pickSheet');

    body.onclick = function (e) {
      const row = e.target.closest('.pick-row');
      if (!row) return;
      closeSheet('#pickSheet');
      onPick(row.dataset.id || null);
    };
  }

  /* ========================= 初始化 ========================= */
  function init() {
    bind();
    render();
    global.addEventListener('resize', U.debounce(render, 200));
  }

  global.Tasks = {
    init: init,
    render: render,
    openAdd: openAdd,
    openEdit: openEdit,
    pickTask: pickTask,
    get isSheetOpen() { return U.$('#taskSheet').classList.contains('is-open'); }
  };
})(window);
