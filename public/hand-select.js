/**
 * HandSelect — SelectionModel + PointerController for vertical rank stacks.
 * Inspired by stacked-card UIs: peek strip >= rank+suit header; each card is hittable.
 * @see https://codefronts.com/navigation/css-accordions/stacked-cards/
 */
(function (global) {
  'use strict';

  const RANK_ORDER = ['大怪', '小怪', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'];
  /** Visible header strip (rank + suit); must be >= overlap step. */
  const PEEK = 30;
  const CARD_H = 66;

  function rankScore(r, trump) {
    if (r === '大怪') return 1000;
    if (r === '小怪') return 900;
    if (trump && r === trump) return 800;
    const i = RANK_ORDER.indexOf(r);
    return i < 0 ? 0 : 100 - i;
  }

  function makeCardEl(c, cls) {
    const d = document.createElement('div');
    d.className = `card ${cls} ${c.s === '♥' || c.s === '♦' ? 'red' : ''} ${c.s === '★' ? 'joker' : ''}`;
    d.dataset.id = c.id || '';
    d.dataset.rank = c.r || '';
    d.innerHTML = `<span class="rank">${c.r}</span><small class="suit">${c.s}</small>`;
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
        d.style.bottom = `${i * PEEK}px`;
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
    return stack.find((n) => n.classList?.contains('handcard')) || null;
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
    let modeAdd = true;
    let lastTap = 0;
    let lastTapId = null;
    const seen = new Set();

    const sync = (ids) => {
      api.setChosen(ids);
      paint(handEl, ids);
      api.onChange?.();
    };

    const applyCard = (el) => {
      if (!el?.dataset?.id || seen.has(el.dataset.id)) return;
      seen.add(el.dataset.id);
      const model = SelectionModel(api.getChosen());
      if (modeAdd) model.add(el.dataset.id);
      else model.remove(el.dataset.id);
      sync(model.get());
    };

    handEl.onpointerdown = (e) => {
      if (e.button != null && e.button !== 0) return;
      const el = cardAt(e.clientX, e.clientY);
      if (!el) return;
      dragging = true;
      moved = false;
      startCard = el;
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
      applyCard(cardAt(e.clientX, e.clientY));
    };

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      const el = moved ? cardAt(e.clientX, e.clientY) : startCard;
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
      } else if (moved) {
        applyCard(el);
      }
      startCard = null;
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
