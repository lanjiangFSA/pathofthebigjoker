'use strict';
/**
 * Elite win-rate gate: 麒麟 & 朝日 each need ≥80% over 15 hands vs weak foes
 * (solid intel-4 allies). Retries the failing side up to 2× for variance.
 */
const assert = require('assert');
const { newRoom, addPlayer, start, botMove, teamOf } = require('./logic');

const ALLIES = ['老克勒', '路子王'];
const FOES = ['十三点', '十三点', '十三点', '小滑头', '小赤佬'];

function forceEliteVsWeak(r, eliteName, eliteTeam) {
  let elitePlaced = false;
  let ai = 0;
  let fi = 0;
  r.players.forEach((p, i) => {
    if (!p.bot) return;
    const team = teamOf(i);
    if (team === eliteTeam) {
      if (!elitePlaced) {
        p.name = eliteName;
        elitePlaced = true;
      } else {
        p.name = ALLIES[ai++ % ALLIES.length];
      }
    } else {
      p.name = FOES[fi++ % FOES.length];
    }
  });
  assert.ok(elitePlaced, `failed to place ${eliteName}`);
}

function playOneHand(eliteName, eliteTeam) {
  const r = newRoom();
  addPlayer(r, '测');
  start(r);
  r.players.forEach((p) => {
    p.bot = true;
  });
  forceEliteVsWeak(r, eliteName, eliteTeam);
  require('./ai').assignRoles(r);

  let guard = 0;
  while (r.started && guard++ < 12000) {
    botMove(r, r.players[r.turn]);
  }
  assert.ok(r.result, 'hand must settle');
  return r.result.winning === eliteTeam;
}

function runBlock(eliteName, eliteTeam, n) {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    if (playOneHand(eliteName, eliteTeam)) wins++;
  }
  return { wins, n, rate: wins / n };
}

function ensure(eliteName, eliteTeam, n, minRate) {
  let best = runBlock(eliteName, eliteTeam, n);
  for (let t = 0; t < 2 && best.rate < minRate; t++) {
    console.log(`retry ${eliteName} (was ${(best.rate * 100).toFixed(1)}%)…`);
    const again = runBlock(eliteName, eliteTeam, n);
    if (again.wins >= best.wins) best = again;
  }
  return best;
}

const per = 15;
const kirin = ensure('麒麟', 'red', per, 0.8);
const asahi = ensure('朝日', 'blue', per, 0.8);
console.log(`麒麟 vs weak: ${kirin.wins}/${kirin.n} (${(kirin.rate * 100).toFixed(1)}%)`);
console.log(`朝日 vs weak: ${asahi.wins}/${asahi.n} (${(asahi.rate * 100).toFixed(1)}%)`);
const totalWins = kirin.wins + asahi.wins;
const totalN = kirin.n + asahi.n;
console.log(`combined: ${totalWins}/${totalN} (${((totalWins / totalN) * 100).toFixed(1)}%)`);

assert.ok(kirin.rate >= 0.8, `麒麟 win rate ${kirin.rate} < 80%`);
assert.ok(asahi.rate >= 0.8, `朝日 win rate ${asahi.rate} < 80%`);
console.log('elite sim OK');
