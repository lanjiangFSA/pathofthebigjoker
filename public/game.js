let me, room, state, chosen = [];
const $ = (s) => document.querySelector(s);
const PEEK = 20; // px of rank/suit corner to keep visible
const MIN_PEEK = 16;

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
  d.innerHTML = `<span>${c.r}</span><small>${c.s}</small>`;
  return d;
}

function seatCountText(p) {
  if (p.done) return '已出完';
  if (p.count <= 10) return `${p.count} 张`;
  return '';
}

function layoutHand(handEl) {
  const cards = [...handEl.querySelectorAll('.handcard')];
  const n = cards.length;
  if (!n) return;
  const style = getComputedStyle(cards[0]);
  const cardW = parseFloat(style.width) || 52;
  const cardH = parseFloat(style.height) || 74;
  const pad = 16;
  const width = Math.max(cardW, handEl.clientWidth - pad);
  const maxSingle = 1 + Math.floor(Math.max(0, width - cardW) / MIN_PEEK);
  const rows = n <= maxSingle ? 1 : 2;
  const perRow = Math.ceil(n / rows);
  handEl.style.minHeight = `${rows * (cardH + 18) + 16}px`;

  cards.forEach((el, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const rowCount = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
    let step = cardW;
    if (rowCount > 1) {
      step = Math.min(cardW - PEEK, Math.max(MIN_PEEK, (width - cardW) / (rowCount - 1)));
    }
    const rowWidth = cardW + step * (rowCount - 1);
    const left0 = Math.max(0, (handEl.clientWidth - rowWidth) / 2);
    el.style.position = 'absolute';
    el.style.left = `${left0 + col * step}px`;
    el.style.top = `${8 + row * (cardH + 14)}px`;
    el.style.zIndex = String(col + 1);
    el.style.margin = '0';
  });
}

function paintSelection() {
  $('#hand').querySelectorAll('.handcard').forEach((el) => {
    el.classList.toggle('selected', chosen.includes(el.dataset.id));
    if (el.classList.contains('selected')) el.style.zIndex = '80';
  });
  const mine = state?.started && state.players[state.turn]?.id === me;
  $('#play').disabled = !mine || !chosen.length;
  $('#pass').disabled = !mine || !state?.table;
}

function bindHandDrag(handEl) {
  let dragging = false;
  let moved = false;
  let startId = null;
  let modeAdd = true;
  const seen = new Set();

  const idAt = (x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const el = stack.find((n) => n.classList?.contains('handcard'));
    return el?.dataset.id || null;
  };

  const applyId = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (modeAdd) {
      if (!chosen.includes(id)) chosen.push(id);
    } else {
      chosen = chosen.filter((x) => x !== id);
    }
    paintSelection();
  };

  handEl.onpointerdown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const id = idAt(e.clientX, e.clientY);
    if (!id) return;
    dragging = true;
    moved = false;
    startId = id;
    modeAdd = !chosen.includes(id);
    seen.clear();
    handEl.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  handEl.onpointermove = (e) => {
    if (!dragging) return;
    if (!moved) {
      moved = true;
      applyId(startId);
    }
    applyId(idAt(e.clientX, e.clientY));
  };

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    if (!moved && startId) {
      // click toggle
      chosen = chosen.includes(startId) ? chosen.filter((x) => x !== startId) : [...chosen, startId];
      paintSelection();
    } else if (moved) {
      applyId(idAt(e.clientX, e.clientY));
    }
    startId = null;
    seen.clear();
  };

  handEl.onpointerup = end;
  handEl.onpointercancel = end;
}

function render() {
  if (!state) return;
  const scores = state.scores || { red: 0, blue: 0 };
  $('#trump').textContent = state.trump;
  $('#trumpMode').textContent = state.trumpRules ? '将牌规则：开' : '将牌规则：关（固定 2）';
  $('#status').textContent = state.started ? '进行中' : '等待开局';
  $('#message').textContent = state.message;
  $('#scoreHint').textContent = state.trumpRules
    ? '比分累计局分；开启将牌时另显示等级'
    : '比分从 0 累计；将牌固定为 2';
  $('#redScore').textContent = scores.red;
  $('#blueScore').textContent = scores.blue;
  $('#redLevel').textContent = state.trumpRules ? `等级 ${state.levels.red}` : '';
  $('#blueLevel').textContent = state.trumpRules ? `等级 ${state.levels.blue}` : '';
  $('#redBanker').textContent = state.banker === 'red' ? '当前庄家' : '';
  $('#blueBanker').textContent = state.banker === 'blue' ? '当前庄家' : '';

  $('#seats').innerHTML = '';
  state.players.forEach((p) => {
    const d = document.createElement('div');
    d.className = `seat ${p.team} ${p.id === me ? 'me' : ''}`;
    const count = seatCountText(p);
    d.innerHTML = `<b>${p.name}${p.bot ? ' · AI' : ''}${p.id === me ? '（你）' : ''}${
      p.role === 'main' ? ' · 主攻' : p.role === 'support' && state.started ? ' · 辅助' : ''
    }</b>${count}`;
    $('#seats').append(d);
  });

  $('#played').innerHTML = '';
  if (state.table) {
    const who = state.players.find((p) => p.id === state.table.player);
    $('#playedBy').textContent = `${who?.name || '玩家'} 出了 ${state.table.combo.label}`;
    state.table.cards.forEach((c) => $('#played').append(card(c, 'played')));
  } else {
    $('#playedBy').textContent = state.started ? '等待出牌' : '';
  }

  $('#turn').textContent = state.started
    ? `轮到：${state.players[state.turn]?.name}${state.table ? `　（压 ${state.table.combo.label}）` : '　（首出）'}`
    : '';

  const host = state.host === me;
  $('#startbox').hidden = state.started;
  $('#start').disabled = !host;
  $('#start').textContent = host
    ? state.players.length < 6
      ? '开始发牌（AI 补位）'
      : '开始发牌'
    : '等待房主开始';

  const handEl = $('#hand');
  handEl.innerHTML = '';
  state.hand.forEach((c) => {
    const d = card(c, 'handcard');
    if (chosen.includes(c.id)) d.classList.add('selected');
    handEl.append(d);
  });
  layoutHand(handEl);
  paintSelection();

  const mine = state.started && state.players[state.turn]?.id === me;
  $('#play').disabled = !mine || !chosen.length;
  $('#pass').disabled = !mine || !state.table;
}

bindHandDrag($('#hand'));
window.addEventListener('resize', () => {
  if (state) layoutHand($('#hand'));
});

$('#start').onclick = () => api('/api/start', { code: room, id: me }).catch((e) => alert(e.message));
$('#play').onclick = () =>
  api('/api/play', { code: room, id: me, cards: chosen }).catch((e) => alert(e.message));
$('#pass').onclick = () => api('/api/pass', { code: room, id: me }).catch((e) => alert(e.message));
$('#copy').onclick = async () => {
  await navigator.clipboard.writeText(room);
  $('#copy').textContent = '已复制';
  setTimeout(() => ($('#copy').textContent = '复制号码'), 1000);
};
