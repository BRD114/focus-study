/* =========================================================================
 * settings.js — 「我的」页：数据总览 + 偏好设置 + 备份
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  /* ========================= 渲染 ========================= */
  function renderProfile() {
    const el = U.$('#profileCard');
    if (!el) return;
    const total = S.totalFocusMinutes();
    const done = S.tasks.filter(function (t) { return t.done; }).length;
    const st = S.streak();
    el.innerHTML =
      '<div class="profile__name">' + U.greeting() + '，今天也稳稳推进</div>' +
      '<div class="profile__desc">所有数据都只存在这台设备上，不上传、不联网。</div>' +
      '<div class="profile__stats">' +
        '<div class="profile__stat"><b>' + (total >= 60 ? (total / 60).toFixed(1) : Math.round(total)) + '</b>' +
          '<span>' + (total >= 60 ? '累计小时' : '累计分钟') + '</span></div>' +
        '<div class="profile__stat"><b>' + st + '</b><span>连续打卡</span></div>' +
        '<div class="profile__stat"><b>' + done + '</b><span>完成任务</span></div>' +
      '</div>';
  }

  function syncControls() {
    const st = S.settings;
    // 数值步进器
    U.$$('.stepper[data-key]').forEach(function (node) {
      const key = node.dataset.key;
      const val = U.$('.stepper__val', node);
      if (val && st[key] != null) val.textContent = st[key];
    });
    // 开关
    U.$$('.switch[data-key]').forEach(function (node) {
      const key = node.dataset.key;
      node.checked = !!st[key];
    });
    // 主题
    U.$$('#themeSeg .seg__btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.themeVal === st.theme);
    });
    U.$$('#deepThemeSeg .seg__btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.deep === st.deepTone);
    });
  }

  function render() {
    renderProfile();
    syncControls();
  }

  /* ========================= 备份 ========================= */
  function doExport() {
    const json = S.exportJSON();

    // 0) 装在手机里（APK）：交给原生剪贴板，最稳
    if (global.AndroidBridge && global.AndroidBridge.copyText) {
      try {
        global.AndroidBridge.copyText(json);
        U.haptic('light');
        return;
      } catch (e) { /* 走下面的兜底 */ }
    }

    // 1) 浏览器环境：直接下载文件
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'focus-backup-' + U.dayKey() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (e) { /* 忽略，走剪贴板 */ }

    // 2) 同时复制到剪贴板（App 内最可靠）
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(function () {
        U.toast('备份已复制到剪贴板');
      }).catch(function () {
        U.toast('备份已生成');
      });
    } else {
      U.toast('备份已生成');
    }
    U.haptic('light');
  }

  function doImport() {
    function apply(text) {
      try {
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.tasks)) throw new Error('格式不对');
        if (!window.confirm('导入会覆盖当前全部数据，确定继续？')) return;
        S.importJSON(text);
        U.toast('导入成功');
      } catch (e) {
        U.toast('内容不是有效的备份 JSON');
      }
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        if (t && t.trim().charAt(0) === '{') { apply(t); return; }
        const manual = window.prompt('把备份 JSON 粘贴到这里：');
        if (manual) apply(manual);
      }).catch(function () {
        const manual = window.prompt('把备份 JSON 粘贴到这里：');
        if (manual) apply(manual);
      });
    } else {
      const manual = window.prompt('把备份 JSON 粘贴到这里：');
      if (manual) apply(manual);
    }
  }

  /* ========================= 事件 ========================= */
  function bind() {
    // 步进器
    U.$$('.stepper[data-key]').forEach(function (node) {
      const key = node.dataset.key;
      const min = parseInt(node.dataset.min, 10);
      const max = parseInt(node.dataset.max, 10);
      const step = parseInt(node.dataset.step, 10);
      node.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        const next = U.clamp(S.settings[key] + (btn.dataset.act === 'inc' ? step : -step), min, max);
        if (next === S.settings[key]) return;
        S.setSetting(key, next);
        U.haptic('light');
      });
    });

    // 开关
    U.$$('.switch[data-key]').forEach(function (node) {
      node.addEventListener('change', function () {
        S.setSetting(node.dataset.key, node.checked);
        U.haptic('light');
      });
    });

    // 主题
    U.$('#themeSeg').addEventListener('click', function (e) {
      const b = e.target.closest('.seg__btn');
      if (!b) return;
      S.setSetting('theme', b.dataset.themeVal);
      U.haptic('light');
    });
    U.$('#deepThemeSeg').addEventListener('click', function (e) {
      const b = e.target.closest('.seg__btn');
      if (!b) return;
      S.setSetting('deepTone', b.dataset.deep);
      U.haptic('light');
    });

    // 数据
    U.$('#btnExport').addEventListener('click', doExport);
    U.$('#btnImport').addEventListener('click', doImport);
    U.$('#btnClear').addEventListener('click', function () {
      if (!window.confirm('会删除全部任务、待办、目标与专注记录，且不可恢复。建议先导出备份。确定清空？')) return;
      S.reset();
      U.toast('数据已清空');
    });
  }

  function init() {
    bind();
    render();
  }

  global.Settings = { init: init, render: render };
})(window);
