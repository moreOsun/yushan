/* ================= 御膳小册 Yushan - 应用逻辑（ES5，无框架） =================
 * 约定：CSS 类名统一 xc- 前缀；数据存 localStorage 键 xc_data_v1；
 *       菜谱与技巧数据来自 data-dishes.js / data-tips.js 的 window 全局。
 */
(function () {
  'use strict';

  var DISHES = window.DISHES || [];
  var PANTRY_DEF = window.PANTRY_DEFAULT || [];
  var ALIAS = window.ING_ALIAS || {};
  var PARENT = window.ING_PARENT || {};
  var GROUPS = window.ING_GROUPS || [];
  var TOPICS = window.TIP_TOPICS || [];
  var MAXIMS = window.MAXIMS || [];
  var QUOTES = window.QUOTES || [];

  var STORE_KEY = 'xc_data_v1';

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function on(el, type, fn) { if (el) el.addEventListener(type, fn); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 规范食材名：去空格 + 别名归一 */
  function norm(name) {
    var n = String(name || '').replace(/\s+/g, '');
    if (!n) return '';
    return ALIAS[n] || n;
  }

  /* 食材 → 分组名（冰箱展示、快速录入） */
  var GROUP_MAP = (function () {
    var m = {};
    for (var i = 0; i < GROUPS.length; i++) {
      for (var j = 0; j < GROUPS[i].items.length; j++) GROUP_MAP_SET(m, GROUPS[i].items[j], GROUPS[i].name);
    }
    return m;
  })();
  function GROUP_MAP_SET(m, k, v) { m[k] = v; }

  function groupOf(name) { return GROUP_MAP[name] || '其他'; }

  var toastTimer = null;
  function toast(msg) {
    var t = $('xc-toast');
    t.innerHTML = esc(msg);
    t.classList.remove('xc-hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('xc-hidden'); }, 1800);
  }

  /* ---------------- 数据状态 ---------------- */
  var state = load();

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    var s = { fridge: {}, pantry: PANTRY_DEF.slice(), favs: [], opt: { mainOnly: false }, matchLevel: 'full', levelV2: false };
    if (raw) {
      try {
        var d = JSON.parse(raw);
        if (d.fridge) s.fridge = d.fridge;
        if (d.pantry && d.pantry.length) s.pantry = d.pantry;
        if (d.favs) s.favs = d.favs;
        if (d.opt) s.opt.mainOnly = !!d.opt.mainOnly;
        /* v1.4.0：首屏默认档从「全部」改成「食材齐全」；老数据只迁移一次，之后用户手动选的全部会保留 */
        if (d.matchLevel) s.matchLevel = d.matchLevel;
        if (d.matchLevel === 'all' && !d.levelV2) s.matchLevel = 'full';
        s.levelV2 = true;
      } catch (e) { /* 数据损坏则回退默认 */ }
    }
    return s;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('本机存储被禁用，数据不会保留'); }
  }

  /* 当前“算作已有”的集合：常备调料 + 冰箱 + 冰箱食材的上位词 */
  function availableSet() {
    var set = {};
    var i;
    for (i = 0; i < state.pantry.length; i++) set[norm(state.pantry[i])] = 1;
    for (i in state.fridge) if (state.fridge.hasOwnProperty(i)) {
      set[i] = 2;                                   // 2 = 冰箱里真的有
      if (PARENT[i]) set[PARENT[i]] = Math.max(set[PARENT[i]] || 0, 1); // 1 = 靠上位词覆盖
    }
    return set;
  }

  /* 单道菜匹配计算 */
  function matchOf(dish, avail) {
    var need = [], seen = {}, k;
    function push(arr, role) {
      for (var i = 0; i < arr.length; i++) {
        var n = norm(arr[i]);
        if (!n || seen[n]) continue;
        seen[n] = 1;
        need.push({ name: n, role: role, pantry: state.pantry.indexOf(n) >= 0 });
      }
    }
    push(dish.main, '主料');
    push(dish.aux || [], '配料');

    var have = [], missing = [], mainOk = true;
    for (k = 0; k < need.length; k++) {
      var it = need[k];
      if (it.pantry) { continue; }                  // 常备调料不计入缺口
      if (avail[it.name]) have.push(it); else missing.push(it);
      if (it.role === '主料' && !avail[it.name]) mainOk = false;
    }
    var need2 = [];
    for (k = 0; k < need.length; k++) if (!need[k].pantry) need2.push(need[k]);

    return {
      items: need,                 // 含常备调料，详情页展示用
      need: need2,                 // 参与匹配的实际需求
      have: have,
      missing: missing,
      mainOk: mainOk,
      rate: need2.length ? Math.round((need2.length - missing.length) * 100 / need2.length) : 100,
      level: missing.length === 0 ? 'full' : (missing.length === 1 ? 'near' : 'miss')
    };
  }

  function matchAll() {
    var avail = availableSet();
    var out = [];
    for (var i = 0; i < DISHES.length; i++) {
      var m = matchOf(DISHES[i], avail);
      m.dish = DISHES[i];
      out.push(m);
    }
    var hasFridge = false;
    for (var k in state.fridge) if (state.fridge.hasOwnProperty(k)) { hasFridge = true; break; }
    if (!hasFridge) return { list: out, usable: out.slice(), hasFridge: false };

    out.sort(function (a, b) {
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      if (a.mainOk !== b.mainOk) return a.mainOk ? -1 : 1;
      return a.dish.time - b.dish.time;
    });
    return { list: out, usable: out, hasFridge: true };
  }

  function dishById(id) {
    for (var i = 0; i < DISHES.length; i++) if (DISHES[i].id === id) return DISHES[i];
    return null;
  }
  function isFav(id) { return state.favs.indexOf(id) >= 0; }

  /* ---------------- 视图切换 ---------------- */
  function showView(id) {
    var views = document.querySelectorAll('.xc-view');
    for (var i = 0; i < views.length; i++) views[i].classList.remove('xc-active');
    var v = $(id); if (v) v.classList.add('xc-active');
    var btns = document.querySelectorAll('.xc-tabbar button');
    for (i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('xc-on', btns[i].getAttribute('data-view') === id);
    }
    /* 切页时重算匹配，避免菜单/冰箱里拿着旧存货数据 */
    if (id === 'xc-view-menu') renderMenu();
    else if (id === 'xc-view-fridge') { renderQuick(); renderFridge(); }
    else if (id === 'xc-view-match') renderMatch();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document.body) {
      if (t.getAttribute && t.getAttribute('data-nav')) {
        showView(t.getAttribute('data-nav'));
        e.preventDefault();
        return;
      }
      t = t.parentNode;
    }
  });
  var tabs = document.querySelectorAll('.xc-tabbar button');
  for (var ti = 0; ti < tabs.length; ti++) {
    on(tabs[ti], 'click', function (e) { showView(e.currentTarget.getAttribute('data-view')); });
  }

  /* ---------------- 首屏：匹配结果 ---------------- */
  var LEVEL_TEXT = { full: '食材齐全', near: '只差 1 样', miss: '缺料' };

  function renderMatch() {
    var res = matchAll();
    var full = 0, near = 0;
    for (var i = 0; i < res.list.length; i++) {
      if (res.list[i].level === 'full') full++;
      else if (res.list[i].level === 'near') near++;
    }
    $('xc-brief-count').innerHTML = countFridge();
    $('xc-brief-full').innerHTML = full;
    $('xc-brief-near').innerHTML = near;
    $('xc-match-rule').innerHTML = res.hasFridge
      ? '已算上 ' + state.pantry.length + ' 种常备调料'
      : '先录入冰箱食材';

    var level = state.matchLevel;
    var list = res.list.filter(function (m) {
      if (state.opt.mainOnly && !m.mainOk) return false;
      if (level === 'all') return res.hasFridge ? m.level !== 'miss' : false;
      return m.level === level;
    });
    if (level === 'miss') {
      list = res.list.filter(function (m) { return m.missing.length >= 2 && (!state.opt.mainOnly || m.mainOk); });
    }

    var ul = $('xc-match-list'), html = '';
    for (i = 0; i < list.length; i++) html += dishRow(list[i], true);
    ul.innerHTML = html;
    /* 列表只占固定高度，多的菜在里面上下滑动，下面的“随机选一道”才不至于被拉太远 */
    ul.scrollTop = 0;
    var more = $('xc-match-more');
    if (more) {
      var overflow = ul.scrollHeight - ul.clientHeight > 8;
      more.classList.toggle('xc-hidden', !overflow);
      if (overflow) more.innerHTML = '共 ' + list.length + ' 道 · 列表内可上下滑动查看';
    }

    var empty = list.length === 0;
    $('xc-match-empty').classList.toggle('xc-hidden', !empty);
    $('xc-match-empty-tip').innerHTML = res.hasFridge
      ? (level === 'all' ? '这些食材还凑不出一道菜，再加点或放宽筛选'
        : (level === 'full' ? '食材齐全的还一道没有，点上面「只差 1 样」看看补一件就能做的'
          : '这个筛选条件下暂无菜品'))
      : '冰箱还空着';
    $('xc-match-sub').innerHTML = res.hasFridge
      ? '冰箱 ' + countFridge() + ' 种食材 · ' + full + ' 道直接可做'
      : '先录入冰箱食材，帮你算出能做的菜';
    window.__xcMatch = res;
  }

  function dishRow(m, showMiss) {
    var d = m.dish, cls = m.level === 'full' ? 'xc-full' : (m.level === 'near' ? 'xc-near' : '');
    var badge = m.level === 'full' ? 'xc-badge-ok' : (m.level === 'near' ? 'xc-badge-near' : 'xc-badge-miss');
    var h = '<li class="xc-dish-item ' + cls + '" data-id="' + d.id + '">';
    h += '<div class="xc-dish-row"><span class="xc-dish-name">' +
      (isFav(d.id) ? '<span class="xc-fav-star">★</span>' : '') + esc(d.name) + '</span>' +
      '<span class="xc-badge ' + badge + '">' + (m.level === 'miss' ? '缺 ' + m.missing.length + ' 样' : LEVEL_TEXT[m.level]) + '</span></div>';
    h += '<div class="xc-dish-info">' + esc(d.cat) + ' · ' + d.time + ' 分钟 · ' + esc(d.diff) +
      (d.tags.length ? ' · ' + esc(d.tags.join('/')) : '') + '</div>';
    if (showMiss && m.missing.length) {
      var ms = [];
      for (var i = 0; i < m.missing.length && i < 5; i++) ms.push(esc(m.missing[i].name));
      h += '<div class="xc-dish-miss">还差：<em>' + ms.join('、') + '</em>' + (m.missing.length > 5 ? ' 等 ' + m.missing.length + ' 样' : '') + '</div>';
    } else if (showMiss && m.level === 'full') {
      h += '<div class="xc-dish-miss">主料配料都齐，直接开火</div>';
    }
    h += '</li>';
    return h;
  }

  function countFridge() {
    var n = 0;
    for (var k in state.fridge) if (state.fridge.hasOwnProperty(k)) n++;
    return n;
  }

  $('xc-seg-match').addEventListener('click', function (e) {
    var b = e.target;
    if (b.tagName !== 'BUTTON') return;
    state.matchLevel = b.getAttribute('data-level');
    var bs = this.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('xc-on', bs[i] === b);
    save(); renderMatch();
  });

  on($('xc-sw-mainonly').parentNode, 'click', function () {
    state.opt.mainOnly = !state.opt.mainOnly;
    $('xc-sw-mainonly').classList.toggle('xc-on', state.opt.mainOnly);
    save(); renderMatch();
  });

  on($('xc-btn-lucky'), 'click', function () {
    var res = window.__xcMatch || matchAll();
    var pool = res.list.filter(function (m) { return m.level === 'full'; });
    if (!pool.length) pool = res.list.filter(function (m) { return m.level === 'near'; });
    if (!pool.length) { toast('冰箱食材还不够，先去录入吧'); return; }
    var pick = pool[Math.floor(Math.random() * pool.length)];
    toast('今天就它了：' + pick.dish.name);
    openDish(pick.dish.id);
  });

  /* 点开菜谱（两个列表共用） */
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document.body) {
      if (t.getAttribute && t.getAttribute('data-id') && t.className && /xc-dish-item/.test(t.className)) {
        openDish(t.getAttribute('data-id'));
        e.preventDefault();
        return;
      }
      t = t.parentNode;
    }
  });

  /* ---------------- 菜谱详情 ---------------- */
  var curDishId = null;

  function openDish(id) {
    var d = dishById(id);
    if (!d) return;
    curDishId = id;
    var m = matchOf(d, availableSet());

    $('xc-d-name').innerHTML = esc(d.name);
    $('xc-btn-fav').innerHTML = isFav(id) ? '★' : '☆';

    var meta = '<span class="xc-meta-tag">' + esc(d.cat) + '</span>' +
      '<span class="xc-meta-tag">约 ' + d.time + ' 分钟</span>' +
      '<span class="xc-meta-tag">' + esc(d.diff) + '</span>';
    for (var i = 0; i < d.tags.length; i++) meta += '<span class="xc-meta-tag">' + esc(d.tags[i]) + '</span>';
    $('xc-d-meta').innerHTML = meta;

    var box = $('xc-d-avail');
    if (m.level === 'full') {
      box.className = 'xc-dish-avail xc-avail-ok';
      box.innerHTML = '冰箱食材齐全，可以直接做';
    } else {
      var missTxt = [];
      for (i = 0; i < m.missing.length; i++) missTxt.push(esc(m.missing[i].name));
      box.className = 'xc-dish-avail ' + (m.level === 'near' ? 'xc-avail-mid' : 'xc-avail-no');
      box.innerHTML = '还缺 ' + m.missing.length + ' 样：' + missTxt.join('、') +
        '（点缺的食材可直接记入冰箱）';
    }

    var ing = '';
    for (i = 0; i < m.items.length; i++) {
      var it = m.items[i];
      var has = it.pantry || availableSet()[it.name];
      var cls = it.pantry ? 'xc-chip' : (has ? 'xc-chip xc-has' : 'xc-chip xc-miss');
      ing += '<span class="' + cls + '" ' + (!has && !it.pantry ? 'data-add="' + esc(it.name) + '"' : '') + '>' +
        '<i class="xc-ing-role">' + it.role + '</i>' + esc(it.name) +
        (it.pantry ? '<i class="xc-ing-note">常备</i>' : (has ? '' : '<i class="xc-x">＋补货</i>')) +
        '</span>';
    }
    $('xc-d-ings').innerHTML = ing;

    var steps = '';
    for (i = 0; i < d.steps.length; i++) steps += '<li>' + esc(d.steps[i]) + '</li>';
    $('xc-d-steps').innerHTML = steps;

    $('xc-d-tipwrap').classList.toggle('xc-hidden', !d.tip);
    $('xc-d-tip').innerHTML = esc(d.tip || '');

    $('xc-modal-dish').classList.remove('xc-hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeDish() {
    $('xc-modal-dish').classList.add('xc-hidden');
    document.body.style.overflow = '';
    curDishId = null;
  }
  on($('xc-btn-dish-close'), 'click', closeDish);
  on($('xc-modal-dish'), 'click', function (e) {
    if (e.target === this) closeDish();
  });

  on($('xc-btn-fav'), 'click', function () {
    if (!curDishId) return;
    var i = state.favs.indexOf(curDishId);
    if (i >= 0) { state.favs.splice(i, 1); toast('已取消收藏'); } else { state.favs.push(curDishId); toast('已收藏'); }
    save();
    this.innerHTML = i >= 0 ? '☆' : '★';
    renderMenu(); renderMatch();
  });

  /* 详情内的两个动作 */
  $('xc-d-ings').addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== this) {
      if (t.getAttribute && t.getAttribute('data-add')) {
        addFridge(t.getAttribute('data-add'), 1);
        toast('已把「' + t.getAttribute('data-add') + '」记入冰箱');
        openDish(curDishId);
        renderMatch(); renderFridge();
        return;
      }
      t = t.parentNode;
    }
  });

  on($('xc-btn-useup'), 'click', function () {
    if (!curDishId) return;
    var d = dishById(curDishId), m = matchOf(d, availableSet()), used = [];
    for (var i = 0; i < m.have.length; i++) {
      var n = m.have[i].name;
      if (!state.fridge[n]) continue;
      used.push(n);
      state.fridge[n].q -= 1;
      if (state.fridge[n].q <= 0) delete state.fridge[n];
    }
    if (!used.length) { toast('本菜食材都在常备调料里，无需扣减'); return; }
    save();
    toast('已扣减：' + used.join('、'));
    renderFridge(); renderQuick();
    openDish(curDishId);
    renderMatch();
  });

  /* ---------------- 冰箱视图 ---------------- */
  function addFridge(name, qty) {
    var n = norm(name);
    if (!n) return false;
    if (state.pantry.indexOf(n) >= 0) { toast('「' + n + '」属于常备调料，不必录入冰箱'); return false; }
    if (state.fridge[n]) state.fridge[n].q += (qty || 1);
    else state.fridge[n] = { q: qty || 1, t: Date.now() };
    save();
    return true;
  }

  function renderFridge() {
    var names = [];
    for (var k in state.fridge) if (state.fridge.hasOwnProperty(k)) names.push(k);
    $('xc-fridge-sub').innerHTML = names.length ? '共 ' + names.length + ' 种食材' : '冰箱还空着，先添加几样吧';
    $('xc-fri-count').innerHTML = names.length ? '（' + names.length + ' 种）' : '';

    var byGroup = {}, i;
    for (i = 0; i < names.length; i++) {
      var n = names[i], g = groupOf(n);
      (byGroup[g] || (byGroup[g] = [])).push(n);
    }
    var order = [], o;
    for (i = 0; i < GROUPS.length; i++) if (byGroup[GROUPS[i].name]) order.push(GROUPS[i].name);
    if (byGroup['其他']) order.push('其他');

    var html = '';
    if (!names.length) {
      html = '<p class="xc-tip">录入方式：手输食材名，或点上方常用食材快速添加。</p>';
    } else {
      for (i = 0; i < order.length; i++) {
        var gname = order[i], arr = byGroup[gname];
        arr.sort(function (a, b) { return state.fridge[b].t - state.fridge[a].t; });
        html += '<div class="xc-fri-group"><div class="xc-fri-gtitle">' + esc(gname) + '</div><div class="xc-chip-row">';
        for (var j = 0; j < arr.length; j++) {
          var it = state.fridge[arr[j]];
          html += '<span class="xc-fri-item" data-name="' + esc(arr[j]) + '">' + esc(arr[j]) +
            (it.q > 1 ? '<b>×' + it.q + '</b>' : '') +
            '<button class="xc-del" data-del="' + esc(arr[j]) + '" aria-label="删除">×</button></span>';
        }
        html += '</div></div>';
      }
      html += '<p class="xc-tip">点食材可减 1（做掉一份），点 × 直接删除该食材。</p>';
    }
    $('xc-fridge-groups').innerHTML = html;

    /* 常备调料芯片 */
    var ph = '';
    for (i = 0; i < state.pantry.length; i++) {
      ph += '<span class="xc-ing-chip">' + esc(state.pantry[i]) +
        '<button data-pdel="' + esc(state.pantry[i]) + '" aria-label="移除">×</button></span>';
    }
    $('xc-pantry-chips').innerHTML = ph;
  }

  /* 存货清单交互：减 1 / 删除 */
  $('xc-fridge-groups').addEventListener('click', function (e) {
    var t = e.target;
    if (!t.getAttribute) return;
    var del = t.getAttribute('data-del');
    if (del) {
      delete state.fridge[del];
      save(); renderFridge(); renderMatch();
      toast('已移除 ' + del);
      return;
    }
    var box = t.getAttribute('data-name') ? t : t.parentNode;
    var name = box && box.getAttribute ? box.getAttribute('data-name') : null;
    if (name && state.fridge[name]) {
      state.fridge[name].q -= 1;
      if (state.fridge[name].q <= 0) { delete state.fridge[name]; toast(name + ' 用完了'); }
      else toast(name + ' 剩余 ' + state.fridge[name].q);
      save(); renderFridge(); renderMatch();
    }
  });

  /* 常备调料增删 */
  $('xc-pantry-chips').addEventListener('click', function (e) {
    var t = e.target;
    var name = t.getAttribute && t.getAttribute('data-pdel');
    if (!name) return;
    var i = state.pantry.indexOf(name);
    if (i >= 0) state.pantry.splice(i, 1);
    save(); renderFridge(); renderMatch();
    toast('已从常备调料移除 ' + name);
  });

  on($('xc-btn-add-pantry'), 'click', function () {
    var v = $('xc-pantry-input').value.replace(/\s+/g, '');
    if (!v) return;
    if (state.pantry.indexOf(v) < 0) state.pantry.push(v);
    if (state.fridge[v]) delete state.fridge[v];
    $('xc-pantry-input').value = '';
    save(); renderFridge(); renderMatch();
    toast('已加入常备调料：' + v);
  });

  /* 快速录入：先选分组，再点食材 */
  var quickGroup = GROUPS.length ? GROUPS[0].name : '';
  function renderQuick() {
    var html = '';
    for (var i = 0; i < GROUPS.length; i++) {
      html += '<button data-vg="' + esc(GROUPS[i].name) + '"' + (GROUPS[i].name === quickGroup ? ' class="xc-on"' : '') + '>' +
        esc(GROUPS[i].name) + '</button>';
    }
    $('xc-quick-group').innerHTML = html;

    var items = [], g = null;
    for (i = 0; i < GROUPS.length; i++) if (GROUPS[i].name === quickGroup) g = GROUPS[i];
    if (g) items = g.items;
    var box = $('xc-quick-items');
    if (!box) {
      box = document.createElement('div');
      box.id = 'xc-quick-items';
      box.className = 'xc-chip-row';
      box.style.marginTop = '10px';
      $('xc-quick-group').parentNode.insertBefore(box, $('xc-quick-group').nextSibling);
    }
    var h2 = '';
    for (i = 0; i < items.length; i++) {
      var inFri = !!state.fridge[items[i]];
      h2 += '<button data-q="' + esc(items[i]) + '"' + (inFri ? ' class="xc-on"' : '') + '>' +
        esc(items[i]) + (inFri ? ' ✓' : '') + '</button>';
    }
    box.innerHTML = h2;
  }

  $('xc-quick-group').addEventListener('click', function (e) {
    var g = e.target.getAttribute && e.target.getAttribute('data-vg');
    if (!g) return;
    quickGroup = g;
    renderQuick();
  });

  document.addEventListener('click', function (e) {
    var t = e.target;
    var name = t.getAttribute && t.getAttribute('data-q');
    if (!name) return;
    if (addFridge(name, 1)) {
      toast(state.fridge[norm(name)].q > 1 ? name + ' 数量 +' : name + ' 已放入冰箱');
      renderQuick(); renderFridge(); renderMatch();
    }
  });

  function addFromInput() {
    var box = $('xc-fri-input');
    var raw = String(box.value).replace(/^[\s、]+|[\s、]+$/g, '');
    if (!raw) return;
    /* 支持“番茄 鸡蛋、土豆”一次录入多种（空格 / 中英文逗号顿号分号斜杠均可） */
    var parts = raw.split(/[\s,，、;；/]+/).filter(function (s) { return s.length; });
    var ok = 0, dup = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = norm(parts[i]);
      if (state.fridge[n]) dup++;
      if (addFridge(n, 1)) ok++;
    }
    box.value = '';
    if (ok) { renderQuick(); renderFridge(); renderMatch(); toast('已录入 ' + ok + ' 种食材' + (dup ? '（' + dup + ' 种累加数量）' : '')); }
    else if (parts.length) toast('没有可录入的新食材（可能是常备调料）');
  }
  on($('xc-btn-add-item'), 'click', addFromInput);
  on($('xc-fri-input'), 'keydown', function (e) { if (e.keyCode === 13) addFromInput(); });

  on($('xc-btn-clear-fri'), 'click', function () {
    if (!countFridge()) { toast('冰箱已经是空的'); return; }
    confirmBox('清空冰箱', '将删除全部 ' + countFridge() + ' 种存货记录，常备调料不受影响。', function () {
      state.fridge = {};
      save(); renderFridge(); renderQuick(); renderMatch();
      toast('冰箱已清空');
    });
  });

  /* ---------------- 菜单库 ---------------- */
  var CATS = ['全部', '收藏', '荤菜', '素菜', '蛋豆', '汤羹', '主食', '凉菜', '早餐', '宴客'];
  var curCat = '全部', curKw = '';

  function renderCats() {
    var html = '';
    for (var i = 0; i < CATS.length; i++) {
      html += '<button data-cat="' + CATS[i] + '"' + (CATS[i] === curCat ? ' class="xc-on"' : '') + '>' +
        CATS[i] + (CATS[i] === '收藏' && state.favs.length ? ' ' + state.favs.length : '') + '</button>';
    }
    $('xc-seg-cat').innerHTML = html;
  }

  function renderMenu() {
    var avail = availableSet();
    var html = '', n = 0;
    for (var i = 0; i < DISHES.length; i++) {
      var d = DISHES[i];
      if (curCat === '收藏') { if (!isFav(d.id)) continue; }
      else if (curCat !== '全部' && d.cat !== curCat) continue;
      if (curKw) {
        var hay = (d.name + '|' + d.cat + '|' + d.tags.join('') + '|' + d.main.join('') + '|' + (d.aux || []).join('')).toLowerCase();
        if (hay.indexOf(curKw.toLowerCase()) < 0) continue;
      }
      var m = matchOf(d, avail);
      m.dish = d;
      html += dishRow(m, true);
      n++;
    }
    $('xc-menu-list').innerHTML = html;
    $('xc-menu-empty').classList.toggle('xc-hidden', n > 0);
    if (curCat === '收藏' && !state.favs.length) $('xc-menu-empty').innerHTML = '<p>还没有收藏，点开菜谱右上角 ☆ 收藏</p>';
    else $('xc-menu-empty').innerHTML = '<p>没有匹配的菜品</p>';
  }

  $('xc-seg-cat').addEventListener('click', function (e) {
    var c = e.target.getAttribute && e.target.getAttribute('data-cat');
    if (!c) return;
    curCat = c;
    renderCats(); renderMenu();
  });
  on($('xc-menu-search'), 'input', function () { curKw = this.value; renderMenu(); });

  /* ---------------- 技巧 ---------------- */
  var curTopic = TOPICS.length ? TOPICS[0].name : '';

  function renderTopics() {
    var html = '';
    for (var i = 0; i < TOPICS.length; i++) {
      html += '<button data-tp="' + esc(TOPICS[i].name) + '"' +
        (TOPICS[i].name === curTopic ? ' class="xc-on"' : '') + '>' + esc(TOPICS[i].name) + '</button>';
    }
    $('xc-seg-topic').innerHTML = html;
  }

  function renderTips() {
    var tp = null, i;
    for (i = 0; i < TOPICS.length; i++) if (TOPICS[i].name === curTopic) tp = TOPICS[i];
    var html = '';
    if (tp) {
      for (i = 0; i < tp.cards.length; i++) {
        var c = tp.cards[i];
        html += '<div class="xc-tip-card"><h3>' + esc(c.t) + '</h3><ul>';
        for (var j = 0; j < c.points.length; j++) html += '<li>' + esc(c.points[j]) + '</li>';
        html += '</ul></div>';
      }
    }
    $('xc-tip-list').innerHTML = html;
  }

  $('xc-seg-topic').addEventListener('click', function (e) {
    var t = e.target.getAttribute && e.target.getAttribute('data-tp');
    if (!t) return;
    curTopic = t;
    renderTopics(); renderTips();
    window.scrollTo(0, 0);
  });

  function renderMaxims() {
    var html = '';
    for (var i = 0; i < MAXIMS.length; i++) html += '<li>' + esc(MAXIMS[i]) + '</li>';
    $('xc-maxim-list').innerHTML = html;
  }

  /* ---------------- 通用确认框 ---------------- */
  var confirmCb = null;
  function confirmBox(title, msg, cb) {
    $('xc-confirm-title').innerHTML = esc(title);
    $('xc-confirm-msg').innerHTML = esc(msg);
    confirmCb = cb;
    $('xc-modal-confirm').classList.remove('xc-hidden');
  }
  on($('xc-confirm-cancel'), 'click', function () {
    $('xc-modal-confirm').classList.add('xc-hidden'); confirmCb = null;
  });
  on($('xc-confirm-ok'), 'click', function () {
    $('xc-modal-confirm').classList.add('xc-hidden');
    var cb = confirmCb; confirmCb = null;
    if (cb) cb();
  });

  /* ---------------- 今日膳语（按年序固定，365 天不重复） ---------------- */
  var quoteOffset = 0;

  function dayOfYear(d) {
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d.getTime() - start.getTime()) / 86400000);
  }

  function renderQuote() {
    if (!QUOTES.length || !$('xc-quote-text')) return;
    var n = QUOTES.length;
    var doy = dayOfYear(new Date());
    var idx = ((doy - 1 + quoteOffset) % n + n) % n;
    $('xc-quote-text').innerHTML = esc(QUOTES[idx]);
    var d = new Date();
    $('xc-quote-date').innerHTML = esc((d.getMonth() + 1) + '月' + d.getDate() + '日 · 第 ' + (idx + 1) + '/' + n + ' 句');
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    $('xc-sw-mainonly').classList.toggle('xc-on', state.opt.mainOnly);
    var lv = $('xc-seg-match').querySelectorAll('button');
    for (var i = 0; i < lv.length; i++) {
      lv[i].classList.toggle('xc-on', lv[i].getAttribute('data-level') === state.matchLevel);
    }
    renderQuick();
    renderFridge();
    renderMatch();
    renderCats();
    renderMenu();
    renderTopics();
    renderTips();
    renderMaxims();

    var ver = 'v1.4.0';
    var meta = document.querySelector('meta[name="app-version"]');
    if (meta) ver = meta.getAttribute('content');
    on($('xc-quote-swap'), 'click', function () { quoteOffset++; renderQuote(); });
    renderQuote();

    var vls = document.querySelectorAll('.xc-version-line');
    var vtext = '御膳小册 Yushan ' + ver + ' · 内置 ' + DISHES.length + ' 道菜谱 · 离线可用';
    for (var vi = 0; vi < vls.length; vi++) vls[vi].innerHTML = vtext;

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 预览环境忽略 */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
