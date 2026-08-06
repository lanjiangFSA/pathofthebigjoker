'use strict';
const crypto = require('crypto');

const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小怪', '大怪'];
const gradeRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const suits = ['♠', '♥', '♣', '♦'];
const botNames = ['小虎机', '阿福', '路子王', '小囡', '老克勒'];
const FACE = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const STRAIGHT_WINDOWS = [
  ['A', '2', '3', '4', '5'],
  ['2', '3', '4', '5', '6'],
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],
];

const KIND = {
  single: 1,
  pair: 2,
  triple: 3,
  mixedStraight: 5,
  flush: 10,
  fullHouse: 20,
  fourPlus: 30,
  straightFlush: 40,
  fiveKind: 50,
};

const uid = () => crypto.randomBytes(7).toString('hex');
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const teamOf = (i) => (i % 2 ? 'blue' : 'red');
const isWild = (c) => c.s === '★';

function deck() {
  const a = [];
  for (let n = 0; n < 3; n++) {
    for (const s of suits) for (const r of ranks.slice(0, 13)) a.push({ id: uid(), r, s });
    a.push({ id: uid(), r: '小怪', s: '★' });
    a.push({ id: uid(), r: '大怪', s: '★' });
  }
  return a.sort(() => Math.random() - 0.5);
}

/** 大怪 > 小怪 > 将牌 > A > … > 2 */
function cardPower(r, trump) {
  if (r === '大怪') return 100;
  if (r === '小怪') return 90;
  if (r === trump) return 80;
  return FACE.indexOf(r);
}

function naturalPower(r) {
  return FACE.indexOf(r);
}

function sort(hand, trump) {
  return hand.sort(
    (a, b) => cardPower(b.r, trump) - cardPower(a.r, trump) || a.s.localeCompare(b.s)
  );
}

function findStraightWindow(normalFaces, wildCount) {
  let best = null;
  for (const win of STRAIGHT_WINDOWS) {
    const missing = win.filter((f) => !normalFaces.has(f));
    const outside = [...normalFaces].some((f) => !win.includes(f));
    if (outside) continue;
    if (missing.length > wildCount) continue;
    const high = win[win.length - 1];
    const highNat = naturalPower(high);
    if (!best || highNat < best.highNat) best = { win, high, highNat };
  }
  return best;
}

function flushKickers(cards, trump) {
  const powers = cards
    .filter((c) => !isWild(c))
    .map((c) => cardPower(c.r, trump))
    .sort((a, b) => b - a);
  while (powers.length < 5) powers.push(-1);
  return powers;
}

function compareKickers(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

function groupSame(cards, trump) {
  const normals = cards.filter((c) => !isWild(c));
  const wilds = cards.filter((c) => isWild(c));
  if (!normals.length) {
    const face = wilds.some((c) => c.r === '大怪') ? '大怪' : '小怪';
    return { face, rank: cardPower(face, trump) };
  }
  if (new Set(normals.map((c) => c.r)).size > 1) return null;
  const face = normals[0].r;
  return { face, rank: cardPower(face, trump) };
}

function tryFiveKind(cards, trump) {
  const g = groupSame(cards, trump);
  if (!g) return null;
  const normals = cards.filter((c) => !isWild(c));
  if (normals.length && new Set(normals.map((c) => c.r)).size > 1) return null;
  return { kind: KIND.fiveKind, rank: g.rank, label: '五同', kickers: [], face: g.face };
}

function tryFourPlus(cards, trump) {
  const normals = cards.filter((c) => !isWild(c));
  const wildCount = cards.length - normals.length;
  const counts = {};
  normals.forEach((c) => {
    counts[c.r] = (counts[c.r] || 0) + 1;
  });
  const faces = Object.keys(counts);
  for (const face of faces) {
    const cnt = counts[face];
    const need = Math.max(0, 4 - cnt);
    if (need > wildCount) continue;
    const remainWild = wildCount - need;
    const other = normals.length - cnt;
    if (other + remainWild === 1) {
      return { kind: KIND.fourPlus, rank: cardPower(face, trump), label: '四带一', kickers: [], face };
    }
  }
  // Four+ wilds with one kicker face already covered; pure wilds are 五同.
  return null;
}

function tryFullHouse(cards, trump) {
  const normals = cards.filter((c) => !isWild(c));
  const wildCount = cards.length - normals.length;
  const counts = {};
  normals.forEach((c) => {
    counts[c.r] = (counts[c.r] || 0) + 1;
  });
  const entries = Object.entries(counts);
  if (entries.length > 2) return null;
  if (entries.length === 0) return null;

  let best = null;
  if (entries.length === 1) {
    const [face, cnt] = entries[0];
    // Need exactly 3+2 using wilds, not 4+1 or 5 (those are stronger and tried first)
    if (cnt <= 3 && cnt + wildCount === 5 && wildCount >= 2 && cnt + Math.min(wildCount, 3 - Math.min(cnt, 3)) >= 3) {
      const asThree = Math.min(3, cnt + wildCount);
      const rest = 5 - asThree;
      if (asThree === 3 && rest === 2) {
        best = { kind: KIND.fullHouse, rank: cardPower(face, trump), label: '三带两', kickers: [], face };
      }
    }
    return best;
  }

  const [[f0, c0], [f1, c1]] = entries;
  // Try each face as the three
  for (const [face3, c3] of entries) {
    const face2 = face3 === f0 ? f1 : f0;
    const c2 = face3 === f0 ? c1 : c0;
    const need3 = Math.max(0, 3 - c3);
    const need2 = Math.max(0, 2 - c2);
    if (need3 + need2 <= wildCount && c3 + c2 + wildCount === 5) {
      const cand = { kind: KIND.fullHouse, rank: cardPower(face3, trump), label: '三带两', kickers: [], face: face3 };
      if (!best || cand.rank > best.rank) best = cand;
    }
  }
  return best;
}

function tryStraightFlush(cards, trump) {
  const normals = cards.filter((c) => !isWild(c));
  const wildCount = cards.length - normals.length;
  if (new Set(normals.map((c) => c.r)).size !== normals.length) return null;
  const suitsN = new Set(normals.map((c) => c.s));
  if (suitsN.size > 1) return null;
  const st = findStraightWindow(new Set(normals.map((c) => c.r)), wildCount);
  if (!st) return null;
  return { kind: KIND.straightFlush, rank: st.highNat, label: '同花顺', kickers: [], high: st.high };
}

function tryFlush(cards, trump) {
  const normals = cards.filter((c) => !isWild(c));
  const wildCount = cards.length - normals.length;
  const suitsN = new Set(normals.map((c) => c.s));
  if (suitsN.size > 1) return null;
  if (new Set(normals.map((c) => c.r)).size === normals.length) {
    const st = findStraightWindow(new Set(normals.map((c) => c.r)), wildCount);
    if (st) return null; // that is 同花顺
  }
  const kickers = flushKickers(cards, trump);
  return { kind: KIND.flush, rank: kickers[0], label: '同花', kickers };
}

function tryMixedStraight(cards, trump) {
  const normals = cards.filter((c) => !isWild(c));
  const wildCount = cards.length - normals.length;
  if (new Set(normals.map((c) => c.r)).size !== normals.length) return null;
  const suitsN = new Set(normals.map((c) => c.s));
  if (suitsN.size <= 1) return null; // flush / SF handled elsewhere
  const st = findStraightWindow(new Set(normals.map((c) => c.r)), wildCount);
  if (!st) return null;
  return { kind: KIND.mixedStraight, rank: st.highNat, label: '杂顺', kickers: [], high: st.high };
}

/** Prefer strongest 5-card reading (howtoplay: 333+大王+4 → 四带一). */
function combo(cards, trump) {
  const n = cards.length;
  if (![1, 2, 3, 5].includes(n)) return null;

  if (n === 1) {
    return { kind: KIND.single, rank: cardPower(cards[0].r, trump), label: '单张', kickers: [] };
  }

  if (n < 5) {
    const g = groupSame(cards, trump);
    if (!g) return null;
    return {
      kind: n === 2 ? KIND.pair : KIND.triple,
      rank: g.rank,
      label: n === 2 ? '对子' : '三张',
      kickers: [],
      face: g.face,
    };
  }

  return (
    tryFiveKind(cards, trump) ||
    tryStraightFlush(cards, trump) ||
    tryFourPlus(cards, trump) ||
    tryFullHouse(cards, trump) ||
    tryFlush(cards, trump) ||
    tryMixedStraight(cards, trump)
  );
}

function beats(challenger, table) {
  if (!table) return true;
  if (challenger.kind <= 3 || table.kind <= 3) {
    return challenger.kind === table.kind && challenger.rank > table.rank;
  }
  if (challenger.kind !== table.kind) return challenger.kind > table.kind;
  if (challenger.rank !== table.rank) return challenger.rank > table.rank;
  if (challenger.kickers && table.kickers) return compareKickers(challenger.kickers, table.kickers) > 0;
  return false;
}

function newRoom(opts = {}) {
  const trumpRules = !!opts.trumpRules;
  return {
    code: code(),
    players: [],
    host: null,
    started: false,
    trumpRules,
    trump: '2',
    levels: { red: '2', blue: '2' },
    banker: 'red',
    bankerSeat: 0,
    leadSeat: 0,
    turn: 0,
    table: null,
    passes: 0,
    ranking: [],
    result: null,
    message: trumpRules ? '等待牌友入座（将牌升级已开）' : '等待牌友入座（将牌固定为 2）',
    round: 0,
  };
}

function addPlayer(r, name, bot = false) {
  if (r.players.length >= 6) throw Error('牌桌已满（6 人）');
  const p = { id: uid(), name: (name || '牌友').trim().slice(0, 12), hand: [], bot, role: 'support' };
  r.players.push(p);
  if (!r.host && !bot) r.host = p.id;
  r.message = `${p.name}${bot ? '（AI）' : ''} 入座（${r.players.length}/6）`;
  return p;
}

function addBots(r) {
  let n = 0;
  while (r.players.length < 6) {
    let name = botNames[n++ % botNames.length];
    while (r.players.some((p) => p.name === name)) name += Math.ceil(Math.random() * 9);
    addPlayer(r, name, true);
  }
}

function subsetsOfSize(arr, size, limit = 800) {
  const out = [];
  const go = (start, path) => {
    if (out.length >= limit) return;
    if (path.length === size) {
      out.push(path.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      go(i + 1, path);
      path.pop();
      if (out.length >= limit) return;
    }
  };
  go(0, []);
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
          for (const pair of subsetsOfSize(list, n, 50))
            for (const ws of subsetsOfSize(wilds, w, 20)) out.push([...pair, ...ws]);
        }
        if (n + w === 3) {
          for (const trip of subsetsOfSize(list, n, 40))
            for (const ws of subsetsOfSize(wilds, w, 15)) out.push([...trip, ...ws]);
        }
      }
    }
  }
  if (wilds.length >= 2) for (const ws of subsetsOfSize(wilds, 2, 20)) out.push(ws);
  if (wilds.length >= 3) for (const ws of subsetsOfSize(wilds, 3, 20)) out.push(ws);

  const needFives = !table || table.kind >= KIND.mixedStraight;
  if (needFives) for (const five of subsetsOfSize(hand, 5, 1500)) out.push(five);

  const seen = new Set();
  const result = [];
  for (const cards of out) {
    const key = cards
      .map((c) => c.id)
      .sort()
      .join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const c = combo(cards, trump);
    if (c && beats(c, table)) result.push({ cards, c });
  }
  return result.sort((a, b) => a.c.kind - b.c.kind || a.c.rank - b.c.rank);
}

function handStrength(hand, trump) {
  let score = 0;
  score += hand.filter(isWild).length * 8;
  score += hand.filter((c) => c.r === trump).length * 5;
  score += hand.filter((c) => c.r === 'A' || c.r === 'K').length * 2;
  const fives = candidates(hand, trump, null).filter((x) => x.c.kind >= KIND.mixedStraight);
  score += Math.min(6, fives.length) * 3;
  score += fives.filter((x) => x.c.kind >= KIND.fullHouse).length * 4;
  return score;
}

function assignRoles(r) {
  for (const team of ['red', 'blue']) {
    const seats = r.players
      .map((p, i) => ({ p, i, team: teamOf(i) }))
      .filter((x) => x.team === team)
      .map((x) => ({ ...x, score: handStrength(x.p.hand, r.trump) }))
      .sort((a, b) => b.score - a.score);
    seats.forEach((x, idx) => {
      x.p.role = idx === 0 ? 'main' : 'support';
    });
  }
}

function activeCount(r) {
  return r.players.filter((p) => !r.ranking.includes(p.id)).length;
}

function next(r) {
  for (let n = 1; n <= 6; n++) {
    const i = (r.turn + n) % 6;
    if (!r.ranking.includes(r.players[i].id)) {
      r.turn = i;
      return;
    }
  }
}

function pointsToSteps(points) {
  if (points >= 8) return 3;
  if (points >= 5) return 2;
  if (points >= 3) return 1;
  if (points >= 1) return 1;
  return 0;
}

/**
 * howtoplay 胜负 1–8 + 计分.
 * places: 1-based finish positions per team.
 */
function settle(r) {
  while (r.ranking.length < 6) {
    const left = r.players.filter((p) => !r.ranking.includes(p.id));
    if (!left.length) break;
    r.ranking.push(left[0].id);
  }

  const order = r.ranking.map((id) => {
    const seat = r.players.findIndex((p) => p.id === id);
    return { id, seat, team: teamOf(seat) };
  });
  const places = { red: [], blue: [] };
  order.forEach((o, idx) => places[o.team].push(idx + 1));

  const banker = r.banker;
  const other = banker === 'red' ? 'blue' : 'red';
  const b = places[banker];
  const o = places[other];
  const has = (arr, n) => arr.includes(n);
  const top3 = (arr) => arr.filter((p) => p <= 3).length === 3;

  let winning = order[0].team;
  let points = 0;
  let switchBanker = false;
  let tributers = [];

  const teamIdsAt = (team, ...ns) =>
    order.filter((x, i) => x.team === team && ns.includes(i + 1)).map((x) => x.id);

  if (top3(b)) {
    // 1
    winning = banker;
    points = 8;
    switchBanker = false;
    tributers = teamIdsAt(other, 4, 5, 6);
  } else if (top3(o)) {
    // 8
    winning = other;
    points = 8;
    switchBanker = true;
    tributers = teamIdsAt(banker, 4, 5, 6);
  } else if (has(b, 1) && has(o, 5) && has(o, 6)) {
    // 2
    winning = banker;
    points = 5;
    switchBanker = false;
    tributers = teamIdsAt(other, 5, 6);
  } else if (has(b, 1) && has(o, 6) && !has(o, 5) && !has(b, 6)) {
    // 3
    winning = banker;
    points = 3;
    switchBanker = false;
    tributers = teamIdsAt(other, 6);
  } else if (has(b, 1) && has(b, 6)) {
    // 4 — 续庄不升级
    winning = banker;
    points = 0;
    // 头家+(二三四)+尾家 → 1 分
    if (b.some((p) => p >= 2 && p <= 4)) points = 1;
    switchBanker = false;
    tributers = [];
  } else if (has(o, 1) && has(o, 6)) {
    // 5
    winning = other;
    points = 0;
    if (o.some((p) => p >= 2 && p <= 4)) points = 1;
    switchBanker = true;
    tributers = [];
  } else if (has(o, 1) && has(b, 6) && !has(b, 5)) {
    // 6
    winning = other;
    points = 0;
    switchBanker = true;
    tributers = teamIdsAt(banker, 6);
  } else if (has(o, 1) && has(b, 5) && has(b, 6)) {
    // 7
    winning = other;
    points = 0;
    switchBanker = true;
    tributers = teamIdsAt(banker, 5, 6);
  } else {
    // Fallback by catch count
    winning = order[0].team;
    const caught = 3 - places[winning === 'red' ? 'blue' : 'red'].filter((p) => p < Math.max(...places[winning])).length;
    const catchPts = { 3: 8, 2: 5, 1: 3, 0: 0 }[caught] ?? 0;
    points = catchPts;
    switchBanker = winning !== banker;
    if (winning === banker && has(b, 6)) {
      points = b.some((p) => p >= 2 && p <= 4) ? 1 : 0;
    }
    if (lastTeamTribute(order, winning)) {
      tributers = teamIdsAt(winning === 'red' ? 'blue' : 'red', 5, 6).slice(-caught || 1);
    }
  }

  const steps = r.trumpRules ? pointsToSteps(points) : 0;
  if (r.trumpRules) {
    const before = gradeRanks.indexOf(r.levels[winning]);
    r.levels[winning] = gradeRanks[Math.min(gradeRanks.length - 1, before + steps)];
  }

  const oldBankerSeat = r.bankerSeat;
  if (switchBanker) {
    r.bankerSeat = (oldBankerSeat + 1) % 6;
    r.banker = teamOf(r.bankerSeat);
  } else {
    r.banker = banker;
    if (teamOf(r.bankerSeat) !== r.banker) {
      r.bankerSeat = r.players.findIndex((_, i) => teamOf(i) === r.banker);
    }
  }

  r.trump = r.trumpRules ? r.levels[r.banker] : '2';
  r.leadSeat = order[0].seat;
  r.started = false;
  r.result = { winning, points, gain: steps, places, tributers, switchBanker };
  r.message = r.trumpRules
    ? `${winning === 'red' ? '红队' : '蓝队'} ${points} 分 / 升 ${steps} 级${switchBanker ? '，换庄' : '，续庄'}；将牌 ${r.trump}`
    : `${winning === 'red' ? '红队' : '蓝队'}获胜${switchBanker ? '，换庄' : '，续庄'}；将牌固定 2`;

  if (tributers.length) applyAutoTribute(r, tributers, winning);
}

function lastTeamTribute(order, winning) {
  return order[5]?.team !== winning;
}

function applyAutoTribute(r, tributers, winningTeam) {
  const winners = r.players
    .map((p, i) => ({ p, i, team: teamOf(i) }))
    .filter((x) => x.team === winningTeam)
    .sort((a, b) => r.ranking.indexOf(a.p.id) - r.ranking.indexOf(b.p.id));
  const notes = [];
  tributers.forEach((tid, idx) => {
    const from = r.players.find((p) => p.id === tid);
    const to = winners[idx % winners.length]?.p;
    if (!from?.hand?.length || !to) return;
    // Hands are empty after full round — tribute is between rounds using leftover cards.
    // After settle all may have cards only if game ended early; typically losers still hold cards.
    sort(from.hand, r.trump);
    if (!from.hand.length) return;
    const up = from.hand[0];
    from.hand = from.hand.slice(1);
    sort(to.hand, r.trump);
    if (!to.hand.length) {
      to.hand.push(up);
      notes.push(`${from.name}进贡${up.r}${up.s}→${to.name}`);
      return;
    }
    const back = to.hand[to.hand.length - 1];
    to.hand = to.hand.filter((c) => c.id !== back.id);
    to.hand.push(up);
    from.hand.push(back);
    sort(to.hand, r.trump);
    sort(from.hand, r.trump);
    notes.push(`${from.name}进贡${up.r}${up.s}→${to.name}，还${back.r}${back.s}`);
  });
  if (notes.length) r.message += '。' + notes.join('；');
}

function start(r) {
  if (r.started) throw Error('牌局已经开始');
  addBots(r);
  r.round++;
  if (r.round === 1) {
    r.bankerSeat = Math.floor(Math.random() * 6);
    r.banker = teamOf(r.bankerSeat);
    r.trump = r.trumpRules ? r.levels[r.banker] : '2';
    r.leadSeat = r.bankerSeat;
  } else if (!r.trumpRules) {
    r.trump = '2';
  }
  const d = deck();
  r.players.forEach((p, i) => {
    p.hand = sort(d.slice(i * 27, i * 27 + 27), r.trump);
  });
  assignRoles(r);
  r.started = true;
  r.turn = r.leadSeat;
  r.table = null;
  r.passes = 0;
  r.ranking = [];
  r.result = null;
  r.message = `${r.players[r.turn].name} 先出（庄：${r.players[r.bankerSeat].name}）；将牌：${r.trump}`;
}

function play(r, p, ids) {
  if (!r.started) throw Error('牌局尚未开始');
  if (r.players[r.turn].id !== p.id) throw Error('还没轮到你');
  const cards = ids.map((id) => p.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) throw Error('选牌已失效');
  const c = combo(cards, r.trump);
  if (!c) throw Error('只可出合法单张、对子、三张或五路');
  if (!beats(c, r.table?.combo)) throw Error('这手牌压不住桌面');
  p.hand = p.hand.filter((card) => !ids.includes(card.id));
  r.table = { player: p.id, cards, combo: c };
  r.passes = 0;
  r.message = `${p.name}${p.bot ? '（AI）' : ''} 出了 ${c.label}`;
  if (!p.hand.length) {
    r.ranking.push(p.id);
    r.message = `${p.name} 已出完牌！（第 ${r.ranking.length} 名）`;
    if (r.ranking.length >= 5) {
      settle(r);
      return;
    }
  }
  next(r);
}

function pass(r, p) {
  if (!r.started || r.players[r.turn].id !== p.id) throw Error('还没轮到你');
  if (!r.table) throw Error('首出不能过');
  r.passes++;
  r.message = `${p.name}${p.bot ? '（AI）' : ''} 不出`;
  if (r.passes >= activeCount(r) - 1) {
    const lead = r.table.player;
    r.table = null;
    r.passes = 0;
    r.turn = r.players.findIndex((x) => x.id === lead);
    if (r.ranking.includes(lead)) next(r);
    r.message = `无人再压，${r.players[r.turn].name} 获得出牌权`;
  } else next(r);
}

function enemyShortest(r, myTeam) {
  let min = 99;
  r.players.forEach((p, i) => {
    if (teamOf(i) === myTeam || r.ranking.includes(p.id)) return;
    min = Math.min(min, p.hand.length);
  });
  return min;
}

function nextActive(r, seat) {
  for (let n = 1; n <= 5; n++) {
    const i = (seat + n) % 6;
    if (!r.ranking.includes(r.players[i].id)) return { seat: i, p: r.players[i], team: teamOf(i) };
  }
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

function pickLead(options, r, p, seat) {
  const myTeam = teamOf(seat);
  const main = mainPartner(r, seat);
  const enemyMin = enemyShortest(r, myTeam);
  const midFives = options.filter(
    (o) => o.c.kind >= KIND.mixedStraight && o.c.kind <= KIND.flush && o.c.rank < 70
  );
  const midPairs = options.filter((o) => o.c.kind === KIND.pair && o.c.rank < 70);
  const smallSingles = options.filter((o) => o.c.kind === KIND.single && o.c.rank < 60);

  if (enemyMin <= 5) {
    if (enemyMin === 1) {
      const five = options.find((o) => o.c.kind >= KIND.mixedStraight);
      if (five) return five;
      const pair = options.find((o) => o.c.kind === KIND.pair);
      if (pair) return pair;
    }
    if (enemyMin <= 3) {
      const five = midFives[0];
      if (five) return five;
      if (smallSingles[0] && enemyMin !== 1) return smallSingles[0];
    }
  }

  // Opening probe: medium-small five or pair
  if (p.hand.length >= 18) {
    if (midFives.length) return midFives[0];
    if (midPairs.length) return midPairs[0];
  }

  // Support feeds main partner with small singles/pairs
  if (p.role === 'support' && main && main.p.hand.length <= 12) {
    if (smallSingles.length) return smallSingles[0];
    if (midPairs.length) return midPairs[0];
  }

  const nonBomb = options.filter((o) => o.c.kind < KIND.fourPlus);
  return (nonBomb.length ? nonBomb : options)[0];
}

function pickBeat(options, r, p, seat, tableOwnerTeam) {
  const myTeam = teamOf(seat);
  const isEnemy = tableOwnerTeam !== myTeam;
  const owner = r.players.find((x) => x.id === r.table.player);
  const ownerCount = owner?.hand.length ?? 99;

  if (!isEnemy) {
    // 绝不压队友，除非接过来给主攻送牌或阻止敌方残局
    const main = mainPartner(r, seat);
    const enemyMin = enemyShortest(r, myTeam);
    const takeForFeed =
      p.role === 'support' && main && main.p.hand.length <= 8 && ownerCount > 5;
    const takeToStop = enemyMin <= 3 && ownerCount <= 2;
    if (!takeForFeed && !takeToStop) return null;
    return options[0];
  }

  // 压制敌方：能压则压；主攻留炸，辅助可挡枪
  let pool = options;
  if (ownerCount > 8 && p.role === 'main') {
    pool = options.filter((o) => o.c.kind < KIND.fourPlus);
    if (!pool.length) pool = options;
  }
  return pool[0];
}

function botMove(r, p) {
  const seat = r.players.indexOf(p);
  const tableCombo = r.table?.combo || null;
  const options = candidates(p.hand, r.trump, tableCombo);
  if (!tableCombo) {
    if (!options.length) return;
    play(r, p, pickLead(options, r, p, seat).cards.map((c) => c.id));
    return;
  }
  const ownerIdx = r.players.findIndex((x) => x.id === r.table.player);
  const choice = pickBeat(options, r, p, seat, teamOf(ownerIdx));
  if (choice) play(r, p, choice.cards.map((c) => c.id));
  else pass(r, p);
}

function state(r, id) {
  return {
    type: 'state',
    code: r.code,
    started: r.started,
    host: r.host,
    trumpRules: !!r.trumpRules,
    trump: r.trump,
    levels: r.levels,
    banker: r.banker,
    bankerSeat: r.bankerSeat,
    turn: r.turn,
    passes: r.passes,
    ranking: r.ranking,
    result: r.result,
    message: r.message,
    table: r.table && {
      player: r.table.player,
      combo: { kind: r.table.combo.kind, rank: r.table.combo.rank, label: r.table.combo.label },
      cards: r.table.cards.map((c) => ({ r: c.r, s: c.s })),
    },
    players: r.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      seat: i,
      team: teamOf(i),
      count: p.hand.length,
      bot: p.bot,
      done: r.ranking.includes(p.id),
      role: p.role,
    })),
    hand: r.players.find((p) => p.id === id)?.hand || [],
  };
}

module.exports = {
  ranks,
  gradeRanks,
  suits,
  KIND,
  uid,
  teamOf,
  deck,
  cardPower,
  sort,
  combo,
  beats,
  newRoom,
  addPlayer,
  addBots,
  start,
  play,
  pass,
  settle,
  candidates,
  botMove,
  state,
  handStrength,
  assignRoles,
  findStraightWindow,
  pointsToSteps,
};
