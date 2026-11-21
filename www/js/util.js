/* =========================================================================
 * util.js — 基础工具层
 * 日期 / 时长 / 提示 / 震动 / 音效 / 任务智能归类
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ----------------------------- DOM 快捷 ----------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ----------------------------- 通用工具 ----------------------------- */
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function debounce(fn, wait) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ----------------------------- 日期 ----------------------------- */
  const DAY_MS = 86400000;
  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  function startOfDay(d) {
    const x = new Date(d || Date.now());
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }
  function startOfWeek(d) {
    // 以周一为一周起点
    const x = new Date(startOfDay(d));
    const wd = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - wd);
    return x.getTime();
  }
  function startOfMonth(d) {
    const x = new Date(d || Date.now());
    x.setDate(1); x.setHours(0, 0, 0, 0);
    return x.getTime();
  }
  function addDays(ts, n) { return ts + n * DAY_MS; }
  function dayKey(ts) {
    const d = new Date(ts == null ? Date.now() : ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isSameDay(a, b) { return dayKey(a) === dayKey(b); }

  function fmtClock(sec) {
    const s = Math.max(0, Math.round(sec));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }
  function fmtMinutes(min) {
    const m = Math.round(min || 0);
    if (m < 60) return m + ' 分钟';
    const h = Math.floor(m / 60), r = m % 60;
    return r ? h + ' 小时 ' + r + ' 分' : h + ' 小时';
  }
  function fmtMinutesShort(min) {
    const m = Math.round(min || 0);
    if (m < 60) return m + 'm';
    return (m / 60).toFixed(m % 60 === 0 ? 0 : 1) + 'h';
  }

  function fmtDateLabel(ts) {
    const d = new Date(ts);
    const today = startOfDay();
    const diff = Math.round((startOfDay(d) - today) / DAY_MS);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    if (diff === -1) return '昨天';
    if (diff > 2 && diff < 7) return '周' + WEEK_CN[d.getDay()];
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function fmtDue(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const isZeroTime = d.getHours() === 0 && d.getMinutes() === 0;
    const label = fmtDateLabel(ts);
    return isZeroTime ? label : label + ' ' + time;
  }
  function isOverdue(ts) { return !!ts && ts < Date.now(); }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }
  function todayLabel() {
    const d = new Date();
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WEEK_CN[d.getDay()];
  }

  /* ----------------------------- 提示 / 反馈 ----------------------------- */
  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, ms || 1900);
  }

  /** 轻震动：优先走原生桥，其次 WebView 的标准 API */
  function haptic(kind) {
    const s = global.Store && global.Store.state && global.Store.state.settings;
    if (s && s.vibrate === false) return;
    const map = { light: 12, medium: 22, success: [14, 60, 22], warn: [30, 50, 30] };
    const pattern = map[kind] || map.light;
    try {
      if (global.AndroidBridge && typeof global.AndroidBridge.vibrate === 'function') {
        global.AndroidBridge.vibrate(Array.isArray(pattern) ? pattern[0] : pattern);
        return;
      }
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) { /* 忽略：部分环境不支持震动 */ }
  }

  /** 温和的结束提示音：合成正弦单音，无需音频资源文件 */
  let audioCtx = null;
  function beep(kind) {
    const s = global.Store && global.Store.state && global.Store.state.settings;
    if (s && s.sound === false) return;
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const notes = kind === 'break' ? [523.25, 659.25] : [659.25, 523.25];
      const t0 = audioCtx.currentTime;
      notes.forEach(function (freq, i) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const at = t0 + i * 0.22;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.11, at + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(at); osc.stop(at + 0.55);
      });
    } catch (e) { /* 忽略 */ }
  }

  /* ----------------------------- 图标 ----------------------------- */
  const ICONS = {
    check: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14.5 12 8l6 6.5"/><path d="M6 20h12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    tomato: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7"/><path d="M12 7c0-2 1.5-3.5 3.5-4M12 7c0-2-1.5-3.5-3.5-4"/></svg>',
    deep: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    sun: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>'
  };
  function icon(name) { return ICONS[name] || ''; }

  /* ----------------------------- 四象限元数据 ----------------------------- */
  const QUADS = [
    { q: 1, name: '重要且紧急', act: '立即做', cls: 'q1', desc: '马上处理，别攒着' },
    { q: 2, name: '重要不紧急', act: '重点深耕', cls: 'q2', desc: '刷题 / 备考 / 主线积累' },
    { q: 3, name: '紧急不重要', act: '快速处理', cls: 'q3', desc: '限时清掉，别上头' },
    { q: 4, name: '不紧急不重要', act: '尽量少做', cls: 'q4', desc: '能砍就砍，别自我安慰' }
  ];
  function quad(q) { return QUADS[q - 1] || QUADS[1]; }

  /* ----------------------------- 智能归类 -----------------------------
   * 规则化识别：关键词权重 + 截止时间紧迫度修正。
   * 返回 { q, reason, score }，score 越高越可信。
   * ------------------------------------------------------------------- */
  const KW = {
    1: ['截止', 'ddl', 'deadline', '提交', '交作业', '交表', '报名', '面试', '答辩', '开题',
        '今天', '今晚', '明天', '明早', '马上', '立刻', '紧急', '催', '到期', '最后一天',
        '倒计时', '考试', '小测', '期中', '期末', '上线', '汇报', '交', '抢', '确认'],
    2: ['刷题', '真题', '做题', '错题', '复习', '预习', '备考', '考研', '保研', '蓝桥', 'acm',
        '算法', '编程', '代码', '项目', '背单词', '单词', '读书', '看书', '论文', '文献',
        '复盘', '总结', '整理笔记', '练习', '课程', '网课', '听课', '推导', '实验', '写作',
        '健身', '跑步', '英语', '听力', '口语', '数学', '专业课', '课设', '实习'],
    3: ['回复', '回消息', '回邮件', '取快递', '快递', '缴费', '交费', '签到', '打印', '复印',
        '买东西', '采购', '打电话', '电话', '填表', '开会', '会议', '班群', '通知', '截图',
        '上传', '请假', '借', '还书', '洗衣', '打扫', '整理桌面', '排队', '接'],
    4: ['刷视频', '刷剧', '抖音', 'b站', 'bilibili', '微博', '小红书', '游戏', '打游戏',
        '王者', '原神', '综艺', '追剧', '闲逛', '发呆', '水群', '闲聊', '睡懒觉', '熬夜',
        '购物', '剁手', '躺', '摸鱼']
  };

  function classify(title, note, due) {
    const text = ((title || '') + ' ' + (note || '')).toLowerCase();
    const scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const hits = { 1: [], 2: [], 3: [], 4: [] };

    [1, 2, 3, 4].forEach(function (q) {
      KW[q].forEach(function (kw) {
        if (text.indexOf(kw.toLowerCase()) !== -1) {
          // 长关键词更可信，给更高权重
          scores[q] += kw.length >= 3 ? 2 : 1.2;
          if (hits[q].length < 2) hits[q].push(kw);
        }
      });
    });

    // 截止时间修正：24 小时内 → 强正向拉进 Q1；已逾期同理
    if (due) {
      const left = due - Date.now();
      if (left < 0) { scores[1] += 3; hits[1].push('已到期'); }
      else if (left <= DAY_MS) { scores[1] += 2.5; hits[1].push('24h 内到期'); }
      else if (left <= 3 * DAY_MS) { scores[1] += 1; }
    }

    let best = 2, bestScore = scores[2];
    [1, 2, 3, 4].forEach(function (q) {
      if (scores[q] > bestScore) { best = q; bestScore = scores[q]; }
    });

    // 全部没命中：默认落在「重要不紧急」，这是学生最该投入的象限
    if (bestScore === 0) {
      return { q: 2, score: 0, reason: '没有明显的时间压力，建议放进「重点深耕」慢慢推进' };
    }
    const meta = quad(best);
    const words = hits[best].slice(0, 2).map(function (w) { return '「' + w + '」'; }).join('');
    return {
      q: best,
      score: bestScore,
      reason: '识别到 ' + words + ' → ' + meta.name + ' · ' + meta.act
    };
  }

  /* ----------------------------- 导出 ----------------------------- */
  global.U = {
    $: $, $$: $$,
    uid: uid, clamp: clamp, pad2: pad2, debounce: debounce, escapeHtml: escapeHtml,
    DAY_MS: DAY_MS, WEEK_CN: WEEK_CN,
    startOfDay: startOfDay, startOfWeek: startOfWeek, startOfMonth: startOfMonth,
    addDays: addDays, dayKey: dayKey, isSameDay: isSameDay,
    fmtClock: fmtClock, fmtMinutes: fmtMinutes, fmtMinutesShort: fmtMinutesShort,
    fmtDateLabel: fmtDateLabel, fmtDue: fmtDue, isOverdue: isOverdue,
    greeting: greeting, todayLabel: todayLabel,
    toast: toast, haptic: haptic, beep: beep,
    icon: icon, QUADS: QUADS, quad: quad, classify: classify
  };
})(window);
