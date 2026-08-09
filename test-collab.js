'use strict';
/**
 * Collaboration scenarios (see gamerules/current-ai.md)
 */
const assert = require('assert');
const {
  newRoom,
  addPlayer,
  start,
  botMove,
  combo,
  teamOf,
  uid,
  KIND,
  feedKindForCount,
  pickLead,
  pickBeat,
  candidates,
  wildSpendCost,
  countWilds,
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

check('feedKindForCount matches 放牌表', () => {
  assert.strictEqual(feedKindForCount(10), 5);
  assert.strictEqual(feedKindForCount(9), 2);
  assert.strictEqual(feedKindForCount(8), 3);
  assert.strictEqual(feedKindForCount(7), 2);
  assert.strictEqual(feedKindForCount(6), 1);
  assert.strictEqual(feedKindForCount(4), 2);
  assert.strictEqual(feedKindForCount(3), 1);
  assert.strictEqual(feedKindForCount(2), 2);
  assert.strictEqual(feedKindForCount(12), null);
});

check('suppress enemy: bot beats opponent when able', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  const lead = r.players[0];
  const enemy = r.players[1];
  lead.hand = [C('3'), C('4'), C('5'), C('6'), C('7'), C('8')];
  enemy.hand = [C('A'), C('K'), C('Q'), C('J'), C('10'), C('9')];
  enemy.role = 'support';
  r.table = { player: lead.id, cards: [C('3')], combo: combo([C('3')], r.trump) };
  r.passes = 0;
  r.turn = 1;
  const before = enemy.hand.length;
  botMove(r, enemy);
  assert.ok(enemy.hand.length === before - 1, 'enemy should play a card');
  assert.ok(r.table.player === enemy.id);
  assert.ok(r.table.combo.rank > combo([C('3')], r.trump).rank);
});

check('pass teammate: do not beat mid pair', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const mate = r.players[0];
  const support = r.players[2];
  mate.role = 'main';
  support.role = 'support';
  mate.hand = [C('3'), C('4'), C('5'), C('6'), C('7'), C('8'), C('9'), C('10')];
  support.hand = [C('A'), C('A', '♥'), C('K'), C('K', '♥'), C('Q'), C('J'), C('10', '♥'), C('9', '♥')];
  const pair = [C('7', '♦'), C('7', '♣')];
  r.table = { player: mate.id, cards: pair, combo: combo(pair, r.trump) };
  r.turn = 2;
  const opts = candidates(support.hand, r.trump, r.table.combo);
  assert.ok(opts.length, 'should have legal beats');
  const choice = pickBeat(opts, r, support, 2, teamOf(0));
  assert.strictEqual(choice, null, 'should pass teammate mid pair');
});

check('feed teammate: support leads preferred length when main short', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const support = r.players[0];
  const main = r.players[2];
  support.role = 'support';
  main.role = 'main';
  main.hand = main.hand.slice(0, 8); // prefer 3-way feed
  support.hand = [
    C('3'),
    C('3', '♥'),
    C('3', '♦'),
    C('4'),
    C('4', '♥'),
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
  ];
  r.turn = 0;
  r.table = null;
  const opts = candidates(support.hand, r.trump, null);
  const lead = pickLead(opts, r, support, 0);
  assert.ok(lead, 'should lead');
  assert.strictEqual(lead.cards.length, 3, '8-card partner → feed 3-way');
  botMove(r, support);
  assert.ok(r.table);
  assert.strictEqual(r.table.cards.length, 3);
});

check('wildSpendCost: 5+大王 pair is expensive', () => {
  const trump = '2';
  const waste = { cards: [C('5'), W()], c: combo([C('5'), W()], trump) };
  const pure = { cards: [W(), W('小怪')], c: combo([W(), W('小怪')], trump) };
  const nat = { cards: [C('5'), C('5', '♥')], c: combo([C('5'), C('5', '♥')], trump) };
  assert.ok(waste.c && waste.c.kind === KIND.pair);
  assert.ok(wildSpendCost(waste) > 40, 'padding low pair with joker is costly');
  assert.strictEqual(wildSpendCost(nat), 0);
  assert.strictEqual(wildSpendCost(pure), 0);
});

check('AI does not lead low pair padded with joker', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const bot = r.players[0];
  bot.role = 'support';
  // One 5 + 大怪 can form 对5, but should lead a natural small single instead
  bot.hand = [
    C('5'),
    W(),
    C('3'),
    C('4'),
    C('6'),
    C('7'),
    C('8'),
    C('9'),
    C('10'),
    C('J'),
    C('Q'),
    C('K'),
  ];
  r.players[2].role = 'main';
  r.players[2].hand = r.players[2].hand.slice(0, 14);
  r.turn = 0;
  r.table = null;
  const opts = candidates(bot.hand, r.trump, null);
  const lead = pickLead(opts, r, bot, 0);
  assert.ok(lead, 'should lead');
  assert.ok(wildSpendCost(lead) <= 18, 'must not dump 大怪 on weak shape');
  if (lead.c.kind === KIND.pair && lead.c.face === '5') {
    assert.strictEqual(countWilds(lead.cards), 0);
  }
  botMove(r, bot);
  assert.ok(r.table);
  assert.ok(countWilds(r.table.cards) === 0 || r.table.cards.every((c) => c.s === '★'));
});

check('careful five: support avoids weak five open early', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const support = r.players[0];
  const main = r.players[2];
  support.role = 'support';
  main.role = 'main';
  main.hand = Array.from({ length: 20 }, (_, i) => C(String((i % 7) + 3)));
  // Long hand with a weak mixed straight available + small pairs
  support.hand = [
    C('3'),
    C('4'),
    C('5'),
    C('6'),
    C('7'),
    C('8'),
    C('8', '♥'),
    C('9'),
    C('9', '♥'),
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
    C('10', '♥'),
  ];
  r.turn = 0;
  r.table = null;
  const opts = candidates(support.hand, r.trump, null);
  const lead = pickLead(opts, r, support, 0);
  assert.ok(lead);
  assert.ok(lead.cards.length !== 5 || lead.c.kind >= KIND.fullHouse, 'no weak five open as support');
});

check('multi-round AI game completes', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  for (let round = 0; round < 2; round++) {
    if (!r.started) start(r);
    r.players.forEach((p) => {
      p.bot = true;
    });
    let guard = 0;
    while (r.started && guard++ < 8000) botMove(r, r.players[r.turn]);
    assert.ok(r.result);
  }
  assert.ok(r.bankerSeat >= 0);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nCollab tests passed');
