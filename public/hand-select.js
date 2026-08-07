/**
 * HandSelect — SelectionModel + PointerController for vertical rank stacks.
 * Inspired by stacked-card UIs: peek strip >= rank+suit header; each card is hittable.
 * @see https://codefronts.com/navigation/css-accordions/stacked-cards/
 */
(function (global) {
  'use strict';

  const RANK_ORDER = ['大怪', '小怪', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'];
  /** Visible header strip (horizontal rank+suit); must match overlap so tops stay readable. */
  const PEEK = 28;
  const CARD_H = 68;

  function rankScore(r, trump) {
    if (r === '大怪') return 1000;
    if (r === '小怪') return 900;
    if (trump && r === trump) return 800;
    const i = RANK_ORDER.indexOf(r);
    return i < 0 ? 0 : 100 - i;
  }

  const JOKER_SVG =
    '<svg class="joker-icon" viewBox="0 0 32 32" aria-hidden="true">' +
    '<circle cx="16" cy="18" r="9" fill="currentColor" opacity=".12"/>' +
    '<path d="M8 12c0-6 4-9 8-9s8 3 8 9" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="10" cy="8" r="2.2" fill="var(--joker-a,#e23)"/>' +
    '<circle cx="16" cy="5" r="2.2" fill="var(--joker-b,#fc3)"/>' +
    '<circle cx="22" cy="8" r="2.2" fill="var(--joker-c,#36c)"/>' +
    '<circle cx="12.5" cy="17" r="1.4" fill="currentColor"/>' +
    '<circle cx="19.5" cy="17" r="1.4" fill="currentColor"/>' +
    '<path d="M12 22c1.5 2 6.5 2 8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

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
      d.innerHTML = `<div class="card-top">${JOKER_SVG}<span class="joker-label">${isBig ? '大' : '小'}</span></div>`;
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

    handEl.innerHTML = '';
    order.forEach((rank) => {
      const cards = groups.get(rank);
      const col = document.createElement('div');
      col.className = 'rank-col';
      col.dataset.rank = rank;
      cards.forEach((c, i) => {
        const d = makeCardEl(c, 'handcard');
        if ((chosen || []).includes(c.id)) d.classList.add('selected');
        // Stack downward so each card's TOP (rank/suit) remains the visible peek strip
        d.style.top = `${i * PEEK}px`;
        d.style.bottom = 'auto';
        d.dataset.z = String(i + 1);
        d.style.zIndex = String(i + 1);
        col.append(d);
      });
      col.style.height = `${CARD_H + Math.max(0, cards.length - 1) * PEEK}px`;
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
    const top = col.getBoundingClientRect().top;
    const rel = clientY - top;
    const idx = Math.min(cards.length - 1, Math.max(0, Math.floor(rel / PEEK)));
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
    RANK_ORDER,
    SelectionModel,
    layout,
    paint,
    bind,
    makeCardEl,
  };
})(typeof window !== 'undefined' ? window : globalThis);
