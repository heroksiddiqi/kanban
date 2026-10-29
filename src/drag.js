/* =========================================================
   drag.js — pointer-based drag & drop (mouse + touch)
   No dependencies. Works on cards (inside/between columns)
   and on columns themselves.
   ========================================================= */
(function (global) {
  'use strict';

  var THRESHOLD = 5;        // px of movement before a drag starts
  var EDGE = 72;            // px from the board edge that auto-scrolls
  var SCROLL_STEP = 14;

  var boardEl = null;
  var onChange = null;
  var ctx = null;
  var lastDropAt = 0;
  var raf = null;
  var scrollDir = 0;

  function init(options) {
    boardEl = options.board;
    onChange = options.onChange;
    boardEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
  }

  /** True right after a drop — used to swallow the trailing click. */
  function justDragged() {
    return Date.now() - lastDropAt < 300;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && ctx && ctx.active) {
      cancel(true);
    }
  }

  function onPointerDown(e) {
    if (ctx) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    var handle = e.target.closest('[data-drag-handle]');
    var card = e.target.closest('.card');
    var isMouse = e.pointerType === 'mouse';

    // Mouse: grab from anywhere on the card. Touch: only from the handle.
    if (!handle && !(isMouse && card)) return;
    if (!handle && e.target.closest('button, a, input')) return;

    var type = handle && handle.getAttribute('data-drag-handle') === 'column' ? 'column' : 'card';
    var el = type === 'column' ? handle.closest('.column') : card;
    if (!el) return;

    ctx = {
      pointerId: e.pointerId,
      type: type,
      el: el,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      clone: null,
      offsetX: 0,
      offsetY: 0
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(e) {
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    ctx.x = e.clientX;
    ctx.y = e.clientY;

    if (!ctx.active) {
      var dist = Math.sqrt(
        Math.pow(ctx.x - ctx.startX, 2) + Math.pow(ctx.y - ctx.startY, 2)
      );
      if (dist < THRESHOLD) return;
      start();
    }

    if (e.cancelable) e.preventDefault();
    positionClone();
    updateTarget();
    planAutoScroll();
  }

  function start() {
    var el = ctx.el;
    var rect = el.getBoundingClientRect();

    ctx.active = true;
    ctx.offsetX = ctx.startX - rect.left;
    ctx.offsetY = ctx.startY - rect.top;

    var clone = el.cloneNode(true);
    clone.classList.add('drag-clone');
    clone.classList.remove('is-dragging');
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    clone.style.left = '0';
    clone.style.top = '0';
    document.body.appendChild(clone);

    ctx.clone = clone;
    el.classList.add('is-dragging');
    document.body.classList.add('is-dragging');

    var selection = global.getSelection && global.getSelection();
    if (selection && selection.removeAllRanges) selection.removeAllRanges();

    positionClone();
  }

  function positionClone() {
    var x = ctx.x - ctx.offsetX;
    var y = ctx.y - ctx.offsetY;
    ctx.clone.style.transform =
      'translate3d(' + x + 'px,' + y + 'px,0) rotate(1.4deg) scale(1.02)';
  }

  /* ---- drop targeting -------------------------------------------------- */

  function otherColumns() {
    return Array.prototype.filter.call(
      boardEl.querySelectorAll('.column'),
      function (c) { return c !== ctx.el; }
    );
  }

  function rectDistance(r, x, y) {
    var dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
    var dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
    return dx * dx + dy * dy;
  }

  function columnAt(x, y) {
    var cols = otherColumns();
    var best = null;
    var bestDist = Infinity;

    for (var i = 0; i < cols.length; i++) {
      var r = cols[i].getBoundingClientRect();
      var dist = rectDistance(r, x, y);
      if (dist === 0) return cols[i];
      if (dist < bestDist) { bestDist = dist; best = cols[i]; }
    }
    return best;
  }

  function updateTarget() {
    if (ctx.type === 'card') updateCardTarget();
    else updateColumnTarget();
  }

  function updateCardTarget() {
    var col = columnAt(ctx.x, ctx.y);
    if (!col) return;

    var cardsEl = col.querySelector('.cards');
    if (!cardsEl) return;

    var siblings = Array.prototype.filter.call(
      cardsEl.querySelectorAll(':scope > .card'),
      function (c) { return c !== ctx.el; }
    );

    var ref = null;
    for (var i = 0; i < siblings.length; i++) {
      var r = siblings[i].getBoundingClientRect();
      if (ctx.y < r.top + r.height / 2) { ref = siblings[i]; break; }
    }

    if (ref) cardsEl.insertBefore(ctx.el, ref);
    else cardsEl.appendChild(ctx.el);
  }

  function updateColumnTarget() {
    var cols = otherColumns();
    if (!cols.length) return;

    var target = columnAt(ctx.x, ctx.y);
    if (!target) return;

    var r = target.getBoundingClientRect();
    var sameRow = ctx.y >= r.top && ctx.y <= r.bottom;
    var after = sameRow
      ? ctx.x > r.left + r.width / 2
      : ctx.y > r.top + r.height / 2;

    if (after) boardEl.insertBefore(ctx.el, target.nextSibling);
    else boardEl.insertBefore(ctx.el, target);
  }

  /* ---- vertical auto-scroll -------------------------------------------- */

  function planAutoScroll() {
    var height = window.innerHeight || document.documentElement.clientHeight;
    scrollDir = 0;
    if (ctx.y < EDGE && window.scrollY > 0) scrollDir = -1;
    else if (ctx.y > height - EDGE) scrollDir = 1;
    if (scrollDir && !raf) raf = requestAnimationFrame(tickScroll);
  }

  function tickScroll() {
    raf = null;
    if (!ctx || !ctx.active || !scrollDir) return;
    var before = window.scrollY;
    window.scrollBy(0, scrollDir * SCROLL_STEP);
    if (window.scrollY !== before) {
      updateTarget();
      raf = requestAnimationFrame(tickScroll);
    }
  }

  /* ---- finish ---------------------------------------------------------- */

  function onPointerUp(e) {
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    var active = ctx.active;
    var type = ctx.type;
    var el = ctx.el;
    var id = el.getAttribute('data-id');

    teardown();

    if (!active) return;
    lastDropAt = Date.now();

    if (type === 'card') {
      var col = el.closest('.column');
      if (!col) { if (onChange) onChange({ type: 'cancel' }); return; }
      var order = Array.prototype.map.call(
        col.querySelectorAll(':scope > .cards > .card'),
        function (c) { return c.getAttribute('data-id'); }
      );
      if (onChange) onChange({
        type: 'card',
        id: id,
        columnId: col.getAttribute('data-id'),
        order: order
      });
    } else {
      var columnOrder = Array.prototype.map.call(
        boardEl.querySelectorAll('.column'),
        function (c) { return c.getAttribute('data-id'); }
      );
      if (onChange) onChange({ type: 'column', order: columnOrder, id: id });
    }
  }

  function onPointerCancel(e) {
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    cancel(false);
  }

  function cancel(revert) {
    var wasActive = ctx && ctx.active;
    teardown(true);
    if (wasActive && revert && onChange) onChange({ type: 'cancel' });
  }

  function teardown(keepDom) {
    if (ctx && ctx.clone) ctx.clone.remove();
    if (ctx && ctx.el) ctx.el.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging');

    scrollDir = 0;
    if (raf) { cancelAnimationFrame(raf); raf = null; }

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    ctx = null;

    if (keepDom) lastDropAt = Date.now();
  }

  global.KBDrag = { init: init, justDragged: justDragged };
})(window);
