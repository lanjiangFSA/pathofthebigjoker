'use strict';
/**
 * Bot policy: candidates → pickLead / pickBeat → botMove.
 * Shape + equity + leftover difficulty + pass-memory coop + light score/card sense.
 */
const {
  KIND,
  suits,
  combo,
  beats,
  teamOf,
  isWild,
  naturalPower,
  subsetsOfSize,
  STRAIGHT_WINDOWS,
  sort,
  play,
  pass,
  next,
} = require('./logic');

/** Nickname → probability tendencies (not absolute). intel 1–5 shown in UI. */
const DEFAULT_PERSONA = {
  intel: 3,
  mistakeRate: 0.06,
  eatTeammateRate: 0.01,
  wildBias: 1,
  weakFiveBias: 1,
  elite: false,
};

const PERSONAS = {
  十三点: { intel: 1, mistakeRate: 0.4, eatTeammateRate: 0.08, wildBias: 1.6, weakFiveBias: 2.2 },
  小滑头: { intel: 2, mistakeRate: 0.18, eatTeammateRate: 0.03, wildBias: 1.35, weakFiveBias: 1.4 },
  小赤佬: { intel: 2, mistakeRate: 0.16, eatTeammateRate: 0.025, wildBias: 1.3, weakFiveBias: 1.35 },
  老克勒: { intel: 4, mistakeRate: 0.03, eatTeammateRate: 0, wildBias: 0.85, weakFiveBias: 0.7 },
  路子王: { intel: 4, mistakeRate: 0.03, eatTeammateRate: 0, wildBias: 0.8, weakFiveBias: 0.65 },
  册那队长: { intel: 4, mistakeRate: 0.04, eatTeammateRate: 0, wildBias: 0.85, weakFiveBias: 0.75 },
  // 5★ elites: never mistake; tighter shape/wild; always main on team
  麒麟: {
    intel: 5,
    elite: true,
    mistakeRate: 0,
    eatTeammateRate: 0,
    wildBias: 0.55,
    weakFiveBias: 0.45,
  },
  朝日: {
    intel: 5,
    elite: true,
    mistakeRate: 0,
    eatTeammateRate: 0,
    wildBias: 0.55,
    weakFiveBias: 0.45,
  },
};

function personaFor(name) {
  return { ...DEFAULT_PERSONA, ...(PERSONAS[name] || {}) };
}

function intelFor(name) {
  return personaFor(name).intel || 3;
}

/** Effective persona for this seat: elite mates calm allies; facing elite rattles foes. */
function effectivePersona(r, p) {
  const base = personaFor(p.name);
  if (base.elite || !r?.players) return base;
  const seat = r.players.indexOf(p);
  if (seat < 0) return base;
  const myTeam = teamOf(seat);
  const hasEliteMate = r.players.some(
    (x, i) => i !== seat && teamOf(i) === myTeam && !r.ranking.includes(x.id) && personaFor(x.name).elite
  );
  const facingElite = r.players.some(
    (x, i) => teamOf(i) !== myTeam && !r.ranking.includes(x.id) && personaFor(x.name).elite
  );
  let next = { ...base };
  if (hasEliteMate) {
    next.mistakeRate = Math.min(next.mistakeRate, 0.03);
    next.eatTeammateRate = 0;
    next.wildBias = Math.min(next.wildBias, 0.95);
    next.weakFiveBias = Math.min(next.weakFiveBias, 0.95);
  }
  if (facingElite) {
    next.mistakeRate = Math.min(0.72, next.mistakeRate + 0.28);
    next.eatTeammateRate = Math.min(0.18, next.eatTeammateRate + 0.06);
    next.wildBias = next.wildBias * 1.25;
    next.weakFiveBias = next.weakFiveBias * 1.3;
  }
  return next;
}

function roll(p) {
  return Math.random() < p;
}

function handStrength(hand, trump) {
  let score = 0;
  score += hand.filter(isWild).length * 8;
  score += hand.filter((c) => c.r === trump).length * 5;
  score += hand.filter((c) => c.r === 'A' || c.r === 'K').length * 2;
  const by = {};
  hand.forEach((c) => {
    if (isWild(c)) return;
    by[c.r] = (by[c.r] || 0) + 1;
  });
  const counts = Object.values(by);
  score += counts.filter((n) => n >= 5).length * 12;
  score += counts.filter((n) => n === 4).length * 8;
  score += counts.filter((n) => n === 3).length * 4;
  score += counts.filter((n) => n === 2).length * 2;
  try {
    const fives = candidates(hand, trump, null).filter((o) => o.cards.length === 5);
    if (fives.some((o) => o.c.kind >= KIND.straightFlush)) score += 16;
    else if (fives.some((o) => o.c.kind >= KIND.fourPlus)) score += 12;
    else if (fives.some((o) => o.c.kind >= KIND.fullHouse)) score += 8;
    else if (fives.length) score += 3;
  } catch {
    /* ignore */
  }
  return score;
}

function buildFiveCandidates(hand, wilds, by) {
  const out = [];
  const faces = Object.keys(by);
  const fat = (hand?.length || 0) >= 20;
  const maxWFive = fat ? Math.min(wilds.length, 2) : Math.min(wilds.length, 5);
  const maxWElse = fat ? Math.min(wilds.length, 2) : Math.min(wilds.length, 3);
  const bodyCap = fat ? 4 : 8;
  const wildCap = fat ? 3 : 6;
  const kickerCap = fat ? 6 : 12;

  for (const f of faces) {
    const list = by[f];
    for (let w = 0; w <= maxWFive; w++) {
      if (list.length + w >= 5 && list.length >= 1) {
        for (const body of subsetsOfSize(list, Math.min(list.length, 5 - w), bodyCap)) {
          for (const ws of subsetsOfSize(wilds, w, wildCap)) {
            if (body.length + ws.length === 5) out.push([...body, ...ws]);
          }
        }
      }
    }
    for (let w = 0; w <= maxWElse; w++) {
      const need = Math.max(0, 4 - list.length);
      if (need > w) continue;
      const take = Math.min(list.length, 4);
      for (const body of subsetsOfSize(list, take, fat ? 3 : 6)) {
        for (const ws of subsetsOfSize(wilds, w, fat ? 2 : 4)) {
          const used = body.length + ws.length;
          if (used > 5) continue;
          const remain = 5 - used;
          if (remain === 1) {
            const kickers = hand.filter((c) => !body.includes(c) && !ws.includes(c));
            for (const k of kickers.slice(0, kickerCap)) out.push([...body, ...ws, k]);
          } else if (remain === 0 && body.length + ws.length === 5) {
            out.push([...body, ...ws]);
          }
        }
      }
    }
  }
  for (let i = 0; i < faces.length; i++) {
    for (let j = 0; j < faces.length; j++) {
      if (i === j) continue;
      const a = by[faces[i]];
      const b = by[faces[j]];
      const maxW = fat ? Math.min(wilds.length, 2) : wilds.length;
      for (let w = 0; w <= maxW; w++) {
        for (let na = Math.min(a.length, 3); na >= 1; na--) {
          for (let nb = Math.min(b.length, 2); nb >= 1; nb--) {
            if (na + nb + w !== 5) continue;
            if (na + Math.min(w, 3 - na) < 3) continue;
            for (const ta of subsetsOfSize(a, na, fat ? 2 : 4)) {
              for (const tb of subsetsOfSize(b, nb, fat ? 2 : 4)) {
                for (const ws of subsetsOfSize(wilds, w, fat ? 2 : 4)) out.push([...ta, ...tb, ...ws]);
              }
            }
          }
        }
      }
    }
  }
  const normals = hand.filter((c) => !isWild(c));
  for (const win of STRAIGHT_WINDOWS) {
    const picks = [];
    let miss = 0;
    for (const face of win) {
      const card = normals.find((c) => c.r === face && !picks.includes(c));
      if (card) picks.push(card);
      else miss++;
    }
    if (miss <= wilds.length && picks.length + Math.min(miss, wilds.length) === 5) {
      out.push([...picks, ...wilds.slice(0, miss)]);
    }
  }
  for (const s of suits) {
    const suited = normals.filter((c) => c.s === s);
    const maxWf = fat ? Math.min(wilds.length, 1) : Math.min(wilds.length, 4);
    for (let w = 0; w <= maxWf; w++) {
      if (suited.length + w < 5) continue;
      for (const five of subsetsOfSize(suited, 5 - w, fat ? 4 : 10)) {
        for (const ws of subsetsOfSize(wilds, w, fat ? 2 : 4)) out.push([...five, ...ws]);
      }
    }
  }
  if (wilds.length >= 5) for (const ws of subsetsOfSize(wilds, 5, 5)) out.push(ws);
  return out;
}

function candidates(hand, trump, table) {
  const out = [];
  for (const c of hand) out.push([c]);
  const by = {};
  hand.forEach((c) => {
    const k = isWild(c) ? 'wild' : c.r;
    (by[k] ??= []).push(c);
  });
  const wilds = by.wild || [];
  const faces = Object.keys(by).filter((k) => k !== 'wild');

  for (const f of faces) {
    const list = by[f];
    for (let w = 0; w <= wilds.length; w++) {
      for (let n = 1; n <= list.length; n++) {
        if (n + w === 2) {
          for (const pair of subsetsOfSize(list, n, 20))
            for (const ws of subsetsOfSize(wilds, w, 10)) out.push([...pair, ...ws]);
        }
        if (n + w === 3) {
          for (const trip of subsetsOfSize(list, n, 15))
            for (const ws of subsetsOfSize(wilds, w, 8)) out.push([...trip, ...ws]);
        }
      }
    }
  }
  if (wilds.length >= 2) for (const ws of subsetsOfSize(wilds, 2, 10)) out.push(ws);
  if (wilds.length >= 3) for (const ws of subsetsOfSize(wilds, 3, 10)) out.push(ws);

  const needFives = !table || table.kind >= KIND.mixedStraight;
  // Early fat hands: skip combinatorial fives (pairs/triples suffice); generate later when shorter
  const skipHeavyFives = !table && hand.length >= 20;
  if (needFives && !skipHeavyFives) {
    const faceMap = {};
    faces.forEach((f) => {
      faceMap[f] = by[f];
    });
    for (const five of buildFiveCandidates(hand, wilds, faceMap)) out.push(five);
  } else if (needFives && skipHeavyFives) {
    // Keep cheap natural windows only (no wild-pad explosion)
    const normals = hand.filter((c) => !isWild(c));
    for (const win of STRAIGHT_WINDOWS) {
      const picks = [];
      let miss = 0;
      for (const face of win) {
        const card = normals.find((c) => c.r === face && !picks.includes(c));
        if (card) picks.push(card);
        else miss++;
      }
      if (miss === 0 && picks.length === 5) out.push(picks);
    }
  }

  const seen = new Set();
  const result = [];
  for (const cards of out) {
    if (cards.length > 5 || cards.length < 1) continue;
    const key = cards
      .map((c) => c.id)
      .sort()
      .join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const c = combo(cards, trump);
    if (c && beats(c, table)) result.push({ cards, c });
  }
  return result.sort(
    (a, b) =>
      wildSpendCost(a) + shapeBreakCost(a, hand) - (wildSpendCost(b) + shapeBreakCost(b, hand)) ||
      a.c.kind - b.c.kind ||
      a.c.rank - b.c.rank
  );
}

function countWilds(cards) {
  return (cards || []).filter(isWild).length;
}

function faceNat(face) {
  if (face == null) return -1;
  if (face === '大怪') return 14;
  if (face === '小怪') return 13;
  return naturalPower(face);
}

/** Natural power of the pair half in a 三带两 (not the triple face). */
function fullHouseSideNat(opt, trump = '2') {
  const c = opt?.c;
  if (!c || c.kind !== KIND.fullHouse) return -1;
  const by = {};
  let wilds = 0;
  for (const card of opt.cards || []) {
    if (isWild(card)) {
      wilds++;
      continue;
    }
    by[card.r] = (by[card.r] || 0) + 1;
  }
  for (const [f, n] of Object.entries(by)) {
    if (f === c.face) continue;
    return faceNat(f);
  }
  // Pair filled by wilds → treat as strong attachment
  if (wilds >= 2) return 14;
  void trump;
  return -1;
}

/** Soft cost: combo kind ≠ fighting strength (e.g. 33322 is a weak full house). */
function comboEquityCost(opt, trump = '2') {
  const c = opt?.c;
  if (!c) return 0;
  if (c.kind < KIND.mixedStraight) return 0;

  if (c.kind === KIND.fullHouse) {
    if (c.face === trump) {
      // Fighting strength is high, but junk pair attachment is handled in key cost
      const side = fullHouseSideNat(opt, trump);
      if (side >= 0 && side <= 4) return 8;
      if (side >= 0 && side <= 7) return 3;
      return 0;
    }
    const nat = faceNat(c.face);
    if (nat <= 2) return 58;
    if (nat <= 5) return 38;
    if (nat <= 8) return 18;
    if (nat <= 10) return 6;
    return 0;
  }
  if (c.kind === KIND.fourPlus) {
    if (c.face === trump) return 0;
    const nat = faceNat(c.face);
    if (nat <= 3) return 28;
    if (nat <= 6) return 14;
    if (nat <= 9) return 4;
    return 0;
  }
  if (c.kind <= KIND.flush) {
    const rank = c.rank || 0;
    if (rank < 40) return 42;
    if (rank < 55) return 30;
    if (rank < 70) return 12;
    return 2;
  }
  return 0;
}

/**
 * Opportunity cost of burning control cards (大王/小王/将/A) in weak shapes.
 * Soft scores — never an absolute ban.
 */
function keyCardOpportunityCost(opt, trump = '2') {
  const cards = opt?.cards || [];
  const c = opt?.c;
  if (!c || !cards.length) return 0;
  if (cards.every(isWild)) return 0;

  let cost = 0;
  const big = cards.filter((x) => x.r === '大怪').length;
  const small = cards.filter((x) => x.r === '小怪').length;
  const trumpUsed = cards.filter((x) => !isWild(x) && x.r === trump).length;
  const aUsed = cards.filter((x) => x.r === 'A').length;
  const nat = faceNat(c.face);

  if (big && c.kind !== KIND.single) {
    if (c.kind >= KIND.straightFlush) cost += big * 4;
    else if (c.kind >= KIND.fourPlus && (c.face === trump || nat >= 10)) cost += big * 7;
    else if (c.kind === KIND.pair || c.kind === KIND.triple) {
      cost += big * (nat >= 11 ? 9 : nat >= 8 ? 24 : 40);
    } else if (c.kind === KIND.fullHouse) {
      cost += big * (nat >= 10 ? 12 : nat >= 7 ? 26 : 36);
    } else {
      cost += big * ((c.rank || 0) < 70 ? 44 : 22);
    }
  }
  if (small && c.kind !== KIND.single) {
    if (c.kind >= KIND.fourPlus && (c.face === trump || nat >= 9)) cost += small * 4;
    else if (c.kind === KIND.pair || c.kind === KIND.triple) {
      cost += small * (nat >= 10 ? 6 : nat >= 7 ? 16 : 28);
    } else if (c.kind === KIND.fullHouse) {
      cost += small * (nat >= 9 ? 8 : nat >= 6 ? 16 : 24);
    } else if (c.kind <= KIND.flush && (c.rank || 0) < 65) {
      cost += small * 20;
    }
  }

  if (c.kind === KIND.fullHouse && c.face !== trump && trumpUsed) {
    cost += trumpUsed * (nat <= 5 ? 30 : nat <= 8 ? 16 : 8);
  }
  // 222 + weak pair (e.g. 22255): nuclear 将 triple wasted as five with junk attachment
  if (c.kind === KIND.fullHouse && c.face === trump && trumpUsed >= 3) {
    const side = fullHouseSideNat(opt, trump);
    if (side >= 0 && side < 9) {
      cost += trumpUsed * (side <= 4 ? 14 : side <= 7 ? 9 : 5);
    }
  }
  if (c.kind >= KIND.mixedStraight && c.kind <= KIND.flush) {
    const weak = (c.rank || 0) < 60;
    if (weak) {
      cost += trumpUsed * 24;
      cost += aUsed * 18;
    } else {
      cost += trumpUsed * 8;
      cost += aUsed * 6;
    }
  }
  return cost;
}

/** Rough leftover awkwardness: fewer natural piles / orphans is better. */
function leftoverDifficulty(hand, usedCards = [], trump = '2') {
  const used = new Set((usedCards || []).map((c) => c.id));
  const remain = (hand || []).filter((c) => !used.has(c.id));
  if (!remain.length) return 0;
  const by = {};
  let wilds = 0;
  remain.forEach((c) => {
    if (isWild(c)) wilds++;
    else by[c.r] = (by[c.r] || 0) + 1;
  });
  let orphans = 0;
  let pairs = 0;
  let trips = 0;
  let bombs = 0;
  for (const n of Object.values(by)) {
    if (n === 1) orphans++;
    else if (n === 2) pairs++;
    else if (n === 3) trips++;
    else bombs++;
  }
  const cover = Math.min(wilds, orphans);
  const looseWild = Math.max(0, wilds - cover);
  const piles = orphans - cover + pairs + trips + bombs + Math.ceil(looseWild / 2);
  return piles * 3.2 + (orphans - cover) * 5 + remain.length * 0.35 - bombs * 2;
}

function leftoverDelta(opt, hand, trump = '2') {
  if (!opt?.cards?.length || !hand?.length) return 0;
  return leftoverDifficulty(hand, opt.cards, trump) - leftoverDifficulty(hand, [], trump);
}

function wildSpendCost(opt) {
  const cards = opt?.cards || [];
  const w = countWilds(cards);
  if (w === 0) return 0;
  if (cards.every(isWild)) return 0;
  const c = opt.c;
  if (!c || c.kind === KIND.single) return 0;

  if (c.kind === KIND.pair || c.kind === KIND.triple) {
    const nat = c.face != null ? naturalPower(c.face) : -1;
    if (nat < 0) return w * 40;
    if (nat < 8) return w * (36 + (8 - nat) * 10);
    if (nat < 11) return w * 14;
    return w * 5;
  }

  if (c.kind >= KIND.fourPlus) return w * 3;
  if (c.kind >= KIND.fullHouse) return (c.rank || 0) < 60 ? w * 16 : w * 6;
  if (c.kind >= KIND.mixedStraight) return (c.rank || 0) < 50 ? w * 22 : w * 10;
  return w * 18;
}

/** Cost of breaking hand structure. Higher = worse. */
function shapeBreakCost(opt, hand) {
  if (!opt?.cards?.length || !hand?.length) return 0;
  const c = opt.c;
  const by = {};
  hand.forEach((card) => {
    if (isWild(card)) return;
    by[card.r] = (by[card.r] || 0) + 1;
  });
  const after = { ...by };
  for (const card of opt.cards) {
    if (isWild(card)) continue;
    after[card.r] = (after[card.r] || 0) - 1;
  }

  let cost = 0;
  for (const face of Object.keys(by)) {
    const before = by[face];
    const left = after[face] || 0;
    if (before >= 4 && left < 4) cost += 45 + (before - left) * 8;
    else if (before >= 3 && left < 3 && c.kind === KIND.single) cost += 28;
    else if (before >= 3 && left < 3 && c.kind === KIND.pair) cost += 22;
    else if (before >= 3 && left < 3 && c.kind === KIND.fullHouse && c.face !== face) cost += 18;
    else if (before >= 2 && left < 2 && c.kind === KIND.single) cost += 16;
  }

  const bigUsed = opt.cards.filter((x) => x.r === '大怪').length;
  const smallUsed = opt.cards.filter((x) => x.r === '小怪').length;
  if (bigUsed && c && c.kind >= KIND.mixedStraight && c.kind < KIND.fourPlus && (c.rank || 0) < 70) {
    cost += bigUsed * 40;
  }
  if (smallUsed && c && c.kind === KIND.fullHouse && (c.rank || 0) < 55) {
    cost += smallUsed * 18;
  }

  if (c?.kind === KIND.single && countWilds(opt.cards) === 0) {
    const face = opt.cards[0].r;
    if ((by[face] || 0) === 1) cost -= 4;
  }
  return Math.max(0, cost);
}

function moveCost(opt, hand, persona = DEFAULT_PERSONA, trump = '2') {
  const wild = wildSpendCost(opt) * (persona.wildBias || 1);
  const shape = shapeBreakCost(opt, hand) * (persona.weakFiveBias || 1);
  const equity = comboEquityCost(opt, trump) * (persona.weakFiveBias || 1);
  const key = keyCardOpportunityCost(opt, trump) * (persona.wildBias || 1);
  const left = hand ? leftoverDelta(opt, hand, trump) : 0;
  return wild + shape + equity + key + left;
}

function scoreMove(o, ctx) {
  const {
    hand = null,
    persona = DEFAULT_PERSONA,
    trump = '2',
    preferMinimalBeat = false,
    tableRank = 0,
    eliteScore = false,
    enemyMin = 99,
    linePenalty = 0,
    teamBias = 0,
    cardSenseBias = 0,
  } = ctx || {};
  const wild = wildSpendCost(o) * (persona.wildBias || 1);
  const shape = hand ? shapeBreakCost(o, hand) * (persona.weakFiveBias || 1) : 0;
  const equity = comboEquityCost(o, trump) * (persona.weakFiveBias || 1);
  const key = keyCardOpportunityCost(o, trump) * (persona.wildBias || 1);
  const leftDelta = hand && hand.length <= 16 ? leftoverDelta(o, hand, trump) : 0;
  const beatSlack =
    preferMinimalBeat && o.c ? Math.max(0, (o.c.rank || 0) - tableRank) + (o.c.kind || 0) * 2 : 0;
  let weakFive = 0;
  if (hand && !preferMinimalBeat && o.cards?.length === 5 && o.c?.kind <= KIND.flush && (o.c.rank || 0) < 55) {
    weakFive = 25 * (persona.weakFiveBias || 1);
  }
  let total =
    wild + shape + equity + key + leftDelta * 1.1 + weakFive + beatSlack * 0.15 + linePenalty + teamBias + cardSenseBias;
  if (eliteScore && hand) {
    const left = hand.length - o.cards.length;
    total -= left === 0 ? 90 : left <= 2 ? 35 : left <= 5 ? 12 : 0;
    if (o.c?.kind >= KIND.fourPlus && enemyMin > 5 && comboEquityCost(o, trump) > 20) total += 18;
    else if (o.c?.kind >= KIND.fourPlus && enemyMin > 5) total += 10;
    if (preferMinimalBeat) total += beatSlack * 0.05;
    total -= Math.min(8, left === o.cards.length ? 0 : 3);
  }
  return { o, wild, shape, equity, key, leftDelta, total };
}

function pickFrom(options, opts = {}) {
  const {
    maxWild = 18,
    maxShape = 40,
    force = true,
    hand = null,
    persona = DEFAULT_PERSONA,
    preferMinimalBeat = false,
    tableRank = 0,
    eliteScore = false,
    enemyMin = 99,
    trump = '2',
    lineAvoid = null,
    teamBiasFn = null,
    cardSenseFn = null,
    room = null,
    seat = -1,
  } = opts;
  if (!options?.length) return null;
  let pool = options;
  if (options.length > 100) {
    // Cheap prefilter before full equity / leftover scoring
    pool = [...options]
      .map((o) => ({ o, cheap: wildSpendCost(o) + shapeBreakCost(o, hand || []) + comboEquityCost(o, trump) * 0.5 }))
      .sort((a, b) => a.cheap - b.cheap)
      .slice(0, 80)
      .map((x) => x.o);
  }
  const scored = pool.map((o) => {
    const len = o.cards?.length || 0;
    const linePenalty = lineAvoid && lineAvoid[len] ? lineAvoid[len] * 14 : 0;
    const teamBias = teamBiasFn ? teamBiasFn(o) : 0;
    const cardSenseBias = cardSenseFn ? cardSenseFn(o) : 0;
    return scoreMove(o, {
      hand,
      persona,
      trump,
      preferMinimalBeat,
      tableRank,
      eliteScore,
      enemyMin,
      linePenalty,
      teamBias,
      cardSenseBias,
    });
  });
  scored.sort((a, b) => a.total - b.total || a.o.c.kind - b.o.c.kind || a.o.c.rank - b.o.c.rank);
  const fit = scored.filter((x) => x.wild <= maxWild && x.shape <= maxShape);
  let best = fit.length ? fit[0] : force ? scored[0] : null;
  if (!best) return null;
  // Phase D: shallow 1-ply preference when short-handed
  if (room && hand && hand.length <= 12 && seat >= 0 && scored.length > 1) {
    const pool = (fit.length ? fit : scored).slice(0, Math.min(6, scored.length));
    best = shallowPrefer(pool, room, seat, hand, trump) || best;
  }
  return best.o;
}

function assignRoles(r) {
  for (const team of ['red', 'blue']) {
    const seats = r.players
      .map((p, i) => ({ p, i, team: teamOf(i) }))
      .filter((x) => x.team === team)
      .map((x) => ({
        ...x,
        score: handStrength(x.p.hand, r.trump),
        elite: !!personaFor(x.p.name).elite,
      }))
      .sort((a, b) => {
        if (a.elite !== b.elite) return a.elite ? -1 : 1;
        return b.score - a.score;
      });
    seats.forEach((x, idx) => {
      x.p.role = idx === 0 ? 'main' : 'support';
    });
  }
}

function enemyShortest(r, myTeam) {
  let min = 99;
  r.players.forEach((p, i) => {
    if (teamOf(i) === myTeam || r.ranking.includes(p.id)) return;
    min = Math.min(min, p.hand.length);
  });
  return min;
}

function feedKindForCount(n) {
  if (n >= 11) return null;
  if (n === 10) return 5;
  if (n === 9 || n === 7 || n === 4 || n === 2) return 2;
  if (n === 8) return 3;
  if (n === 6 || n === 3 || n === 1) return 1;
  if (n === 5) return 5;
  return null;
}

function mainPartner(r, seat) {
  const myTeam = teamOf(seat);
  for (const off of [2, 4]) {
    const i = (seat + off) % 6;
    const p = r.players[i];
    if (teamOf(i) === myTeam && p.role === 'main' && !r.ranking.includes(p.id)) {
      return { seat: i, p, team: myTeam };
    }
  }
  return null;
}

function racingPartner(r, seat) {
  const myTeam = teamOf(seat);
  let best = null;
  r.players.forEach((p, i) => {
    if (i === seat || teamOf(i) !== myTeam || r.ranking.includes(p.id)) return;
    if (
      !best ||
      p.hand.length < best.p.hand.length ||
      (p.hand.length === best.p.hand.length && p.role === 'main' && best.p.role !== 'main')
    ) {
      best = { seat: i, p, team: myTeam };
    }
  });
  return best;
}

function isStrongFive(c, trump = '2', cards = null) {
  if (!c || c.kind < KIND.fullHouse) return false;
  if (c.kind >= KIND.straightFlush) return true;
  if (c.kind >= KIND.fourPlus) {
    return c.face === trump || faceNat(c.face) >= 8;
  }
  if (c.face === trump) {
    if (!cards?.length) return true;
    const side = fullHouseSideNat({ cards, c }, trump);
    // 222KK+ ok; 22255 is fighting-strong but not a "good strong five" to volunteer
    return side < 0 || side >= 9;
  }
  return faceNat(c.face) >= 9;
}

function hasStrongReturn(options, trump = '2') {
  return options.some(
    (o) =>
      (o.c.kind >= KIND.fourPlus && isStrongFive(o.c, trump, o.cards)) ||
      (o.c.kind === KIND.single && o.c.rank >= 90)
  );
}

/** Phase B: lengths teammates recently passed on. */
function teammatePassLens(r, seat) {
  const sense = r?.aiSense;
  if (!sense?.teammatePassByLen) return {};
  const team = teamOf(seat);
  return sense.teammatePassByLen[team] || {};
}

function selfIsStrong(r, p, seat) {
  const hs = handStrength(p.hand, r.trump);
  if (p.role === 'main' && hs >= 28) return true;
  if (personaFor(p.name).elite && hs >= 22) return true;
  return hs >= 36;
}

/** Phase C: soft bias toward catching more foes / match deficit. */
function teamScoreBiasFor(o, r, seat, p) {
  if (!r || !o?.cards) return 0;
  const myTeam = teamOf(seat);
  const other = myTeam === 'red' ? 'blue' : 'red';
  const scores = r.scores || { red: 0, blue: 0 };
  const deficit = (scores[other] || 0) - (scores[myTeam] || 0);
  const matchRound = r.matchRound || 1;
  const urgency = deficit >= 5 ? 1.4 : deficit >= 3 ? 1.15 : matchRound >= 5 && deficit > 0 ? 1.2 : 1;

  const leftAfter = p.hand.length - o.cards.length;
  const enemyMin = enemyShortest(r, myTeam);
  const race = racingPartner(r, seat);
  let bias = 0;

  if (leftAfter === 0) {
    // Finishing: higher value if we can still catch foes
    bias -= enemyMin <= 8 ? 28 * urgency : 14 * urgency;
  } else if (leftAfter <= 3 && enemyMin >= leftAfter + 2) {
    bias -= 10 * urgency;
  }

  if (!selfIsStrong(r, p, seat) && race && race.p.hand.length <= 8) {
    // Feed teammate lengths; prefer matching feed table
    const pref = feedKindForCount(race.p.hand.length);
    if (pref && o.cards.length === pref) bias -= 12;
    else if (pref && o.cards.length !== pref) bias += 6;
  }

  if (selfIsStrong(r, p, seat) && enemyMin <= 6 && leftAfter <= 10) {
    bias -= o.cards.length >= 3 ? 6 * urgency : 2;
  }

  // Late match, behind: prefer progressing over hoarding mid bombs
  if (urgency > 1 && o.c?.kind >= KIND.fourPlus && enemyMin > 8 && leftAfter > 8) {
    bias += 8;
  }
  return bias;
}

/** Phase D: key cards still out → soft press/hold. */
function cardSenseBiasFor(o, r, trump = '2') {
  const sense = r?.aiSense?.played;
  if (!sense || !o?.c) return 0;
  const totalBig = 6;
  const totalSmall = 6;
  const totalTrump = 12; // 3 decks × 4 suits
  const bigLeft = Math.max(0, totalBig - (sense.big || 0));
  const smallLeft = Math.max(0, totalSmall - (sense.small || 0));
  const trumpLeft = Math.max(0, totalTrump - (sense.trump || 0));
  let bias = 0;
  // If many big jokers still out, avoid leading weak mid pairs that invite smash
  if (o.c.kind === KIND.pair && (o.c.rank || 0) < 70 && bigLeft + smallLeft >= 4) {
    bias += 5;
  }
  // If few control cards left, slightly prefer pressing with natural high singles
  if (o.c.kind === KIND.single && o.c.rank >= 80 && bigLeft + trumpLeft <= 3) {
    bias -= 4;
  }
  // Don't pad with wild when many wilds already seen as spent poorly — already in key cost
  void trump;
  return bias;
}

/** Shallow prefer: among top scored moves, pick one that leaves fewer awkward piles. */
function shallowPrefer(scoredPool, room, seat, hand, trump) {
  if (!scoredPool?.length) return null;
  let best = scoredPool[0];
  let bestV = Infinity;
  for (const s of scoredPool) {
    const left = leftoverDifficulty(hand, s.o.cards, trump);
    const finish = hand.length === s.o.cards.length ? -40 : 0;
    const enemyMin = enemyShortest(room, teamOf(seat));
    const press = enemyMin <= 3 && s.o.cards.length !== enemyMin ? 8 : 0;
    const v = s.total * 0.85 + left + finish + press;
    if (v < bestV) {
      bestV = v;
      best = s;
    }
  }
  return best;
}

function pickCtx(r, p, persona) {
  const seat = r.players.indexOf(p);
  const passes = teammatePassLens(r, seat);
  const strong = selfIsStrong(r, p, seat);
  const lineAvoid = {};
  // Soft: if teammate passed a length and we are not racing strong, avoid reopening that length
  for (const [len, n] of Object.entries(passes)) {
    if (n > 0 && !strong) lineAvoid[Number(len)] = Math.min(3, n);
    else if (n > 0 && strong) lineAvoid[Number(len)] = 0.35;
  }
  return {
    hand: p.hand,
    persona,
    trump: r.trump || '2',
    room: r,
    seat,
    lineAvoid,
    teamBiasFn: (o) => teamScoreBiasFor(o, r, seat, p),
    cardSenseFn: (o) => cardSenseBiasFor(o, r, r.trump || '2'),
  };
}

function pickLead(options, r, p, seat, persona) {
  if (!options.length) return null;
  const personaX = persona || personaFor(p.name);
  const elite = !!personaX.elite;
  const ctx = pickCtx(r, p, personaX);
  const myTeam = teamOf(seat);
  const main = mainPartner(r, seat);
  const race = racingPartner(r, seat);
  const enemyMin = enemyShortest(r, myTeam);
  const strong = selfIsStrong(r, p, seat);
  const soft = {
    maxWild: elite ? 8 : 12,
    maxShape: elite ? 18 : 28,
    force: false,
    eliteScore: elite,
    enemyMin,
    ...ctx,
  };
  const hard = {
    maxWild: elite ? 12 : 18,
    maxShape: elite ? 28 : 45,
    force: true,
    eliteScore: elite,
    enemyMin,
    ...ctx,
  };
  const emergency = {
    maxWild: 999,
    maxShape: 999,
    force: true,
    eliteScore: elite,
    enemyMin,
    ...ctx,
  };

  const fives = options.filter((o) => o.cards.length === 5);
  const midFives = fives.filter((o) => o.c.kind <= KIND.flush && o.c.rank >= 55 && o.c.rank < 75);
  const strongFives = fives.filter((o) => isStrongFive(o.c, r.trump, o.cards));
  const pairs = options.filter((o) => o.c.kind === KIND.pair);
  const triples = options.filter((o) => o.c.kind === KIND.triple);
  const singles = options.filter((o) => o.c.kind === KIND.single);
  const smallSingles = singles.filter(
    (o) => o.c.rank < 60 && countWilds(o.cards) === 0 && shapeBreakCost(o, p.hand) < (elite ? 8 : 12)
  );
  const midPairs = pairs.filter((o) => o.c.rank < 70 && shapeBreakCost(o, p.hand) < (elite ? 12 : 20));
  const softTriples = triples.filter((o) => o.c.rank < 75 && shapeBreakCost(o, p.hand) < (elite ? 14 : 25));
  const nonBomb = options.filter((o) => o.c.kind < KIND.fourPlus);
  const suppressAt = elite ? 7 : 5;
  const mode = enemyMin <= 3 ? emergency : soft;

  if (enemyMin <= suppressAt) {
    if (enemyMin === 1) {
      return (
        pickFrom(strongFives, mode) ||
        pickFrom(fives, mode) ||
        pickFrom(pairs, mode) ||
        pickFrom(triples, mode) ||
        pickFrom(nonBomb, hard) ||
        pickFrom(options, hard)
      );
    }
    if (enemyMin === 2) {
      return (
        pickFrom(triples, mode) ||
        pickFrom(strongFives, mode) ||
        pickFrom(
          fives.filter((o) => o.c.kind >= KIND.flush && isStrongFive(o.c, r.trump, o.cards)),
          mode
        ) ||
        pickFrom(smallSingles, soft) ||
        pickFrom(nonBomb, hard) ||
        pickFrom(options, hard)
      );
    }
    if (enemyMin <= 3) {
      return (
        pickFrom(midFives, mode) ||
        pickFrom(pairs, mode) ||
        pickFrom(smallSingles, soft) ||
        pickFrom(nonBomb, hard) ||
        pickFrom(options, hard)
      );
    }
    return (
      pickFrom(midPairs, soft) ||
      pickFrom(smallSingles, soft) ||
      pickFrom(midFives, soft) ||
      pickFrom(nonBomb, hard) ||
      pickFrom(options, hard)
    );
  }

  const feedTarget =
    race && race.p.hand.length <= 10 ? race : main && main.p.hand.length <= 12 ? main : null;

  // Phase B: teammate passed pairs → prefer other lengths when feeding / weak
  const avoidPair = (ctx.lineAvoid && ctx.lineAvoid[2] > 0) || false;
  if (p.role === 'support' && feedTarget) {
    let pref = feedKindForCount(feedTarget.p.hand.length);
    if (avoidPair && pref === 2 && !strong) {
      pref = feedTarget.p.hand.length % 3 === 0 ? 3 : 1;
    }
    if (pref === 5) {
      const five =
        pickFrom(midFives, soft) ||
        pickFrom(
          fives.filter((o) => !isStrongFive(o.c, r.trump, o.cards) && o.c.rank >= 50 && comboEquityCost(o, r.trump) < 25),
          soft
        );
      if (five) return five;
    }
    if (pref === 3) {
      const t = pickFrom(softTriples, soft) || pickFrom(triples, soft);
      if (t) return t;
    }
    if (pref === 2 && !avoidPair) {
      const pr = pickFrom(midPairs, soft) || pickFrom(pairs, soft);
      if (pr) return pr;
    }
    if (pref === 1 || (avoidPair && pref === 2)) {
      const s =
        pickFrom(smallSingles, soft) ||
        pickFrom(
          singles.filter((o) => countWilds(o.cards) === 0),
          soft
        ) ||
        pickFrom(softTriples, soft);
      if (s) return s;
    }
    if (feedTarget.p.hand.length <= 12) {
      const s =
        pickFrom(smallSingles, soft) ||
        (!avoidPair ? pickFrom(midPairs, soft) : pickFrom(softTriples, soft));
      if (s) return s;
    }
  }

  // Strong self: race own finish line over feeding
  if (strong && p.hand.length <= 12) {
    const pref = feedKindForCount(p.hand.length);
    if (pref === 5) {
      const five = pickFrom(strongFives, soft) || pickFrom(midFives, soft);
      if (five) return five;
    }
    if (pref === 3) {
      const t = pickFrom(triples, soft);
      if (t) return t;
    }
    if (pref === 2) {
      const pr = pickFrom(pairs, soft);
      if (pr) return pr;
    }
    if (pref === 1) {
      const s =
        pickFrom(
          singles.filter((o) => countWilds(o.cards) === 0),
          soft
        ) || pickFrom(singles, soft);
      if (s) return s;
    }
  }

  if (p.hand.length >= 18) {
    const canProbeFive =
      !elite &&
      p.role === 'main' &&
      midFives.length &&
      (hasStrongReturn(options, r.trump) || strongFives.length);
    if (canProbeFive) {
      const five = pickFrom(midFives, soft);
      if (five) return five;
    }
    const pr = !avoidPair ? pickFrom(midPairs, soft) : null;
    if (pr) return pr;
    const s = pickFrom(smallSingles, soft);
    if (s) return s;
    const t = pickFrom(softTriples, soft);
    if (t) return t;
  }

  if ((p.role === 'main' || elite) && p.hand.length <= 10) {
    const pref = feedKindForCount(p.hand.length);
    if (pref === 5) {
      const five = pickFrom(strongFives, soft) || pickFrom(midFives, soft);
      if (five) return five;
    }
    if (pref === 3) {
      const t = pickFrom(triples, soft);
      if (t) return t;
    }
    if (pref === 2) {
      const pr = pickFrom(pairs, soft);
      if (pr) return pr;
    }
    if (pref === 1) {
      const s =
        pickFrom(
          singles.filter((o) => countWilds(o.cards) === 0),
          soft
        ) || pickFrom(singles, soft);
      if (s) return s;
    }
  }

  const safe = nonBomb.filter(
    (o) =>
      o.cards.length !== 5 ||
      isStrongFive(o.c, r.trump, o.cards) ||
      (!elite && p.role === 'main' && o.c.kind <= KIND.flush && o.c.rank >= 55 && o.c.rank < 70)
  );
  return pickFrom(safe.length ? safe : nonBomb.length ? nonBomb : options, hard);
}

function pickBeat(options, r, p, seat, tableOwnerTeam, persona, allowEatTeammate = false) {
  if (!options.length) return null;
  const personaX = persona || personaFor(p.name);
  const elite = !!personaX.elite;
  const ctx = pickCtx(r, p, personaX);
  const myTeam = teamOf(seat);
  const isEnemy = tableOwnerTeam !== myTeam;
  const owner = r.players.find((x) => x.id === r.table.player);
  const ownerCount = owner?.hand.length ?? 99;
  const tableLen = r.table?.cards?.length || 0;
  const tableRank = r.table?.combo?.rank ?? 0;
  const enemyMin = enemyShortest(r, myTeam);
  const nonBomb = options.filter((o) => o.c.kind < KIND.fourPlus);
  const beatOpts = { ...ctx, preferMinimalBeat: true, tableRank, eliteScore: elite, enemyMin };

  if (!isEnemy) {
    if (owner && personaFor(owner.name).elite) return null;
    if (ownerCount <= 3) return null;
    const main = mainPartner(r, seat);
    const race = racingPartner(r, seat);
    const partner = race && race.p.hand.length <= 10 ? race : main;
    const takeToStop = enemyMin <= 3 && ownerCount <= 2;
    const takeForFeed =
      p.role === 'support' &&
      partner &&
      partner.p.hand.length <= 8 &&
      ownerCount > 5 &&
      tableLen === 1 &&
      tableRank < 55;
    if (allowEatTeammate && !takeForFeed && !takeToStop) {
      return pickFrom(nonBomb, { maxWild: 25, maxShape: 50, force: true, ...beatOpts });
    }
    if (!takeForFeed && !takeToStop) return null;
    return pickFrom(nonBomb, { maxWild: 8, maxShape: 20, force: true, ...beatOpts });
  }

  if (enemyMin <= 3 || ownerCount <= 3) {
    return pickFrom(options, { maxWild: 999, maxShape: 999, force: true, ...beatOpts });
  }
  if (elite) {
    const press =
      pickFrom(nonBomb, { maxWild: 16, maxShape: 28, force: false, ...beatOpts }) ||
      pickFrom(nonBomb, { maxWild: 24, maxShape: 36, force: false, ...beatOpts });
    if (press) return press;
    if (ownerCount <= 12 || enemyMin <= 7) {
      return pickFrom(options, { maxWild: 36, maxShape: 50, force: false, ...beatOpts });
    }
    return null;
  }
  const pool = ownerCount > 8 && p.role === 'main' ? nonBomb : nonBomb.length ? nonBomb : options;
  return pickFrom(pool, { maxWild: 18, maxShape: 32, force: false, ...beatOpts });
}

function sillyPick(options, hand) {
  if (!options.length) return null;
  const ranked = [...options].sort((a, b) => moveCost(b, hand) - moveCost(a, hand));
  const pool = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.35)));
  return pool[Math.floor(Math.random() * pool.length)];
}

function botMove(r, p) {
  if (!r.started || !p?.hand) return;
  const seat = r.players.indexOf(p);
  if (seat < 0 || r.players[r.turn]?.id !== p.id) return;
  const persona = effectivePersona(r, p);
  const tableCombo = r.table?.combo || null;
  let options = [];
  try {
    options = candidates(p.hand, r.trump, tableCombo);
  } catch {
    options = [];
  }

  const mistake = !persona.elite && roll(persona.mistakeRate);

  if (!tableCombo) {
    if (!options.length) {
      if (!p.hand.length) {
        next(r);
        return;
      }
      const sorted = sort([...p.hand], r.trump);
      play(r, p, [sorted[sorted.length - 1].id]);
      return;
    }
    let lead = pickLead(options, r, p, seat, persona) || options[0];
    if (mistake) lead = sillyPick(options, p.hand) || lead;
    play(r, p, lead.cards.map((c) => c.id));
    return;
  }

  const ownerIdx = r.players.findIndex((x) => x.id === r.table.player);
  const ownerTeam = teamOf(ownerIdx);
  const owner = r.players[ownerIdx];
  const ownerElite = owner ? !!personaFor(owner.name).elite : false;
  const eat =
    !persona.elite &&
    !ownerElite &&
    ownerTeam === teamOf(seat) &&
    roll(persona.eatTeammateRate);
  let choice = pickBeat(options, r, p, seat, ownerTeam, persona, eat);
  if (mistake && options.length) {
    if (choice) choice = sillyPick(options, p.hand) || choice;
    else if (ownerTeam !== teamOf(seat) || eat) choice = sillyPick(options, p.hand);
  }
  if (choice) play(r, p, choice.cards.map((c) => c.id));
  else pass(r, p);
}

module.exports = {
  PERSONAS,
  personaFor,
  intelFor,
  handStrength,
  candidates,
  countWilds,
  wildSpendCost,
  shapeBreakCost,
  comboEquityCost,
  keyCardOpportunityCost,
  leftoverDifficulty,
  leftoverDelta,
  moveCost,
  pickFrom,
  assignRoles,
  feedKindForCount,
  enemyShortest,
  isStrongFive,
  fullHouseSideNat,
  teammatePassLens,
  selfIsStrong,
  teamScoreBiasFor,
  cardSenseBiasFor,
  pickLead,
  pickBeat,
  botMove,
};
