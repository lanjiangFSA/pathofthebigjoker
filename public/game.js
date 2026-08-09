let me, room, state, chosen = [];
let timerTick = null;
let audioPrev = null;
let audioBootstrapped = false;
let joining = false;
let streamSrc = null;
const SESSION_KEY = 'dglz-session-v06';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function unlockAudio() {
  if (typeof GameAudio !== 'undefined') GameAudio.unlock();
}

function applyAudio(prev, next, opts) {
  if (typeof GameAudio === 'undefined') return;
  GameAudio.applyDiff(prev, next, me, opts);
}

/** Relative seat 0=self → slot (clockwise from bottom). */
const REL_SLOTS_6 = ['bottom', 'rightL', 'rightU', 'topR', 'topL', 'leftU'];

function saveSession(code, id, name) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code, id, name }));
  } catch (_) {}
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

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

function syncAppShell() {
  const vv = Math.round(window.visualViewport?.height || 0);
  const ih = Math.round(window.innerHeight || 0);
  const h = Math.max(vv, ih);
  if (h > 0) document.documentElement.style.setProperty('--app-height', `${h}px`);
  const dock = document.getElementById('dock');
  const top = document.querySelector('#table .topbar');
  if (top) document.documentElement.style.setProperty('--topbar-h', `${top.offsetHeight}px`);
  if (dock) document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
}

function relayoutHand() {
  if (!state) return;
  HandSelect.layout($('#hand'), {
    hand: state.hand || [],
    trump: state.trump,
    chosen,
  });
  syncActionButtons();
}

function closeStream() {
  if (streamSrc) {
    try {
      streamSrc.close();
    } catch (_) {}
    streamSrc = null;
  }
}

function openStream() {
  if (!room || !me) return;
  closeStream();
  streamSrc = new EventSource(`/api/stream?code=${room}&id=${me}`);
  streamSrc.onmessage = (e) => {
    const next = JSON.parse(e.data);
    const ids = new Set((next.hand || []).map((c) => c.id));
    chosen = chosen.filter((id) => ids.has(id));
    const snapshot = !audioBootstrapped;
    applyAudio(audioPrev, next, { snapshot });
    audioBootstrapped = true;
    audioPrev = next;
    state = next;
    render();
  };
  streamSrc.onerror = () => {
    // keep session; browser may reconnect EventSource automatically
  };
}

function enter(x) {
  me = x.id;
  room = x.code;
  saveSession(room, me, x.name || $('#name')?.value || '牌友');
  audioPrev = null;
  audioBootstrapped = false;
  unlockAudio();
  $('#lobby').hidden = true;
  $('#table').hidden = false;
  $('#room').textContent = room;
  document.body.classList.add('in-game');
  syncAppShell();
  requestAnimationFrame(() => {
    syncAppShell();
    relayoutHand();
  });
  openStream();
}

async function enterRoom(join) {
  if (joining) return;
  joining = true;
  $('#create').disabled = true;
  $('#join').disabled = true;
  try {
    unlockAudio();
    const name = $('#name').value;
    const sess = loadSession();
    enter(
      join
        ? await api('/api/join', {
            name,
            code: $('#code').value.toUpperCase(),
            id: sess?.code === $('#code').value.toUpperCase() ? sess.id : undefined,
          })
        : await api('/api/create', { name })
    );
  } catch (e) {
    $('#error').textContent = e.message;
  } finally {
    joining = false;
    $('#create').disabled = false;
    $('#join').disabled = false;
  }
}

async function tryRestoreSession() {
  const sess = loadSession();
  if (!sess?.code || !sess?.id) return;
  try {
    if ($('#name') && sess.name) $('#name').value = sess.name;
    const x = await api('/api/rejoin', { code: sess.code, id: sess.id, name: sess.name });
    enter(x);
  } catch {
    clearSession();
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

function passSetFromLog(log) {
  const set = new Set();
  (log || []).forEach((t) => {
    if (t.pass && t.playerId) set.add(t.playerId);
  });
  return set;
}

function activeTrickEntries() {
  if ((state.trickLog || []).length) return state.trickLog;
  return state.lastTrickShow || [];
}

function playsByPlayer() {
  const map = new Map();
  activeTrickEntries().forEach((t, idx) => {
    if (!t.playerId) return;
    if (!map.has(t.playerId)) map.set(t.playerId, []);
    map.get(t.playerId).push({ ...t, _i: idx });
  });
  return map;
}

function selectionLegal() {
  if (!state?.started || !chosen.length) return false;
  if (![1, 2, 3, 5].includes(chosen.length)) return false;
  // Lead: any legal-length selection can be attempted; follow must match count.
  if (state.table && chosen.length !== (state.table.cards || []).length) return false;
  return true;
}

function syncActionButtons() {
  const turnPlayer = state?.players?.[state?.turn];
  const mine = !!(state?.started && turnPlayer && turnPlayer.id === me && !turnPlayer.bot);
  const playBtn = $('#play');
  const passBtn = $('#pass');
  if (!playBtn || !passBtn) return;
  // Always clear disabled via property (WeChat WebView can stick aria/attribute)
  const canPlay = mine && selectionLegal();
  const canPass = mine && !!state?.table;
  playBtn.disabled = !canPlay;
  passBtn.disabled = !canPass;
  if (canPlay) playBtn.removeAttribute('disabled');
  else playBtn.setAttribute('disabled', '');
  if (canPass) passBtn.removeAttribute('disabled');
  else passBtn.setAttribute('disabled', '');
  playBtn.classList.toggle('ready', canPlay);
}

function updateTimer() {
  if (!state?.started || !state.turnDeadline) {
    $$('.seat-timer').forEach((el) => {
      el.hidden = true;
    });
    return;
  }
  const remain = Math.max(0, state.turnDeadline - Date.now());
  const sec = Math.ceil(remain / 1000);
  const who = state.players[state.turn];
  const mine = who && who.id === me;
  if (typeof GameAudio !== 'undefined') GameAudio.maybeTimerWarn(sec, !!mine);

  $$('.seat-timer').forEach((el) => {
    const seat = Number(el.dataset.seat);
    const on = seat === state.turn;
    el.hidden = !on;
    if (on) {
      el.querySelector('.clock-face').textContent = String(sec);
      el.querySelector('.clock-face').classList.toggle('warn', sec <= 5 || remain === 0);
    }
  });

  // At 0s: re-sync actions; if still stuck, nudge SSE so auto-act state arrives
  if (remain === 0) {
    syncActionButtons();
    if (!updateTimer._zeroSince) updateTimer._zeroSince = Date.now();
    else if (Date.now() - updateTimer._zeroSince > 1500 && room && me) {
      updateTimer._zeroSince = Date.now();
      openStream();
    }
  } else {
    updateTimer._zeroSince = 0;
  }

  // Self dock timer when it's my turn (bottom seat hidden)
  const selfTimer = $('#self-timer');
  if (selfTimer) {
    const mySeat = mySeatIndex();
    const show = state.turn === mySeat;
    selfTimer.hidden = !show;
    if (show) {
      selfTimer.querySelector('.clock-face').textContent = String(sec);
      selfTimer.querySelector('.clock-face').classList.toggle('warn', sec <= 5);
    }
  }
}

function renderSeats() {
  $$('.seat-slot').forEach((s) => {
    s.innerHTML = '';
  });
  if (!state?.players?.length) return;
  const mine = mySeatIndex();
  const log = activeTrickEntries();
  const passed = passSetFromLog(log);
  const byPlayer = playsByPlayer();
  const myTeam = state.players[mine]?.team;
  const host = state.host === me;

  state.players.forEach((p, seat) => {
    const rel = (seat - mine + 6) % 6;
    const slotName = slotForRelative(rel);
    const hostEl = document.querySelector(`.seat-slot[data-slot="${slotName}"]`);
    if (!hostEl) return;

    const d = document.createElement('div');
    const isTurn = state.started && state.turn === seat;
    const isBanker = !!p.banker || seat === state.bankerSeat;
    d.className = `seat ${p.team} ${p.id === me ? 'me' : ''} ${isTurn ? 'active' : ''} ${isBanker ? 'banker' : ''}`;
    const count = seatCountText(p);
    const tags = [
      isBanker ? '庄' : null,
      p.bot ? 'AI' : null,
      p.id === me ? '你' : null,
      p.teammate ? '队友' : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const initial = (p.name || '?').slice(0, 1);
    const kick =
      host && !state.started && !p.bot && p.id !== me
        ? `<button type="button" class="kick-btn" data-kick="${p.id}">踢</button>`
        : '';

    const plays = byPlayer.get(p.id) || [];
    const playHtml = plays
      .filter((t) => !t.pass && t.cards?.length)
      .map((t, i) => {
        const z = 10 + (t._i || i);
        const faces = t.cards.map((c) => card(c, 'seat-card').outerHTML).join('');
        return `<div class="seat-play-stack" style="z-index:${z}">${faces}</div>`;
      })
      .join('');

    d.innerHTML = `
      <div class="seat-timer" data-seat="${seat}" hidden><div class="clock-face">0</div></div>
      <div class="avatar">${initial}${count ? `<span class="badge-count">${count}</span>` : ''}${isBanker ? '<span class="badge-banker">庄</span>' : ''}</div>
      <div class="name">${p.name}</div>
      <div class="meta">${tags}</div>
      <div class="pass-flag ${passed.has(p.id) ? 'on' : ''}">${passed.has(p.id) ? '不出' : ''}</div>
      <div class="seat-plays">${playHtml}</div>
      ${kick}
    `;
    hostEl.append(d);
  });

  $('#redScoreWrap').classList.toggle('mine-team', myTeam === 'red');
  $('#blueScoreWrap').classList.toggle('mine-team', myTeam === 'blue');
}

function renderCenterTable() {
  const show = state.table || state.lastTable;
  $('#played').innerHTML = '';
  if (show) {
    const who = state.players.find((p) => p.id === show.player);
    const stale = !state.table && state.lastTable;
    $('#playedBy').textContent = `${stale ? '上轮最大' : '当前最大'}：${who?.name || '玩家'} · ${show.combo.label}`;
    show.cards.forEach((c) => $('#played').append(card(c, 'played')));
  } else {
    $('#playedBy').textContent = state.started ? '等待出牌' : '';
  }
}

function render() {
  if (!state) return;
  const scores = state.scores || { red: 0, blue: 0 };
  const mr = state.matchRound || 0;
  $('#status').textContent = state.started
    ? `进行中 · ${mr}/6`
    : state.matchOver
      ? '赛段结束'
      : '等待开局';
  $('#message').textContent = state.message || '';
  $('#redScore').textContent = scores.red;
  $('#blueScore').textContent = scores.blue;

  renderSeats();
  renderCenterTable();

  const logEl = $('#trickLog');
  logEl.innerHTML = '';
  activeTrickEntries().forEach((t) => {
    const row = document.createElement('div');
    row.className = t.pass ? 'pass' : '';
    if (t.pass) row.textContent = `${t.name}：不出`;
    else {
      const faces = (t.cards || []).map((c) => c.r + c.s).join(' ');
      row.textContent = `${t.name}：${t.label} ${faces}`;
    }
    logEl.append(row);
  });

  const host = state.host === me;
  const waiting = !state.started;
  $('#startbox').hidden = !waiting;
  $('#startbox').classList.toggle('docked', true);
  $('#start').disabled = !host;
  const nextRound = (state.round || 0) > 0 && !state.started;
  $('#start').textContent = host
    ? state.matchOver
      ? '重新分组并开局'
      : nextRound
        ? '开始下一局'
        : state.players.filter((p) => !p.bot).length < 6
          ? '开始发牌（AI 补位）'
          : '开始发牌'
    : '等待房主开始';
  $('#startbox').querySelector('p').textContent = state.matchOver
    ? `赛段比分 红 ${scores.red} : ${scores.blue} 蓝 · 将重新随机分组`
    : nextRound
      ? `上局已结束 · 赛段 ${mr}/6 · 红 ${scores.red} : ${scores.blue} 蓝`
      : '座位列表见牌桌；不足 6 人时开始后 AI 补齐';

  HandSelect.layout($('#hand'), {
    hand: state.hand || [],
    trump: state.trump,
    chosen,
  });
  syncActionButtons();
  updateTimer();
  syncAppShell();
  requestAnimationFrame(syncAppShell);
}

HandSelect.bind($('#hand'), {
  getChosen: () => chosen,
  setChosen: (ids) => {
    chosen = ids;
  },
  onChange: syncActionButtons,
});

function onShellResize() {
  syncAppShell();
  relayoutHand();
}

window.addEventListener('resize', onShellResize);
window.addEventListener('orientationchange', () => setTimeout(onShellResize, 120));
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', onShellResize);
  window.visualViewport.addEventListener('scroll', syncAppShell);
}
syncAppShell();

if (timerTick) clearInterval(timerTick);
timerTick = setInterval(updateTimer, 200);

$('#start').onclick = () => {
  unlockAudio();
  api('/api/start', { code: room, id: me }).catch((e) => alert(e.message));
};
$('#play').onclick = () => {
  unlockAudio();
  api('/api/play', { code: room, id: me, cards: chosen }).catch((e) => alert(e.message));
};
$('#pass').onclick = () => {
  unlockAudio();
  api('/api/pass', { code: room, id: me }).catch((e) => alert(e.message));
};
$('#copy').onclick = async () => {
  await navigator.clipboard.writeText(room);
  $('#copy').textContent = '已复制';
  setTimeout(() => ($('#copy').textContent = '复制'), 1000);
};

$('#leave').onclick = async () => {
  if (!room || !me) return;
  const inGame = state?.started;
  let mode = 'abort';
  if (inGame) {
    const choice = window.prompt(
      '确认退出？\n输入 1 = 整桌中止回等人\n输入 2 = 我离开，AI 接手继续\n取消则留下',
      '1'
    );
    if (choice === null) return;
    mode = String(choice).trim() === '2' ? 'ai' : 'abort';
  } else if (!window.confirm('确认离开房间？')) {
    return;
  }
  try {
    await api('/api/leave', { code: room, id: me, mode });
    closeStream();
    clearSession();
    me = room = state = null;
    chosen = [];
    $('#table').hidden = true;
    $('#lobby').hidden = false;
    document.body.classList.remove('in-game');
  } catch (e) {
    alert(e.message);
  }
};

document.getElementById('table-arena')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-kick]');
  if (!btn) return;
  const targetId = btn.getAttribute('data-kick');
  if (!window.confirm('确认踢出该玩家？')) return;
  try {
    await api('/api/kick', { code: room, id: me, targetId });
  } catch (err) {
    alert(err.message);
  }
});

if (typeof GameAudio !== 'undefined') GameAudio.bindVolumeControls();

// WeChat / mobile: unlock audio and recompute action buttons after first touch
document.addEventListener(
  'pointerdown',
  () => {
    unlockAudio();
    syncActionButtons();
  },
  { passive: true }
);

tryRestoreSession();
