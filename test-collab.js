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
  shapeBreakCost,
  personaFor,
  comboEquityCost,
  keyCardOpportunityCost,
  leftoverDelta,
  isStrongFive,
  pass,
  play,
  ensureAiSense,
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
  support.name = '老克勒';
  support.role = 'support';
  main.role = 'main';
  // Avoid facingElite rattle so botMove matches pickLead
  r.players.forEach((p, i) => {
    if (p.name === '朝日') p.name = '阿根';
    if (i === 0 || i === 2) return;
    p.hand = Array.from({ length: 20 }, (_, k) => C(String((k % 8) + 3)));
  });
  main.hand = main.hand.slice(0, 8); // prefer 3-way feed
  support.hand = [
    C('3'),
    C('3', '♥'),
    C('3', '♦'),
    C('4'),
    C('4', '♥'),
    C('6', '♣'),
    C('8', '♦'),
    C('9', '♥'),
    C('10', '♣'),
    C('J', '♦'),
    C('Q', '♥'),
    C('K', '♣'),
    C('5', '♦'),
    C('7', '♥'),
    C('A', '♣'),
  ];
  r.turn = 0;
  r.table = null;
  const opts = candidates(support.hand, r.trump, null);
  const lead = pickLead(opts, r, support, 0, personaFor('老克勒'));
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
  bot.name = '麒麟';
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
  const lead = pickLead(opts, r, bot, 0, personaFor('麒麟'));
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

check('shapeBreakCost: breaking triple for single is costly', () => {
  const hand = [C('9'), C('9', '♥'), C('9', '♦'), C('3'), C('4'), C('5')];
  const breakTrip = { cards: [hand[0]], c: combo([hand[0]], '2') };
  const orphan = { cards: [hand[3]], c: combo([hand[3]], '2') };
  assert.ok(shapeBreakCost(breakTrip, hand) > shapeBreakCost(orphan, hand));
});

check('personaFor: 十三点 has high mistakeRate tendency', () => {
  const s = personaFor('十三点');
  const d = personaFor('阿根');
  const steady = personaFor('老克勒');
  assert.ok(s.mistakeRate > d.mistakeRate);
  assert.ok(s.mistakeRate > steady.mistakeRate);
  assert.ok(s.eatTeammateRate > steady.eatTeammateRate);
});

check('elite 麒麟/朝日 are intel 5 and never mistake', () => {
  const { intelFor } = require('./logic');
  for (const name of ['麒麟', '朝日']) {
    const p = personaFor(name);
    assert.strictEqual(intelFor(name), 5);
    assert.ok(p.elite);
    assert.strictEqual(p.mistakeRate, 0);
    assert.strictEqual(p.eatTeammateRate, 0);
  }
});

check('placeEliteBots: 麒麟 on host team, 朝日 on foe', () => {
  const { placeEliteBots } = require('./logic');
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const hostSeat = r.players.findIndex((p) => p.id === r.host);
  const myTeam = teamOf(hostSeat);
  const foe = myTeam === 'red' ? 'blue' : 'red';
  assert.ok(r.players.some((p, i) => p.bot && p.name === '麒麟' && teamOf(i) === myTeam));
  assert.ok(r.players.some((p, i) => p.bot && p.name === '朝日' && teamOf(i) === foe));
  void placeEliteBots;
});

// ——— Phase A: equity / opportunity / leftover ———
check('Phase A: 33322 has high equity cost; not isStrongFive', () => {
  const cards = [C('3'), C('3', '♥'), C('3', '♦'), C('2'), C('2', '♥')];
  const c = combo(cards, '2');
  assert.ok(c && c.kind === KIND.fullHouse);
  const opt = { cards, c };
  assert.ok(comboEquityCost(opt, '2') >= 50, 'weak full house costly');
  assert.ok(!isStrongFive(c, '2'), '33322 is not strong');
  const strong = {
    cards: [C('K'), C('K', '♥'), C('K', '♦'), C('5'), C('5', '♥')],
    c: combo([C('K'), C('K', '♥'), C('K', '♦'), C('5'), C('5', '♥')], '2'),
  };
  assert.ok(isStrongFive(strong.c, '2'));
  assert.ok(comboEquityCost(opt, '2') > comboEquityCost(strong, '2'));
});

check('Phase A: AI prefers small pair over leading 33322', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const bot = r.players[0];
  bot.name = '麒麟';
  bot.role = 'support';
  bot.hand = [
    C('3'),
    C('3', '♥'),
    C('3', '♦'),
    C('2'),
    C('2', '♥'),
    C('8'),
    C('8', '♥'),
    C('4'),
    C('5'),
    C('6'),
    C('7'),
    C('9'),
    C('10'),
    C('J'),
    C('Q'),
  ];
  r.players[2].role = 'main';
  r.players[2].hand = Array.from({ length: 18 }, (_, i) => C(String((i % 7) + 3)));
  r.players.forEach((p, i) => {
    if (i !== 0 && i !== 2) p.hand = Array.from({ length: 20 }, (_, k) => C(String((k % 8) + 3)));
  });
  r.turn = 0;
  r.table = null;
  const opts = candidates(bot.hand, r.trump, null);
  const lead = pickLead(opts, r, bot, 0);
  assert.ok(lead);
  assert.ok(
    !(lead.c.kind === KIND.fullHouse && lead.c.face === '3'),
    'must not open with 33322'
  );
});

check('Phase A: A2345 burns A/2 — high opportunity vs orphan 3', () => {
  const hand = [C('A'), C('2', '♥'), C('3', '♦'), C('4', '♣'), C('5'), C('7'), C('9')];
  const straight = {
    cards: [hand[0], hand[1], hand[2], hand[3], hand[4]],
    c: combo([hand[0], hand[1], hand[2], hand[3], hand[4]], '2'),
  };
  const orphan = { cards: [hand[5]], c: combo([hand[5]], '2') };
  assert.ok(straight.c && straight.c.kind === KIND.mixedStraight);
  assert.ok(keyCardOpportunityCost(straight, '2') > 20, 'A+2 in weak straight costly');
  assert.ok(
    leftoverDelta(straight, hand, '2') + keyCardOpportunityCost(straight, '2') + comboEquityCost(straight, '2') >
      leftoverDelta(orphan, hand, '2') + 5,
    'A2345 worse than dumping orphan'
  );
});

check('Phase A: padding 大王 on mid pair has key opportunity cost', () => {
  const waste = { cards: [C('9'), W()], c: combo([C('9'), W()], '2') };
  const pureBig = { cards: [W()], c: combo([W()], '2') };
  assert.ok(keyCardOpportunityCost(waste, '2') >= 20);
  assert.strictEqual(keyCardOpportunityCost(pureBig, '2'), 0);
  assert.ok(wildSpendCost(waste) + keyCardOpportunityCost(waste, '2') > 30);
});

// ——— Phase B: pass memory / switch line ———
check('Phase B: teammate pass on pairs → avoid reopening pairs', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const support = r.players[0];
  const main = r.players[2];
  support.name = '老克勒';
  support.role = 'support';
  main.role = 'main';
  // 9 cards → feed table prefers pairs; pass-memory should override to non-pair
  main.hand = main.hand.slice(0, 9);
  r.players.forEach((p, i) => {
    if (i === 0 || i === 2) return;
    p.hand = Array.from({ length: 20 }, (_, k) => C(String((k % 8) + 3)));
  });
  support.hand = [
    C('3'),
    C('3', '♥'),
    C('3', '♦'),
    C('8'),
    C('8', '♥'),
    C('4'),
    C('5'),
    C('6'),
    C('7'),
    C('9'),
    C('10'),
    C('J'),
    C('Q'),
    C('K'),
    C('A'),
  ];
  ensureAiSense(r);
  r.aiSense.teammatePassByLen.red[2] = 2;
  r.turn = 0;
  r.table = null;
  const opts = candidates(support.hand, r.trump, null);
  const lead = pickLead(opts, r, support, 0, personaFor('老克勒'));
  assert.ok(lead);
  assert.notStrictEqual(lead.cards.length, 2, 'after teammate pair-pass, avoid leading pairs');
});

check('Phase B: pass() records teammate pass length in aiSense', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const leadP = r.players[0];
  const mate = r.players[2];
  const pair = [C('8'), C('8', '♥')];
  leadP.hand = [...pair, C('3'), C('4')];
  mate.hand = [C('A'), C('A', '♥'), C('K'), C('Q')];
  r.turn = 0;
  r.table = null;
  play(r, leadP, [pair[0].id, pair[1].id]);
  r.turn = 2;
  pass(r, mate);
  assert.ok(r.aiSense.teammatePassByLen.red[2] >= 1, 'pair pass recorded for red');
});

// ——— Phase C / D smoke ———
check('Phase C/D: aiSense tracks played key cards; short hand still picks', () => {
  const r = newRoom();
  addPlayer(r, '人');
  start(r);
  const bot = r.players[0];
  bot.name = '麒麟';
  bot.role = 'main';
  bot.hand = [C('3'), C('4'), C('5'), C('6'), C('7'), C('8'), W(), C('9')];
  r.players.forEach((p, i) => {
    if (i === 0) return;
    p.hand = Array.from({ length: i % 2 ? 4 : 15 }, (_, k) => C(String((k % 8) + 3)));
  });
  ensureAiSense(r);
  r.aiSense.played.big = 4;
  r.scores = { red: 0, blue: 8 };
  r.matchRound = 5;
  r.turn = 0;
  r.table = null;
  const opts = candidates(bot.hand, r.trump, null);
  const lead = pickLead(opts, r, bot, 0);
  assert.ok(lead);
  assert.ok(lead.cards.length >= 1);
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
