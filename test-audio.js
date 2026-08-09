'use strict';
const assert = require('assert');
const { phaseFromState, diffAudioEvents } = require('./public/audio-diff.js');

function players(counts, opts = {}) {
  return counts.map((count, i) => ({
    id: `p${i}`,
    count,
    done: !!opts.done?.[i],
  }));
}

function base(over = {}) {
  return {
    started: false,
    turn: 0,
    round: 0,
    trickLog: [],
    players: players([27, 27, 27, 27, 27, 27]),
    result: null,
    ...over,
  };
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok', name);
  } catch (e) {
    failed += 1;
    console.error('FAIL', name, e.message);
  }
}

check('phase wait when not started', () => {
  assert.strictEqual(phaseFromState(base()), 'wait');
});

check('phase play when started all >10', () => {
  assert.strictEqual(phaseFromState(base({ started: true })), 'play');
});

check('phase tension when any count <=10', () => {
  const st = base({
    started: true,
    players: players([27, 10, 27, 27, 27, 27]),
  });
  assert.strictEqual(phaseFromState(st), 'tension');
});

check('phase play ignores done seats with low count', () => {
  const st = base({
    started: true,
    players: players([0, 27, 27, 27, 27, 27], { done: [true, false, false, false, false, false] }),
  });
  assert.strictEqual(phaseFromState(st), 'play');
});

check('snapshot: only yourTurn ding when my turn', () => {
  const next = base({
    started: true,
    turn: 0,
    trickLog: [
      { pass: false },
      { pass: true },
      { pass: false },
    ],
    players: players([27, 9, 27, 27, 27, 27]),
  });
  const ev = diffAudioEvents(null, next, 'p0', { snapshot: true });
  assert.strictEqual(ev.phase, 'tension');
  assert.deepStrictEqual(ev.sfx, ['yourTurn']);
  const evOther = diffAudioEvents(null, next, 'p2', { snapshot: true });
  assert.deepStrictEqual(evOther.sfx, []);
});

check('deal + play phase on start', () => {
  const prev = base({ started: false });
  const next = base({ started: true, turn: 0 });
  const ev = diffAudioEvents(prev, next, 'p0');
  assert.strictEqual(ev.phase, 'play');
  assert.ok(ev.sfx.includes('deal'));
  assert.ok(ev.sfx.includes('yourTurn'));
});

check('play and pass from trickLog append', () => {
  const prev = base({
    started: true,
    trickLog: [{ pass: false, playerId: 'p0' }],
  });
  const next = base({
    started: true,
    trickLog: [
      { pass: false, playerId: 'p0' },
      { pass: true, playerId: 'p1' },
      { pass: false, playerId: 'p2' },
    ],
  });
  const ev = diffAudioEvents(prev, next, 'p5');
  const kinds = ev.sfx
    .map((s) => (typeof s === 'object' ? s.id : s))
    .filter((s) => s === 'pass' || s === 'play');
  assert.deepStrictEqual(kinds, ['pass', 'play']);
  const passEv = ev.sfx.find((s) => typeof s === 'object' && s.id === 'pass');
  assert.strictEqual(passEv.name, 'p1');
});

check('guessVoiceGender from nicknames', () => {
  const { guessVoiceGender } = require('./public/audio-diff.js');
  assert.strictEqual(guessVoiceGender('小囡'), 'f');
  assert.strictEqual(guessVoiceGender('阿妹'), 'f');
  assert.strictEqual(guessVoiceGender('阿庆'), 'm');
  assert.strictEqual(guessVoiceGender('册那队长'), 'm');
});

check('new lead after log shrink to one', () => {
  const prev = base({
    started: true,
    trickLog: [{ pass: false }, { pass: true }, { pass: true }],
  });
  const next = base({
    started: true,
    trickLog: [{ pass: false, playerId: 'p3' }],
  });
  const ev = diffAudioEvents(prev, next, 'p0');
  assert.ok(ev.sfx.includes('play'));
});

check('yourTurn only when becoming me', () => {
  const prev = base({ started: true, turn: 1 });
  const next = base({ started: true, turn: 0 });
  const ev = diffAudioEvents(prev, next, 'p0');
  assert.ok(ev.sfx.includes('yourTurn'));
  const ev2 = diffAudioEvents(prev, next, 'p2');
  assert.ok(!ev2.sfx.includes('yourTurn'));
});

check('tension enter sfx', () => {
  const prev = base({
    started: true,
    players: players([27, 11, 27, 27, 27, 27]),
  });
  const next = base({
    started: true,
    players: players([27, 10, 27, 27, 27, 27]),
  });
  const ev = diffAudioEvents(prev, next, 'p0');
  assert.strictEqual(ev.phase, 'tension');
  assert.ok(ev.sfx.includes('tension'));
});

check('finish on new done', () => {
  const prev = base({
    started: true,
    players: players([1, 27, 27, 27, 27, 27]),
  });
  const next = base({
    started: true,
    players: players([0, 27, 27, 27, 27, 27], { done: [true, false, false, false, false, false] }),
  });
  const ev = diffAudioEvents(prev, next, 'p0');
  assert.ok(ev.sfx.includes('finish'));
});

check('roundEnd + wait', () => {
  const prev = base({ started: true, round: 0 });
  const next = base({ started: false, round: 1, result: { points: 3 } });
  const ev = diffAudioEvents(prev, next, 'p0');
  assert.strictEqual(ev.phase, 'wait');
  assert.ok(ev.sfx.includes('roundEnd'));
});

check('seatJoin when waiting', () => {
  const prev = base({ players: players([27, 27]) });
  const next = base({ players: players([27, 27, 27]) });
  const ev = diffAudioEvents(prev, next, 'p0');
  assert.ok(ev.sfx.includes('seatJoin'));
});

if (failed) {
  console.error(`\n${failed} audio tests failed`);
  process.exit(1);
}
console.log('\nall audio tests passed');
