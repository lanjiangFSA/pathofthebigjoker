let me, room, state, chosen = [];
const $ = (s) => document.querySelector(s);

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
    state = JSON.parse(e.data);
    chosen = [];
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
  d.innerHTML = `<span>${c.r}</span><small>${c.s}</small>`;
  return d;
}

function seatCountText(p) {
  if (p.done) return '已出完';
  if (p.count <= 10) return `${p.count} 张`;
  return '';
}

function render() {
  if (!state) return;
  $('#trump').textContent = state.trump;
  $('#trumpMode').textContent = state.trumpRules ? '将牌规则：开' : '将牌规则：关（固定 2）';
  $('#status').textContent = state.started ? '进行中' : '等待开局';
  $('#message').textContent = state.message;
  $('#scoreHint').textContent = state.trumpRules
    ? '本局结算：剩余对手人数决定升级；换庄少升一级'
    : '将牌规则关闭：将牌固定为 2，本局不升级';
  $('#redLevel').textContent = state.levels.red;
  $('#blueLevel').textContent = state.levels.blue;
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

  $('#hand').innerHTML = '';
  state.hand.forEach((c) => {
    const d = card(c, 'handcard');
    if (chosen.includes(c.id)) d.classList.add('selected');
    d.onclick = () => {
      chosen = chosen.includes(c.id) ? chosen.filter((x) => x !== c.id) : [...chosen, c.id];
      render();
    };
    $('#hand').append(d);
  });

  const mine = state.started && state.players[state.turn]?.id === me;
  $('#play').disabled = !mine || !chosen.length;
  $('#pass').disabled = !mine || !state.table;
}

$('#start').onclick = () => api('/api/start', { code: room, id: me }).catch((e) => alert(e.message));
$('#play').onclick = () =>
  api('/api/play', { code: room, id: me, cards: chosen }).catch((e) => alert(e.message));
$('#pass').onclick = () => api('/api/pass', { code: room, id: me }).catch((e) => alert(e.message));
$('#copy').onclick = async () => {
  await navigator.clipboard.writeText(room);
  $('#copy').textContent = '已复制';
  setTimeout(() => ($('#copy').textContent = '复制号码'), 1000);
};
