'use strict';
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3456;
const base = `http://127.0.0.1:${PORT}`;

async function post(url, data) {
  const r = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const x = await r.json();
  if (!r.ok) throw Error(JSON.stringify(x));
  return x;
}

async function readState(code, id) {
  const res = await fetch(`${base}/api/stream?code=${code}&id=${id}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const p of parts) {
      const line = p.trim();
      if (line.startsWith('data:')) {
        reader.cancel();
        return JSON.parse(line.slice(5).trim());
      }
    }
  }
  throw Error('no state');
}

function assert(cond, msg) {
  if (!cond) throw Error(msg);
}

(async () => {
  const child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error('server start timeout')), 10000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('大怪路子')) {
        clearTimeout(t);
        resolve();
      }
    });
    child.stderr.on('data', (d) => console.error(String(d)));
  });

  try {
    // 1) default trumpRules off
    const a = await post('/api/create', { name: '试玩A' });
    let st = await readState(a.code, a.id);
    assert(st.trumpRules === false, 'default trumpRules should be false');
    assert(st.trump === '2', 'trump should be 2');
    assert(st.scores && st.scores.red === 0 && st.scores.blue === 0, 'scores start at 0');
    await post('/api/start', { code: a.code, id: a.id });
    await new Promise((r) => setTimeout(r, 400));
    st = await readState(a.code, a.id);
    assert(st.started === true, 'game started');
    assert(st.hand.length > 0, 'hand dealt');
    const over10 = st.players.filter((p) => p.count > 10);
    assert(over10.length >= 1, 'someone has >10 cards at start');

    // If human to play, lead smallest; else wait for bots
    for (let i = 0; i < 20 && !st.table; i++) {
      const turn = st.players[st.turn];
      if (turn && !turn.bot && st.hand.length) {
        const card = st.hand[st.hand.length - 1];
        try {
          await post('/api/play', { code: a.code, id: a.id, cards: [card.id] });
        } catch (_) {
          /* try next */
        }
      }
      await new Promise((r) => setTimeout(r, 700));
      st = await readState(a.code, a.id);
    }
    assert(st.table, 'expected table cards after play');
    const who = st.players.find((p) => p.id === st.table.player);
    assert(!!who, 'table player resolvable');
    assert(!!st.table.combo.label, 'combo label present');
    console.log('OK playedBy data:', who.name, st.table.combo.label);

    // 2) trumpRules on
    const b = await post('/api/create', { name: '试玩B', trumpRules: true });
    st = await readState(b.code, b.id);
    assert(st.trumpRules === true, 'trumpRules on');
    console.log('OK trumpRules create on/off');

    // 3) static assets
    for (const f of ['/', '/style.css', '/game.js']) {
      const r = await fetch(base + f);
      assert(r.ok, `asset ${f}`);
      const text = await r.text();
      if (f === '/') {
        assert(text.includes('trumpRules'), 'lobby has trump checkbox');
        assert(text.includes('playedBy'), 'board has playedBy');
        assert(text.includes('redScore'), 'scoreboard uses scores');
        assert(text.includes('table-arena'), 'table arena');
        assert(text.includes('turn-timer'), 'turn timer');
        assert(text.includes('trickLog'), 'trickLog in html');
      }
      if (f === '/game.js') {
        assert(text.includes('count <= 10'), 'seat count gate');
        assert(text.includes('playedBy'), 'playedBy render');
        assert(text.includes('rank-col') || text.includes('layoutRankColumns'), 'rank columns');
        assert(text.includes('bindHandDrag') || text.includes('onpointermove'), 'drag select');
        assert(text.includes('scores'), 'renders scores');
        assert(text.includes('trickLog') || text.includes('trick-log'), 'trick history');
        assert(text.includes('队友') || text.includes('teammate'), 'teammate label');
        assert(text.includes('turnDeadline') || text.includes('updateTimer'), 'timer ui');
        assert(text.includes('REL_SLOTS') || text.includes('seat-slot'), 'relative seats');
      }
      if (f === '/style.css') {
        assert(text.includes('touch-action:none') || text.includes('touch-action: none'), 'hand drag css');
        assert(text.includes('trick-log'), 'trick log css');
        assert(text.includes('table-arena'), 'arena css');
        assert(text.includes('rank-col'), 'rank-col css');
        assert(text.includes('turn-timer'), 'timer css');
      }
    }
    console.log('OK assets and UI markers');
    console.log('PLAYTEST PASSED');
  } finally {
    child.kill();
  }
})().catch((e) => {
  console.error('PLAYTEST FAIL', e);
  process.exit(1);
});
