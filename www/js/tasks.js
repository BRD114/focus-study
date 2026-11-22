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
  /* 顺序规则交给 Store：未完成在前、已完成在后，组内按手动顺序 ord */
  function taskOrder(a, b) { return S.displayOrder(a, b); }

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

  /* 重绘会重建 DOM：先记下各区域的滚动位置，重建后放回去，
     这样拖动结束后列表不会跳回顶部 */
  function captureScroll() {
    const map = {};
    U.$$('#matrix .quad__body').forEach(function (b) {
      if (b.dataset.drop) map[b.dataset.drop] = b.scrollTop;
    });
    const lv = U.$('#listView');
    if (lv) map.__list = lv.scrollTop;
    return map;
  }
  function restoreScroll(map) {
    U.$$('#matrix .quad__body').forEach(function (b) {
      const v = map[b.dataset.drop];
      if (v) b.scrollTop = v;
    });
    const lv = U.$('#listView');
    if (lv && map.__list) lv.scrollTop = map.__list;
  }

  function render() {
    const keep = captureScroll();
    renderOverview();
    renderMatrix();
    renderList();
    const matrix = U.$('#matrix'), list = U.$('#listView'), legend = U.$('#planeLegend');
    if (matrix) matrix.hidden = view !== 'matrix';
    if (list) list.hidden = view !== 'list';
    if (legend) legend.hidden = view !== 'matrix';   // 清单视图不需要坐标轴图例
    if (matrix) matrix.style.display = view === 'matrix' ? 'grid' : 'none';
    restoreScroll(keep);
    syncScrollMask();
  }

  /* ========================= 拖拽：排序 + 跨象限 ========================= */
  const HOLD_MS = 280;      // 触屏：长按多久进入拖拽
  const MOUSE_SLOP = 5;     // 鼠标：按下后移动多少像素开始拖
  const TOUCH_SLOP = 9;     // 触屏：长按前手指移动超过这个距离＝在滚动页面
  const EDGE = 46;          // 自动滚动的边缘触发区
  const HINT_KEY = 'focus.drag.hint';

  let drag = null;      // 正在拖拽
  let press = null;     // 已按下、还没进入拖拽
  let lineEl = null;    // 插入位置指示线
  let rafId = 0;
  let justDragged = false;

  function clearPress() {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.card) press.card.classList.remove('is-press');
    press = null;
  }

  function ghostOf(task) {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = '<span class="drag-ghost__grip" aria-hidden="true"></span>' +
      '<span class="drag-ghost__text">' + U.escapeHtml(task.title) + '</span>';
    document.body.appendChild(ghost);
    return ghost;
  }

  function startDrag(card, x, y, touch) {
    const task = S.tasks.find(function (t) { return t.id === card.dataset.id; });
    clearPress();
    if (!task || drag) return;

    const ghost = ghostOf(task);
    drag = {
      id: task.id, task: task, card: card, ghost: ghost,
      fromQ: task.q, toQ: task.q, beforeId: null,
      container: null, scroller: null,
      x: x, y: y, touch: touch,
      gw: ghost.offsetWidth, gh: ghost.offsetHeight
    };

    card.classList.add('is-dragging');
    document.body.classList.add('is-dragging');
    U.haptic('medium');
    moveGhost(x, y);
    updateTarget(x, y);

    // 拖拽期间手指不能滚页面（改为拖到边缘自动滚）
    document.addEventListener('touchmove', blockTouchMove, { passive: false });
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(autoScroll);
    hintOnce();
  }

  function blockTouchMove(e) { e.preventDefault(); }

  function moveGhost(x, y) {
    if (!drag) return;
    const maxX = Math.max(4, (global.innerWidth || 360) - drag.gw - 4);
    // 触屏时把预览抬到手指上方，避免被自己的手挡住落点
    drag.ghost.style.left = U.clamp(x - drag.gw / 2, 4, maxX) + 'px';
    drag.ghost.style.top = Math.max(4, y - (drag.touch ? drag.gh + 16 : drag.gh / 2)) + 'px';
  }

  /** 指针下方属于哪个区域 / 插到哪两张卡片之间 */
  function updateTarget(x, y) {
    if (!drag) return;
    const el = document.elementFromPoint(x, y);
    if (!el) return;

    const group = el.closest ? el.closest('.lgroup') : null;
    const quad = el.closest ? el.closest('.quad') : null;
    let container = null, q = drag.toQ;

    if (view === 'list' && group) {
      container = group;
      q = parseInt(group.dataset.q, 10) || drag.fromQ;
    } else if (quad) {
      container = quad.querySelector('.quad__body');
      q = parseInt(quad.dataset.q, 10) || drag.fromQ;
    }
    if (!container) return;   // 指针离开了任务区：保持上一次的落点

    drag.toQ = q;
    drag.container = container;
    drag.scroller = container.classList.contains('quad__body') ? container : U.$('#listView');

    // 目标区域淡色点亮（拖回原象限就不必高亮）
    U.$$('.quad').forEach(function (n) {
      n.classList.toggle('is-over', parseInt(n.dataset.q, 10) === q && q !== drag.fromQ);
    });
    U.$$('.lgroup').forEach(function (n) {
      n.classList.toggle('is-over', n === group && q !== drag.fromQ);
    });

    const cards = Array.prototype.slice.call(container.querySelectorAll('.task'))
      .filter(function (c) { return c !== drag.card; });
    const done = !!drag.task.done;

    let before = null;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = cards[i]; break; }
    }
    // 完成 / 未完成是两个分组：落点被拽到另一组时，吸附到两组的交界
    if (before && before.classList.contains('is-done') !== done) {
      before = cards.filter(function (c) { return c.classList.contains('is-done'); })[0] || null;
    }

    drag.beforeId = before ? before.dataset.id : null;
    placeLine(container, before);
  }

  function placeLine(container, before) {
    if (!lineEl) {
      lineEl = document.createElement('div');
      lineEl.className = 'drop-line';
      lineEl.setAttribute('aria-hidden', 'true');
    }
    if (lineEl.parentNode !== container) container.appendChild(lineEl);

    const cr = container.getBoundingClientRect();
    const scrolled = container.scrollTop || 0;
    let top;
    if (before) {
      top = before.getBoundingClientRect().top - cr.top + scrolled - 3;
    } else {
      const cards = container.querySelectorAll('.task');
      const last = cards.length ? cards[cards.length - 1] : null;
      top = last
        ? last.getBoundingClientRect().bottom - cr.top + scrolled + 1
        : 6;
    }
    lineEl.style.top = Math.max(0, Math.round(top)) + 'px';
    lineEl.classList.add('is-on');
  }

  /** 拖到容器上下边缘时自动滚动，长列表也能拖到看不见的位置 */
  function autoScroll() {
    if (!drag) return;
    const sc = drag.scroller;
    if (sc) {
      const r = sc.getBoundingClientRect();
      let dy = 0;
      if (drag.y < r.top + EDGE) dy = -Math.ceil((r.top + EDGE - drag.y) / 3);
      else if (drag.y > r.bottom - EDGE) dy = Math.ceil((drag.y - (r.bottom - EDGE)) / 3);
      if (dy) {
        dy = U.clamp(dy, -18, 18);
        const before = sc.scrollTop;
        sc.scrollTop = before + dy;
        if (sc.scrollTop !== before) updateTarget(drag.x, drag.y);
      }
    }
    rafId = requestAnimationFrame(autoScroll);
  }

  function endDrag(commit, point) {
    if (!drag) return;
    if (commit && point) updateTarget(point.x, point.y);

    const d = drag;
    drag = null;
    cancelAnimationFrame(rafId);
    rafId = 0;
    d.ghost.remove();
    d.card.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging');
    document.removeEventListener('touchmove', blockTouchMove);
    U.$$('.quad, .lgroup').forEach(function (n) { n.classList.remove('is-over'); });
    if (lineEl) { lineEl.classList.remove('is-on'); lineEl.remove(); }

    justDragged = true;
    setTimeout(function () { justDragged = false; }, 340);

    if (!commit) { render(); return; }
    if (!d.container) { render(); return; }   // 没有落在任何任务区：当作取消

    if (S.reorderTask(d.id, d.toQ, d.beforeId)) {
      render();                      // 立刻反映新顺序
      U.haptic('success');
      if (d.toQ !== d.fromQ) U.toast('已移动到「' + U.quad(d.toQ).name + '」');
      markSettled(d.id);
    } else {
      render();
    }
  }

  /** 落位后轻轻闪一下描边，告诉用户「就是放在这儿了」 */
  function markSettled(id) {
    setTimeout(function () {
      const root = U.$(view === 'matrix' ? '#matrix' : '#listView');
      const el = root ? root.querySelector('.task[data-id="' + id + '"]') : null;
      if (!el) return;
      el.classList.add('is-settle');
      setTimeout(function () { el.classList.remove('is-settle'); }, 720);
    }, 80);
  }

  function hintOnce() {
    if (hintShown) return;
    hintShown = true;
    let seen = false;
    try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch (e) {}
    if (seen) return;
    try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
    U.toast('拖动可以调整顺序 · 拖到别的象限会移动任务');
  }

  /* 指针事件：桌面按下即拖，触屏长按再拖 */
  function bindDrag() {
    window.addEventListener('pointerdown', function (e) {
      if (e.button > 0 || drag) return;
      const card = e.target.closest ? e.target.closest('.task') : null;
      if (!card || !card.closest('#matrix, #listView')) return;
      if (e.target.closest('[data-act="toggle"]')) return;   // 勾选不进入拖拽
      if (U.$('.sheet.is-open')) return;

      clearPress();
      press = {
        card: card,
        x0: e.clientX, y0: e.clientY,
        x: e.clientX, y: e.clientY,
        mouse: e.pointerType !== 'touch',
        timer: 0
      };
      card.classList.add('is-press');
      if (!press.mouse) {
        const target = card;
        press.timer = setTimeout(function () {
          if (!press || press.card !== target) return;
          startDrag(target, press.x, press.y, true);
        }, HOLD_MS);
      }
    }, { passive: true });

    window.addEventListener('pointermove', function (e) {
      if (drag) {
        drag.x = e.clientX;
        drag.y = e.clientY;
        moveGhost(drag.x, drag.y);
        updateTarget(drag.x, drag.y);
        if (!drag.touch && e.cancelable) e.preventDefault();
        return;
      }
      if (!press) return;

      press.x = e.clientX;
      press.y = e.clientY;
      const dx = Math.abs(e.clientX - press.x0);
      const dy = Math.abs(e.clientY - press.y0);

      if (press.mouse) {
        // 桌面：按住往上下一拖就走，不用等长按
        if (dx + dy > MOUSE_SLOP) startDrag(press.card, e.clientX, e.clientY, false);
      } else if (dx + dy > TOUCH_SLOP) {
        clearPress();   // 手指在滚页面，不是在拖
      }
    }, { passive: false });

    function finish(e) {
      if (drag) {
        endDrag(true, e && typeof e.clientX === 'number' ? { x: e.clientX, y: e.clientY } : null);
        return;
      }
      clearPress();
    }
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', function () {
      if (drag) { endDrag(false); return; }
      clearPress();
    });
    window.addEventListener('blur', function () {
      if (drag) endDrag(false);
      clearPress();
    });
  }

  /* ========================= 事件绑定 ========================= */
  function bind() {
    // —— 点按编辑 / 勾选（矩阵与清单共用）——
    function bindClicks(container) {
      if (!container) return;
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
    bindClicks(U.$('#matrix'));
    bindClicks(U.$('#listView'));
    bindDrag();

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
