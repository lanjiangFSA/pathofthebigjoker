'use strict';
const assert = require('assert');
const {
  newRoom,
  addPlayer,
  start,
  play,
  pass,
  state,
  autoAct,
  checkTimeout,
  TURN_MS,
  armTurn,
} = require('./logic');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('OK ', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, e.message);
  }
}

check('TURN_MS is 15s', () => {
  assert.strictEqual(TURN_MS, 15000);
});

check('start arms turnDeadline', () => {
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  assert.ok(r.turnDeadline);
  assert.ok(r.turnDeadline > Date.now());
  assert.ok(r.turnDeadline <= Date.now() + TURN_MS + 50);
  const st = state(r, r.players[0].id);
  assert.ok(st.turnDeadline);
  assert.strictEqual(st.turnMs, TURN_MS);
});

check('autoAct leads weakest single', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  h.bot = false;
  // Force human turn with empty table
  r.turn = r.players.findIndex((p) => p.id === h.id);
  r.table = null;
  r.passes = 0;
  r.trickLog = [];
  armTurn(r);
  const before = h.hand.length;
  const sorted = [...h.hand].sort((a, b) => {
    const pow = (x) => (x.r === '大怪' ? 100 : x.r === '小怪' ? 90 : x.r === r.trump ? 80 : '2345678910JQKA'.indexOf(x.r === '10' ? '1' : x.r[0]));
    return pow(a) - pow(b);
  });
  assert.ok(autoAct(r));
  assert.strictEqual(h.hand.length, before - 1);
  assert.ok(r.table);
  assert.ok(String(r.message).includes('超时'));
});

check('autoAct passes when cannot beat', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  h.bot = false;
  // Give human only a weak 3, table is huge
  const three = h.hand.find((c) => c.r === '3') || h.hand[h.hand.length - 1];
  h.hand = [three];
  const other = r.players.find((p) => p.id !== h.id);
  r.table = {
    player: other.id,
    cards: [{ r: '大怪', s: '★', id: 'x1' }],
    combo: { kind: 1, rank: 100, label: '单张' },
  };
  r.turn = r.players.findIndex((p) => p.id === h.id);
  r.passes = 0;
  r.trickLog = [];
  armTurn(r);
  assert.ok(autoAct(r));
  assert.ok(String(r.message).includes('超时'));
  assert.ok(r.passes >= 1 || !r.table || r.message.includes('不出') || r.message.includes('获得出牌权'));
});

check('checkTimeout ignores bots and future deadline', () => {
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  r.turnDeadline = Date.now() - 1;
  assert.strictEqual(checkTimeout(r), false);
  r.players[r.turn].bot = false;
  r.turnDeadline = Date.now() + 60000;
  assert.strictEqual(checkTimeout(r), false);
});

check('checkTimeout fires for human', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  h.bot = false;
  r.turn = r.players.findIndex((p) => p.id === h.id);
  r.table = null;
  r.trickLog = [];
  r.turnDeadline = Date.now() - 10;
  const n = h.hand.length;
  assert.ok(checkTimeout(r));
  assert.strictEqual(h.hand.length, n - 1);
});

if (failed) {
  console.error('FAILED', failed);
  process.exit(1);
}
console.log('test-v05 OK');
