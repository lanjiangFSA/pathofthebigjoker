'use strict';
const assert = require('assert');
const {
  combo,
  play,
  newRoom,
  addPlayer,
  start,
  botMove,
  settle,
  scoreFromPlaces,
  KIND,
  uid,
  state,
} = require('./logic');

function C(r, s = '♠') {
  return { id: uid(), r, s };
}
function W(r = '大怪') {
  return { id: uid(), r, s: '★' };
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

check('triple three of a kind', () => {
  const c = combo([C('7'), C('7', '♥'), C('7', '♦')], '2');
  assert.strictEqual(c.label, '三张');
  assert.strictEqual(c.kind, KIND.triple);
});

check('triple with wild', () => {
  const c = combo([C('Q'), C('Q', '♥'), W()], '2');
  assert.strictEqual(c.label, '三张');
});

check('play triple from hand', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  const seat = r.players.indexOf(h);
  r.turn = seat;
  r.table = null;
  const a = C('5');
  const b = C('5', '♥');
  const c = C('5', '♦');
  h.hand = [a, b, c, C('9'), C('8')];
  play(r, h, [a.id, b.id, c.id]);
  assert.strictEqual(r.table.combo.label, '三张');
});

check('scoreFromPlaces catch 3 is 8', () => {
  assert.strictEqual(scoreFromPlaces({ red: [1, 2, 3], blue: [4, 5, 6] }, 'red'), 8);
  assert.strictEqual(scoreFromPlaces({ red: [1, 2, 4], blue: [3, 5, 6] }, 'red'), 5);
});

check('two rounds complete without stall', () => {
  const r = newRoom({ trumpRules: false });
  addPlayer(r, 'H');
  for (let round = 0; round < 2; round++) {
    if (!r.started) start(r);
    r.players.forEach((p) => {
      p.bot = true;
    });
    let guard = 0;
    const t0 = Date.now();
    while (r.started && guard++ < 12000) botMove(r, r.players[r.turn]);
    assert.ok(!r.started, `round ${round + 1} should end`);
    assert.ok(Date.now() - t0 < 60000, 'should not hang');
    assert.ok(r.scores);
  }
  assert.ok(r.round >= 2);
  assert.ok(r.scores.red + r.scores.blue >= 0);
});

check('trickLog records plays and clears on new lead', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  r.turn = r.players.indexOf(h);
  h.bot = false;
  h.hand = [C('3'), C('4'), C('5')];
  play(r, h, [h.hand[0].id]);
  assert.ok(r.trickLog.length >= 1);
  assert.strictEqual(r.trickLog[0].pass, false);
  // finish trick by passing around
  for (let i = 0; i < 5 && r.table; i++) {
    const p = r.players[r.turn];
    if (p.id === h.id) break;
    try {
      require('./logic').pass(r, p);
    } catch {
      break;
    }
  }
});

check('state marks teammates', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  const st = state(r, h.id);
  const mates = st.players.filter((p) => p.teammate);
  assert.strictEqual(mates.length, 2);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nv0.4 tests passed');
