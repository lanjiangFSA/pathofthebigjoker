/**
 * HandSelect — SelectionModel + PointerController for vertical rank stacks.
 * Inspired by stacked-card UIs: peek strip >= rank+suit header; each card is hittable.
 * @see https://codefronts.com/navigation/css-accordions/stacked-cards/
 */
(function (global) {
  'use strict';

  const RANK_ORDER = ['大怪', '小怪', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'];
  /** Visible header strip (horizontal rank+suit); overridable via --hand-peek CSS. */
  const PEEK = 28;
  const CARD_H = 64;

  const MIN_COL_W = 22;
  /** Reference width for peek/cardH scale; mobile soft ceiling. */
  const MAX_COL_W = 40;
  /** Wide / desktop ceiling so columns fill leftover space. */
  const MAX_COL_W_WIDE = 56;
  const COL_GAP = 3;
  const WIDE_AVAIL = 640;

  function layoutMetrics(handEl) {
    // Read stylesheet defaults only — strip prior inline writes to avoid
    // re-scaling the same vars on every SSE/render layout pass.
    handEl.style.removeProperty('--hand-peek');
    handEl.style.removeProperty('--hand-card-h');
    const cs = getComputedStyle(handEl);
    const peek = parseFloat(cs.getPropertyValue('--hand-peek')) || PEEK;
    const cardH = parseFloat(cs.getPropertyValue('--hand-card-h')) || CARD_H;
    return { peek, cardH };
  }

  function maxColWidth(availWidth) {
    // Phone landscape is wide but short — keep mobile column ceiling.
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(orientation: landscape) and (max-height: 520px) and (max-width: 899px)').matches
    ) {
      return MAX_COL_W;
    }
    return availWidth >= WIDE_AVAIL ? MAX_COL_W_WIDE : MAX_COL_W;
  }

  /** Fit rank columns into one screen: scale width, wrap to 2 rows if needed. */
  function fitColumns(rankCount, availWidth) {
    const n = Math.max(0, rankCount | 0);
    const avail = Math.max(0, availWidth | 0);
    const maxW = maxColWidth(avail);
    if (!n) return { rows: 1, colW: maxW, perRow: 0 };

    const widthFor = (count) => {
      const gaps = COL_GAP * Math.max(0, count - 1);
      return Math.floor((avail - gaps) / count);
    };

    let colW = widthFor(n);
    if (colW >= MIN_COL_W) {
      return { rows: 1, colW: Math.min(maxW, Math.max(MIN_COL_W, colW)), perRow: n };
    }
    const perRow = Math.ceil(n / 2);
    colW = widthFor(perRow);
    return {
      rows: 2,
      colW: Math.max(MIN_COL_W, Math.min(maxW, colW)),
      perRow,
    };
  }

  function rankScore(r, trump) {
    if (r === '大怪') return 1000;
    if (r === '小怪') return 900;
    if (trump && r === trump) return 800;
    const i = RANK_ORDER.indexOf(r);
    return i < 0 ? 0 : 100 - i;
  }

  function makeCardEl(c, cls) {
    const d = document.createElement('div');
    const isBig = c.r === '大怪';
    const isSmall = c.r === '小怪';
    const isJoker = isBig || isSmall || c.s === '★';
    d.className = [
      'card',
      cls,
      c.s === '♥' || c.s === '♦' ? 'red' : '',
      isJoker ? 'joker' : '',
      isBig ? 'joker-big' : '',
      isSmall ? 'joker-small' : '',
    ]
      .filter(Boolean)
      .join(' ');
    d.dataset.id = c.id || '';
    d.dataset.rank = c.r || '';
    if (isBig || isSmall) {
      d.innerHTML = `<div class="card-top joker-letters" aria-label="${isBig ? '大怪' : '小怪'}"><span class="joker-j">J</span><span class="joker-rest">O</span><span class="joker-rest">K</span><span class="joker-rest">E</span><span class="joker-rest">R</span></div>`;
    } else {
      d.innerHTML = `<div class="card-top"><span class="rank">${c.r}</span><span class="suit">${c.s}</span></div>`;
    }
    return d;
  }

  function SelectionModel(initial) {
    let ids = Array.isArray(initial) ? [...initial] : [];
    return {
      get() {
        return ids;
      },
      set(next) {
        ids = Array.isArray(next) ? [...next] : [];
        return ids;
      },
      has(id) {
        return ids.includes(id);
      },
      toggle(id) {
        ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
        return ids;
      },
      add(id) {
        if (!ids.includes(id)) ids = [...ids, id];
        return ids;
      },
      remove(id) {
        ids = ids.filter((x) => x !== id);
        return ids;
      },
      toggleMany(list) {
        const allOn = list.length && list.every((id) => ids.includes(id));
        if (allOn) ids = ids.filter((id) => !list.includes(id));
        else {
          list.forEach((id) => {
            if (!ids.includes(id)) ids.push(id);
          });
        }
        return ids;
      },
      filterValid(validSet) {
        ids = ids.filter((id) => validSet.has(id));
        return ids;
      },
    };
  }

  function paint(handEl, chosen) {
    const set = new Set(chosen || []);
    handEl.querySelectorAll('.handcard').forEach((el) => {
      const on = set.has(el.dataset.id);
      el.classList.toggle('selected', on);
      const base = parseInt(el.dataset.z || '1', 10);
      el.style.zIndex = String(on ? base + 40 : base);
    });
  }

  function layout(handEl, { hand, trump, chosen }) {
    const groups = new Map();
    (hand || []).forEach((c) => {
      const k = c.r;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    });
    const order = [...groups.keys()].sort((a, b) => rankScore(b, trump) - rankScore(a, trump));
    const base = layoutMetrics(handEl);
    const padX = 18;
    const rawW =
      handEl.clientWidth ||
      handEl.offsetWidth ||
      handEl.parentElement?.clientWidth ||
      320;
    const avail = Math.max(0, rawW - padX);
    const fit = fitColumns(order.length, avail);
    // Width may grow on desktop; height/peek only shrink when columns are narrow
    // (never scale above CSS base — that made PC cards look too tall).
    const hScale = Math.min(1, Math.max(0.55, fit.colW / MAX_COL_W));
    const peek = Math.max(12, Math.round(base.peek * hScale));
    const cardH = Math.max(32, Math.round(base.cardH * hScale));
    handEl.dataset.peek = String(peek);
    handEl.dataset.rows = String(fit.rows);
    handEl.classList.toggle('hand-rows-2', fit.rows === 2);
    handEl.style.setProperty('--hand-col-w', `${fit.colW}px`);
    handEl.style.setProperty('--hand-peek', `${peek}px`);
    handEl.style.setProperty('--hand-card-h', `${cardH}px`);
    handEl.style.gap = `${COL_GAP}px`;

    handEl.innerHTML = '';
    order.forEach((rank) => {
      const cards = groups.get(rank);
      const col = document.createElement('div');
      col.className = 'rank-col';
      col.dataset.rank = rank;
      col.style.width = `${fit.colW}px`;
      cards.forEach((c, i) => {
        const d = makeCardEl(c, 'handcard');
        if ((chosen || []).includes(c.id)) d.classList.add('selected');
        d.style.top = `${i * peek}px`;
        d.style.bottom = 'auto';
        d.style.width = `${fit.colW}px`;
        d.style.height = `${cardH}px`;
        d.dataset.z = String(i + 1);
        d.style.zIndex = String(i + 1);
        col.append(d);
      });
      col.style.height = `${cardH + Math.max(0, cards.length - 1) * peek}px`;
      handEl.append(col);
    });
    paint(handEl, chosen);
  }

  function cardAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    const col =
      stack.find((n) => n.classList?.contains('rank-col')) ||
      stack.find((n) => n.classList?.contains('handcard'))?.closest?.('.rank-col');
    if (!col) return null;
    return cardAtInColumn(col, y);
  }

  /** Geometric hit: peek strips map to card index; ignores z-index / selection lift. */
  function cardAtInColumn(col, clientY) {
    const cards = [...col.querySelectorAll('.handcard')];
    if (!cards.length) return null;
    const handEl = col.parentElement;
    const peek = parseFloat(handEl?.dataset?.peek) || layoutMetrics(handEl || col).peek;
    const top = col.getBoundingClientRect().top;
    const rel = clientY - top;
    const idx = Math.min(cards.length - 1, Math.max(0, Math.floor(rel / peek)));
    return cards[idx] || null;
  }

  function indexInColumn(col, cardEl) {
    return [...col.querySelectorAll('.handcard')].indexOf(cardEl);
  }

  function columnIds(cardEl) {
    const col = cardEl?.closest?.('.rank-col');
    if (!col) return [];
    return [...col.querySelectorAll('.handcard')].map((c) => c.dataset.id).filter(Boolean);
  }

  /**
   * @param {HTMLElement} handEl
   * @param {{ getChosen: () => string[], setChosen: (ids: string[]) => void, onChange?: () => void }} api
   */
  function bind(handEl, api) {
    let dragging = false;
    let moved = false;
    let startCard = null;
    let startCol = null;
    let startIdx = -1;
    let modeAdd = true;
    let lastTap = 0;
    let lastTapId = null;
    const seen = new Set();

    const sync = (ids) => {
      api.setChosen(ids);
      paint(handEl, ids);
      api.onChange?.();
    };

    const applyId = (id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const model = SelectionModel(api.getChosen());
      if (modeAdd) model.add(id);
      else model.remove(id);
      sync(model.get());
    };

    const applyCard = (el) => {
      if (el?.dataset?.id) applyId(el.dataset.id);
    };

    /** Fill all cards between start and current Y in the same column (fixes sparse pointermove). */
    const applyColumnSpan = (col, fromIdx, clientY) => {
      if (!col || fromIdx < 0) return;
      const cards = [...col.querySelectorAll('.handcard')];
      if (!cards.length) return;
      const cur = cardAtInColumn(col, clientY);
      const toIdx = cur ? indexInColumn(col, cur) : fromIdx;
      if (toIdx < 0) return;
      const a = Math.min(fromIdx, toIdx);
      const b = Math.max(fromIdx, toIdx);
      for (let i = a; i <= b; i++) applyId(cards[i].dataset.id);
    };

    handEl.onpointerdown = (e) => {
      if (e.button != null && e.button !== 0) return;
      const el = cardAt(e.clientX, e.clientY);
      if (!el) return;
      dragging = true;
      moved = false;
      startCard = el;
      startCol = el.closest('.rank-col');
      startIdx = startCol ? indexInColumn(startCol, el) : -1;
      modeAdd = !api.getChosen().includes(el.dataset.id);
      seen.clear();
      handEl.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    handEl.onpointermove = (e) => {
      if (!dragging) return;
      if (!moved) {
        moved = true;
        applyCard(startCard);
      }
      const col =
        document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains('rank-col')) ||
        cardAt(e.clientX, e.clientY)?.closest?.('.rank-col');
      if (col && col === startCol) {
        applyColumnSpan(col, startIdx, e.clientY);
      } else {
        // Cross-column: select the geometrically hit card in the other column
        applyCard(cardAt(e.clientX, e.clientY));
        if (col && col !== startCol) {
          // Reset span anchor when entering a new column so vertical sweeps work there too
          startCol = col;
          const hit = cardAtInColumn(col, e.clientY);
          startIdx = hit ? indexInColumn(col, hit) : 0;
          applyCard(hit);
        }
      }
    };

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      if (!moved && startCard) {
        const now = Date.now();
        const id = startCard.dataset.id;
        const isDouble = lastTapId === id && now - lastTap < 350;
        lastTap = now;
        lastTapId = id;
        if (isDouble) {
          sync(SelectionModel(api.getChosen()).toggleMany(columnIds(startCard)));
          lastTap = 0;
          lastTapId = null;
        } else {
          sync(SelectionModel(api.getChosen()).toggle(id));
        }
      } else if (moved && startCol) {
        applyColumnSpan(startCol, startIdx, e.clientY);
      }
      startCard = null;
      startCol = null;
      startIdx = -1;
      seen.clear();
    };

    handEl.onpointerup = end;
    handEl.onpointercancel = end;
  }

  global.HandSelect = {
    PEEK,
    CARD_H,
    MIN_COL_W,
    MAX_COL_W,
    MAX_COL_W_WIDE,
    RANK_ORDER,
    SelectionModel,
    fitColumns,
    layout,
    paint,
    bind,
    makeCardEl,
  };
})(typeof window !== 'undefined' ? window : globalThis);
