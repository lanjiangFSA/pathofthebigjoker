'use strict';
/**
 * Verify UI-facing state helpers and trumpRules default for the beta fixes.
 */
const assert = require('assert');
const { newRoom, addPlayer, start, botMove, state, settle } = require('./logic');

function seatCountText(p) {
  if (p.done) return '已出完';
  if (p.count <= 10) return `${p.count} 张`;
  return '';
}

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

check('default trumpRules is off', () => {
  const r = newRoom();
  assert.strictEqual(r.trumpRules, false);
  assert.strictEqual(r.trump, '2');
  assert.deepStrictEqual(r.scores, { red: 0, blue: 0 });
});

check('seat count hidden when >10', () => {
  assert.strictEqual(seatCountText({ done: false, count: 27 }), '');
  assert.strictEqual(seatCountText({ done: false, count: 11 }), '');
  assert.strictEqual(seatCountText({ done: false, count: 10 }), '10 张');
  assert.strictEqual(seatCountText({ done: false, count: 3 }), '3 张');
  assert.strictEqual(seatCountText({ done: true, count: 0 }), '已出完');
});

check('state exposes table player for playedBy UI', () => {
  const r = newRoom();
  const human = addPlayer(r, '测');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  const p = r.players[r.turn];
  botMove(r, p);
  const st = state(r, human.id);
  if (st.table) {
    assert.ok(st.table.player);
    assert.ok(st.table.combo.label);
    assert.ok(st.players.some((x) => x.id === st.table.player));
  }
  assert.strictEqual(st.trumpRules, false);
  assert.deepStrictEqual(st.scores, { red: 0, blue: 0 });
});

check('full round with trumpRules off stays at 2', () => {
  const r = newRoom({ trumpRules: false });
  addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  let guard = 0;
  while (r.started && guard++ < 8000) botMove(r, r.players[r.turn]);
  assert.ok(!r.started);
  assert.strictEqual(r.trump, '2');
  assert.strictEqual(r.levels.red, '2');
  assert.strictEqual(r.levels.blue, '2');
  assert.ok(r.scores);
  assert.strictEqual(typeof r.scores.red, 'number');
  assert.strictEqual(typeof r.scores.blue, 'number');
});

check('settle accumulates score from 0', () => {
  const r = newRoom({ trumpRules: true });
  addPlayer(r, 'H');
  start(r);
  r.banker = 'red';
  r.bankerSeat = 0;
  r.levels = { red: '2', blue: '2' };
  r.scores = { red: 0, blue: 0 };
  r.ranking = [r.players[0].id, r.players[2].id, r.players[4].id, r.players[1].id, r.players[3].id, r.players[5].id];
  r.players.forEach((p) => {
    if (!p.hand.length) p.hand = [{ id: 'x', r: '3', s: '♠' }, { id: 'y', r: '4', s: '♠' }];
  });
  settle(r);
  assert.strictEqual(r.scores.red, 8);
  assert.strictEqual(r.scores.blue, 0);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nUI/trump tests passed');
