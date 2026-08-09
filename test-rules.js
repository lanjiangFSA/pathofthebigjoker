'use strict';
const assert = require('assert');
const {
  combo,
  beats,
  cardPower,
  KIND,
  newRoom,
  addPlayer,
  start,
  play,
  pass,
  botMove,
  settle,
  candidates,
  teamOf,
  uid,
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

check('cardPower order', () => {
  const t = '5';
  assert.ok(cardPower('大怪', t) > cardPower('小怪', t));
  assert.ok(cardPower('小怪', t) > cardPower('5', t));
  assert.ok(cardPower('5', t) > cardPower('A', t));
  assert.ok(cardPower('A', t) > cardPower('K', t));
  assert.ok(cardPower('3', t) > cardPower('2', t));
  assert.ok(cardPower('6', t) > cardPower('4', t)); // 4 is not trump; 6>4 naturally? FACE: 2,3,4,5,6 → 6>4 yes
});

check('single pair triple', () => {
  assert.strictEqual(combo([C('A')], '2').label, '单张');
  assert.strictEqual(combo([C('7'), C('7', '♥')], '2').label, '对子');
  assert.strictEqual(combo([C('7'), C('7', '♥'), W()], '2').label, '三张');
  assert.ok(!combo([C('7'), C('8')], '2'));
});

check('333+joker+4 is 四带一 not 三带两', () => {
  const c = combo([C('3'), C('3', '♥'), C('3', '♦'), W(), C('4')], '2');
  assert.strictEqual(c.label, '四带一');
  assert.strictEqual(c.kind, KIND.fourPlus);
});

check('五同 with wilds', () => {
  const c = combo([C('9'), C('9', '♥'), C('9', '♦'), W(), W('小怪')], '2');
  assert.strictEqual(c.label, '五同');
});

check('wild straight is smallest window', () => {
  // 3,4,5,6,大王 → 23456 not 34567（杂色才是杂顺）
  const c = combo([C('3', '♠'), C('4', '♥'), C('5', '♠'), C('6', '♦'), W()], '2');
  assert.ok(c);
  assert.strictEqual(c.label, '杂顺');
  assert.strictEqual(c.high, '6');
});

check('A2345 smallest straight, 10JQKA largest', () => {
  const low = combo([C('A'), C('2'), C('3'), C('4'), C('5', '♥')], '2');
  const high = combo([C('10'), C('J'), C('Q'), C('K'), C('A', '♥')], '2');
  assert.strictEqual(low.label, '杂顺');
  assert.strictEqual(high.label, '杂顺');
  assert.ok(beats(high, low));
  assert.ok(!beats(low, high));
});

check('trump in straight counts as natural', () => {
  // 将牌=5: 10 9 8 7 6 > 5 4 3 2 A
  const a = combo([C('10'), C('9'), C('8'), C('7'), C('6', '♥')], '5');
  const b = combo([C('5'), C('4'), C('3'), C('2'), C('A', '♥')], '5');
  assert.ok(beats(a, b));
});

check('five-card ladder beats', () => {
  const mixed = combo([C('3'), C('4'), C('5'), C('6'), C('7', '♥')], '2');
  const flush = combo([C('2', '♥'), C('4', '♥'), C('7', '♥'), C('9', '♥'), C('J', '♥')], '2');
  const full = combo([C('9'), C('9', '♥'), C('9', '♦'), C('5'), C('5', '♥')], '2');
  const four = combo([C('8'), C('8', '♥'), C('8', '♦'), C('8', '♣'), C('3')], '2');
  const sf = combo([C('5', '♠'), C('6', '♠'), C('7', '♠'), C('8', '♠'), C('9', '♠')], '2');
  const five = combo([C('Q'), C('Q', '♥'), C('Q', '♦'), C('Q', '♣'), W()], '2');
  assert.ok(beats(flush, mixed));
  assert.ok(beats(full, flush));
  assert.ok(beats(four, full));
  assert.ok(beats(sf, four));
  assert.ok(beats(five, sf));
});

check('same length only for 1/2/3', () => {
  const s = combo([C('A')], '2');
  const p = combo([C('3'), C('3', '♥')], '2');
  assert.ok(!beats(p, s));
  assert.ok(!beats(s, p));
});

check('三带两', () => {
  const c = combo([C('9'), C('9', '♥'), C('9', '♦'), C('5'), C('5', '♥')], '2');
  assert.strictEqual(c.label, '三带两');
});

check('AI does not beat teammate lightly', () => {
  const r = newRoom();
  const human = addPlayer(r, '测');
  start(r);
  // Force a known table from teammate
  const seat = r.players.findIndex((p) => p.id === human.id);
  // Seat 0 red, seat 2 red teammate
  const teammate = r.players[(seat + 2) % 6];
  const enemy = r.players[(seat + 1) % 6];
  r.turn = r.players.indexOf(teammate);
  r.table = {
    player: teammate.id,
    cards: [teammate.hand[teammate.hand.length - 1]],
    combo: combo([teammate.hand[teammate.hand.length - 1]], r.trump),
  };
  // Give current bot (next after teammate) a chance — move to a support bot on same team after teammate
  const after = (r.players.indexOf(teammate) + 2) % 6; // same team next
  r.turn = after;
  const actor = r.players[after];
  actor.role = 'support';
  const beforeHand = actor.hand.length;
  const beforePasses = r.passes;
  botMove(r, actor);
  // Should pass (not beat teammate) in normal case
  assert.ok(actor.hand.length === beforeHand, 'should pass teammate');
  assert.ok(r.passes === beforePasses + 1 || r.table === null || r.turn !== after);
});

check('settle case1 banker 123 scores without trump upgrade', () => {
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  r.banker = 'red';
  r.bankerSeat = 0;
  // ranking seats 0,2,4 red then blue
  r.ranking = [r.players[0].id, r.players[2].id, r.players[4].id, r.players[1].id, r.players[3].id, r.players[5].id];
  r.players.forEach((p) => {
    if (!p.hand.length) p.hand = [C('3'), C('4')];
  });
  settle(r);
  assert.strictEqual(r.result.winning, 'red');
  assert.strictEqual(r.result.points, 8);
  assert.strictEqual(r.result.gain, 0);
  assert.strictEqual(r.result.upgradePoints, 0);
  assert.strictEqual(r.trump, '2');
  assert.strictEqual(r.levels.red, '2');
  assert.strictEqual(r.bankerSeat, 1);
  assert.strictEqual(r.leadSeat, 1);
});

check('settle keeps trump 2 and no level climb', () => {
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  assert.strictEqual(r.trump, '2');
  assert.strictEqual(r.trumpRules, false);
  r.banker = 'red';
  r.bankerSeat = 0;
  r.ranking = [r.players[0].id, r.players[2].id, r.players[4].id, r.players[1].id, r.players[3].id, r.players[5].id];
  r.players.forEach((p) => {
    if (!p.hand.length) p.hand = [C('3'), C('4')];
  });
  settle(r);
  assert.strictEqual(r.trump, '2');
  assert.strictEqual(r.levels.red, '2');
  assert.strictEqual(r.result.gain, 0);
});

check('settle other 123 rotates banker seat clockwise', () => {
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  r.banker = 'red';
  r.bankerSeat = 0;
  r.ranking = [r.players[1].id, r.players[3].id, r.players[5].id, r.players[0].id, r.players[2].id, r.players[4].id];
  r.players.forEach((p) => {
    if (!p.hand.length) p.hand = [C('3'), C('4')];
  });
  settle(r);
  assert.strictEqual(r.result.winning, 'blue');
  assert.strictEqual(r.result.points, 8);
  assert.strictEqual(r.bankerSeat, 1);
  assert.strictEqual(r.leadSeat, 1);
  assert.strictEqual(r.banker, teamOf(1));
});

check('full bot round completes', () => {
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  // Make human a bot too for autofinish
  r.players.forEach((p) => {
    p.bot = true;
  });
  let guard = 0;
  while (r.started && guard++ < 5000) {
    const p = r.players[r.turn];
    botMove(r, p);
  }
  assert.ok(!r.started, 'round should end');
  assert.ok(r.result, 'should have result');
  assert.ok(r.ranking.length === 6);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll tests passed');
