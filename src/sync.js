/* =========================================================
   sync.js — keeps the open board in step with Supabase
   Subscribes to Realtime changes for this board, paints a
   small status indicator, and asks app.js to reload the board
   when something changed elsewhere.
   ========================================================= */
(function (global) {
  'use strict';

  var pillEl = null;
  var noteEl = null;
  var onChange = null;
  var timer = null;
  var pending = false;
  var retryTimer = null;
  var active = false;

  var LABELS = {
    connecting: 'Connecting…',
    live: 'Synced',
    offline: 'Offline — retrying'
  };

  function paint(state) {
    document.documentElement.dataset.sync = state;
    var text = LABELS[state] || 'Connecting…';
    if (pillEl) pillEl.textContent = text;
    if (noteEl) noteEl.textContent = text;
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending) return;
    if (document.body.classList.contains('is-dragging')) return;
    pending = false;
    if (onChange) onChange();
  }

  function schedule() {
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 180);
  }

  function subscribe() {
    if (!active) return;
    global.KBStore.subscribe(
      function () { schedule(); },
      function (status) {
        if (status === 'SUBSCRIBED') {
          paint('live');
          schedule();          // catch anything missed while disconnected
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          paint('offline');
          retry();
        } else {
          paint('connecting');
        }
      }
    );
  }

  function retry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (!active) return;
      if (global.navigator && global.navigator.onLine === false) {
        paint('offline');
        retry();
        return;
      }
      paint('connecting');
      subscribe();
    }, 6000);
  }

  function start(options) {
    onChange = options && options.onChange;
    pillEl = document.getElementById('sync-pill');
    noteEl = document.getElementById('sync-note');
    active = true;

    paint(global.navigator && global.navigator.onLine === false ? 'offline' : 'connecting');

    subscribe();

    global.addEventListener('online', function () {
      paint('connecting');
      subscribe();
      schedule();
    });

    global.addEventListener('offline', function () { paint('offline'); });

    global.addEventListener('focus', function () {
      if (!pending && global.navigator.onLine !== false) schedule();
    });

    // a drop just finished — apply anything that arrived mid-drag
    document.addEventListener('pointerup', function () {
      if (pending) setTimeout(flush, 350);
    });
  }

  function stop() {
    active = false;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    timer = null;
    retryTimer = null;
    pending = false;
    global.KBStore.unsubscribe();
  }

  global.KBSync = { start: start, stop: stop, paint: paint };
})(window);
