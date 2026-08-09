/**
 * Game audio: BGM phases + SFX. Relies on AudioDiff for state → events.
 * Music / SFX volumes are independent 0–100 (localStorage).
 */
const GameAudio = (() => {
  const BASE = 'audio/';
  // Phase volumes already at 80% of the original mix levels.
  const BGM = {
    wait: { url: BASE + 'bgm-main.mp3', rate: 0.88, vol: 0.336 },
    play: { url: BASE + 'bgm-main.mp3', rate: 1.0, vol: 0.464 },
    tension: { url: BASE + 'bgm-tension.mp3', rate: 1.06, vol: 0.528 },
  };
  const SFX_URL = {
    play: BASE + 'sfx-play.mp3',
    passF: BASE + 'sfx-pass-f.mp3',
    passM: BASE + 'sfx-pass-m.mp3',
    deal: BASE + 'sfx-deal.mp3',
    yourTurn: BASE + 'sfx-your-turn.mp3',
    timerWarn: BASE + 'sfx-timer-warn.mp3',
    finish: BASE + 'sfx-finish.mp3',
    roundEnd: BASE + 'sfx-round-end.mp3',
    seatJoin: BASE + 'sfx-seat-join.mp3',
    tension: BASE + 'sfx-tension.mp3',
  };
  const SFX_BASE = { passF: 0.9, passM: 0.9, yourTurn: 1.0, default: 0.7 };

  // Bump keys when defaults change; also clears values wrongly written as 0
  const MUSIC_KEY = 'dglz-v060b-vol-music';
  const SFX_KEY = 'dglz-v060b-vol-sfx';
  const DEFAULT_MUSIC = 10;
  const DEFAULT_SFX = 30;

  function clampVol(n, fallback) {
    // localStorage miss is null; Number(null)===0 must not swallow defaults
    if (n === null || n === undefined || n === '') return fallback;
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  let musicVol = clampVol(localStorage.getItem(MUSIC_KEY), DEFAULT_MUSIC);
  let sfxVol = clampVol(localStorage.getItem(SFX_KEY), DEFAULT_SFX);

  let ctx = null;
  let musicBus = null;
  let sfxBus = null;
  let phase = null;
  let bgmSrc = null;
  let bgmGain = null;
  let fadeTimer = null;
  const buffers = new Map();
  let loadPromise = null;
  let lastTimerWarnSec = null;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      musicBus = ctx.createGain();
      sfxBus = ctx.createGain();
      musicBus.gain.value = musicVol / 100;
      sfxBus.gain.value = sfxVol / 100;
      musicBus.connect(ctx.destination);
      sfxBus.connect(ctx.destination);
    }
    return ctx;
  }

  async function unlock() {
    ensureCtx();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (_) {}
    }
    return preload();
  }

  async function decode(url) {
    if (buffers.has(url)) return buffers.get(url);
    const res = await fetch(url);
    const raw = await res.arrayBuffer();
    const buf = await ensureCtx().decodeAudioData(raw.slice(0));
    buffers.set(url, buf);
    return buf;
  }

  function preload() {
    if (loadPromise) return loadPromise;
    const urls = new Set([BGM.wait.url, BGM.tension.url, ...Object.values(SFX_URL)]);
    loadPromise = Promise.all([...urls].map((u) => decode(u).catch(() => null)));
    return loadPromise;
  }

  function applyBusGains() {
    if (musicBus) musicBus.gain.value = musicVol / 100;
    if (sfxBus) sfxBus.gain.value = sfxVol / 100;
  }

  function setMusicVolume(n) {
    musicVol = clampVol(n, musicVol);
    localStorage.setItem(MUSIC_KEY, String(musicVol));
    applyBusGains();
    syncVolumeUi();
  }

  function setSfxVolume(n) {
    sfxVol = clampVol(n, sfxVol);
    localStorage.setItem(SFX_KEY, String(sfxVol));
    applyBusGains();
    syncVolumeUi();
  }

  function getMusicVolume() {
    return musicVol;
  }

  function getSfxVolume() {
    return sfxVol;
  }

  function syncVolumeUi() {
    const m = document.getElementById('volMusic');
    const s = document.getElementById('volSfx');
    const mv = document.getElementById('volMusicVal');
    const sv = document.getElementById('volSfxVal');
    const btn = document.getElementById('audioMenuBtn');
    if (m) m.value = String(musicVol);
    if (s) s.value = String(sfxVol);
    if (mv) mv.textContent = String(musicVol);
    if (sv) sv.textContent = String(sfxVol);
    if (btn) {
      const off = musicVol === 0 && sfxVol === 0;
      btn.textContent = off ? '静音 ▾' : '声音 ▾';
      btn.setAttribute('aria-pressed', off ? 'true' : 'false');
    }
  }

  function stopBgmImmediate() {
    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
    try {
      bgmSrc?.stop();
    } catch (_) {}
    bgmSrc = null;
    bgmGain = null;
  }

  async function setPhase(nextPhase) {
    if (!nextPhase || nextPhase === phase) return;
    ensureCtx();
    await preload();
    const conf = BGM[nextPhase];
    if (!conf) return;
    const buf = buffers.get(conf.url);
    if (!buf) return;

    const ac = ctx;
    const nextGain = ac.createGain();
    nextGain.gain.value = 0;
    nextGain.connect(musicBus);
    const nextSrc = ac.createBufferSource();
    nextSrc.buffer = buf;
    nextSrc.loop = true;
    nextSrc.playbackRate.value = conf.rate;
    nextSrc.connect(nextGain);
    nextSrc.start();

    const oldGain = bgmGain;
    const oldSrc = bgmSrc;
    bgmGain = nextGain;
    bgmSrc = nextSrc;
    phase = nextPhase;

    const target = conf.vol;
    const steps = 12;
    const ms = 900;
    let i = 0;
    if (fadeTimer) clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      i += 1;
      const t = i / steps;
      try {
        nextGain.gain.value = target * t;
        if (oldGain) oldGain.gain.value = (oldGain._targetVol ?? 0.5) * (1 - t);
      } catch (_) {}
      if (i >= steps) {
        clearInterval(fadeTimer);
        fadeTimer = null;
        nextGain.gain.value = target;
        nextGain._targetVol = target;
        if (oldSrc) {
          try {
            oldSrc.stop();
          } catch (_) {}
        }
      }
    }, ms / steps);
    nextGain._targetVol = target;
  }

  /** Short “叮” chime — reliable even if mp3 buffer not ready. */
  function playTurnDing() {
    if (sfxVol <= 0) return;
    ensureCtx();
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.connect(sfxBus);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(988, t0); // B5
    o.frequency.setValueAtTime(1319, t0 + 0.07); // E6
    o.connect(g);
    o.start(t0);
    o.stop(t0 + 0.45);
  }

  function playSfx(ev) {
    if (!ev || sfxVol <= 0) return;
    let name = ev;
    let speaker = '';
    if (typeof ev === 'object') {
      name = ev.id;
      speaker = ev.name || '';
    }
    if (name === 'pass') {
      const g =
        typeof AudioDiff !== 'undefined' && AudioDiff.guessVoiceGender
          ? AudioDiff.guessVoiceGender(speaker)
          : 'm';
      name = g === 'f' ? 'passF' : 'passM';
    }
    if (name === 'yourTurn') {
      playTurnDing();
      return;
    }
    ensureCtx();
    const url = SFX_URL[name];
    if (!url) return;
    const buf = buffers.get(url);
    if (!buf) {
      decode(url)
        .then(() => playSfx(ev))
        .catch(() => {});
      return;
    }
    const g = ctx.createGain();
    g.gain.value = SFX_BASE[name] ?? SFX_BASE.default;
    g.connect(sfxBus);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start();
  }

  function applyDiff(prev, next, meId, opts) {
    if (typeof AudioDiff === 'undefined') return;
    const ev = AudioDiff.diffAudioEvents(prev, next, meId, opts);
    setPhase(ev.phase);
    const snapshot = !!(opts && opts.snapshot);
    for (const s of ev.sfx) {
      if (snapshot) {
        const id = typeof s === 'object' ? s.id : s;
        if (id !== 'yourTurn') continue;
      }
      playSfx(s);
    }
  }

  function maybeTimerWarn(sec, isMyTurn) {
    if (!isMyTurn || sec > 5 || sec <= 0) {
      if (sec > 5) lastTimerWarnSec = null;
      return;
    }
    if (lastTimerWarnSec === sec) return;
    lastTimerWarnSec = sec;
    playSfx('timerWarn');
  }

  function bindVolumeControls() {
    const btn = document.getElementById('audioMenuBtn');
    const panel = document.getElementById('audioMenu');
    const m = document.getElementById('volMusic');
    const s = document.getElementById('volSfx');
    if (!btn || !panel) return;

    syncVolumeUi();

    btn.onclick = (e) => {
      e.stopPropagation();
      unlock();
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    const onMusic = () => {
      unlock();
      setMusicVolume(m.value);
    };
    const onSfx = () => {
      unlock();
      setSfxVolume(s.value);
    };
    m?.addEventListener('input', onMusic);
    s?.addEventListener('input', onSfx);

    document.addEventListener('click', (e) => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  return {
    unlock,
    setMusicVolume,
    setSfxVolume,
    getMusicVolume,
    getSfxVolume,
    setPhase,
    playSfx,
    applyDiff,
    maybeTimerWarn,
    bindVolumeControls,
    syncVolumeUi,
    stop: stopBgmImmediate,
  };
})();
