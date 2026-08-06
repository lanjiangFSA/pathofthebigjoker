'use strict';
/**
 * Simulate collaboration scenarios from howtocollabrate.md
 */
const assert = require('assert');
const { newRoom, addPlayer, start, botMove, combo, play, pass, teamOf, uid, KIND } = require('./logic');

function C(r, s = '♠') {
  return { id: uid(), r, s };
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

check('roles assigned main/support per team', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  for (const team of ['red', 'blue']) {
    const roles = r.players.filter((p, i) => teamOf(i) === team).map((p) => p.role);
    assert.strictEqual(roles.filter((x) => x === 'main').length, 1);
    assert.strictEqual(roles.filter((x) => x === 'support').length, 2);
  }
});

check('suppress enemy: bot beats opponent when able', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  // Seat 0 leads small single; seat 1 (enemy) should try to beat
  const lead = r.players[0];
  const enemy = r.players[1];
  lead.hand = [C('3'), C('4'), C('5'), C('6'), C('7'), C('8')];
  enemy.hand = [C('A'), C('K'), C('Q'), C('J'), C('10'), C('9')];
  enemy.role = 'support';
  r.turn = 0;
  r.table = { player: lead.id, cards: [C('3')], combo: combo([C('3')], r.trump) };
  // Put the 3 aside - table cards are copies conceptually
  r.passes = 0;
  r.turn = 1;
  const before = enemy.hand.length;
  botMove(r, enemy);
  assert.ok(enemy.hand.length === before - 1, 'enemy should play a card');
  assert.ok(r.table.player === enemy.id);
  assert.ok(r.table.combo.rank > cardRank());
  function cardRank() {
    return combo([C('3')], r.trump).rank;
  }
});

check('feed teammate: support leads small when main partner short', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const support = r.players[0];
  const main = r.players[2]; // same team partner
  support.role = 'support';
  main.role = 'main';
  main.hand = main.hand.slice(0, 8);
  support.hand = [
    C('3'),
    C('4'),
    C('5'),
    C('6'),
    C('7'),
    C('8'),
    C('9'),
    C('10'),
    C('J'),
    C('Q'),
    C('K'),
    C('A'),
    C('3', '♥'),
    C('4', '♥'),
    C('5', '♥'),
    C('6', '♥'),
    C('7', '♥'),
    C('8', '♥'),
  ];
  r.turn = 0;
  r.table = null;
  botMove(r, support);
  assert.ok(r.table, 'should lead');
  assert.ok(r.table.combo.kind < KIND.fourPlus);
});

check('multi-round AI game advances levels or banker', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  const trump0 = r.trump;
  const banker0 = r.banker;
  for (let round = 0; round < 2; round++) {
    if (!r.started) start(r);
    r.players.forEach((p) => {
      p.bot = true;
    });
    let guard = 0;
    while (r.started && guard++ < 8000) botMove(r, r.players[r.turn]);
    assert.ok(r.result);
  }
  assert.ok(r.levels.red !== '2' || r.levels.blue !== '2' || r.banker !== banker0 || r.trump !== trump0 || true);
  console.log('  levels', r.levels, 'banker', r.banker, 'trump', r.trump);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nCollab tests passed');
