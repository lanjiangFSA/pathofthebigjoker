'use strict';
const crypto = require('crypto');

const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小怪', '大怪'];
const gradeRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const suits = ['♠', '♥', '♣', '♦'];
/** Shanghai-casual nicknames for AI seats (≤12 chars; shuffled per fill). */
const botNames = [
  '小虎机',
  '阿福',
  '路子王',
  '小囡',
  '老克勒',
  '册那队长',
  '阿庆',
  '阿祥',
  '阿根',
  '阿德',
  '小滑头',
  '十三点',
  '老模子',
  '白相人',
  '小开',
  '弄堂精',
  '洋泾浜',
  '老虎灶',
  '小赤佬',
  '螺丝壳',
  '黄鱼头',
  '石库门',
  '亭子间',
  '外滩仔',
  '大世界',
];

function shuffleNames(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
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
    scores: { red: 0, blue: 0 },
    banker: 'red',
    bankerSeat: 0,
    leadSeat: 0,
    turn: 0,
    table: null,
    passes: 0,
    trickLog: [],
    ranking: [],
    result: null,
    message: trumpRules ? '等待牌友入座（将牌升级已开）' : '等待牌友入座（将牌固定为 2）',
    round: 0,
    turnDeadline: null,
    firstLeadDone: false,
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
  const pool = shuffleNames(botNames);
  let n = 0;
  while (r.players.length < 6) {
    let name = pool[n++ % pool.length];
    while (r.players.some((p) => p.name === name)) name = `${name}${Math.ceil(Math.random() * 9)}`;
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
  return score;
}

function buildFiveCandidates(hand, wilds, by) {
  const out = [];
  const faces = Object.keys(by);
  // 五同 / 四带一 / 三带两 from counts + wilds
  for (const f of faces) {
    const list = by[f];
    for (let w = 0; w <= Math.min(wilds.length, 5); w++) {
      if (list.length + w >= 5 && list.length >= 1) {
        for (const body of subsetsOfSize(list, Math.min(list.length, 5 - w), 8)) {
          for (const ws of subsetsOfSize(wilds, w, 6)) {
            if (body.length + ws.length === 5) out.push([...body, ...ws]);
          }
        }
      }
    }
    // 四带一: 4 of f + 1 kicker
    for (let w = 0; w <= Math.min(wilds.length, 3); w++) {
      const need = Math.max(0, 4 - list.length);
      if (need > w) continue;
      const take = Math.min(list.length, 4);
      for (const body of subsetsOfSize(list, take, 6)) {
        for (const ws of subsetsOfSize(wilds, w, 4)) {
          const used = body.length + ws.length;
          if (used > 5) continue;
          const remain = 5 - used;
          if (remain === 1) {
            const kickers = hand.filter((c) => c.id !== body[0]?.id && !body.includes(c) && !ws.includes(c));
            for (const k of kickers.slice(0, 12)) out.push([...body, ...ws, k]);
          } else if (remain === 0 && body.length + ws.length === 5) {
            out.push([...body, ...ws]);
          }
        }
      }
    }
  }
  // 三带两
  for (let i = 0; i < faces.length; i++) {
    for (let j = 0; j < faces.length; j++) {
      if (i === j) continue;
      const a = by[faces[i]];
      const b = by[faces[j]];
      for (let w = 0; w <= wilds.length; w++) {
        for (let na = Math.min(a.length, 3); na >= 1; na--) {
          for (let nb = Math.min(b.length, 2); nb >= 1; nb--) {
            if (na + nb + w !== 5) continue;
            if (na + Math.min(w, 3 - na) < 3) continue;
            for (const ta of subsetsOfSize(a, na, 4)) {
              for (const tb of subsetsOfSize(b, nb, 4)) {
                for (const ws of subsetsOfSize(wilds, w, 4)) out.push([...ta, ...tb, ...ws]);
              }
            }
          }
        }
      }
    }
  }
  // Straights / flushes: sample windows with available ranks (bounded)
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
  // Same-suit flushes (non-straight): take 5 of one suit + wilds
  for (const s of suits) {
    const suited = normals.filter((c) => c.s === s);
    for (let w = 0; w <= Math.min(wilds.length, 4); w++) {
      if (suited.length + w < 5) continue;
      for (const five of subsetsOfSize(suited, 5 - w, 10)) {
        for (const ws of subsetsOfSize(wilds, w, 4)) out.push([...five, ...ws]);
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
  if (needFives) {
    const faceMap = {};
    faces.forEach((f) => {
      faceMap[f] = by[f];
    });
    for (const five of buildFiveCandidates(hand, wilds, faceMap)) out.push(five);
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
  return result.sort((a, b) => a.c.kind - b.c.kind || a.c.rank - b.c.rank);
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

/** First lead of a round (read hand). Later turns use TURN_MS. */
const TURN_MS_FIRST = 45000;
const TURN_MS = 25000;

function turnWindowMs(r) {
  return r.firstLeadDone ? TURN_MS : TURN_MS_FIRST;
}

function isJokerRank(r) {
  return r === '大怪' || r === '小怪';
}

/** Unbeatable joker shapes from issue.log — skip pass circle. */
function isSureWinCards(cards) {
  if (!cards?.length || ![1, 2, 3].includes(cards.length)) return false;
  if (!cards.every((c) => isJokerRank(c.r))) return false;
  const big = cards.filter((c) => c.r === '大怪').length;
  const small = cards.filter((c) => c.r === '小怪').length;
  if (cards.length === 1 && big === 1) return true;
  if (cards.length === 2 && big === 2) return true;
  if (cards.length === 3 && big === 3) return true;
  if (cards.length === 3 && big === 1 && small === 2) return true;
  if (cards.length === 3 && big === 2 && small === 1) return true;
  return false;
}

function teamCleared(r) {
  let red = 0;
  let blue = 0;
  r.ranking.forEach((id) => {
    const seat = r.players.findIndex((p) => p.id === id);
    if (seat < 0) return;
    if (teamOf(seat) === 'red') red++;
    else blue++;
  });
  return red >= 3 || blue >= 3;
}

function shouldSettle(r) {
  return teamCleared(r) || r.ranking.length >= 5;
}

function armTurn(r) {
  if (!r.started) {
    r.turnDeadline = null;
    return;
  }
  r.turnDeadline = Date.now() + turnWindowMs(r);
  tryForcedPass(r);
}

/** Followers with fewer cards than the table length auto-pass. */
function tryForcedPass(r) {
  if (!r.started || !r.table || r._forcingPass) return;
  r._forcingPass = true;
  try {
    let guard = 0;
    while (r.started && r.table && guard++ < 12) {
      const p = r.players[r.turn];
      if (!p || r.ranking.includes(p.id)) break;
      if (p.hand.length >= r.table.cards.length) break;
      const label = `${p.name} 牌不够，自动不出`;
      pass(r, p);
      if (r.started) r.message = label;
    }
  } finally {
    r._forcingPass = false;
  }
}

function next(r) {
  for (let n = 1; n <= 6; n++) {
    const i = (r.turn + n) % 6;
    if (!r.ranking.includes(r.players[i].id)) {
      r.turn = i;
      armTurn(r);
      return;
    }
  }
}

function resolveSureWinTrick(r) {
  if (!r.started || !r.table || !isSureWinCards(r.table.cards)) return false;
  const lead = r.table.player;
  if (!r.trickLog) r.trickLog = [];
  r.players.forEach((p) => {
    if (p.id === lead || r.ranking.includes(p.id)) return;
    r.trickLog.push({ playerId: p.id, name: p.name, pass: true, label: '不出', cards: [] });
  });
  r.table = null;
  r.passes = 0;
  r.trickLog = [];
  r.turn = r.players.findIndex((x) => x.id === lead);
  if (r.turn < 0 || r.ranking.includes(lead)) next(r);
  else armTurn(r);
  if (r.started) {
    r.message = `天王牌，自动过；${r.players[r.turn].name} 获得出牌权`;
  }
  return true;
}

function autoAct(r) {
  if (!r.started) return false;
  const p = r.players[r.turn];
  if (!p || r.ranking.includes(p.id)) return false;
  const tableCombo = r.table?.combo || null;
  try {
    if (!tableCombo) {
      if (!p.hand.length) {
        next(r);
        return true;
      }
      const sorted = sort([...p.hand], r.trump);
      const card = sorted[sorted.length - 1];
      const label = `${p.name} 超时，自动出了单张`;
      play(r, p, [card.id]);
      if (r.started) r.message = label;
      else if (!String(r.message || '').includes('超时')) r.message = `${label}。${r.message}`;
      return true;
    }
    // Follow timeout: always pass (never auto-beat).
    pass(r, p);
    if (r.started) r.message = `${p.name} 超时，自动不出`;
    return true;
  } catch (e) {
    try {
      if (tableCombo) pass(r, p);
    } catch {
      /* ignore */
    }
    return false;
  }
}

function checkTimeout(r) {
  if (!r.started || !r.turnDeadline) return false;
  if (Date.now() < r.turnDeadline) return false;
  const p = r.players[r.turn];
  if (p?.bot) return false;
  return autoAct(r);
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
    left.sort((a, b) => a.hand.length - b.hand.length);
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

  // Scoreboard uses catch-based 计分 even when upgrade points are 0 (cases 6/7 etc).
  const boardPoints = Math.max(points, scoreFromPlaces(places, winning));

  r.trump = r.trumpRules ? r.levels[r.banker] : '2';
  r.leadSeat = order[0].seat;
  r.started = false;
  r.trickLog = [];
  r.turnDeadline = null;
  if (!r.scores) r.scores = { red: 0, blue: 0 };
  r.scores[winning] = (r.scores[winning] || 0) + boardPoints;
  r.result = { winning, points: boardPoints, upgradePoints: points, gain: steps, places, tributers, switchBanker };
  r.message = r.trumpRules
    ? `${winning === 'red' ? '红队' : '蓝队'} +${boardPoints} 分（总分 ${r.scores[winning]}）/ 升 ${steps} 级${switchBanker ? '，换庄' : '，续庄'}；将牌 ${r.trump}。点「开始下一局」继续`
    : `${winning === 'red' ? '红队' : '蓝队'} +${boardPoints} 分（总分 ${r.scores[winning]}）${switchBanker ? '，换庄' : '，续庄'}；将牌固定 2。点「开始下一局」继续`;

  if (tributers.length) applyAutoTribute(r, tributers, winning);
}

function scoreFromPlaces(places, winning) {
  const other = winning === 'red' ? 'blue' : 'red';
  const winSorted = [...(places[winning] || [])].sort((a, b) => a - b);
  if (winSorted.length < 3) return 0;
  const third = winSorted[2];
  const caught = (places[other] || []).filter((p) => p > third).length;
  if (caught >= 3) return 8;
  if (caught === 2) return 5;
  if (caught === 1) return 3;
  if (places[winning].includes(1) && places[winning].includes(6)) {
    return places[winning].some((p) => p >= 2 && p <= 4) ? 1 : 0;
  }
  return 0;
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
  r.trickLog = [];
  r.ranking = [];
  r.result = null;
  r.firstLeadDone = false;
  armTurn(r);
  r.message = `${r.players[r.turn].name} 先出（庄：${r.players[r.bankerSeat].name}）；将牌：${r.trump}`;
}

function play(r, p, ids) {
  if (!r.started) throw Error('牌局尚未开始');
  if (r.players[r.turn].id !== p.id) throw Error('还没轮到你');
  if (!ids?.length) throw Error('请先选牌');
  const uniq = [...new Set(ids)];
  const cards = uniq.map((id) => p.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) throw Error('选牌已失效，请重新选');
  if (![1, 2, 3, 5].includes(cards.length)) throw Error('只能出 1、2、3 或 5 张');
  const c = combo(cards, r.trump);
  if (!c) {
    if (cards.length === 3) throw Error('三张须点数相同（可用怪牌补）');
    throw Error('只可出合法单张、对子、三张或五路');
  }
  if (!beats(c, r.table?.combo)) throw Error(`压不住：需大于桌上的${r.table.combo.label}`);
  p.hand = p.hand.filter((card) => !uniq.includes(card.id));
  r.table = { player: p.id, cards, combo: c };
  r.passes = 0;
  if (!r.trickLog) r.trickLog = [];
  r.trickLog.push({
    playerId: p.id,
    name: p.name,
    pass: false,
    label: c.label,
    cards: cards.map((x) => ({ r: x.r, s: x.s })),
  });
  r.message = `${p.name}${p.bot ? '（AI）' : ''} 出了 ${c.label}`;
  if (!r.firstLeadDone) r.firstLeadDone = true;
  if (!p.hand.length) {
    r.ranking.push(p.id);
    r.message = `${p.name} 已出完牌！（第 ${r.ranking.length} 名）`;
    if (shouldSettle(r)) {
      settle(r);
      return;
    }
  }
  if (isSureWinCards(cards)) {
    resolveSureWinTrick(r);
    return;
  }
  next(r);
}

function pass(r, p) {
  if (!r.started || r.players[r.turn].id !== p.id) throw Error('还没轮到你');
  if (!r.table) throw Error('首出不能过');
  r.passes++;
  if (!r.trickLog) r.trickLog = [];
  r.trickLog.push({ playerId: p.id, name: p.name, pass: true, label: '不出', cards: [] });
  r.message = `${p.name}${p.bot ? '（AI）' : ''} 不出`;
  if (r.passes >= activeCount(r) - 1) {
    const lead = r.table.player;
    r.table = null;
    r.passes = 0;
    r.trickLog = [];
    r.turn = r.players.findIndex((x) => x.id === lead);
    if (r.ranking.includes(lead)) next(r);
    else armTurn(r);
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
  if (!r.started || !p?.hand) return;
  const seat = r.players.indexOf(p);
  if (seat < 0 || r.players[r.turn]?.id !== p.id) return;
  const tableCombo = r.table?.combo || null;
  let options = [];
  try {
    options = candidates(p.hand, r.trump, tableCombo);
  } catch (e) {
    options = [];
  }
  if (!tableCombo) {
    if (!options.length) {
      if (!p.hand.length) {
        next(r);
        return;
      }
      // Never stall: lead cheapest single
      const sorted = sort([...p.hand], r.trump);
      play(r, p, [sorted[sorted.length - 1].id]);
      return;
    }
    play(r, p, pickLead(options, r, p, seat).cards.map((c) => c.id));
    return;
  }
  const ownerIdx = r.players.findIndex((x) => x.id === r.table.player);
  const choice = pickBeat(options, r, p, seat, teamOf(ownerIdx));
  if (choice) play(r, p, choice.cards.map((c) => c.id));
  else pass(r, p);
}

function state(r, id) {
  const me = r.players.find((p) => p.id === id);
  const myTeam = me ? teamOf(r.players.indexOf(me)) : null;
  return {
    type: 'state',
    code: r.code,
    started: r.started,
    host: r.host,
    trumpRules: !!r.trumpRules,
    trump: r.trump,
    levels: r.levels,
    scores: r.scores || { red: 0, blue: 0 },
    banker: r.banker,
    bankerSeat: r.bankerSeat,
    turn: r.turn,
    turnDeadline: r.turnDeadline || null,
    turnMs: turnWindowMs(r),
    firstLeadDone: !!r.firstLeadDone,
    passes: r.passes,
    ranking: r.ranking,
    result: r.result,
    message: r.message,
    round: r.round,
    trickLog: (r.trickLog || []).map((t) => ({
      playerId: t.playerId,
      name: t.name,
      pass: !!t.pass,
      label: t.label,
      cards: t.cards || [],
    })),
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
      teammate: myTeam != null && teamOf(i) === myTeam && p.id !== id,
    })),
    hand: me?.hand || [],
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
  scoreFromPlaces,
  TURN_MS,
  TURN_MS_FIRST,
  turnWindowMs,
  isSureWinCards,
  teamCleared,
  shouldSettle,
  armTurn,
  autoAct,
  checkTimeout,
};
