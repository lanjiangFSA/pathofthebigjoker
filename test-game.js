'use strict';
/**
 * Game / UI / timer regression checks (merged from former v0.4 / v0.5 / ui-fixes suites).
 */
const assert = require('assert');
const {
  combo,
  play,
  pass,
  newRoom,
  addPlayer,
  start,
  botMove,
  settle,
  scoreFromPlaces,
  KIND,
  uid,
  state,
  autoAct,
  checkTimeout,
  TURN_MS,
  TURN_MS_FIRST,
  armTurn,
  isSureWinCards,
  teamCleared,
  shouldSettle,
  teamOf,
} = require('./logic');

function C(r, s = '♠') {
  return { id: uid(), r, s };
}
function W(r = '大怪') {
  return { id: uid(), r, s: '★' };
}

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
  for (let i = 0; i < 5 && r.table; i++) {
    const p = r.players[r.turn];
    if (p.id === h.id) break;
    try {
      pass(r, p);
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
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  r.banker = 'red';
  r.bankerSeat = 0;
  r.scores = { red: 0, blue: 0 };
  r.ranking = [
    r.players[0].id,
    r.players[2].id,
    r.players[4].id,
    r.players[1].id,
    r.players[3].id,
    r.players[5].id,
  ];
  r.players.forEach((p) => {
    if (!p.hand.length) p.hand = [{ id: 'x', r: '3', s: '♠' }, { id: 'y', r: '4', s: '♠' }];
  });
  settle(r);
  assert.strictEqual(r.scores.red, 8);
  assert.strictEqual(r.scores.blue, 0);
  assert.ok(r.result.points >= 8);
  assert.deepStrictEqual(r.result.tributers, []);
  assert.strictEqual(r.bankerSeat, 1);
  assert.strictEqual(r.leadSeat, 1);
});

check('onlyAiPlaying when no humans left in hand', () => {
  const { onlyAiPlaying, humansStillPlaying } = require('./logic');
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  assert.strictEqual(onlyAiPlaying(r), false);
  assert.strictEqual(humansStillPlaying(r), true);
  r.ranking.push(h.id);
  assert.strictEqual(humansStillPlaying(r), false);
  assert.strictEqual(onlyAiPlaying(r), true);
});

check('join idempotent by id and leave ai', () => {
  const { leavePlayer, findPlayer } = require('./logic');
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  const before = r.players.length;
  leavePlayer(r, h.id, 'ai');
  assert.strictEqual(r.players.length, before);
  assert.ok(findPlayer(r, h.id).bot);
  assert.ok(r.started);
});

check('match ends at 6 then regroup on start', () => {
  const { regroupHumans } = require('./logic');
  const r = newRoom();
  addPlayer(r, 'A');
  addPlayer(r, 'B');
  start(r);
  assert.strictEqual(r.matchRound, 1);
  r.matchRound = 6;
  r.ranking = r.players.map((p) => p.id);
  r.players.forEach((p) => {
    if (!p.hand.length) p.hand = [{ id: uid(), r: '3', s: '♠' }];
  });
  settle(r);
  assert.ok(r.matchOver);
  const scores = { ...r.scores };
  start(r);
  assert.strictEqual(r.matchRound, 1);
  assert.ok(!r.matchOver);
  assert.deepStrictEqual(r.scores, { red: 0, blue: 0 });
  assert.ok(scores.red + scores.blue >= 0);
});

check('TURN_MS is 25s and first lead 45s', () => {
  assert.strictEqual(TURN_MS, 25000);
  assert.strictEqual(TURN_MS_FIRST, 45000);
});

check('start arms first-lead deadline', () => {
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  assert.ok(r.turnDeadline);
  assert.ok(!r.firstLeadDone);
  assert.ok(r.turnDeadline > Date.now());
  assert.ok(r.turnDeadline <= Date.now() + TURN_MS_FIRST + 50);
  const st = state(r, r.players[0].id);
  assert.ok(st.turnDeadline);
  assert.strictEqual(st.turnMs, TURN_MS_FIRST);
});

check('after first play uses TURN_MS', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  r.turn = r.players.indexOf(h);
  r.table = null;
  const card = h.hand[0];
  play(r, h, [card.id]);
  assert.ok(r.firstLeadDone);
  const st = state(r, h.id);
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
  r.turn = r.players.findIndex((p) => p.id === h.id);
  r.table = null;
  r.passes = 0;
  r.trickLog = [];
  armTurn(r);
  const before = h.hand.length;
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
  r.firstLeadDone = true;
  armTurn(r);
  assert.ok(autoAct(r));
  assert.ok(String(r.message).includes('超时'));
  assert.ok(r.passes >= 1 || !r.table || r.message.includes('不出') || r.message.includes('获得出牌权'));
});

check('autoAct follow always passes even if can beat', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  h.bot = false;
  r.firstLeadDone = true;
  const other = r.players.find((p) => p.id !== h.id);
  const weak = { id: 't3', r: '3', s: '♠' };
  h.hand = [
    { id: 'hb', r: '大怪', s: '★' },
    { id: 'h2', r: '2', s: '♥' },
  ];
  r.table = {
    player: other.id,
    cards: [weak],
    combo: { kind: KIND.single, rank: 1, label: '单张' },
  };
  r.turn = r.players.findIndex((p) => p.id === h.id);
  r.passes = 0;
  r.trickLog = [];
  const before = h.hand.length;
  assert.ok(autoAct(r));
  assert.strictEqual(h.hand.length, before);
  assert.ok(String(r.message).includes('不出') || String(r.message).includes('超时'));
});

check('isSureWinCards joker shapes', () => {
  assert.ok(isSureWinCards([{ r: '大怪', s: '★' }]));
  assert.ok(isSureWinCards([{ r: '大怪', s: '★' }, { r: '大怪', s: '★' }]));
  assert.ok(
    isSureWinCards([
      { r: '大怪', s: '★' },
      { r: '大怪', s: '★' },
      { r: '大怪', s: '★' },
    ])
  );
  assert.ok(
    isSureWinCards([
      { r: '大怪', s: '★' },
      { r: '小怪', s: '★' },
      { r: '小怪', s: '★' },
    ])
  );
  assert.ok(
    isSureWinCards([
      { r: '大怪', s: '★' },
      { r: '大怪', s: '★' },
      { r: '小怪', s: '★' },
    ])
  );
  assert.ok(!isSureWinCards([{ r: '小怪', s: '★' }]));
  assert.ok(!isSureWinCards([{ r: '大怪', s: '★' }, { r: '小怪', s: '★' }]));
});

check('sure-win single 大怪 skips pass circle', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  h.bot = false;
  r.firstLeadDone = true;
  r.turn = r.players.indexOf(h);
  r.table = null;
  r.passes = 0;
  r.trickLog = [];
  const big = { id: 'big1', r: '大怪', s: '★' };
  h.hand = [big, { id: 'n3', r: '3', s: '♠' }, { id: 'n4', r: '4', s: '♠' }];
  play(r, h, [big.id]);
  assert.ok(!r.table, 'table cleared after sure-win');
  assert.ok(String(r.message).includes('天王') || String(r.message).includes('自动过'));
  assert.strictEqual(r.turn, r.players.indexOf(h));
});

check('short hand auto-passes on armTurn', () => {
  const r = newRoom();
  const h = addPlayer(r, 'H');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  h.bot = false;
  r.firstLeadDone = true;
  const other = r.players.find((p) => p.id !== h.id);
  h.hand = [
    { id: 'a', r: '3', s: '♠' },
    { id: 'b', r: '4', s: '♠' },
  ];
  r.table = {
    player: other.id,
    cards: [
      { id: 't1', r: '5', s: '♠' },
      { id: 't2', r: '5', s: '♥' },
      { id: 't3', r: '5', s: '♦' },
      { id: 't4', r: '5', s: '♣' },
      { id: 't5', r: '6', s: '♠' },
    ],
    combo: { kind: KIND.fourPlus, rank: 10, label: '四带一' },
  };
  r.turn = r.players.indexOf(h);
  r.passes = 0;
  r.trickLog = [];
  armTurn(r);
  assert.ok(
    String(r.message).includes('牌不够') ||
      String(r.message).includes('不出') ||
      !r.table ||
      r.turn !== r.players.indexOf(h)
  );
});

check('team of three finished settles early', () => {
  const r = newRoom();
  addPlayer(r, 'H');
  start(r);
  const redIds = r.players.filter((_, i) => teamOf(i) === 'red').map((p) => p.id);
  assert.strictEqual(redIds.length, 3);
  r.ranking = [...redIds];
  assert.ok(teamCleared(r));
  assert.ok(shouldSettle(r));
  r.players.forEach((p) => {
    if (!r.ranking.includes(p.id) && !p.hand.length) {
      p.hand = [{ id: uid(), r: '3', s: '♠' }];
    }
  });
  settle(r);
  assert.ok(!r.started);
  assert.strictEqual(r.ranking.length, 6);
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
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ntest-game OK');
