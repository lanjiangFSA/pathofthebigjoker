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

  /**
   * @param {object|null} prev
   * @param {object|null} next
   * @param {string} meId
   * @param {{ snapshot?: boolean }} [opts] snapshot=true: first frame, phase only
   * @returns {{ phase: 'wait'|'play'|'tension', sfx: string[] }}
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
        sfx.push(nextLog[i].pass ? 'pass' : 'play');
      }
    } else if (nextLog.length === 1 && prevLog.length > 1) {
      // New lead after clears: single fresh entry
      sfx.push(nextLog[0].pass ? 'pass' : 'play');
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

  return { phaseFromState, diffAudioEvents };
});
