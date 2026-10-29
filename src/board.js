/* =========================================================
   board.js — state, rendering and board mutations
   ========================================================= */
(function (global) {
  'use strict';

  var store = global.KBStore;

  var PALETTE = [
    { key: 'slate',  hex: '#64748b' },
    { key: 'blue',   hex: '#3b82f6' },
    { key: 'green',  hex: '#22c55e' },
    { key: 'amber',  hex: '#f59e0b' },
    { key: 'rose',   hex: '#f43f5e' },
    { key: 'violet', hex: '#8b5cf6' },
    { key: 'cyan',   hex: '#06b6d4' },
    { key: 'orange', hex: '#f97316' }
  ];

  var state = { columns: [], cards: [], meta: {}, query: '' };
  var mountEl = null;
  var scrollMemo = { pageY: 0 };

  /* ---- helpers --------------------------------------------------------- */

  function now() { return Date.now(); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function tone(key) {
    return PALETTE.some(function (p) { return p.key === key; }) ? key : '';
  }

  function liveCards() {
    return state.cards.filter(function (c) { return !c.deleted; });
  }

  function cardsOf(columnId) {
    return liveCards()
      .filter(function (c) { return c.columnId === columnId; })
      .sort(function (a, b) {
        return (a.position - b.position) || (a.createdAt - b.createdAt);
      });
  }

  function dueInfo(dueDate) {
    if (!dueDate) return null;
    var d = new Date(dueDate + 'T00:00:00');
    if (isNaN(d.getTime())) return null;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var day = 86400000;
    var cls = '';
    var label = d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric'
    });

    if (d.getTime() < today.getTime()) cls = 'overdue';
    else if (d.getTime() === today.getTime()) { cls = 'today'; label = 'Today'; }
    else if (d.getTime() === today.getTime() + day) label = 'Tomorrow';

    return { label: label, cls: cls };
  }

  function matches(card, query) {
    if (!query) return true;
    return (card.title + ' ' + (card.notes || '')).toLowerCase().indexOf(query) !== -1;
  }

  var GRIP = '<svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor" aria-hidden="true">' +
    '<circle cx="7" cy="5" r="1.5"/><circle cx="13" cy="5" r="1.5"/>' +
    '<circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>' +
    '<circle cx="7" cy="15" r="1.5"/><circle cx="13" cy="15" r="1.5"/></svg>';

  /* ---- templates ------------------------------------------------------- */

  function cardHTML(card) {
    var due = dueInfo(card.dueDate);
    var color = tone(card.color);

    return '' +
      '<article class="card" data-id="' + esc(card.id) + '"' +
        (color ? ' data-tone="' + color + '"' : '') +
        ' tabindex="0" role="group" aria-label="' + esc(card.title) + '">' +
        '<div class="card-top">' +
          '<h3 class="card-title">' + esc(card.title) + '</h3>' +
          '<button type="button" class="drag-handle card-handle" data-drag-handle="card" ' +
            'aria-label="Drag card" tabindex="-1">' + GRIP + '</button>' +
        '</div>' +
        (card.notes ? '<p class="card-notes">' + esc(card.notes) + '</p>' : '') +
        (due
          ? '<div class="card-foot"><span class="due ' + due.cls + '">' +
              (due.cls === 'overdue' ? '⚠ ' : '') + esc(due.label) +
            '</span></div>'
          : '') +
      '</article>';
  }

  function columnHTML(column, total, visible, query) {
    var color = tone(column.color);
    var body;

    if (visible.length) {
      body = visible.map(cardHTML).join('');
    } else if (total > 0 && query) {
      body = '<p class="no-matches">No matching cards</p>';
    } else {
      body = '';
    }

    return '' +
      '<section class="column" data-id="' + esc(column.id) + '"' +
        (color ? ' data-tone="' + color + '"' : '') +
        ' aria-label="' + esc(column.title) + '">' +
        '<header class="column-header">' +
          '<button type="button" class="drag-handle" data-drag-handle="column" ' +
            'title="Drag column" aria-label="Drag column">' + GRIP + '</button>' +
          '<span class="column-dot"></span>' +
          '<h2 class="column-title">' + esc(column.title) + '</h2>' +
          '<span class="column-count">' + visible.length + (query ? '/' + total : '') + '</span>' +
          '<button type="button" class="btn btn-icon column-menu" data-action="edit-column" ' +
            'data-id="' + esc(column.id) + '" title="Column options" aria-label="Column options">⋯</button>' +
        '</header>' +
        '<div class="cards">' + body + '</div>' +
        '<button type="button" class="add-card" data-action="add-card" data-id="' + esc(column.id) + '">+ Add card</button>' +
      '</section>';
  }

  function emptyHTML() {
    return '' +
      '<div class="empty-board">' +
        '<h2>No columns yet</h2>' +
        '<p>Create a column like “To Do” to start dropping cards into it.</p>' +
        '<button type="button" class="btn btn-primary" data-action="new-column">+ Add column</button>' +
      '</div>';
  }

  function addColumnTileHTML() {
    return '<button type="button" class="add-column-tile" data-action="new-column">' +
      '<span class="plus-big">+</span>' +
      '<span>Add column</span>' +
    '</button>';
  }

  /* ---- rendering ------------------------------------------------------- */

  function rememberScroll() {
    if (!mountEl) return;
    scrollMemo.pageY = window.scrollY || window.pageYOffset || 0;
  }

  function restoreScroll() {
    if (!mountEl) return;
    if (typeof scrollMemo.pageY !== 'number') return;
    if (Math.abs((window.scrollY || 0) - scrollMemo.pageY) > 1) {
      window.scrollTo(window.scrollX, scrollMemo.pageY);
    }
  }

  function render() {
    if (!mountEl) return;
    rememberScroll();

    var query = state.query.trim().toLowerCase();

    if (!state.columns.length) {
      mountEl.innerHTML = emptyHTML();
      return;
    }

    mountEl.innerHTML = state.columns.map(function (column) {
      var total = cardsOf(column.id);
      var visible = query ? total.filter(function (c) { return matches(c, query); }) : total;
      return columnHTML(column, total.length, visible, query);
    }).join('') + addColumnTileHTML();

    restoreScroll();
  }

  /* ---- init ------------------------------------------------------------ */

  function setColumns(columns) {
    state.columns = (columns || [])
      .filter(function (c) { return !c.deleted; })
      .sort(function (a, b) { return a.position - b.position; });
  }

  function applyData(data) {
    setColumns(data.columns);
    state.cards = data.cards || [];
    state.meta = data.meta || {};
  }

  function init(options) {
    mountEl = options.mount;

    return store.init()
      .then(function () { return store.load(); })
      .then(function (data) {
        applyData(data);
        render();
        return state;
      });
  }

  /** Re-reads the board from the cloud (used by realtime + focus). */
  function reload() {
    return store.load().then(function (data) {
      applyData(data);
      render();
      return state;
    });
  }

  /* ---- card mutations -------------------------------------------------- */

  function addCard(columnId, fields) {
    var column = cardsOf(columnId);
    var maxPos = column.reduce(function (max, c) { return Math.max(max, c.position); }, -1);

    var card = {
      id: store.uid(),
      columnId: columnId,
      title: (fields.title || '').trim(),
      notes: (fields.notes || '').trim(),
      color: fields.color || '',
      dueDate: fields.dueDate || '',
      position: maxPos + 1,
      deleted: false,
      createdAt: now(),
      updatedAt: now()
    };

    state.cards.push(card);
    render();
    return store.saveCard(card).then(function () { return card; });
  }

  function updateCard(id, fields) {
    var card = state.cards.find(function (c) { return c.id === id; });
    if (!card) return Promise.resolve(null);

    card.title = (fields.title || '').trim();
    card.notes = (fields.notes || '').trim();
    card.color = fields.color || '';
    card.dueDate = fields.dueDate || '';

    if (fields.columnId && fields.columnId !== card.columnId) {
      var siblings = state.cards.filter(function (c) {
        return !c.deleted && c.columnId === fields.columnId && c.id !== card.id;
      });
      var maxPos = siblings.reduce(function (max, c) { return Math.max(max, c.position); }, -1);
      card.columnId = fields.columnId;
      card.position = maxPos + 1;
    }

    card.updatedAt = now();

    render();
    return store.saveCard(card).then(function () { return card; });
  }

  function deleteCard(id) {
    var card = state.cards.find(function (c) { return c.id === id; });
    if (!card) return Promise.resolve(false);

    card.deleted = true;
    card.updatedAt = now();

    render();
    return store.saveCard(card).then(function () { return true; });
  }

  /* ---- column mutations ------------------------------------------------ */

  function addColumn(fields) {
    var maxPos = state.columns.reduce(function (max, c) { return Math.max(max, c.position); }, -1);
    var column = {
      id: store.uid(),
      title: (fields.title || '').trim(),
      color: fields.color || 'slate',
      position: maxPos + 1,
      createdAt: now(),
      updatedAt: now()
    };

    state.columns.push(column);
    state.columns.sort(function (a, b) { return a.position - b.position; });
    render();
    scrollToColumn(column.id);
    return store.saveColumn(column).then(function () { return column; });
  }

  function scrollToColumn(id) {
    if (!mountEl) return;
    var el = mountEl.querySelector('.column[data-id="' + id + '"]');
    if (!el) return;
    requestAnimationFrame(function () {
      el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    });
  }

  function updateColumn(id, fields) {
    var column = state.columns.find(function (c) { return c.id === id; });
    if (!column) return Promise.resolve(null);

    column.title = (fields.title || '').trim();
    column.color = fields.color || 'slate';
    column.updatedAt = now();

    render();
    return store.saveColumn(column).then(function () { return column; });
  }

  function deleteColumn(id) {
    if (state.columns.length <= 1) {
      return Promise.resolve({ ok: false, reason: 'last-column' });
    }

    var column = state.columns.find(function (c) { return c.id === id; });
    if (!column) return Promise.resolve({ ok: false, reason: 'missing' });

    var stamp = now();

    var affected = state.cards.filter(function (card) {
      return card.columnId === id && !card.deleted;
    });
    affected.forEach(function (card) {
      card.deleted = true;
      card.updatedAt = stamp;
    });

    // soft delete: other devices (and realtime) need to see the tombstone
    column.deleted = true;
    column.updatedAt = stamp;

    state.columns = state.columns.filter(function (c) { return c.id !== id; });
    state.columns.forEach(function (c, index) {
      if (c.position !== index) {
        c.position = index;
        c.updatedAt = stamp;
      }
    });

    render();

    return store.saveCards(affected)
      .then(function () { return store.saveColumns([column].concat(state.columns)); })
      .then(function () { return { ok: true, column: column }; });
  }

  /* ---- drag results ---------------------------------------------------- */

  function reorder(payload) {
    if (!payload) return;

    if (payload.type === 'column') {
      var index = new Map();
      payload.order.forEach(function (id, i) { index.set(id, i); });

      var changedCols = [];
      state.columns.forEach(function (column) {
        if (!index.has(column.id)) return;
        var next = index.get(column.id);
        if (column.position !== next) {
          column.position = next;
          column.updatedAt = now();
          changedCols.push(column);
        }
      });
      state.columns.sort(function (a, b) { return a.position - b.position; });
      render();
      store.saveColumns(changedCols).catch(reportError);
      return;
    }

    if (payload.type === 'card') {
      var changedCards = [];

      payload.order.forEach(function (id, i) {
        var card = state.cards.find(function (c) { return c.id === id; });
        if (!card) return;

        var dirty = false;
        if (card.columnId !== payload.columnId) { card.columnId = payload.columnId; dirty = true; }
        if (card.position !== i) { card.position = i; dirty = true; }

        if (dirty) {
          card.updatedAt = now();
          changedCards.push(card);
        }
      });

      var moved = state.cards.find(function (c) { return c.id === payload.id; });
      if (moved && moved.columnId !== payload.columnId) {
        moved.columnId = payload.columnId;
        moved.updatedAt = now();
        if (changedCards.indexOf(moved) === -1) changedCards.push(moved);
      }

      render();
      store.saveCards(changedCards).catch(reportError);
      return;
    }

    if (payload.type === 'cancel') render();
  }

  /* ---- search ---------------------------------------------------------- */

  function setQuery(query) {
    state.query = query || '';
    render();
  }

  /* ---- export / import / reset ----------------------------------------- */

  function exportData() {
    return {
      app: 'herok-kanban',
      version: 1,
      exportedAt: new Date().toISOString(),
      columns: state.columns.map(function (c) {
        return { id: c.id, title: c.title, color: c.color, position: c.position };
      }),
      cards: liveCards().map(function (c) {
        return {
          id: c.id, columnId: c.columnId, title: c.title, notes: c.notes,
          color: c.color, dueDate: c.dueDate, position: c.position,
          createdAt: c.createdAt, updatedAt: c.updatedAt
        };
      })
    };
  }

  function normalizeImport(raw) {
    var source = raw && raw.board ? raw.board : raw;
    if (!source || !Array.isArray(source.columns) || !Array.isArray(source.cards)) {
      throw new Error('This file does not look like a Kanban backup.');
    }

    var stamp = now();
    var columns = source.columns.map(function (c, index) {
      if (!c || !c.title) throw new Error('A column in the file is missing a title.');
      return {
        id: String(c.id || store.uid()),
        title: String(c.title).slice(0, 40),
        color: tone(c.color) || 'slate',
        position: typeof c.position === 'number' ? c.position : index,
        createdAt: c.createdAt || stamp,
        updatedAt: c.updatedAt || stamp
      };
    });

    var validColumns = new Set(columns.map(function (c) { return c.id; }));
    var fallback = columns.length ? columns[0].id : null;

    if (!fallback) throw new Error('A board needs at least one column.');

    var cards = source.cards.map(function (c, index) {
      if (!c || !c.title) throw new Error('A card in the file is missing a title.');
      return {
        id: String(c.id || store.uid()),
        columnId: validColumns.has(String(c.columnId)) ? String(c.columnId) : fallback,
        title: String(c.title).slice(0, 200),
        notes: String(c.notes || '').slice(0, 4000),
        color: tone(c.color) || '',
        dueDate: c.dueDate ? String(c.dueDate).slice(0, 10) : '',
        position: typeof c.position === 'number' ? c.position : index,
        deleted: false,
        createdAt: c.createdAt || stamp,
        updatedAt: c.updatedAt || stamp
      };
    });

    return { columns: columns, cards: cards, meta: state.meta };
  }

  function importData(raw) {
    var data = normalizeImport(raw);

    return store.replaceAll(data).then(function () {
      setColumns(data.columns);
      state.cards = data.cards;
      state.query = '';
      render();
      return { columns: data.columns.length, cards: data.cards.length };
    });
  }

  function resetBoard() {
    return store.clearAll()
      .then(function () {
        var columns = store.defaultColumns();
        return store.replaceAll({ columns: columns, cards: [] });
      })
      .then(function () {
        return store.load();
      })
      .then(function (data) {
        applyData(data);
        state.query = '';
        render();
      });
  }

  function reportError(err) {
    console.error('[kanban] save failed', err);
    if (global.KBToast) global.KBToast('Could not save — check your connection');
  }

  /* ---- public API ------------------------------------------------------ */

  global.KB = {
    init: init,
    reload: reload,
    render: render,
    PALETTE: PALETTE,
    reorder: reorder,
    setQuery: setQuery,
    getQuery: function () { return state.query; },
    getState: function () { return state; },
    getColumns: function () { return state.columns.slice(); },
    getCard: function (id) {
      return state.cards.find(function (c) { return c.id === id && !c.deleted; }) || null;
    },
    cardsOf: cardsOf,
    addCard: addCard,
    updateCard: updateCard,
    deleteCard: deleteCard,
    addColumn: addColumn,
    updateColumn: updateColumn,
    deleteColumn: deleteColumn,
    exportData: exportData,
    importData: importData,
    resetBoard: resetBoard
  };
})(window);
