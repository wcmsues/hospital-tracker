(function () {
  'use strict';

  /* ---------------- 基础数据 ---------------- */
  var ST = {
    todo:      { n: '未投',    c: 'todo' },
    applied:   { n: '已投',    c: 'applied' },
    screening: { n: '筛选中',  c: 'screening' },
    interview: { n: '面试',    c: 'interview' },
    offer:     { n: 'Offer',   c: 'offer' },
    rejected:  { n: '未通过',  c: 'rejected' },
    skip:      { n: '不投',    c: 'skip' }
  };
  var ST_ORDER = ['todo', 'applied', 'screening', 'interview', 'offer', 'rejected', 'skip'];
  var CHANNELS = ['官网在线', '邮箱', '区统招', '丁香人才', 'BOSS直聘', '猎聘', '内推', '宣讲会', '其他'];
  var KEY = 'hmt.records.v1';
  var CKEY = 'hmt.custom.v1';

  var mem = {};
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  };

  var BUILTIN = (window.HOSPITALS || []).slice();
  var custom = readJson(CKEY, []);
  var records = readJson(KEY, {});
  var state = { tab: 'list', q: '', priority: 'all', status: 'all' };
  var curId = null;
  var editingId = null;
  var notices = null;

  function readJson(k, def) {
    try { var raw = LS.get(k); if (raw) return JSON.parse(raw); } catch (e) {}
    return def;
  }
  function saveRecords() { LS.set(KEY, JSON.stringify(records)); }
  function saveCustom() { LS.set(CKEY, JSON.stringify(custom)); }

  function all() { return BUILTIN.concat(custom); }
  function byId(id) {
    var arr = all();
    for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === String(id)) return arr[i];
    return null;
  }
  function getRec(id) {
    var r = records[id];
    if (r) {
      if (!r.channels) r.channels = [];
      if (!r.log) r.log = [];
      return r;
    }
    return { status: 'todo', appliedAt: '', followUp: '', channels: [], note: '', log: [] };
  }
  function touch(id) {
    if (!records[id]) records[id] = getRec(id);
    return records[id];
  }

  /* ---------------- 工具 ---------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    var t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  function parseD(s) {
    if (!s) return null;
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function dayDiff(a, b) {
    var da = parseD(a), db = parseD(b);
    if (!da || !db) return 0;
    return Math.round((da - db) / 86400000);
  }
  function fmt(s) {
    var d = parseD(s);
    if (!d) return '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function copyText(text, okMsg) {
    if (!text) { toast('没有可复制的内容'); return; }
    var done = function () { toast(okMsg || '已复制'); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        toast(ok ? (okMsg || '已复制') : '复制失败，请长按选择');
      } catch (e) { toast('复制失败，请长按选择'); }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  /* ---------------- 列表 ---------------- */
  function statusOf(h) { return getRec(h.id).status; }

  function filtered() {
    var kw = state.q.trim().toLowerCase();
    return all().filter(function (h) {
      if (state.priority !== 'all' && h.priority !== state.priority) return false;
      if (state.status !== 'all') {
        if (state.status === 'hiring') {
          if (h.hiring !== '在招' && h.hiring !== '常年招') return false;
        } else if (statusOf(h) !== state.status) return false;
      }
      if (kw) {
        var hay = (h.name + ' ' + h.district + ' ' + h.channel + ' ' + h.note + ' ' + h.level + ' ' + h.address).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
  }

  function rowHtml(h) {
    var r = getRec(h.id);
    var st = ST[r.status] || ST.todo;
    var dotCls = h.priority === '主投' ? 'main' : h.priority === '可冲' ? 'mid' : 'back';
    var metaParts = [h.level, h.district];
    var chs = r.channels.length ? r.channels : (h.guessChannels || []);
    if (chs.length) metaParts.push(chs.join(' / '));
    if (r.followUp && (r.status === 'applied' || r.status === 'screening' || r.status === 'interview')) {
      metaParts.push('跟进 ' + fmt(r.followUp));
    }
    return '' +
      '<div class="row" data-id="' + h.id + '">' +
        '<span class="dot ' + dotCls + '"></span>' +
        '<div class="row-main">' +
          '<div class="row-title">' + esc(h.name) + '</div>' +
          '<div class="row-meta">' + esc(metaParts.join(' · ')) + '</div>' +
        '</div>' +
        '<span class="tag ' + st.c + '">' + st.n + '</span>' +
      '</div>';
  }

  function renderNoticeBar() {
    var el = document.getElementById('noticeBar');
    if (!el) return;
    if (!notices || !notices.items || !notices.items.length) { el.innerHTML = ''; return; }
    var fresh = notices.items.filter(function (x) { return x.isNew; });
    var hospSet = {};
    notices.items.forEach(function (x) { hospSet[x.hospital] = 1; });
    var hn = Object.keys(hospSet).length;
    var upd = notices.today ? (notices.today.slice(5).replace('-', '/')) : '';
    el.innerHTML =
      '<div class="notice-bar' + (fresh.length ? ' hot' : '') + '" data-act="notices">' +
        '<span class="live"></span>' +
        '<div class="txt">' + (fresh.length
          ? '新增 <b>' + fresh.length + ' 个岗位</b> · ' + hn + ' 家在招'
          : '<b>' + notices.items.length + '</b> 个护理岗在招 · ' + hn + ' 家') +
        '</div>' +
        (upd ? '<span class="upd">' + upd + '</span>' : '') +
        '<svg class="chev" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 1L6.5 6.5L1.5 12"/></svg>' +
      '</div>';
  }

  function endText(v) {
    if (!v) return '';
    var y = v.slice(0, 4), md = v.slice(5).replace('-', '/');
    return (y === String(new Date().getFullYear())) ? md + '止' : v.replace(/-/g, '/') + '止';
  }
  function shortJob(v) {
    if (!v) return '';
    var parts = String(v).split('/').filter(Boolean);
    if (parts.length > 1 && parts[1].indexOf(parts[0]) === 0) parts = [parts[0]];
    return parts.join(' / ');
  }
  function shortEdu(v) {
    return String(v || '').replace('及以上', '').replace('高职（专科）', '大专');
  }
  function shortTitle(v) {
    return String(v || '').replace('及以上', '');
  }

  function openNotices() {
    if (!notices || !notices.items.length) return;
    document.getElementById('sheetTitle').textContent = '市平台在招岗位';
    document.getElementById('sheetSave').style.display = 'none';
    document.getElementById('sheetCancel').textContent = '关闭';
    var items = notices.items.slice().sort(function (a, b) {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return (b.start || '').localeCompare(a.start || '');
    });
    document.getElementById('sheetBody').innerHTML =
      '<div class="group" style="margin-top:14px"><div class="card">' +
        items.map(function (x) {
          return '<div class="row" data-hid="' + x.hospitalId + '">' +
            '<div class="row-main">' +
              '<div class="row-title">' + esc(x.hospital) + '</div>' +
              '<div class="row-meta">' + esc(shortJob(x.job)) + ' · ' + x.num + '人 · ' +
                esc(shortEdu(x.edu)) + (x.title && x.title.indexOf('不作') === -1 ? ' · ' + esc(shortTitle(x.title)) : '') +
                (x.end ? ' · ' + endText(x.end) : '') + '</div>' +
            '</div>' +
            (x.isNew ? '<span class="tag offer">新</span>' : '') +
          '</div>';
        }).join('') +
      '</div></div>' +
      '<div class="hint">数据来自上海卫生人才网公开岗位，每天自动更新两次。' +
      '这里的岗位多为医院自主招聘，与区统招不冲突，可同时报名。</div>';
    showSheet();
  }

  document.getElementById('noticeBar').addEventListener('click', function (e) {
    if (e.target.closest('[data-act="notices"]')) openNotices();
  });

  document.getElementById('sheetBody').addEventListener('click', function (e) {
    var row = e.target.closest('[data-hid]');
    if (!row) return;
    var id = row.dataset.hid;
    hideSheet();
    setTimeout(function () { openDetail(id); }, 260);
  });

  function loadNotices() {
    fetch('notices.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.items) { notices = d; renderNoticeBar(); } })
      .catch(function () {});
  }

  function renderList() {
    var list = filtered();
    var body = document.getElementById('listBody');
    var total = all().length;
    var hiring = all().filter(function (h) { return h.hiring === '在招'; }).length;
    var appliedCnt = all().filter(function (h) {
      var s = statusOf(h); return s !== 'todo' && s !== 'skip';
    }).length;
    document.getElementById('listSub').textContent =
      total + ' 家 · 主投 ' + all().filter(function (h) { return h.priority === '主投'; }).length +
      ' · 正在招 ' + hiring + ' · 已投 ' + appliedCnt;

    if (!list.length) {
      body.innerHTML = '<div class="empty">没有匹配的医院<br>试试换个筛选条件</div>';
      return;
    }

    var groups = [
      { k: '主投', label: '主投' },
      { k: '可冲', label: '可冲' },
      { k: '备选', label: '备选' }
    ];
    var html = '';
    groups.forEach(function (g) {
      var items = list.filter(function (h) { return h.priority === g.k; });
      if (!items.length) return;
      html += '<div class="group">' +
        '<div class="group-head"><b>' + g.label + '</b><span>' + items.length + ' 家</span></div>' +
        '<div class="card">' + items.map(rowHtml).join('') + '</div>' +
        '</div>';
    });
    body.innerHTML = html;
  }

  document.getElementById('listBody').addEventListener('click', function (e) {
    var row = e.target.closest('.row');
    if (row && row.dataset.id) openDetail(row.dataset.id);
  });

  /* ---------------- 详情 ---------------- */
  function detailHtml(h) {
    var r = getRec(h.id);
    var st = ST[r.status] || ST.todo;
    var chs = r.channels.length ? r.channels : [];
    var hiringCls = h.hiring === '在招' ? 'hiring' : (h.hiring === '常年招' ? '' : 'closed');

    var statusBtns = ST_ORDER.map(function (k) {
      return '<button class="sbtn ' + k + (r.status === k ? ' on' : '') + '" data-act="status" data-v="' + k + '">' + ST[k].n + '</button>';
    }).join('');

    var chBtns = CHANNELS.map(function (c) {
      var on = chs.indexOf(c) > -1;
      return '<button class="chip' + (on ? ' on' : '') + '" data-act="channel" data-v="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');

    var contact = '';
    if (h.email) {
      contact += '<div class="field"><span class="lb" style="color:var(--label2);font-size:15px">邮箱</span>' +
        '<span class="vl" style="color:var(--label);font-size:15px">' + esc(h.email) + '</span>' +
        '<button class="mini-btn" data-act="copy-email">复制</button></div>';
    }
    if (h.phone) {
      contact += '<div class="field"><span class="lb" style="color:var(--label2);font-size:15px">电话</span>' +
        '<span class="vl" style="color:var(--label);font-size:15px">' + esc(h.phone) + '</span>' +
        '<button class="mini-btn" data-act="copy-phone">复制</button></div>';
    }

    var logHtml = '';
    if (r.log && r.log.length) {
      logHtml = '<div class="tl">' + r.log.slice().reverse().map(function (l, i, arr) {
        var s = ST[l.s] || ST.todo;
        return '<div class="tl-item"><div class="tl-dot"></div>' +
          '<div class="tl-line"></div><div class="tl-body">' +
          '<div class="tl-t">' + s.n + '</div>' +
          '<div class="tl-d">' + (l.at || '') + '</div></div></div>';
      }).join('') + '</div>';
    }

    return '' +
    '<div class="d-head">' +
      '<h1 class="d-title">' + esc(h.name) + '</h1>' +
      '<div class="d-tags">' +
        '<span class="d-tag">' + esc(h.level || '未定级') + '</span>' +
        '<span class="d-tag">' + esc(h.district || '') + '</span>' +
        '<span class="d-tag p-main">' + esc(h.priority || '') + '</span>' +
        '<span class="d-tag ' + hiringCls + '">' + esc(h.hiring || '') + '</span>' +
      '</div>' +
    '</div>' +

    '<div class="group">' +
      '<div class="group-head"><b>投递状态</b><span>点选即可更新</span></div>' +
      '<div class="card pad"><div class="status-grid">' + statusBtns + '</div></div>' +
    '</div>' +

    '<div class="group">' +
      '<div class="group-head"><b>投递记录</b></div>' +
      '<div class="card">' +
        '<div class="field"><span class="lb">投递日期</span>' +
          '<input type="date" data-f="appliedAt" class="' + (r.appliedAt ? 'hasval' : '') + '" value="' + esc(r.appliedAt || '') + '"></div>' +
        '<div class="field"><span class="lb">下次跟进</span>' +
          '<input type="date" data-f="followUp" class="' + (r.followUp ? 'hasval' : '') + '" value="' + esc(r.followUp || '') + '"></div>' +
      '</div>' +
      '<div class="group-head" style="margin-top:14px"><b>投递渠道</b><span>可多选</span></div>' +
      '<div class="card"><div class="channel-wrap">' + chBtns + '</div></div>' +
    '</div>' +

    '<div class="group">' +
      '<div class="group-head"><b>投递方式</b></div>' +
      '<div class="card">' +
        '<div style="padding:12px 14px 1px;font-size:12.5px;color:var(--label2)">投递说明</div>' +
        '<div style="padding:1px 14px 12px;font-size:15px;line-height:1.55;color:var(--label)">' + esc(h.channel || '—') + '</div>' +
        contact +
      '</div>' +
      '<div class="actions">' +
        (h.url ? '<button class="btn primary" data-act="open">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h5"/></svg>' +
          '打开投递页</button>' : '') +
        '<button class="btn secondary" data-act="copy-channel">复制投递方式</button>' +
      '</div>' +
    '</div>' +

    '<div class="group">' +
      '<div class="group-head"><b>岗位门槛</b></div>' +
      '<div class="card"><div style="padding:12px 14px;font-size:15px;line-height:1.6;color:var(--label2)">' + esc(h.note || '—') + '</div></div>' +
    '</div>' +

    '<div class="group">' +
      '<div class="group-head"><b>我的备注</b></div>' +
      '<div class="card"><textarea class="note-box" data-f="note" placeholder="面试时间、联系人、薪资、通勤……">' + esc(r.note || '') + '</textarea></div>' +
    '</div>' +

    (r.log && r.log.length ? '<div class="group"><div class="group-head"><b>时间线</b></div><div class="card">' + logHtml + '</div></div>' : '') +

    '<div class="group">' +
      '<div class="group-head"><b>医院信息</b></div>' +
      '<div class="card">' +
        '<div class="field"><span class="lb">等级</span><span class="vl">' + esc(h.level || '—') + '</span></div>' +
        '<div class="field"><span class="lb">区域</span><span class="vl">' + esc(h.district || '—') + '</span></div>' +
        '<div class="field"><span class="lb">地址</span><span class="vl" style="max-width:64%">' + esc(h.address || '—') + '</span></div>' +
        '<div class="field"><span class="lb">招聘状态</span><span class="vl">' + esc(h.hiring || '—') + '</span></div>' +
      '</div>' +
    '</div>' +

    (h.custom ? '<div class="actions" style="margin-top:22px"><button class="btn ghost" data-act="del" style="color:var(--red)">删除这家医院</button></div>' : '') +
    '<div style="height:20px"></div>';
  }

  function renderDetail() {
    var h = byId(curId);
    if (!h) return;
    document.getElementById('detailBody').innerHTML = detailHtml(h);
  }

  function openDetail(id) {
    curId = id;
    renderDetail();
    var d = document.getElementById('detail');
    d.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDetail() {
    var d = document.getElementById('detail');
    d.classList.remove('open');
    document.body.style.overflow = '';
    curId = null;
    renderList();
    if (state.tab === 'progress') renderProgress();
  }

  document.getElementById('btnBack').addEventListener('click', closeDetail);

  document.getElementById('detailBody').addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;
    var h = byId(curId);
    if (!h) return;

    if (act === 'status') {
      setStatus(h.id, el.dataset.v);
    } else if (act === 'channel') {
      var r = touch(h.id);
      var c = el.dataset.v;
      var i = r.channels.indexOf(c);
      if (i > -1) r.channels.splice(i, 1); else r.channels.push(c);
      saveRecords();
      el.classList.toggle('on');
    } else if (act === 'open') {
      if (h.url) window.open(h.url, '_blank', 'noopener');
    } else if (act === 'copy-email') {
      copyText(h.email, '邮箱已复制');
    } else if (act === 'copy-phone') {
      copyText(h.phone, '电话已复制');
    } else if (act === 'copy-channel') {
      var txt = h.name + '\n' + (h.channel || '');
      if (h.email) txt += '\n邮箱：' + h.email;
      if (h.phone) txt += '\n电话：' + h.phone;
      if (h.url) txt += '\n链接：' + h.url;
      copyText(txt, '投递信息已复制');
    } else if (act === 'del') {
      if (confirm('确定删除「' + h.name + '」？')) {
        custom = custom.filter(function (x) { return String(x.id) !== String(h.id); });
        saveCustom();
        delete records[h.id];
        saveRecords();
        closeDetail();
        renderList();
      }
    }
  });

  document.getElementById('detailBody').addEventListener('change', function (e) {
    var el = e.target.closest('[data-f]');
    if (!el || !curId) return;
    var r = touch(curId);
    var f = el.dataset.f;
    r[f] = el.value;
    if (f === 'appliedAt' && el.value && r.status === 'todo') {
      r.status = 'applied';
      r.log.push({ s: 'applied', at: el.value });
      renderDetail();
    }
    saveRecords();
    if (f === 'followUp') renderDetail();
  });

  document.getElementById('detailBody').addEventListener('input', function (e) {
    var el = e.target.closest('[data-f="note"]');
    if (!el || !curId) return;
    var r = touch(curId);
    r.note = el.value;
    saveRecords();
  });

  function setStatus(id, s) {
    var r = touch(id);
    var old = r.status;
    if (old === s) return;
    r.status = s;
    if ((s === 'applied' || s === 'screening' || s === 'interview' || s === 'offer' || s === 'rejected') && !r.appliedAt) {
      r.appliedAt = todayStr();
    }
    r.log.push({ s: s, at: todayStr() });
    if (s === 'applied' && !r.followUp) {
      var d = new Date();
      d.setDate(d.getDate() + 7);
      r.followUp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    saveRecords();
    renderDetail();
    toast('已更新为「' + ST[s].n + '」');
  }

  /* ---------------- 进度 ---------------- */
  function computeStats() {
    var s = { total: 0, todo: 0, skip: 0, applied: 0, screening: 0, interview: 0, offer: 0, rejected: 0, responded: 0, iv: 0 };
    all().forEach(function (h) {
      s.total++;
      var st = statusOf(h);
      if (st === 'todo') { s.todo++; return; }
      if (st === 'skip') { s.skip++; return; }
      s.applied++;
      if (st === 'screening') s.screening++;
      if (st === 'interview') s.interview++;
      if (st === 'offer') s.offer++;
      if (st === 'rejected') s.rejected++;
      if (st === 'screening' || st === 'interview' || st === 'offer') s.responded++;
      if (st === 'interview' || st === 'offer') s.iv++;
    });
    return s;
  }

  function needFollow() {
    var t = todayStr();
    var out = [];
    all().forEach(function (h) {
      var r = getRec(h.id);
      if (r.status !== 'applied' && r.status !== 'screening' && r.status !== 'interview') return;
      var reason = '', d = 0;
      if (r.followUp && r.followUp <= t) {
        d = Math.max(0, dayDiff(t, r.followUp));
        reason = d === 0 ? '今天该跟进' : '已逾期 ' + d + ' 天';
      } else if (r.status === 'applied' && r.appliedAt) {
        var days = dayDiff(t, r.appliedAt);
        if (days >= 7) { d = days; reason = '投递 ' + days + ' 天无更新'; }
      }
      if (reason) out.push({ h: h, r: r, reason: reason, d: d });
    });
    return out.sort(function (a, b) { return b.d - a.d; });
  }

  function renderProgress() {
    var s = computeStats();
    document.getElementById('progressSub').textContent =
      '已投 ' + s.applied + ' / ' + s.total + ' 家 · 还有 ' + s.todo + ' 家没动';

    document.getElementById('statsGrid').innerHTML = '' +
      '<div class="stat blue"><div class="n">' + s.applied + '<small>/' + s.total + '</small></div><div class="l">已投递</div></div>' +
      '<div class="stat orange"><div class="n">' + s.responded + '</div><div class="l">有回应</div></div>' +
      '<div class="stat purple"><div class="n">' + s.iv + '</div><div class="l">进面试</div></div>' +
      '<div class="stat green"><div class="n">' + s.offer + '</div><div class="l">Offer</div></div>';

    var maxV = Math.max(s.applied, 1);
    var rows = [
      { l: '已投递', v: s.applied, c: 'var(--blue)' },
      { l: '有回应', v: s.responded, c: 'var(--orange)' },
      { l: '进面试', v: s.iv, c: 'var(--purple)' },
      { l: 'Offer', v: s.offer, c: 'var(--green)' }
    ];
    document.getElementById('funnel').innerHTML = rows.map(function (x) {
      var w = Math.min(100, Math.round(x.v / maxV * 100));
      return '<div class="fn-row"><span class="fn-label">' + x.l + '</span>' +
        '<div class="fn-bar"><i style="width:' + w + '%;background:' + x.c + '"></i></div>' +
        '<span class="fn-val">' + x.v + '</span></div>';
    }).join('');
    document.getElementById('funnelRate').textContent =
      s.applied ? '进面率 ' + Math.round(s.iv / s.applied * 100) + '%' : '';

    var fu = needFollow();
    document.getElementById('followCount').textContent = fu.length ? fu.length + ' 家' : '暂无';
    document.getElementById('followList').innerHTML = fu.length
      ? fu.map(function (x) {
          var st = ST[x.r.status] || ST.todo;
          return '<div class="row" data-fid="' + x.h.id + '">' +
            '<div class="row-main"><div class="row-title">' + esc(x.h.name) + '</div>' +
            '<div class="row-meta">' + esc(x.reason) + ' · ' + esc(x.h.district) + '</div></div>' +
            '<span class="tag ' + st.c + '">' + st.n + '</span></div>';
        }).join('')
      : '<div style="padding:22px 14px;text-align:center;color:var(--label2);font-size:14px">暂时没有需要跟进的</div>';

    /* 渠道统计 */
    var chMap = {};
    all().forEach(function (h) {
      var r = getRec(h.id);
      if (r.status === 'todo' || r.status === 'skip') return;
      var chs = r.channels.length ? r.channels : (h.guessChannels || []);
      chs.forEach(function (c) {
        chMap[c] = chMap[c] || { n: 0, iv: 0 };
        chMap[c].n++;
        if (r.status === 'interview' || r.status === 'offer') chMap[c].iv++;
      });
    });
    var chArr = Object.keys(chMap).map(function (k) {
      return { k: k, n: chMap[k].n, iv: chMap[k].iv };
    }).sort(function (a, b) { return b.n - a.n; });
    var chMax = chArr.length ? chArr[0].n : 1;
    document.getElementById('channelStats').innerHTML = chArr.length
      ? chArr.map(function (x) {
          return '<div class="mini-bar"><span class="k">' + esc(x.k) + '</span>' +
            '<div class="t"><i style="width:' + Math.round(x.n / chMax * 100) + '%"></i></div>' +
            '<span class="v">' + x.n + ' / ' + (x.n ? Math.round(x.iv / x.n * 100) : 0) + '%</span></div>';
        }).join('')
      : '<div style="padding:14px 0;text-align:center;color:var(--label2);font-size:14px">还没有投递记录</div>';

    /* 区域统计 */
    var dMap = {};
    all().forEach(function (h) {
      var d = h.district || '其他';
      dMap[d] = dMap[d] || { n: 0, t: 0 };
      dMap[d].t++;
      var st = statusOf(h);
      if (st !== 'todo' && st !== 'skip') dMap[d].n++;
    });
    var dArr = Object.keys(dMap).map(function (k) {
      return { k: k, n: dMap[k].n, t: dMap[k].t };
    }).sort(function (a, b) { return b.t - a.t; });
    var dMax = dArr.length ? dArr[0].t : 1;
    document.getElementById('districtStats').innerHTML = dArr.map(function (x) {
      return '<div class="mini-bar"><span class="k">' + esc(x.k) + '</span>' +
        '<div class="t"><i style="width:' + Math.round(x.n / dMax * 100) + '%;background:var(--green)"></i></div>' +
        '<span class="v">' + x.n + ' / ' + x.t + '</span></div>';
    }).join('');
  }

  document.getElementById('followList').addEventListener('click', function (e) {
    var row = e.target.closest('[data-fid]');
    if (row) {
      switchTab('list');
      openDetail(row.dataset.fid);
    }
  });

  /* ---------------- 设置 ---------------- */
  function backupObj() {
    return { v: 1, exportedAt: todayStr(), records: records, custom: custom };
  }
  function renderSettings() {
    document.getElementById('aboutTotal').textContent = all().length + ' 家';
  }
  document.getElementById('btnExport').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(backupObj(), null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '投递清单备份-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    toast('备份已导出');
  });
  document.getElementById('btnCopyBackup').addEventListener('click', function () {
    copyText(JSON.stringify(backupObj()), '备份已复制到剪贴板');
  });
  document.getElementById('btnImport').addEventListener('click', function () {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var obj = JSON.parse(fr.result);
        if (obj.records) { records = obj.records; saveRecords(); }
        if (obj.custom) { custom = obj.custom; saveCustom(); }
        renderList(); renderSettings();
        if (state.tab === 'progress') renderProgress();
        toast('恢复成功');
      } catch (err) { toast('文件格式不对'); }
    };
    fr.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('btnReset').addEventListener('click', function () {
    if (confirm('清空所有投递记录？医院清单会保留，但状态、备注、日期都会删除。')) {
      records = {};
      saveRecords();
      renderList(); renderProgress(); renderSettings();
      toast('已清空');
    }
  });

  /* ---------------- 添加医院 ---------------- */
  function openSheet() {
    editingId = null;
    document.getElementById('sheetTitle').textContent = '添加医院';
    document.getElementById('sheetSave').style.display = '';
    document.getElementById('sheetCancel').textContent = '取消';
    document.getElementById('sheetBody').innerHTML = '' +
      '<div class="form-group"><div class="card">' +
        '<input class="f-input" id="fName" placeholder="医院名称（必填）" autocomplete="off">' +
      '</div></div>' +
      '<div class="form-group"><div class="card">' +
        '<div class="f-label">等级</div><input class="f-input" id="fLevel" placeholder="如 三级甲等">' +
        '<div class="f-label">区域</div><input class="f-input" id="fDistrict" placeholder="如 浦东新区">' +
        '<div class="f-label">优先级</div><select class="f-input" id="fPriority"><option>主投</option><option>可冲</option><option>备选</option></select>' +
        '<div class="f-label">招聘状态</div><select class="f-input" id="fHiring"><option>在招</option><option>常年招</option><option>本批已结束</option></select>' +
      '</div></div>' +
      '<div class="form-group"><div class="card">' +
        '<div class="f-label">投递途径</div><input class="f-input" id="fChannel" placeholder="如 官网在线投递 / 邮箱 xxx">' +
        '<div class="f-label">链接</div><input class="f-input" id="fUrl" placeholder="https://" inputmode="url">' +
        '<div class="f-label">备注</div><input class="f-input" id="fNote" placeholder="门槛、通勤、截止时间">' +
      '</div></div>';
    showSheet();
  }

  function showSheet() {
    document.getElementById('backdrop').classList.add('show');
    document.getElementById('sheet').classList.add('open');
  }
  function hideSheet() {
    document.getElementById('backdrop').classList.remove('show');
    document.getElementById('sheet').classList.remove('open');
  }
  document.getElementById('sheetCancel').addEventListener('click', hideSheet);
  document.getElementById('backdrop').addEventListener('click', hideSheet);
  document.getElementById('sheetSave').addEventListener('click', function () {
    var name = (document.getElementById('fName') || {}).value;
    if (!name || !name.trim()) { toast('请填写医院名称'); return; }
    var maxId = 1000;
    custom.forEach(function (c) { if (c.id > maxId) maxId = c.id; });
    custom.push({
      id: maxId + 1,
      name: name.trim(),
      level: (document.getElementById('fLevel').value || '未定级').trim(),
      district: (document.getElementById('fDistrict').value || '其他').trim(),
      priority: document.getElementById('fPriority').value,
      hiring: document.getElementById('fHiring').value,
      channel: document.getElementById('fChannel').value || '',
      url: document.getElementById('fUrl').value || '',
      note: document.getElementById('fNote').value || '',
      address: '',
      email: '',
      phone: '',
      guessChannels: ['其他'],
      custom: true
    });
    saveCustom();
    hideSheet();
    renderList();
    toast('已添加');
  });
  document.getElementById('btnAdd').addEventListener('click', openSheet);

  /* ---------------- Tab ---------------- */
  function switchTab(t) {
    state.tab = t;
    ['list', 'progress', 'settings'].forEach(function (k) {
      document.getElementById('page-' + k).hidden = (k !== t);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === t);
    });
    document.getElementById('navbarTitle').textContent =
      t === 'list' ? '投递清单' : t === 'progress' ? '进度' : '设置';
    document.getElementById('btnAdd').style.display = t === 'list' ? 'flex' : 'none';
    window.scrollTo(0, 0);
    document.getElementById('navbar').classList.remove('scrolled');
    if (t === 'progress') renderProgress();
    if (t === 'settings') renderSettings();
    if (t === 'list') renderList();
  }
  document.getElementById('tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });

  /* ---------------- 筛选交互 ---------------- */
  document.getElementById('segPriority').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    state.priority = b.dataset.v;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) {
      x.classList.toggle('on', x === b);
    });
    renderList();
  });
  document.getElementById('chipStatus').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    state.status = b.dataset.v;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) {
      x.classList.toggle('on', x === b);
    });
    renderList();
  });
  var searchTimer = null;
  document.getElementById('searchInput').addEventListener('input', function (e) {
    var v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.q = v;
      renderList();
    }, 120);
  });

  window.addEventListener('scroll', function () {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 26);
  }, { passive: true });

  /* ---------------- 启动 ---------------- */
  renderList();
  renderSettings();
  loadNotices();
})();
