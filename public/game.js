let me, room, state, chosen = [];
let timerTick = null;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const RANK_ORDER = ['大怪', '小怪', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'];

/** Relative seat 0=self → slot (clockwise from bottom). leftL unused. */
const REL_SLOTS_6 = ['bottom', 'rightL', 'rightU', 'topR', 'topL', 'leftU'];

async function api(url, data) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const x = await r.json();
  if (!r.ok) throw Error(x.error || '请求失败');
  return x;
}

function enter(x) {
  me = x.id;
  room = x.code;
  $('#lobby').hidden = true;
  $('#table').hidden = false;
  $('#room').textContent = room;
  new EventSource(`/api/stream?code=${room}&id=${me}`).onmessage = (e) => {
    const next = JSON.parse(e.data);
    const ids = new Set((next.hand || []).map((c) => c.id));
    chosen = chosen.filter((id) => ids.has(id));
    state = next;
    render();
  };
}

async function enterRoom(join) {
  try {
    const name = $('#name').value;
    enter(
      join
        ? await api('/api/join', { name, code: $('#code').value.toUpperCase() })
        : await api('/api/create', { name, trumpRules: $('#trumpRules').checked })
    );
  } catch (e) {
    $('#error').textContent = e.message;
  }
}

$('#create').onclick = () => enterRoom(false);
$('#join').onclick = () => enterRoom(true);
$('#code').oninput = (e) => (e.target.value = e.target.value.toUpperCase());

function card(c, cls = '') {
  const d = document.createElement('div');
  d.className = `card ${cls} ${c.s === '♥' || c.s === '♦' ? 'red' : ''} ${c.s === '★' ? 'joker' : ''}`;
  d.dataset.id = c.id || '';
  d.dataset.rank = c.r || '';
  d.innerHTML = `<span>${c.r}</span><small>${c.s}</small>`;
  return d;
}

function seatCountText(p) {
  if (p.done) return '完';
  if (p.count <= 10) return String(p.count);
  return '';
}

function mySeatIndex() {
  const i = state.players.findIndex((p) => p.id === me);
  return i >= 0 ? i : 0;
}

function slotForRelative(rel) {
  return REL_SLOTS_6[rel % 6];
}

function passSetFromLog() {
  const set = new Set();
  (state.trickLog || []).forEach((t) => {
    if (t.pass && t.playerId) set.add(t.playerId);
  });
  return set;
}

function paintSelection() {
  $$('#hand .handcard').forEach((el) => {
    el.classList.toggle('selected', chosen.includes(el.dataset.id));
  });
  $$('#hand .rank-col').forEach((col) => {
    const ids = [...col.querySelectorAll('.handcard')].map((c) => c.dataset.id);
    col.classList.toggle('col-selected', ids.length && ids.every((id) => chosen.includes(id)));
  });
  const mine = state?.started && state.players[state.turn]?.id === me;
  $('#play').disabled = !mine || !chosen.length;
  $('#pass').disabled = !mine || !state?.table;
}

function toggleColumn(ids) {
  const allOn = ids.every((id) => chosen.includes(id));
  if (allOn) chosen = chosen.filter((id) => !ids.includes(id));
  else {
    ids.forEach((id) => {
      if (!chosen.includes(id)) chosen.push(id);
    });
  }
  paintSelection();
}

function layoutRankColumns(handEl) {
  const groups = new Map();
  (state.hand || []).forEach((c) => {
    const k = c.r;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  const order = [...groups.keys()].sort((a, b) => {
    const ia = RANK_ORDER.indexOf(a);
    const ib = RANK_ORDER.indexOf(b);
    const pa = ia < 0 ? 99 : ia;
    const pb = ib < 0 ? 99 : ib;
    if (state.trump && a === state.trump) return -1;
    if (state.trump && b === state.trump) return 1;
    return pa - pb;
  });
  // trump already first if matches; re-sort: jokers, trump, then high to low faces
  order.sort((a, b) => {
    const score = (r) => {
      if (r === '大怪') return 1000;
      if (r === '小怪') return 900;
      if (r === state.trump) return 800;
      const i = RANK_ORDER.indexOf(r);
      return i < 0 ? 0 : 100 - i;
    };
    return score(b) - score(a);
  });

  handEl.innerHTML = '';
  const peek = 16;
  order.forEach((rank) => {
    const cards = groups.get(rank);
    const col = document.createElement('div');
    col.className = 'rank-col';
    col.dataset.rank = rank;
    cards.forEach((c, i) => {
      const d = card(c, 'handcard');
      if (chosen.includes(c.id)) d.classList.add('selected');
      d.style.bottom = `${i * peek}px`;
      d.style.zIndex = String(i + 1);
      col.append(d);
    });
    col.style.height = `${66 + (cards.length - 1) * peek}px`;
    handEl.append(col);
  });
}

function bindHandDrag(handEl) {
  let dragging = false;
  let moved = false;
  let startCol = null;
  let modeAdd = true;
  const seen = new Set();

  const colAt = (x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const el = stack.find((n) => n.classList?.contains('rank-col'));
    return el || null;
  };

  const applyCol = (col) => {
    if (!col || seen.has(col)) return;
    seen.add(col);
    const ids = [...col.querySelectorAll('.handcard')].map((c) => c.dataset.id);
    if (modeAdd) {
      ids.forEach((id) => {
        if (!chosen.includes(id)) chosen.push(id);
      });
    } else {
      chosen = chosen.filter((id) => !ids.includes(id));
    }
    paintSelection();
  };

  handEl.onpointerdown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const col = colAt(e.clientX, e.clientY);
    if (!col) return;
    dragging = true;
    moved = false;
    startCol = col;
    const ids = [...col.querySelectorAll('.handcard')].map((c) => c.dataset.id);
    modeAdd = !ids.every((id) => chosen.includes(id));
    seen.clear();
    handEl.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  handEl.onpointermove = (e) => {
    if (!dragging) return;
    if (!moved) {
      moved = true;
      applyCol(startCol);
    }
    applyCol(colAt(e.clientX, e.clientY));
  };

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    if (!moved && startCol) {
      const ids = [...startCol.querySelectorAll('.handcard')].map((c) => c.dataset.id);
      toggleColumn(ids);
    } else if (moved) {
      applyCol(colAt(e.clientX, e.clientY));
    }
    startCol = null;
    seen.clear();
  };

  handEl.onpointerup = end;
  handEl.onpointercancel = end;
}

function updateTimer() {
  const el = $('#turn-timer');
  if (!state?.started || !state.turnDeadline) {
    el.hidden = true;
    return;
  }
  const remain = Math.max(0, state.turnDeadline - Date.now());
  const sec = Math.ceil(remain / 1000);
  el.hidden = false;
  $('#timerSec').textContent = String(sec);
  const who = state.players[state.turn];
  $('#timerWho').textContent = who ? `${who.name}` : '';
  $('.clock-face').classList.toggle('warn', sec <= 5);
}

function renderSeats() {
  $$('.seat-slot').forEach((s) => {
    s.innerHTML = '';
  });
  if (!state?.players?.length) return;
  const mine = mySeatIndex();
  const passed = passSetFromLog();
  const myTeam = state.players[mine]?.team;

  state.players.forEach((p, seat) => {
    const rel = (seat - mine + 6) % 6;
    const slotName = slotForRelative(rel);
    const host = document.querySelector(`.seat-slot[data-slot="${slotName}"]`);
    if (!host) return;

    const d = document.createElement('div');
    const isTurn = state.started && state.turn === seat;
    d.className = `seat ${p.team} ${p.id === me ? 'me' : ''} ${isTurn ? 'active' : ''}`;
    const count = seatCountText(p);
    const tags = [
      p.bot ? 'AI' : null,
      p.id === me ? '你' : null,
      p.teammate ? '队友' : null,
      p.role === 'main' && state.started ? '主攻' : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const initial = (p.name || '?').slice(0, 1);
    d.innerHTML = `
      <div class="avatar">${initial}${count ? `<span class="badge-count">${count}</span>` : ''}</div>
      <div class="name">${p.name}</div>
      <div class="meta">${tags}</div>
      <div class="pass-flag ${passed.has(p.id) ? 'on' : ''}">${passed.has(p.id) ? '不出' : ''}</div>
    `;
    host.append(d);
  });

  $('#redScoreWrap').classList.toggle('mine-team', myTeam === 'red');
  $('#blueScoreWrap').classList.toggle('mine-team', myTeam === 'blue');
}

function render() {
  if (!state) return;
  const scores = state.scores || { red: 0, blue: 0 };
  $('#trump').textContent = state.trump;
  $('#trumpMode').textContent = state.trumpRules ? '将牌：开' : '将牌：关';
  $('#status').textContent = state.started ? '进行中' : '等待开局';
  $('#message').textContent = state.message || '';
  $('#redScore').textContent = scores.red;
  $('#blueScore').textContent = scores.blue;
  $('#redLevel').textContent = state.trumpRules ? `等级 ${state.levels.red}` : '';
  $('#blueLevel').textContent = state.trumpRules ? `等级 ${state.levels.blue}` : '';

  renderSeats();

  const logEl = $('#trickLog');
  logEl.innerHTML = '';
  (state.trickLog || []).forEach((t) => {
    const row = document.createElement('div');
    row.className = t.pass ? 'pass' : '';
    if (t.pass) row.textContent = `${t.name}：不出`;
    else {
      const faces = (t.cards || []).map((c) => c.r + c.s).join(' ');
      row.textContent = `${t.name}：${t.label} ${faces}`;
    }
    logEl.append(row);
  });

  $('#played').innerHTML = '';
  if (state.table) {
    const who = state.players.find((p) => p.id === state.table.player);
    $('#playedBy').textContent = `当前最大：${who?.name || '玩家'} · ${state.table.combo.label}`;
    state.table.cards.forEach((c) => $('#played').append(card(c, 'played')));
  } else {
    $('#playedBy').textContent = state.started ? '等待出牌' : '';
  }

  const host = state.host === me;
  $('#startbox').hidden = state.started;
  $('#start').disabled = !host;
  const nextRound = (state.round || 0) > 0 && !state.started;
  $('#start').textContent = host
    ? nextRound
      ? '开始下一局'
      : state.players.length < 6
        ? '开始发牌（AI 补位）'
        : '开始发牌'
    : '等待房主开始';
  $('#startbox').querySelector('p').textContent = nextRound
    ? `上局已结束。红 ${scores.red} : ${scores.blue} 蓝`
    : '不足 6 人时，空位将自动由 AI 补齐';

  layoutRankColumns($('#hand'));
  paintSelection();
  updateTimer();
}

bindHandDrag($('#hand'));

if (timerTick) clearInterval(timerTick);
timerTick = setInterval(updateTimer, 200);

$('#start').onclick = () => api('/api/start', { code: room, id: me }).catch((e) => alert(e.message));
$('#play').onclick = () =>
  api('/api/play', { code: room, id: me, cards: chosen }).catch((e) => alert(e.message));
$('#pass').onclick = () => api('/api/pass', { code: room, id: me }).catch((e) => alert(e.message));
$('#copy').onclick = async () => {
  await navigator.clipboard.writeText(room);
  $('#copy').textContent = '已复制';
  setTimeout(() => ($('#copy').textContent = '复制'), 1000);
};
