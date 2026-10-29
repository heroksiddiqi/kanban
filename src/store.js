/* =========================================================
   store.js — Supabase persistence layer

   The board is stored in Postgres (Supabase) and nothing is
   cached locally, so every device reads and writes the same
   rows. Auth is email + password (no mail is ever sent, so the
   built-in SMTP rate limit does not apply).

   The public API mirrors the old IndexedDB version, which is
   why board.js / app.js barely had to change:

     start(), init(), load(), saveCard(s), saveColumn(s),
     deleteColumn(), clearAll(), replaceAll(), saveMeta(),
     defaultColumns(), uid()

   Plus the auth / realtime bits used by sync.js:

     signInWithPassword(), signOut(), getUser(), onAuthChange(),
     subscribe(), unsubscribe(), isSignedIn()
   ========================================================= */
(function (global) {
  'use strict';

  var cfg = global.KB_CONFIG || {};
  var client = null;
  var boardId = null;
  var channel = null;
  var authListeners = [];
  var currentSession = null;

  /* ---- client ---------------------------------------------------------- */

  function configured() {
    return !!(cfg.supabaseUrl && cfg.supabaseKey && global.supabase && global.supabase.createClient);
  }

  function sb() {
    if (client) return client;

    if (!configured()) {
      throw new Error('Supabase is not configured. Check src/config.js and your connection.');
    }

    client = global.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    client.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_OUT') boardId = null;
      if (session) currentSession = session;
      else if (event === 'SIGNED_OUT') currentSession = null;
      authListeners.forEach(function (fn) {
        try { fn(event, session); } catch (err) { console.error(err); }
      });
    });

    return client;
  }

  function check(res) {
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  }

  /* ---- session --------------------------------------------------------- */

  /** Restores the saved session (if any). */
  function start() {
    sb();
    return sb().auth.getSession().then(function (res) {
      var data = check(res);
      currentSession = data.session || null;
      return currentSession;
    });
  }

  function isSignedIn() {
    return !!currentSession;
  }

  function getUser() {
    return currentSession && currentSession.user ? currentSession.user : null;
  }

  function onAuthChange(fn) {
    authListeners.push(fn);
    return function () {
      authListeners = authListeners.filter(function (f) { return f !== fn; });
    };
  }

  function signInWithPassword(email, password) {
    return sb().auth
      .signInWithPassword({
        email: String(email || '').trim(),
        password: String(password || '')
      })
      .then(function (res) {
        if (res.error) throw res.error;
        currentSession = res.data.session || currentSession;
        return true;
      });
  }

  function signOut() {
    unsubscribe();
    boardId = null;
    return sb().auth.signOut().then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  /* ---- board ----------------------------------------------------------- */

  function ensureBoard() {
    if (boardId) return Promise.resolve(boardId);
    return sb().rpc('ensure_board').then(function (res) {
      boardId = check(res);
      return boardId;
    });
  }

  var COLUMN_FIELDS = 'id,title,color,position,deleted,created_at,updated_at';
  var CARD_FIELDS = 'id,column_id,title,notes,color,due_date,position,deleted,created_at,updated_at';

  function columnFromRow(r) {
    return {
      id: r.id,
      title: r.title,
      color: r.color,
      position: r.position,
      deleted: !!r.deleted,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    };
  }

  function columnToRow(c) {
    return {
      id: c.id,
      board_id: boardId,
      title: c.title,
      color: c.color || 'slate',
      position: c.position || 0,
      deleted: !!c.deleted,
      created_at: c.createdAt || Date.now(),
      updated_at: c.updatedAt || Date.now()
    };
  }

  function cardFromRow(r) {
    return {
      id: r.id,
      columnId: r.column_id,
      title: r.title,
      notes: r.notes || '',
      color: r.color || '',
      dueDate: r.due_date || '',
      position: r.position,
      deleted: !!r.deleted,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    };
  }

  function cardToRow(c) {
    return {
      id: c.id,
      board_id: boardId,
      column_id: c.columnId,
      title: c.title,
      notes: c.notes || '',
      color: c.color || '',
      due_date: c.dueDate || '',
      position: c.position || 0,
      deleted: !!c.deleted,
      created_at: c.createdAt || Date.now(),
      updated_at: c.updatedAt || Date.now()
    };
  }

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ---- defaults -------------------------------------------------------- */

  var DEFAULT_COLUMNS = [
    { title: 'To Do', color: 'blue' },
    { title: 'Doing', color: 'amber' },
    { title: 'Done', color: 'green' }
  ];

  function defaultColumns() {
    var stamp = Date.now();
    return DEFAULT_COLUMNS.map(function (col, index) {
      return {
        id: uid(),
        title: col.title,
        color: col.color,
        position: index,
        createdAt: stamp,
        updatedAt: stamp
      };
    });
  }

  /* ---- reads ----------------------------------------------------------- */

  function load() {
    return ensureBoard().then(function () {
      return Promise.all([
        sb().from('columns').select(COLUMN_FIELDS).eq('board_id', boardId).order('position'),
        sb().from('cards').select(CARD_FIELDS).eq('board_id', boardId).order('position')
      ]);
    }).then(function (res) {
      var columns = check(res[0]) || [];
      var cards = check(res[1]) || [];
      return {
        columns: columns.map(columnFromRow),
        cards: cards.map(cardFromRow),
        meta: {}
      };
    });
  }

  /* ---- writes ---------------------------------------------------------- */

  function upsertColumns(columns) {
    if (!columns || !columns.length) return Promise.resolve();
    return sb().from('columns').upsert(columns.map(columnToRow), { onConflict: 'id' })
      .then(function (res) { check(res); });
  }

  function upsertCards(cards) {
    if (!cards || !cards.length) return Promise.resolve();
    return sb().from('cards').upsert(cards.map(cardToRow), { onConflict: 'id' })
      .then(function (res) { check(res); });
  }

  function saveCard(card) {
    return ensureBoard().then(function () { return upsertCards([card]); }).then(function () { return card; });
  }

  function saveCards(cards) {
    return ensureBoard().then(function () { return upsertCards(cards); });
  }

  function saveColumn(column) {
    return ensureBoard().then(function () { return upsertColumns([column]); }).then(function () { return column; });
  }

  function saveColumns(columns) {
    return ensureBoard().then(function () { return upsertColumns(columns); });
  }

  function deleteColumn(id) {
    return ensureBoard()
      .then(function () { return sb().from('columns').delete().eq('board_id', boardId).eq('id', id); })
      .then(function (res) { check(res); });
  }

  /** Wipes every column and card, keeping the board itself. */
  function clearAll() {
    return ensureBoard()
      .then(function () { return sb().from('cards').delete().eq('board_id', boardId); })
      .then(function (res) {
        check(res);
        return sb().from('columns').delete().eq('board_id', boardId);
      })
      .then(function (res) { check(res); });
  }

  function prune(table, keepIds) {
    var query = sb().from(table).delete().eq('board_id', boardId);
    if (keepIds.length) query = query.not('id', 'in', '(' + keepIds.join(',') + ')');
    return query.then(function (res) { check(res); });
  }

  /** Replaces the whole board in one go (import / reset). */
  function replaceAll(data) {
    var columns = (data && data.columns) || [];
    var cards = (data && data.cards) || [];

    return ensureBoard()
      .then(function () { return upsertColumns(columns); })
      .then(function () { return upsertCards(cards); })
      .then(function () { return prune('cards', cards.map(function (c) { return c.id; })); })
      .then(function () { return prune('columns', columns.map(function (c) { return c.id; })); });
  }

  /* ---- realtime -------------------------------------------------------- */

  function unsubscribe() {
    if (channel && client) {
      try { client.removeChannel(channel); } catch (e) {}
      channel = null;
    }
  }

  function subscribe(onEvent, onStatus) {
    unsubscribe();
    if (!boardId) return;

    var handler = function (payload) { if (onEvent) onEvent(payload); };
    var filter = 'board_id=eq.' + boardId;

    channel = sb()
      .channel('kanban-' + boardId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'columns', filter: filter }, handler)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cards', filter: filter }, handler)
      .subscribe(function (status, err) {
        if (onStatus) onStatus(status, err);
      });
  }

  /* ---- public API ------------------------------------------------------ */

  global.KBStore = {
    uid: uid,

    // auth
    start: start,
    signInWithPassword: signInWithPassword,
    signOut: signOut,
    getUser: getUser,
    onAuthChange: onAuthChange,
    isSignedIn: isSignedIn,

    // data
    init: function () {
      return start().then(function (session) {
        if (!session) throw new Error('not-signed-in');
        return ensureBoard();
      });
    },
    load: load,
    saveCard: saveCard,
    saveCards: saveCards,
    saveColumn: saveColumn,
    saveColumns: saveColumns,
    deleteColumn: deleteColumn,
    clearAll: clearAll,
    replaceAll: replaceAll,

    // settings stay local to this browser
    saveMeta: function () { return Promise.resolve(); },

    // exposed for debugging in the console
    client: function () { return sb(); },

    subscribe: subscribe,
    unsubscribe: unsubscribe,
    defaultColumns: defaultColumns
  };
})(window);
