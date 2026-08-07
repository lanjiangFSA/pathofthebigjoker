let me, room, state, chosen = [];
let timerTick = null;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

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
  return HandSelect.makeCardEl(c, cls);
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

function syncActionButtons() {
  const mine = state?.started && state.players[state.turn]?.id === me;
  $('#play').disabled = !mine || !chosen.length;
  $('#pass').disabled = !mine || !state?.table;
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

  HandSelect.layout($('#hand'), {
    hand: state.hand || [],
    trump: state.trump,
    chosen,
  });
  syncActionButtons();
  updateTimer();
}

HandSelect.bind($('#hand'), {
  getChosen: () => chosen,
  setChosen: (ids) => {
    chosen = ids;
  },
  onChange: syncActionButtons,
});

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
