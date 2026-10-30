(function(){
'use strict';

/* ========== 配置（内容都在 config.js，改内容不用动这里） ========== */
var CFG = window.STUDY_CONFIG || {};
var KEY = 'study-planner-v1';
var EXAMS = CFG.exams || [];
var CATS = (CFG.subjects && CFG.subjects.length) ? CFG.subjects : [{id:'other', name:'其他', color:'#64748b'}];
var CATMAP = {};
CATS.forEach(function(c){ CATMAP[c.id] = c; });

var WEEK = ['周日','周一','周二','周三','周四','周五','周六'];

var DEFAULT_TEMPLATE = (CFG.template && CFG.template.length) ? CFG.template : [];
var PHASES = CFG.phases || [];
var SCHEDULE = CFG.schedule || [];
var TIPS = (CFG.tips && CFG.tips.length) ? CFG.tips : ['先做最重要的那件事。'];

/* ========== 工具函数 ========== */
function pad(n){ return String(n).padStart(2,'0'); }
function keyOf(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function parseKey(k){ var p = k.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
function shift(d, n){ var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate()+n); return x; }
function todayKey(){ return keyOf(new Date()); }
function diffDays(a, b){ return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
function uid(){ return Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-3); }
function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function $(id){ return document.getElementById(id); }
function weekStart(d){ var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var wd = (x.getDay()+6)%7; return shift(x, -wd); }
function fmtMD(k){ var d = parseKey(k); return (d.getMonth()+1)+'月'+d.getDate()+'日'; }

/* ========== 状态 ========== */
function defSettings(){
  var st = {target: 6};
  EXAMS.forEach(function(e){ st[e.id] = e.date; });
  return st;
}

function defaults(){
  return {
    version: 3,
    settings: defSettings(),
    tasks: {},
    template: DEFAULT_TEMPLATE.map(function(t){ return {title:t.title, cat:t.cat, mins:t.mins}; }),
    focus: {},
    pomos: {},
    meta: {settingsUpd: 0, tplUpd: 0},
    dayUpd: {},
    updatedAt: 0
  };
}

var storeOK = true;
var state = loadState();

function loadState(){
  try{
    var raw = localStorage.getItem(KEY);
    if(!raw) return defaults();
    var s = JSON.parse(raw);
    var d = defaults();
    return {
      version: 3,
      settings: Object.assign(d.settings, s.settings || {}),
      tasks: (s.tasks && typeof s.tasks === 'object') ? s.tasks : {},
      template: (Array.isArray(s.template) && s.template.length) ? s.template : d.template,
      focus: (s.focus && typeof s.focus === 'object') ? s.focus : {},
      pomos: (s.pomos && typeof s.pomos === 'object') ? s.pomos : {},
      meta: (s.meta && typeof s.meta === 'object') ? s.meta : {settingsUpd: 0, tplUpd: 0},
      dayUpd: (s.dayUpd && typeof s.dayUpd === 'object') ? s.dayUpd : {},
      updatedAt: s.updatedAt || 0
    };
  }catch(e){
    storeOK = false;
    return defaults();
  }
}

function save(){
  state.updatedAt = Date.now();
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }
  catch(e){ storeOK = false; }
  if(sync && sync.token && !sync.busy) scheduleSync(4000);
}

/* 标记某一天被改过（同步时按天比较新旧） */
function touchDay(k){
  if(!state.dayUpd) state.dayUpd = {};
  state.dayUpd[k] = Date.now();
}

function touchSettings(){
  if(!state.meta) state.meta = {settingsUpd: 0, tplUpd: 0};
  state.meta.settingsUpd = Date.now();
}

var view = 'today';
var selDate = todayKey();
var filter = 'all';

function tasksOf(k){ return state.tasks[k] || []; }
function counts(k){
  var l = tasksOf(k), done = 0;
  for(var i=0;i<l.length;i++){ if(l[i].done) done++; }
  return {total:l.length, done:done};
}

/* ========== Toast ========== */
var toastTimer = null;
function toast(msg){
  var el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 1900);
}

/* ========== 倒计时 ========== */
function cdInfo(dateStr){
  var d = diffDays(todayKey(), dateStr);
  var dd = parseKey(dateStr);
  return {
    left: Math.max(d, 0),
    passed: d < 0,
    md: (dd.getMonth()+1)+'月'+dd.getDate()+'日',
    dow: WEEK[dd.getDay()],
    weeks: Math.floor(Math.max(d,0)/7),
    rem: Math.max(d,0)%7
  };
}

function paintCountdowns(){
  var wrap = $('cdWrap');
  if(wrap){
    wrap.innerHTML = EXAMS.map(function(e, i){
      var info = cdInfo(state.settings[e.id] || e.date);
      var tone = e.tone || ['blue','violet','green','orange'][i % 4];
      return '<div class="cd-card tone-' + tone + '">' +
        '<div class="cd-label">' + esc(e.label) + '</div>' +
        '<div class="cd-num">' + (info.passed ? '已考' : info.left) + (info.passed ? '' : '<small>天后开考</small>') + '</div>' +
        '<div class="cd-date">' + info.md + ' ' + info.dow + (e.time ? ' · ' + esc(e.time) : '') + '</div>' +
        '<div class="cd-foot"><span>' + (info.passed ? '祝顺利' : '还剩 ' + info.weeks + ' 周 ' + info.rem + ' 天') + '</span><span>' + esc(e.note || '') + '</span></div>' +
      '</div>';
    }).join('');
  }
  $('brandSub').textContent = cdText();
}

function cdText(){
  if(!EXAMS.length) return '还没有配置考试';
  return EXAMS.map(function(e){
    return '距' + (e.short || e.label) + ' ' + cdInfo(state.settings[e.id] || e.date).left + ' 天';
  }).join(' · ');
}

/* ========== 今日 ========== */
function shortLabel(s){
  return String(s)
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[+＋、，,\/／\s]+$/, '')
    .trim();
}

function paintToday(){
  var k = selDate;
  var dd = parseKey(k);
  var isToday = (k === todayKey());
  var c = counts(k);

  $('dayTitle').textContent = (dd.getMonth()+1)+'月'+dd.getDate()+'日 ' + WEEK[dd.getDay()];
  var badge = $('dayBadge');
  if(isToday){ badge.hidden = false; badge.textContent = '今天'; badge.className = 'badge today'; }
  else {
    var delta = diffDays(todayKey(), k);
    badge.hidden = false;
    badge.className = 'badge';
    badge.textContent = delta === -1 ? '昨天' : (delta === 1 ? '明天' : (delta < 0 ? (-delta) + ' 天前' : delta + ' 天后'));
  }
  $('todayBtn').hidden = isToday;
  $('daySub').innerHTML = cdText() + '<span class="tgt"> · 目标 ' + state.settings.target + ' 项/天</span>';

  $('pTitle').textContent = isToday ? '今日进度' : '当日进度';
  var pct = c.total ? Math.round(c.done / c.total * 100) : 0;
  var C = 2 * Math.PI * 52;
  $('ringFg').style.strokeDashoffset = String(C * (1 - pct/100));
  $('ringTxt').textContent = pct + '%';
  $('doneNum').textContent = c.done;
  $('totalNum').textContent = c.total;
  $('pbarFill').style.width = pct + '%';

  var hint = $('pastHint');
  var yKey = keyOf(shift(dd, -1));
  var undonePrev = tasksOf(yKey).filter(function(t){ return !t.done; });
  var bits = [];

  if(isToday){
    bits.push('<span>还差 ' + Math.max(state.settings.target - c.done, 0) + ' 项达标 · 剩 ' + (c.total - c.done) + ' 项没做</span>');
    if(undonePrev.length){
      bits.push('<button class="ghost" style="padding:2px 10px;font-size:12px" data-carry="' + yKey + '">顺延昨天 ' + undonePrev.length + ' 项</button>');
    }
  } else if(diffDays(todayKey(), k) === -1 && c.total > c.done){
    bits.push('<span>这天有 ' + (c.total - c.done) + ' 项没做完</span>' +
      '<button class="ghost" style="padding:2px 10px;font-size:12px" data-carry="' + k + '">顺延到今天</button>');
  } else if(diffDays(todayKey(), k) < 0){
    bits.push(c.total === 0
      ? '<span>这天没有任务记录</span>'
      : '<span>这天全部完成 ✅</span>');
  } else if(diffDays(todayKey(), k) > 0){
    bits.push('<span>提前安排的一天，可以先把模板套上。</span>');
  }
  hint.innerHTML = bits.join('');

  paintTasks();

  $('pomoCount').textContent = '今日 ' + (state.pomos[k] || 0) + ' 次';
}

function paintTasks(){
  var list = tasksOf(selDate).slice();
  var shown = list.filter(function(t){
    if(filter === 'todo') return !t.done;
    if(filter === 'done') return t.done;
    return true;
  });
  if(filter === 'all'){
    shown.sort(function(a,b){
      if(a.done !== b.done) return a.done ? 1 : -1;
      return (a.ts||0) - (b.ts||0);
    });
  }

  var ul = $('taskList');
  ul.innerHTML = shown.map(function(t){
    var c = CATMAP[t.cat] || CATMAP.other;
    return '<li class="task' + (t.done ? ' done' : '') + '" style="--c:' + c.color + '">' +
      '<button class="t-check" data-act="toggle" data-id="' + t.id + '" aria-label="标记完成">' +
        '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>' +
      '</button>' +
      '<div class="t-main">' +
        '<div class="t-title">' + esc(t.title) + '</div>' +
        '<div class="t-meta"><span class="cat">' + c.name + '</span><span>' + (t.mins ? t.mins + ' 分钟' : '未估时') + '</span></div>' +
      '</div>' +
      '<button class="t-del" data-act="del" data-id="' + t.id + '" title="删除">✕</button>' +
    '</li>';
  }).join('');

  var empty = $('emptyState');
  if(!shown.length){
    ul.innerHTML = '';
    empty.hidden = false;
    empty.innerHTML = list.length
      ? '这个筛选下没有任务。'
      : '这一天还没有任务。<b>点上面的「快捷」</b>或输入框就能加。';
  } else {
    empty.hidden = true;
  }

  document.querySelectorAll('#filters button').forEach(function(b){
    b.classList.toggle('active', b.dataset.filter === filter);
  });
}

function addTask(title, cat, mins, dateKey){
  title = (title || '').trim();
  if(!title){ toast('先写点什么吧'); return; }
  var k = dateKey || selDate;
  var list = state.tasks[k];
  if(!list){ list = state.tasks[k] = []; }
  list.push({id:uid(), title:title, cat:cat || 'other', mins: Number(mins) || 0, done:false, ts:Date.now(), upd:Date.now()});
  touchDay(k);
  save();
  paintToday();
}

function applyTemplate(){
  var k = selDate;
  var list = state.tasks[k];
  if(!list){ list = state.tasks[k] = []; }
  var added = 0;
  state.template.forEach(function(t){
    var exists = list.some(function(x){ return x.title === t.title; });
    if(!exists){
      list.push({id:uid(), title:t.title, cat:t.cat, mins:t.mins, done:false, ts:Date.now(), upd:Date.now()});
      added++;
    }
  });
  touchDay(k);
  save();
  paintToday();
  toast(added ? '已添加 ' + added + ' 项' : '模板任务都已在清单里了');
}

function carryTo(fromKey){
  var toKey = keyOf(shift(parseKey(fromKey), 1));
  var src = state.tasks[fromKey] || [];
  var undone = src.filter(function(t){ return !t.done; });
  if(!undone.length){ toast('没有要顺延的任务'); return; }
  var dst = state.tasks[toKey];
  if(!dst){ dst = state.tasks[toKey] = []; }
  undone.forEach(function(t){
    dst.push({id:uid(), title:t.title, cat:t.cat, mins:t.mins, done:false, ts:Date.now(), upd:Date.now()});
  });
  state.tasks[fromKey] = src.filter(function(t){ return t.done; });
  touchDay(fromKey);
  touchDay(toKey);
  save();
  selDate = toKey;
  view = 'today';
  render();
  toast('已顺延 ' + undone.length + ' 项到 ' + (toKey === todayKey() ? '今天' : '次日'));
}

/* ========== 周视图 ========== */
var weekRef = todayKey();

function paintWeek(){
  var start = weekStart(parseKey(weekRef));
  var end = shift(start, 6);
  $('weekRange').textContent = fmtMD(keyOf(start)) + ' — ' + fmtMD(keyOf(end));

  var html = '';
  var wDone = 0, wTotal = 0;
  for(var i=0;i<7;i++){
    var d = shift(start, i), k = keyOf(d), c = counts(k);
    var list = tasksOf(k);
    wDone += c.done; wTotal += c.total;
    var pct = c.total ? Math.round(c.done / c.total * 100) : 0;
    var items = list.slice(0, 3).map(function(t){
      return '<li class="' + (t.done ? 'done' : '') + '">' + (t.done ? '✓ ' : '') + esc(t.title) + '</li>';
    }).join('');
    if(list.length > 3) items += '<li class="more">还有 ' + (list.length - 3) + ' 项…</li>';
    html += '<div class="day-col' + (k === todayKey() ? ' today' : '') + '" data-date="' + k + '">' +
      '<div class="dname">' + WEEK[d.getDay()] + '</div>' +
      '<div class="dnum">' + d.getDate() + '</div>' +
      '<div class="dcount">' + c.done + ' / ' + c.total + ' 项</div>' +
      '<div class="mini"><i style="width:' + pct + '%"></i></div>' +
      '<ul>' + items + '</ul>' +
    '</div>';
  }
  $('weekGrid').innerHTML = html;
  $('weekSummary').innerHTML =
    '<div>本周完成 <b>' + wDone + '</b> 项 / 计划 ' + wTotal + ' 项</div>' +
    '<div>完成率 <b>' + (wTotal ? Math.round(wDone/wTotal*100) : 0) + '%</b></div>' +
    '<div>日均 <b>' + (wDone/7).toFixed(1) + '</b> 项</div>';
}

/* ========== 阶段 ========== */
function paintPhase(){
  var t = todayKey();
  var curIdx = -1;
  var html = PHASES.map(function(p, i){
    var cls = 'phase';
    if(t > p.to) cls += ' done';
    if(t >= p.from && t <= p.to){ cls += ' cur'; curIdx = i; }
    var pts = p.points.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('');
    return '<div class="' + cls + '">' +
      '<div class="phase-head">' +
        '<h3>' + esc(p.title) + '</h3>' +
        '<span class="tag' + (cls.indexOf('cur') >= 0 ? ' cur' : '') + '">' + p.tag + '</span>' +
        '<span class="range">' + p.from.slice(5).replace('-','/') + ' — ' + p.to.slice(5).replace('-','/') + '</span>' +
      '</div>' +
      '<ul>' + pts + '</ul>' +
      '<div class="check">' + esc(p.check) + '</div>' +
    '</div>';
  }).join('');
  $('timeline').innerHTML = html;

  if(curIdx >= 0){
    var p = PHASES[curIdx];
    var left = Math.max(diffDays(t, p.to), 0);
    $('phaseHint').textContent = '当前：' + p.title + ' · 还剩 ' + left + ' 天';
  } else if(t > PHASES[PHASES.length-1].to){
    $('phaseHint').textContent = '已考完，等你的好消息。';
  } else {
    $('phaseHint').textContent = '未开始的阶段，先按第一阶段走。';
  }

  $('sched').innerHTML = SCHEDULE.map(function(s){
    return '<div class="sched-row"><span class="t">' + s.t + '</span><span class="n">' + esc(s.n) + '</span></div>';
  }).join('');
}

/* ========== 统计 ========== */
function paintStats(){
  var t = todayKey();
  var keys = Object.keys(state.tasks);

  var allDone = 0, allMins = 0, catMins = {}, activeDays = 0;
  keys.forEach(function(k){
    var l = state.tasks[k], d = 0;
    l.forEach(function(x){
      if(x.done){
        d++;
        allDone++;
        allMins += Number(x.mins) || 0;
        catMins[x.cat] = (catMins[x.cat] || 0) + (Number(x.mins) || 0);
      }
    });
    if(d > 0) activeDays++;
  });

  // 连续打卡
  var streak = 0;
  for(var i=0;i<400;i++){
    var k = keyOf(shift(parseKey(t), -i));
    if(counts(k).done > 0) streak++;
    else if(i === 0) continue;   // 今天还没开始不算断
    else break;
  }

  var pomoCount = Object.keys(state.pomos).reduce(function(a,k){ return a + (state.pomos[k]||0); }, 0);

  $('statTiles').innerHTML =
    tile('连续打卡', streak, '天') +
    tile('累计完成', allDone, '项') +
    tile('累计投入', (allMins/60).toFixed(1), '小时') +
    tile('番茄次数', pomoCount, '次');

  // 近 14 天
  var days = [], max = 1;
  for(var j=13;j>=0;j--){
    var kk = keyOf(shift(parseKey(t), -j));
    var v = counts(kk).done;
    if(v > max) max = v;
    days.push({k:kk, v:v});
  }
  $('chart').innerHTML = days.map(function(d){
    var h = Math.round(d.v / max * 100);
    var dd = parseKey(d.k);
    return '<div class="bar' + (d.v ? '' : ' zero') + '" title="' + d.k + '：' + d.v + ' 项">' +
      '<i style="height:' + (d.v ? Math.max(h, 6) : 3) + '%"></i>' +
      '<span>' + (dd.getMonth()+1) + '/' + dd.getDate() + '</span>' +
    '</div>';
  }).join('');

  // 科目分布
  var maxCat = 1;
  Object.keys(catMins).forEach(function(c){ if(catMins[c] > maxCat) maxCat = catMins[c]; });
  var rows = CATS.filter(function(c){ return catMins[c.id]; }).map(function(c){
    var m = catMins[c.id];
    var w = Math.round(m / maxCat * 100);
    return '<div class="catrow">' +
      '<span class="name">' + c.name + '</span>' +
      '<span class="track"><i style="width:' + w + '%;background:' + c.color + '"></i></span>' +
      '<span class="val">' + (m/60).toFixed(1) + ' h</span>' +
    '</div>';
  }).join('');
  $('catBars').innerHTML = rows || '<p class="small muted">还没有完成的任务数据，先去「今日」勾几项吧。</p>';
}

function tile(label, num, unit){
  return '<div class="stat"><span>' + label + '</span><b>' + num + '<small>' + unit + '</small></b></div>';
}

/* ========== 设置 ========== */
function paintSettings(){
  $('setExams').innerHTML = EXAMS.map(function(e){
    return '<label class="field">' + esc(e.label) +
      '<input type="date" data-exam="' + e.id + '" value="' + (state.settings[e.id] || e.date) + '" />' +
      '</label>';
  }).join('') +
  '<label class="field">每日目标（项）' +
    '<input type="number" id="setTarget" min="1" max="30" step="1" value="' + state.settings.target + '" style="width:120px" />' +
  '</label>';

  $('tplList').innerHTML = state.template.map(function(t, i){
    var c = CATMAP[t.cat] || CATMAP.other;
    return '<div class="tpl-item" style="--c:' + c.color + '">' +
      '<span class="cat">' + c.name + '</span>' +
      '<span class="t-title">' + esc(t.title) + '</span>' +
      '<span class="muted small">' + (t.mins || 0) + ' 分钟</span>' +
      '<button class="t-del" data-tpl="' + i + '" title="删除" style="opacity:1">✕</button>' +
    '</div>';
  }).join('') || '<p class="small muted">还没有模板任务。</p>';

  var opts = CATS.map(function(c){ return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('');
  $('tplCat').innerHTML = opts;
  $('catSelect').innerHTML = opts;
  paintSyncUI();
}

/* ========== 渲染入口 ========== */
function render(noScroll){
  document.querySelectorAll('.view').forEach(function(v){
    v.classList.toggle('active', v.id === 'view-' + view);
  });
  document.querySelectorAll('#tabs button').forEach(function(b){
    b.classList.toggle('active', b.dataset.view === view);
  });

  paintCountdowns();
  $('storeBanner').classList.toggle('show', !storeOK);

  if(view === 'today') paintToday();
  if(view === 'week') paintWeek();
  if(view === 'phase') paintPhase();
  if(view === 'stats') paintStats();
  if(view === 'settings') paintSettings();
  if(view === 'today') paintQuick();

  if(!noScroll) window.scrollTo({top:0, behavior:'smooth'});
}

function paintQuick(){
  $('quickChips').innerHTML = state.template.slice(0, 6).map(function(t, i){
    var c = CATMAP[t.cat] || CATMAP.other;
    var label = shortLabel(t.title);
    if(label.length > 11) label = label.slice(0, 11) + '…';
    return '<button class="chip" data-quick="' + i + '" title="' + esc(t.title) + '  ' + (t.mins||0) + ' 分钟" style="--c:' + c.color + '">' +
      esc(label) + '</button>';
  }).join('');
}

/* ========== 事件 ========== */
$('tabs').addEventListener('click', function(e){
  var b = e.target.closest('button[data-view]');
  if(!b) return;
  view = b.dataset.view;
  if(view === 'week') weekRef = selDate;
  render();
});

$('prevDay').onclick = function(){ selDate = keyOf(shift(parseKey(selDate), -1)); paintToday(); };
$('nextDay').onclick = function(){ selDate = keyOf(shift(parseKey(selDate), 1)); paintToday(); };
$('todayBtn').onclick = function(){ selDate = todayKey(); paintToday(); };

$('addBtn').onclick = function(){
  var input = $('taskInput');
  addTask(input.value, $('catSelect').value, $('minsInput').value);
  input.value = '';
  input.focus();
};

$('taskInput').addEventListener('keydown', function(e){
  if(e.key === 'Enter'){
    e.preventDefault();
    $('addBtn').click();
  }
});

$('applyTpl').onclick = applyTemplate;

$('quickChips').addEventListener('click', function(e){
  var b = e.target.closest('[data-quick]');
  if(!b) return;
  var t = state.template[Number(b.dataset.quick)];
  if(!t) return;
  addTask(t.title, t.cat, t.mins);
  toast('已添加：' + t.title);
});

$('filters').addEventListener('click', function(e){
  var b = e.target.closest('button[data-filter]');
  if(!b) return;
  filter = b.dataset.filter;
  paintTasks();
});

$('taskList').addEventListener('click', function(e){
  var b = e.target.closest('[data-act]');
  if(!b) return;
  var list = state.tasks[selDate] || [];
  var id = b.dataset.id;
  if(b.dataset.act === 'toggle'){
    list.forEach(function(t){
      if(t.id === id){
        t.done = !t.done;
        t.doneAt = t.done ? Date.now() : null;
        t.upd = Date.now();
      }
    });
    touchDay(selDate);
    save(); paintToday();
  }
  if(b.dataset.act === 'del'){
    state.tasks[selDate] = list.filter(function(t){ return t.id !== id; });
    touchDay(selDate);
    save(); paintToday();
    toast('已删除');
  }
});

document.addEventListener('click', function(e){
  var btn = e.target.closest('[data-carry]');
  if(btn) carryTo(btn.dataset.carry);
});

$('prevWeek').onclick = function(){ weekRef = keyOf(shift(parseKey(weekRef), -7)); paintWeek(); };
$('nextWeek').onclick = function(){ weekRef = keyOf(shift(parseKey(weekRef), 7)); paintWeek(); };
$('weekToday').onclick = function(){ weekRef = todayKey(); paintWeek(); };

$('weekGrid').addEventListener('click', function(e){
  var col = e.target.closest('.day-col');
  if(!col) return;
  selDate = col.dataset.date;
  view = 'today';
  render();
});

/* ---- 设置 ---- */
$('setExams').addEventListener('change', function(ev){
  var t = ev.target;
  if(t.dataset && t.dataset.exam){
    var id = t.dataset.exam;
    if(!t.value){
      var ex = EXAMS.filter(function(x){ return x.id === id; })[0];
      t.value = ex ? ex.date : '';
    }
    state.settings[id] = t.value;
    touchSettings();
    save();
    paintCountdowns();
    paintToday();
  }
  if(t.id === 'setTarget'){
    var v = parseInt(t.value, 10);
    state.settings.target = (v > 0 && v < 50) ? v : 6;
    t.value = state.settings.target;
    touchSettings();
    save();
    paintToday();
  }
});

$('tplAdd').onclick = function(){
  var title = $('tplInput').value.trim();
  if(!title){ toast('先写任务内容'); return; }
  state.template.push({title:title, cat:$('tplCat').value, mins:Number($('tplMins').value)||0});
  state.meta.tplUpd = Date.now();
  save(); $('tplInput').value = ''; paintSettings(); paintQuick();
  toast('已加入模板');
};

$('tplInput').addEventListener('keydown', function(e){
  if(e.key === 'Enter'){ e.preventDefault(); $('tplAdd').click(); }
});

$('tplList').addEventListener('click', function(e){
  var b = e.target.closest('[data-tpl]');
  if(!b) return;
  state.template.splice(Number(b.dataset.tpl), 1);
  state.meta.tplUpd = Date.now();
  save(); paintSettings(); paintQuick();
});

$('printBtn').onclick = function(){ window.print(); };

$('exportBtn').onclick = function(){
  var blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  var a = document.createElement('a');
  var d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = '学习计划备份-' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
  toast('已导出备份');
};

$('importBtn').onclick = function(){ $('importFile').click(); };

$('importFile').onchange = function(e){
  var f = e.target.files && e.target.files[0];
  if(!f) return;
  var fr = new FileReader();
  fr.onload = function(){
    try{
      var s = JSON.parse(fr.result);
      if(!s || typeof s !== 'object' || typeof s.tasks !== 'object') throw new Error('bad');
      if(!confirm('导入会覆盖当前数据，确定吗？')) return;
      var dd = defaults();
      state = {
        version: 3,
        settings: Object.assign(dd.settings, s.settings || {}),
        tasks: s.tasks || {},
        template: (Array.isArray(s.template) && s.template.length) ? s.template : dd.template,
        focus: s.focus || {},
        pomos: s.pomos || {},
        meta: {settingsUpd: Date.now(), tplUpd: Date.now()},
        dayUpd: s.dayUpd || {},
        updatedAt: Date.now()
      };
      if(!s.dayUpd){
        Object.keys(state.tasks).forEach(function(k){
          var u = 0;
          (state.tasks[k] || []).forEach(function(t){ u = Math.max(u, t.upd || t.ts || 0); });
          if(u) state.dayUpd[k] = u;
        });
      }
      save(); render();
      toast('导入成功');
    }catch(err){
      toast('文件格式不对，导入失败');
    }
  };
  fr.readAsText(f);
  e.target.value = '';
};

$('resetBtn').onclick = function(){
  if(!confirm('确定清空所有任务和设置吗？此操作不可恢复。')) return;
  try{ localStorage.removeItem(KEY); }catch(err){}
  state = defaults();
  selDate = todayKey();
  filter = 'all';
  save();
  render();
  toast('已清空');
};

/* ========== 番茄钟 ========== */
var pomo = {mins:25, left:25*60, running:false, timer:null};

function pomoPaint(){
  var m = Math.floor(pomo.left / 60), s = pomo.left % 60;
  $('pomoTime').textContent = pad(m) + ':' + pad(s);
  var total = pomo.mins * 60;
  $('pomoBar').style.width = ((total - pomo.left) / total * 100) + '%';
  $('pomoStart').textContent = pomo.running ? '暂停' : '开始';
  document.querySelectorAll('#pomoPresets .chip').forEach(function(b){
    b.style.borderStyle = Number(b.dataset.min) === pomo.mins ? 'solid' : 'dashed';
    b.style.background = Number(b.dataset.min) === pomo.mins ? '#eef4ff' : '';
    b.style.color = Number(b.dataset.min) === pomo.mins ? '#2f6df6' : '';
  });
}

function pomoStop(){
  clearInterval(pomo.timer);
  pomo.timer = null;
  pomo.running = false;
}

$('pomoStart').onclick = function(){
  if(pomo.running){
    pomoStop();
    pomoPaint();
    return;
  }
  if(pomo.left <= 0){ pomo.left = pomo.mins * 60; }
  pomo.running = true;
  pomo.timer = setInterval(function(){
    pomo.left--;
    if(pomo.left <= 0){
      pomoStop();
      pomo.left = 0;
      state.pomos[selDate] = (state.pomos[selDate] || 0) + 1;
      state.focus[selDate] = (state.focus[selDate] || 0) + pomo.mins;
      touchDay(selDate);
      save();
      pomoPaint();
      $('pomoCount').textContent = '今日 ' + (state.pomos[selDate] || 0) + ' 次';
      toast('完成一次 ' + pomo.mins + ' 分钟专注，已记录 ✅');
      pomo.left = pomo.mins * 60;
      return;
    }
    pomoPaint();
  }, 1000);
  pomoPaint();
};

$('pomoReset').onclick = function(){
  pomoStop();
  pomo.left = pomo.mins * 60;
  pomoPaint();
};

$('pomoPresets').addEventListener('click', function(e){
  var b = e.target.closest('[data-min]');
  if(!b) return;
  pomoStop();
  pomo.mins = Number(b.dataset.min);
  pomo.left = pomo.mins * 60;
  pomoPaint();
});

/* ========== 提醒卡 ========== */
function paintTip(){
  var dayIdx = Math.floor(Date.now() / 86400000);
  $('tipText').textContent = TIPS[dayIdx % TIPS.length];
}

/* ========== 启动 ========== */
(function init(){
  // 下拉框与快捷
  var opts = CATS.map(function(c){ return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('');
  $('catSelect').innerHTML = opts;
  $('catSelect').value = 'cet';

  paintQuick();
  paintTip();
  pomoPaint();
  render();

  if(selDate === todayKey()){
    // 首次使用：给个起步提示
    var hasAny = Object.keys(state.tasks).some(function(k){ return state.tasks[k].length; });
    if(!hasAny){
      setTimeout(function(){ toast('第一次用？先点「套用今日模板」'); }, 900);
    }
  }

  // 跨天自动刷新
  var dayAtLoad = todayKey();
  setInterval(function(){
    if(todayKey() !== dayAtLoad){
      dayAtLoad = todayKey();
      render();
    }
  }, 60000);

  window.addEventListener('beforeunload', function(){
    if(pomo.running) pomoStop();
  });
})();



/* ========== 云同步（GitHub Gist） ========== */
var TOKEN_KEY = 'study-planner-token';
var SYNC_KEY = 'study-planner-sync';
var GIST_FILE = 'study-plan.json';
var GIST_DESC = '冲刺计划 · 数据同步（自动生成，请勿手改）';

var API_BASE = (function(){
  /* 只允许本地调试用 ?api=http://127.0.0.1:port，防止被恶意链接骗走令牌 */
  try{
    var q = new URLSearchParams(location.search).get('api');
    if(q && /^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/.test(q)) return q.replace(/\/+$/, '');
  }catch(e){}
  return 'https://api.github.com';
})();

var sync = {
  token: '', gistId: '', login: '',
  busy: false, lastAt: 0, lastErr: '', timer: null
};

function loadSync(){
  try{
    /* 扫码/链接带参：#t=令牌&g=存档id —— 用完立刻从地址栏抹掉 */
    var h = location.hash || '';
    if(h.length > 3 && h.indexOf('t=') > -1){
      var hp = new URLSearchParams(h.replace(/^#/, ''));
      var tk = hp.get('t');
      if(tk){
        localStorage.setItem(TOKEN_KEY, tk);
        if(hp.get('g')){
          var cur = {};
          try{ cur = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); }catch(e2){}
          cur.gistId = hp.get('g');
          localStorage.setItem(SYNC_KEY, JSON.stringify(cur));
        }
      }
      try{ history.replaceState(null, '', location.pathname + location.search); }catch(e3){}
    }

    sync.token = localStorage.getItem(TOKEN_KEY) || '';
    var cfg = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
    sync.gistId = cfg.gistId || '';
    sync.login = cfg.login || '';
    sync.lastAt = cfg.lastAt || 0;
  }catch(e){}
}

function saveSync(){
  try{
    if(sync.token) localStorage.setItem(TOKEN_KEY, sync.token);
    else localStorage.removeItem(TOKEN_KEY);
    localStorage.setItem(SYNC_KEY, JSON.stringify({gistId: sync.gistId, login: sync.login, lastAt: sync.lastAt}));
  }catch(e){}
}

function payloadOf(st){
  st = st || {};
  return {
    version: 3,
    settings: st.settings || {},
    tasks: st.tasks || {},
    template: st.template || [],
    focus: st.focus || {},
    pomos: st.pomos || {},
    meta: st.meta || {settingsUpd: 0, tplUpd: 0},
    dayUpd: st.dayUpd || {},
    updatedAt: st.updatedAt || 0
  };
}

/* 用来判断「有没有变化」，把时间戳排除掉 */
function payloadKey(st){
  var o = payloadOf(st);
  delete o.updatedAt;
  return JSON.stringify(o);
}

function api(path, opts){
  opts = opts || {};
  var headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + sync.token
  };
  if(opts.body) headers['Content-Type'] = 'application/json';
  return fetch(API_BASE + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store'
  }).then(function(res){
    return res.text().then(function(txt){
      var data = null;
      try{ data = txt ? JSON.parse(txt) : null; }catch(e){}
      if(!res.ok){
        var msg = (data && data.message) || ('HTTP ' + res.status);
        if(res.status === 401) msg = '令牌无效或已过期';
        if(res.status === 403) msg = '权限不足或触发频率限制';
        throw new Error(msg);
      }
      return data;
    });
  });
}

function dayStamp(st, d){
  var v = (st.dayUpd && st.dayUpd[d]) || 0;
  if(!v){
    (st.tasks[d] || []).forEach(function(t){ v = Math.max(v, t.upd || t.ts || 0); });
  }
  return v;
}

/* 合并：按天取新、设置/模板取新、番茄按天取大 */
function mergeStates(local, remote){
  if(!remote || !remote.tasks) return local;
  var out = JSON.parse(JSON.stringify(local));
  out.tasks = {};
  out.dayUpd = {};
  var days = {};
  Object.keys(local.tasks || {}).forEach(function(d){ days[d] = 1; });
  Object.keys(remote.tasks || {}).forEach(function(d){ days[d] = 1; });

  Object.keys(days).forEach(function(d){
    var lu = dayStamp(local, d), ru = dayStamp(remote, d);
    var arr = (ru > lu) ? (remote.tasks[d] || []) : (local.tasks[d] || []);
    arr = arr.filter(function(t){ return t && t.id; });
    if(arr.length) out.tasks[d] = arr;
    var u = Math.max(lu, ru);
    if(u) out.dayUpd[d] = u;
  });

  out.meta = Object.assign({settingsUpd: 0, tplUpd: 0}, local.meta || {});
  var rm = remote.meta || {};
  if((rm.settingsUpd || 0) > (out.meta.settingsUpd || 0)){
    out.settings = Object.assign({}, local.settings, remote.settings);
    out.meta.settingsUpd = rm.settingsUpd;
  }
  if((rm.tplUpd || 0) > (out.meta.tplUpd || 0)){
    out.template = (remote.template && remote.template.length) ? remote.template : out.template;
    out.meta.tplUpd = rm.tplUpd;
  }

  ['focus', 'pomos'].forEach(function(key){
    var a = local[key] || {}, b = remote[key] || {}, m = {};
    Object.keys(a).forEach(function(k){ m[k] = Math.max(m[k] || 0, a[k] || 0); });
    Object.keys(b).forEach(function(k){ m[k] = Math.max(m[k] || 0, b[k] || 0); });
    out[key] = m;
  });

  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}

function findGistId(){
  return api('/gists?per_page=100').then(function(list){
    var hit = (list || []).filter(function(g){ return g.files && g.files[GIST_FILE]; })[0];
    return hit ? hit.id : '';
  });
}

function pullRemote(){
  if(!sync.gistId) return Promise.resolve(null);
  return api('/gists/' + sync.gistId).then(function(g){
    var f = g && g.files && g.files[GIST_FILE];
    if(!f) return null;
    if(f.truncated && f.raw_url){
      return fetch(f.raw_url).then(function(r){ return r.text(); }).then(JSON.parse);
    }
    return f.content ? JSON.parse(f.content) : null;
  });
}

function pushRemote(){
  var body = {
    description: GIST_DESC,
    files: {}
  };
  body.files[GIST_FILE] = {content: JSON.stringify(payloadOf(state))};
  if(sync.gistId){
    return api('/gists/' + sync.gistId, {method: 'PATCH', body: body});
  }
  body.public = false;
  return api('/gists', {method: 'POST', body: body}).then(function(g){
    sync.gistId = g.id;
    saveSync();
    paintSyncUI();
    return g;
  });
}

function syncStatus(text, cls){
  var el = $('syncState');
  if(el){ el.textContent = text; el.className = 'sync-state ' + (cls || ''); }
}

function fmtTime(ts){
  if(!ts) return '从未';
  var d = new Date(ts);
  var now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  return (sameDay ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function syncNow(manual){
  if(!sync.token){
    if(manual) toast('还没有连接同步');
    return Promise.resolve(false);
  }
  if(sync.busy) return Promise.resolve(false);
  if(!navigator.onLine){
    syncStatus('当前没有网络，联网后会自动同步', 'warn');
    return Promise.resolve(false);
  }

  var beforeKey = payloadKey(state);
  sync.busy = true;
  syncStatus('同步中…', 'busy');

  var chain = sync.gistId ? pullRemote() : findGistId().then(function(id){
    if(id){ sync.gistId = id; saveSync(); }
    return id ? pullRemote() : null;
  });

  return chain.then(function(remote){
    var merged = remote ? mergeStates(state, remote) : state;
    if(remote && payloadKey(merged) !== payloadKey(state)){
      state = merged;
      save();
    }
    var needPush = !remote || payloadKey(state) !== payloadKey(remote);
    if(needPush) return pushRemote();
  }).then(function(){
    sync.lastAt = Date.now();
    sync.lastErr = '';
    saveSync();
    syncStatus('已同步 · ' + fmtTime(sync.lastAt), 'ok');
    if(payloadKey(state) !== beforeKey) render(true);
  }).catch(function(err){
    sync.lastErr = (err && err.message) ? err.message : String(err);
    syncStatus('同步失败：' + sync.lastErr, 'err');
    if(manual) toast('同步失败：' + sync.lastErr);
  }).then(function(){
    sync.busy = false;
    return true;
  });
}

function scheduleSync(delay){
  if(!sync.token || sync.busy) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(function(){ syncNow(false); }, delay || 4000);
}

function connectSync(token){
  token = (token || '').trim().replace(/^Bearer\s+/i, '');
  if(!token){ toast('先粘贴令牌'); return; }
  if(!/^[A-Za-z0-9_]{20,}$/.test(token)){ toast('这不像一个 GitHub 令牌'); return; }
  sync.token = token;
  syncStatus('正在校验令牌…', 'busy');
  api('/user').then(function(u){
    sync.login = u.login || '';
    return findGistId();
  }).then(function(id){
    sync.gistId = id || '';
    saveSync();
    paintSyncUI();
    syncStatus('已连接，正在同步…', 'busy');
    return syncNow(true);
  }).catch(function(err){
    var msg = (err && err.message) ? err.message : String(err);
    if(/令牌无效|401/.test(msg)){
      sync.token = '';
      sync.login = '';
      sync.gistId = '';
      saveSync();
    }
    paintSyncUI();
    syncStatus('连接失败：' + msg, 'err');
  });
}

function disconnectSync(){
  if(!confirm('断开后这台设备不再自动同步（云端存档保留），确定吗？')) return;
  clearTimeout(sync.timer);
  sync.token = '';
  sync.gistId = '';
  sync.login = '';
  sync.lastAt = 0;
  sync.lastErr = '';
  saveSync();
  paintSyncUI();
  toast('已断开同步');
}

function paintSyncUI(){
  var box = $('syncBox');
  if(!box) return;

  if(sync.token){
    box.innerHTML =
      '<div class="sync-row">' +
        '<div class="sync-who">已连接 <b>' + (sync.login ? '@' + esc(sync.login) : 'GitHub') + '</b>' +
          '<span class="muted small"> · ' + (sync.gistId ? '云端存档已建立' : '还没有云端存档') + '</span>' +
        '</div>' +
        '<div class="sync-actions">' +
          '<button class="ghost" id="syncNowBtn">立即同步</button>' +
          '<button class="danger" id="syncOffBtn">断开</button>' +
        '</div>' +
      '</div>' +
      '<div class="sync-state-wrap">' +
        '<span id="syncState" class="sync-state">—</span>' +
        (sync.gistId ? '<a class="sync-link" href="https://gist.github.com/' + esc(sync.gistId) + '" target="_blank" rel="noopener">查看云端存档</a>' : '') +
      '</div>';
    var btn = $('syncNowBtn');
    if(btn) btn.onclick = function(){ syncNow(true); };
    var off = $('syncOffBtn');
    if(off) off.onclick = disconnectSync;
    syncStatus(
      sync.lastErr ? ('上次失败：' + sync.lastErr) : (sync.lastAt ? '已同步 · ' + fmtTime(sync.lastAt) : '等待首次同步'),
      sync.lastErr ? 'err' : 'ok'
    );
    return;
  }

  box.innerHTML =
    '<ol class="sync-steps">' +
      '<li>点下面链接打开 GitHub 令牌页（已帮你勾好 <b>gist</b> 权限）</li>' +
      '<li>拉到最下面点 <b>Generate token</b>，复制 <b>ghp_</b> 开头那串</li>' +
      '<li>粘贴到下面点「连接」。另一台设备粘<b>同一个令牌</b>，数据就并到一起了</li>' +
    '</ol>' +
    '<div class="sync-input-row">' +
      '<input id="syncTokenInput" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 ghp_ 开头的令牌" />' +
      '<button class="primary" id="syncConnectBtn">连接</button>' +
    '</div>' +
    '<p class="small muted" style="margin-top:9px">令牌只存在本机浏览器，不会写进网页，也不会传给别的设备。' +
      '<a class="sync-link" href="https://github.com/settings/tokens/new?scopes=gist&description=study-plan-sync" target="_blank" rel="noopener">去创建令牌 →</a></p>';

  var ci = $('syncConnectBtn');
  if(ci) ci.onclick = function(){ connectSync($('syncTokenInput').value); };
  var ti = $('syncTokenInput');
  if(ti) ti.addEventListener('keydown', function(e){ if(e.key === 'Enter') connectSync(this.value); });
}

loadSync();
paintSyncUI();

/* ========== 版本 / 更新 / 网络状态 ========== */
function paintVersion(){
  var line = $('verLine');
  if(!line) return;
  var v = CFG.version || '2.0.0';
  var mode = (location.protocol === 'file:')
    ? '本地文件模式：数据只存在这台设备'
    : '装成应用后断网也能用';
  line.textContent = 'v' + v + ' · ' + mode;
}

function paintNet(){
  var b = $('netBanner');
  if(b) b.classList.toggle('show', !navigator.onLine);
}

function initPWA(){
  if(!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(function(reg){
    reg.addEventListener('updatefound', function(){
      var nw = reg.installing;
      if(!nw) return;
      nw.addEventListener('statechange', function(){
        if(nw.state === 'installed' && navigator.serviceWorker.controller){
          toast('发现新版本，正在更新…');
          setTimeout(function(){ location.reload(); }, 1200);
        }
      });
    });
  }).catch(function(){ /* 本地文件模式下忽略 */ });
}

var checkUpdateBtn = $('checkUpdate');
if(checkUpdateBtn){
  checkUpdateBtn.onclick = function(){
    if(location.protocol === 'file:'){
      toast('本地文件模式：替换文件后刷新即可');
      return;
    }
    if(!('serviceWorker' in navigator)){ location.reload(); return; }
    navigator.serviceWorker.getRegistration().then(function(reg){
      if(!reg){ location.reload(); return; }
      toast('正在检查更新…');
      reg.update().catch(function(){ toast('检查失败，请检查网络'); });
    });
  };
}

window.addEventListener('online', paintNet);
window.addEventListener('offline', paintNet);

/* 收尾 */
paintVersion();
paintNet();
initPWA();
syncStatus(sync.lastErr ? ('上次失败：' + sync.lastErr) : (sync.lastAt ? '已同步 · ' + fmtTime(sync.lastAt) : '尚未同步'), sync.lastErr ? 'err' : '');
if(sync.token){
  setTimeout(function(){ syncNow(false); }, 1200);
  if(!sync.login){
    api('/user').then(function(u){
      sync.login = u.login || '';
      saveSync();
      paintSyncUI();
    }).catch(function(){});
  }
}
document.addEventListener('visibilitychange', function(){
  if(!document.hidden && sync.token) scheduleSync(1000);
});

})();
