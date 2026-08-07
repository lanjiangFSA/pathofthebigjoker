/**
 * Pure audio event diff for big-monster-road.
 * Shared by browser (game) and Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AudioDiff = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function phaseFromState(state) {
    if (!state || !state.started) return 'wait';
    const tense = (state.players || []).some((p) => !p.done && Number(p.count) <= 10);
    return tense ? 'tension' : 'play';
  }

  /** Heuristic voice gender from display name (Shanghai nick pool + common cues). */
  function guessVoiceGender(name) {
    const n = String(name || '');
    if (/囡|妹|姐|阿姨|姑娘|小姐|姨|美|芳|丽|婷|媛|娟|燕|花|婆/.test(n)) return 'f';
    if (/仔|哥|叔|爷|赤佬|模子|队长|王|头|庆|祥|根|德|福|虎|开|滑头|十三点|白相|克勒|机/.test(n)) {
      return 'm';
    }
    if (/^阿/.test(n) && !/阿妹|阿姐|阿姨/.test(n)) return 'm';
    return 'm';
  }

  function passEvent(entry) {
    return { id: 'pass', name: (entry && (entry.name || entry.playerId)) || '' };
  }

  /**
   * @param {object|null} prev
   * @param {object|null} next
   * @param {string} meId
   * @param {{ snapshot?: boolean }} [opts]
   * @returns {{ phase: 'wait'|'play'|'tension', sfx: Array<string|{id:string,name?:string}> }}
   */
  function diffAudioEvents(prev, next, meId, opts) {
    const snapshot = !!(opts && opts.snapshot);
    if (!next) return { phase: 'wait', sfx: [] };
    const phase = phaseFromState(next);
    if (snapshot || !prev) return { phase, sfx: [] };

    const sfx = [];

    if (!prev.started && next.started) sfx.push('deal');
    if (prev.started && !next.started) sfx.push('roundEnd');

    const prevLog = prev.trickLog || [];
    const nextLog = next.trickLog || [];
    if (nextLog.length > prevLog.length) {
      for (let i = prevLog.length; i < nextLog.length; i++) {
        sfx.push(nextLog[i].pass ? passEvent(nextLog[i]) : 'play');
      }
    } else if (nextLog.length === 1 && prevLog.length > 1) {
      sfx.push(nextLog[0].pass ? passEvent(nextLog[0]) : 'play');
    }

    const prevTurnId = prev.started ? prev.players?.[prev.turn]?.id : null;
    const nextTurnId = next.started ? next.players?.[next.turn]?.id : null;
    if (next.started && nextTurnId === meId && prevTurnId !== meId) sfx.push('yourTurn');

    const prevDone = new Set((prev.players || []).filter((p) => p.done).map((p) => p.id));
    for (const p of next.players || []) {
      if (p.done && !prevDone.has(p.id)) sfx.push('finish');
    }

    if (phaseFromState(prev) !== 'tension' && phase === 'tension') sfx.push('tension');

    const prevN = (prev.players || []).length;
    const nextN = (next.players || []).length;
    if (!next.started && nextN > prevN) sfx.push('seatJoin');

    return { phase, sfx };
  }

  return { phaseFromState, diffAudioEvents, guessVoiceGender };
});
