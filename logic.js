'use strict';
const crypto = require('crypto');

const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小怪', '大怪'];
const suits = ['♠', '♥', '♣', '♦'];
/** Shanghai-casual nicknames for AI seats (≤12 chars; shuffled per fill). */
const botNames = [
  '小虎机',
  '阿福',
  '路子王',
  '小囡',
  '阿妹',
  '囡囡',
  '小阿姐',
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
    // Pure jokers: face = weakest joker (大+小 → 对小怪). 小怪 cannot become 大怪.
    const face = wilds.some((c) => c.r === '小怪') ? '小怪' : '大怪';
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

function newRoom(_opts = {}) {
  return {
    code: code(),
    players: [],
    host: null,
    started: false,
    trumpRules: false,
    trump: '2',
    levels: { red: '2', blue: '2' },
    scores: { red: 0, blue: 0 },
    banker: 'red',
    bankerSeat: 0,
    leadSeat: 0,
    turn: 0,
    table: null,
    lastTable: null,
    lastTrickShow: [],
    passes: 0,
    trickLog: [],
    ranking: [],
    result: null,
    message: '等待牌友入座',
    round: 0,
    matchRound: 0,
    matchOver: false,
    turnDeadline: null,
    firstLeadDone: false,
    aiSense: emptyAiSense(),
  };
}

function emptyAiSense() {
  return {
    teammatePassByLen: { red: {}, blue: {} },
    played: { big: 0, small: 0, trump: 0, A: 0 },
  };
}

function ensureAiSense(r) {
  if (!r.aiSense) r.aiSense = emptyAiSense();
  if (!r.aiSense.teammatePassByLen) r.aiSense.teammatePassByLen = { red: {}, blue: {} };
  if (!r.aiSense.played) r.aiSense.played = { big: 0, small: 0, trump: 0, A: 0 };
  return r.aiSense;
}

function noteAiPlay(r, cards) {
  const sense = ensureAiSense(r);
  const trump = r.trump || '2';
  for (const c of cards || []) {
    if (c.r === '大怪') sense.played.big++;
    else if (c.r === '小怪') sense.played.small++;
    else if (c.r === trump) sense.played.trump++;
    else if (c.r === 'A') sense.played.A++;
  }
}

function noteAiPass(r, p) {
  const sense = ensureAiSense(r);
  const seat = r.players.indexOf(p);
  if (seat < 0 || !r.table?.cards?.length) return;
  const team = teamOf(seat);
  const len = r.table.cards.length;
  const bucket = sense.teammatePassByLen[team] || (sense.teammatePassByLen[team] = {});
  bucket[len] = (bucket[len] || 0) + 1;
}

function noteAiLeadClear(r, p, cards) {
  const sense = ensureAiSense(r);
  const seat = r.players.indexOf(p);
  if (seat < 0) return;
  const team = teamOf(seat);
  const len = cards?.length;
  if (len && sense.teammatePassByLen[team]) {
    // Successfully opening/using this length — decay teammate avoid signal
    if (sense.teammatePassByLen[team][len]) {
      sense.teammatePassByLen[team][len] = Math.max(0, sense.teammatePassByLen[team][len] - 1);
    }
  }
}

function addPlayer(r, name, bot = false) {
  if (r.players.length >= 6) throw Error('牌桌已满（6 人）');
  const p = { id: uid(), name: (name || '牌友').trim().slice(0, 12), hand: [], bot, role: 'support' };
  r.players.push(p);
  if (!r.host && !bot) r.host = p.id;
  r.message = `${p.name}${bot ? '（AI）' : ''} 入座（${r.players.filter((x) => !x.bot).length} 人真人 / ${r.players.length} 座）`;
  return p;
}

function findPlayer(r, id) {
  return r.players.find((p) => p.id === id) || null;
}

function ensureHost(r) {
  if (r.host && r.players.some((p) => p.id === r.host && !p.bot)) return;
  const human = r.players.find((p) => !p.bot);
  r.host = human ? human.id : null;
}

function stripBots(r) {
  r.players = r.players.filter((p) => !p.bot);
  ensureHost(r);
}

function addBots(r) {
  const reserved = new Set(['麒麟', '朝日']);
  const pool = shuffleNames(botNames.filter((n) => !reserved.has(n)));
  let n = 0;
  while (r.players.length < 6) {
    let name = pool[n++ % pool.length];
    while (r.players.some((p) => p.name === name)) name = `${name}${Math.ceil(Math.random() * 9)}`;
    addPlayer(r, name, true);
  }
  placeEliteBots(r);
}

/** 我方(房主/首位真人队)必有麒麟，对方必有朝日。 */
function placeEliteBots(r) {
  const humans = r.players.filter((p) => !p.bot);
  const anchor = humans.find((p) => p.id === r.host) || humans[0];
  const myTeam = anchor ? teamOf(r.players.indexOf(anchor)) : 'red';
  const foeTeam = myTeam === 'red' ? 'blue' : 'red';
  const allyBot = r.players.find((p, i) => p.bot && teamOf(i) === myTeam);
  const foeBot = r.players.find((p, i) => p.bot && teamOf(i) === foeTeam);
  if (allyBot) allyBot.name = '麒麟';
  if (foeBot) foeBot.name = '朝日';
  // Avoid duplicate elite names on same team leftovers
  r.players.forEach((p, i) => {
    if (!p.bot || p === allyBot || p === foeBot) return;
    if (p.name === '麒麟' || p.name === '朝日') {
      p.name = `阿福${(i % 9) + 1}`;
    }
  });
}

function snapshotTable(table) {
  if (!table) return null;
  return {
    player: table.player,
    combo: { kind: table.combo.kind, rank: table.combo.rank, label: table.combo.label },
    cards: table.cards.map((c) => ({ r: c.r, s: c.s, id: c.id })),
  };
}

function endTrickKeepShow(r) {
  r.lastTrickShow = (r.trickLog || []).map((t) => ({
    playerId: t.playerId,
    name: t.name,
    pass: !!t.pass,
    label: t.label,
    cards: t.cards || [],
  }));
  if (r.table) r.lastTable = snapshotTable(r.table);
  r.table = null;
  r.passes = 0;
  r.trickLog = [];
}

function abortToLobby(r) {
  r.started = false;
  r.table = null;
  r.lastTable = null;
  r.lastTrickShow = [];
  r.trickLog = [];
  r.ranking = [];
  r.result = null;
  r.turnDeadline = null;
  r.firstLeadDone = false;
  r.players.forEach((p) => {
    p.hand = [];
  });
  stripBots(r);
  r.message = '牌局已中止，等待开局';
}

function leavePlayer(r, id, mode) {
  const p = findPlayer(r, id);
  if (!p) throw Error('你不在该房间');
  if (p.bot) throw Error('AI 不能退出');
  if (mode === 'abort' || !r.started) {
    if (r.started) abortToLobby(r);
    r.players = r.players.filter((x) => x.id !== id);
    stripBots(r);
    ensureHost(r);
    if (!r.players.length) return { empty: true };
    r.message = `${p.name} 已离开（${r.players.filter((x) => !x.bot).length} 人）`;
    return { empty: false, left: true };
  }
  if (mode === 'ai') {
    p.bot = true;
    ensureHost(r);
    r.message = `${p.name} 已离席，AI 接手`;
    return { empty: false, ai: true };
  }
  throw Error('请选择退出方式');
}

function kickPlayer(r, hostId, targetId) {
  if (r.started) throw Error('对局中不能踢人');
  if (r.host !== hostId) throw Error('只有房主可以踢人');
  if (hostId === targetId) throw Error('不能踢自己');
  const t = findPlayer(r, targetId);
  if (!t) throw Error('找不到该玩家');
  if (t.bot) throw Error('不能踢 AI');
  r.players = r.players.filter((p) => p.id !== targetId);
  ensureHost(r);
  r.message = `${t.name} 被移出房间`;
  return t;
}

function teamLineup(r) {
  const red = [];
  const blue = [];
  r.players.forEach((p, i) => {
    (teamOf(i) === 'red' ? red : blue).push(p.name);
  });
  return { red, blue };
}

function regroupHumans(r) {
  const humans = r.players.filter((p) => !p.bot);
  const shuffled = shuffleNames(humans);
  r.players = [];
  shuffled.forEach((h) => {
    h.hand = [];
    h.bot = false;
    r.players.push(h);
  });
  ensureHost(r);
  addBots(r);
  r.scores = { red: 0, blue: 0 };
  r.matchRound = 0;
  r.matchOver = false;
  r.round = 0;
  r.result = null;
  r.bankerSeat = Math.floor(Math.random() * 6);
  r.banker = teamOf(r.bankerSeat);
  r.leadSeat = r.bankerSeat;
  const line = teamLineup(r);
  r.message = `重新分组！红队：${line.red.join('、')}；蓝队：${line.blue.join('、')}`;
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

/** Unbeatable joker shapes — skip pass circle. Mixed 大+小 triples rank as 小怪 and are beatable. */
function isSureWinCards(cards) {
  if (!cards?.length || ![1, 2, 3].includes(cards.length)) return false;
  if (!cards.every((c) => isJokerRank(c.r))) return false;
  const big = cards.filter((c) => c.r === '大怪').length;
  if (cards.length === 1 && big === 1) return true;
  if (cards.length === 2 && big === 2) return true;
  if (cards.length === 3 && big === 3) return true;
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
  endTrickKeepShow(r);
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
  const acted = autoAct(r);
  if (!acted && r.started) {
    // Avoid stuck at 0s: force advance
    try {
      if (r.table) pass(r, p);
      else if (p?.hand?.length) {
        const sorted = sort([...p.hand], r.trump);
        play(r, p, [sorted[sorted.length - 1].id]);
      } else next(r);
    } catch {
      next(r);
    }
    return true;
  }
  return acted;
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

  if (top3(b)) {
    // 1
    winning = banker;
    points = 8;
    switchBanker = false;
  } else if (top3(o)) {
    // 8
    winning = other;
    points = 8;
    switchBanker = true;
  } else if (has(b, 1) && has(o, 5) && has(o, 6)) {
    // 2
    winning = banker;
    points = 5;
    switchBanker = false;
  } else if (has(b, 1) && has(o, 6) && !has(o, 5) && !has(b, 6)) {
    // 3
    winning = banker;
    points = 3;
    switchBanker = false;
  } else if (has(b, 1) && has(b, 6)) {
    // 4 — 续庄不升级
    winning = banker;
    points = 0;
    // 头家+(二三四)+尾家 → 1 分
    if (b.some((p) => p >= 2 && p <= 4)) points = 1;
    switchBanker = false;
  } else if (has(o, 1) && has(o, 6)) {
    // 5
    winning = other;
    points = 0;
    if (o.some((p) => p >= 2 && p <= 4)) points = 1;
    switchBanker = true;
  } else if (has(o, 1) && has(b, 6) && !has(b, 5)) {
    // 6
    winning = other;
    points = 0;
    switchBanker = true;
  } else if (has(o, 1) && has(b, 5) && has(b, 6)) {
    // 7
    winning = other;
    points = 0;
    switchBanker = true;
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
  }

  // Scoreboard uses catch-based 计分 even when upgrade points are 0 (cases 6/7 etc).
  const boardPoints = Math.max(points, scoreFromPlaces(places, winning));

  r.trump = '2';
  // Next round: banker (= first lead) rotates clockwise by seat
  r.bankerSeat = (r.bankerSeat + 1) % 6;
  r.banker = teamOf(r.bankerSeat);
  r.leadSeat = r.bankerSeat;
  r.started = false;
  r.trickLog = [];
  r.lastTrickShow = [];
  r.lastTable = null;
  r.turnDeadline = null;
  if (!r.scores) r.scores = { red: 0, blue: 0 };
  r.scores[winning] = (r.scores[winning] || 0) + boardPoints;
  r.result = {
    winning,
    points: boardPoints,
    upgradePoints: 0,
    gain: 0,
    places,
    tributers: [],
    switchBanker,
  };
  const mr = r.matchRound || 1;
  if (mr >= 6) {
    r.matchOver = true;
    r.message = `本赛段结束！红 ${r.scores.red} : ${r.scores.blue} 蓝（本副 ${winning === 'red' ? '红' : '蓝'} +${boardPoints}）。点「开始下一局」重新分组`;
  } else {
    const nextBanker = r.players[r.bankerSeat]?.name || '';
    r.message = `${winning === 'red' ? '红队' : '蓝队'} +${boardPoints}（红 ${r.scores.red} : ${r.scores.blue} 蓝）· 第 ${mr}/6 副。下局庄/首出：${nextBanker}。点「开始下一局」`;
  }
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

function start(r) {
  if (r.started) throw Error('牌局已经开始');
  if (r.matchOver) regroupHumans(r);
  addBots(r);
  r.trump = '2';
  r.matchRound = (r.matchRound || 0) + 1;
  r.round = (r.round || 0) + 1;
  if (r.matchRound === 1) {
    r.bankerSeat = Math.floor(Math.random() * 6);
    r.banker = teamOf(r.bankerSeat);
  }
  r.leadSeat = r.bankerSeat;
  const d = deck();
  r.players.forEach((p, i) => {
    p.hand = sort(d.slice(i * 27, i * 27 + 27), r.trump);
  });
  require('./ai').assignRoles(r);
  r.started = true;
  r.matchOver = false;
  r.turn = r.leadSeat;
  r.table = null;
  r.lastTable = null;
  r.lastTrickShow = [];
  r.passes = 0;
  r.trickLog = [];
  r.ranking = [];
  r.result = null;
  r.firstLeadDone = false;
  r.aiSense = emptyAiSense();
  armTurn(r);
  const line = teamLineup(r);
  const bankerName = r.players[r.bankerSeat]?.name || '';
  r.message =
    r.matchRound === 1
      ? `第 1/6 副开局。红队：${line.red.join('、')}；蓝队：${line.blue.join('、')}。庄/首出：${bankerName}`
      : `第 ${r.matchRound}/6 副。庄/首出：${bankerName}`;
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
  // New lead clears previous trick display
  if (!r.table) {
    r.lastTable = null;
    r.lastTrickShow = [];
    noteAiLeadClear(r, p, cards);
  }
  p.hand = p.hand.filter((card) => !uniq.includes(card.id));
  r.table = { player: p.id, cards, combo: c };
  r.passes = 0;
  noteAiPlay(r, cards);
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
  noteAiPass(r, p);
  if (!r.trickLog) r.trickLog = [];
  r.trickLog.push({ playerId: p.id, name: p.name, pass: true, label: '不出', cards: [] });
  r.message = `${p.name}${p.bot ? '（AI）' : ''} 不出`;
  if (r.passes >= activeCount(r) - 1) {
    const lead = r.table.player;
    endTrickKeepShow(r);
    r.turn = r.players.findIndex((x) => x.id === lead);
    if (r.ranking.includes(lead)) next(r);
    else armTurn(r);
    r.message = `无人再压，${r.players[r.turn].name} 获得出牌权`;
  } else next(r);
}

function humansStillPlaying(r) {
  return r.players.some((p) => !p.bot && !r.ranking.includes(p.id));
}

function onlyAiPlaying(r) {
  return !!r.started && !humansStillPlaying(r);
}

function state(r, id) {
  const me = r.players.find((p) => p.id === id);
  const myTeam = me ? teamOf(r.players.indexOf(me)) : null;
  const { intelFor } = require('./ai');
  const mapTrick = (t) => ({
    playerId: t.playerId,
    name: t.name,
    pass: !!t.pass,
    label: t.label,
    cards: t.cards || [],
  });
  const tableSnap = (t) =>
    t && {
      player: t.player,
      combo: { kind: t.combo.kind, rank: t.combo.rank, label: t.combo.label },
      cards: t.cards.map((c) => ({ r: c.r, s: c.s })),
    };
  return {
    type: 'state',
    code: r.code,
    started: r.started,
    host: r.host,
    trumpRules: false,
    trump: '2',
    levels: { red: '2', blue: '2' },
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
    matchRound: r.matchRound || 0,
    matchOver: !!r.matchOver,
    trickLog: (r.trickLog || []).map(mapTrick),
    lastTrickShow: (r.lastTrickShow || []).map(mapTrick),
    table: tableSnap(r.table),
    lastTable: tableSnap(r.lastTable),
    players: r.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      seat: i,
      team: teamOf(i),
      count: p.hand.length,
      bot: p.bot,
      done: r.ranking.includes(p.id),
      role: p.role,
      intel: p.bot ? intelFor(p.name) : null,
      teammate: myTeam != null && teamOf(i) === myTeam && p.id !== id,
      banker: i === r.bankerSeat,
    })),
    hand: me?.hand || [],
  };
}

module.exports = {
  ranks,
  suits,
  KIND,
  FACE,
  STRAIGHT_WINDOWS,
  uid,
  teamOf,
  isWild,
  naturalPower,
  subsetsOfSize,
  deck,
  cardPower,
  sort,
  combo,
  beats,
  newRoom,
  addPlayer,
  addBots,
  findPlayer,
  leavePlayer,
  kickPlayer,
  abortToLobby,
  regroupHumans,
  start,
  play,
  pass,
  settle,
  next,
  state,
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
  onlyAiPlaying,
  humansStillPlaying,
};

// AI lives in ai.js; re-export for server/tests (load after exports to avoid cycles)
const ai = require('./ai');
module.exports.candidates = ai.candidates;
module.exports.botMove = ai.botMove;
module.exports.pickLead = ai.pickLead;
module.exports.pickBeat = ai.pickBeat;
module.exports.feedKindForCount = ai.feedKindForCount;
module.exports.wildSpendCost = ai.wildSpendCost;
module.exports.shapeBreakCost = ai.shapeBreakCost;
module.exports.comboEquityCost = ai.comboEquityCost;
module.exports.keyCardOpportunityCost = ai.keyCardOpportunityCost;
module.exports.leftoverDelta = ai.leftoverDelta;
module.exports.isStrongFive = ai.isStrongFive;
module.exports.countWilds = ai.countWilds;
module.exports.handStrength = ai.handStrength;
module.exports.assignRoles = ai.assignRoles;
module.exports.personaFor = ai.personaFor;
module.exports.intelFor = ai.intelFor;
module.exports.placeEliteBots = placeEliteBots;
module.exports.emptyAiSense = emptyAiSense;
module.exports.ensureAiSense = ensureAiSense;
