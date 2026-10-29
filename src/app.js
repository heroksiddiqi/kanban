/* =========================================================
   app.js — UI wiring: dialogs, toolbar, search, export/import
   ========================================================= */
(function (global) {
  'use strict';

  var boardEl = document.getElementById('board');
  var searchInput = document.getElementById('search');
  var searchClear = document.getElementById('search-clear');
  var sizeDown = document.getElementById('size-down');
  var sizeUp = document.getElementById('size-up');
  var themeBtn = document.getElementById('theme-toggle');
  var menuBtn = document.getElementById('menu-btn');
  var menu = document.getElementById('menu');
  var toastEl = document.getElementById('toast');
  var importFile = document.getElementById('import-file');
  var fab = document.getElementById('fab');

  var authScreen = document.getElementById('auth-screen');
  var authForm = document.getElementById('auth-form');
  var authEmail = document.getElementById('auth-email');
  var authPassword = document.getElementById('auth-password');
  var authSubmit = document.getElementById('auth-submit');
  var authError = document.getElementById('auth-error');

  var cardDialog = document.getElementById('card-dialog');
  var cardForm = document.getElementById('card-form');
  var cardDialogTitle = document.getElementById('card-dialog-title');
  var cardColors = document.getElementById('card-colors');
  var cardDeleteBtn = document.getElementById('card-delete');
  var cardColumn = document.getElementById('card-column');

  var columnDialog = document.getElementById('column-dialog');
  var columnForm = document.getElementById('column-form');
  var columnDialogTitle = document.getElementById('column-dialog-title');
  var columnColors = document.getElementById('column-colors');
  var columnDeleteBtn = document.getElementById('column-delete');

  var cardEditing = { id: null, columnId: null };
  var columnEditing = { id: null };
  var toastTimer = null;

  var SIZES = ['compact', 'comfortable', 'large', 'xlarge', 'huge'];
  var SIZE_LABELS = {
    compact: 'Compact',
    comfortable: 'Comfortable',
    large: 'Large',
    xlarge: 'Extra large',
    huge: 'Huge'
  };

  /* ---- toast ----------------------------------------------------------- */

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }
  global.KBToast = toast;

  /* ---- theme ----------------------------------------------------------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    themeBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    try { localStorage.setItem('herok-kanban-theme', theme); } catch (e) {}
    if (global.KBStore) global.KBStore.saveMeta('theme', theme).catch(function () {});
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  /* ---- text size ------------------------------------------------------- */

  function applySize(size) {
    if (SIZES.indexOf(size) === -1) size = 'large';
    document.documentElement.dataset.size = size;
    try { localStorage.setItem('herok-kanban-size', size); } catch (e) {}
    if (global.KBStore) global.KBStore.saveMeta('textSize', size).catch(function () {});

    var index = SIZES.indexOf(size);
    sizeDown.disabled = index <= 0;
    sizeUp.disabled = index >= SIZES.length - 1;
    sizeDown.setAttribute('aria-label', 'Smaller text (' + SIZE_LABELS[size] + ')');
    sizeUp.setAttribute('aria-label', 'Larger text (' + SIZE_LABELS[size] + ')');
  }

  function stepSize(delta) {
    var current = document.documentElement.dataset.size || 'large';
    var index = SIZES.indexOf(current);
    if (index === -1) index = SIZES.indexOf('large');

    var next = index + delta;
    if (next < 0 || next >= SIZES.length) return;

    applySize(SIZES[next]);
    toast('Text size: ' + SIZE_LABELS[SIZES[next]]);
  }

  /* ---- color swatches -------------------------------------------------- */

  function renderSwatches(container, selected, onPick) {
    container.innerHTML = '';
    container.dataset.value = selected || '';

    function makeSwatch(key, hex, label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (key ? '' : ' swatch-none');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String((selected || '') === key));
      btn.setAttribute('aria-label', label);
      btn.title = label;
      if (key) btn.style.setProperty('--tone', hex);
      btn.addEventListener('click', function () {
        container.dataset.value = key;
        Array.prototype.forEach.call(container.children, function (el) {
          el.setAttribute('aria-checked', String(el === btn));
        });
        onPick(key);
      });
      container.appendChild(btn);
    }

    makeSwatch('', '', 'No color');
    global.KB.PALETTE.forEach(function (p) {
      makeSwatch(p.key, p.hex, p.key);
    });
  }

  /* ---- card dialog ----------------------------------------------------- */

  function fillColumnSelect(selectedId) {
    var columns = global.KB.getColumns();
    cardColumn.innerHTML = '';

    columns.forEach(function (col) {
      var option = document.createElement('option');
      option.value = col.id;
      option.textContent = col.title;
      cardColumn.appendChild(option);
    });

    var exists = columns.some(function (col) { return col.id === selectedId; });
    if (exists) cardColumn.value = selectedId;
  }

  function openCardDialog(card, columnId) {
    cardEditing = {
      id: card ? card.id : null,
      columnId: card ? card.columnId : columnId
    };

    cardDialogTitle.textContent = card ? 'Edit card' : 'New card';
    cardForm.elements.title.value = card ? card.title : '';
    cardForm.elements.notes.value = card ? card.notes : '';
    cardForm.elements.dueDate.value = card && card.dueDate ? card.dueDate : '';
    cardForm.elements.title.classList.remove('invalid');
    cardDeleteBtn.hidden = !card;

    fillColumnSelect(cardEditing.columnId);
    renderSwatches(cardColors, card ? card.color : '', function () {});

    cardDialog.showModal();
    setTimeout(function () {
      cardForm.elements.title.focus();
      if (card) cardForm.elements.title.select();
    }, 30);
  }

  function closeCardDialog() {
    if (cardDialog.open) cardDialog.close();
  }

  cardForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var titleInput = cardForm.elements.title;
    var title = titleInput.value.trim();
    if (!title) {
      titleInput.classList.add('invalid');
      titleInput.focus();
      return;
    }

    var targetColumn = cardColumn.value || cardEditing.columnId;

    var fields = {
      title: title,
      notes: cardForm.elements.notes.value,
      color: cardColors.dataset.value || '',
      dueDate: cardForm.elements.dueDate.value,
      columnId: targetColumn
    };

    var wasEdit = !!cardEditing.id;
    var work = wasEdit
      ? global.KB.updateCard(cardEditing.id, fields)
      : global.KB.addCard(targetColumn, fields);

    work.then(function () {
      closeCardDialog();
      toast(wasEdit ? 'Card updated' : 'Card added');
    }).catch(function (err) {
      console.error(err);
      toast('Could not save the card');
    });
  });

  cardForm.elements.title.addEventListener('input', function () {
    cardForm.elements.title.classList.remove('invalid');
  });

  cardDeleteBtn.addEventListener('click', function () {
    if (!cardEditing.id) return;
    if (!global.confirm('Delete this card?')) return;
    global.KB.deleteCard(cardEditing.id).then(function () {
      closeCardDialog();
      toast('Card deleted');
    });
  });

  /* ---- column dialog --------------------------------------------------- */

  function openColumnDialog(column) {
    columnEditing = { id: column ? column.id : null };

    columnDialogTitle.textContent = column ? 'Edit column' : 'New column';
    columnForm.elements.title.value = column ? column.title : '';
    columnForm.elements.title.classList.remove('invalid');
    columnDeleteBtn.hidden = !column;

    renderSwatches(columnColors, column ? column.color : 'slate', function () {});

    columnDialog.showModal();
    setTimeout(function () {
      columnForm.elements.title.focus();
      columnForm.elements.title.select();
    }, 30);
  }

  function closeColumnDialog() {
    if (columnDialog.open) columnDialog.close();
  }

  columnForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var titleInput = columnForm.elements.title;
    var title = titleInput.value.trim();
    if (!title) {
      titleInput.classList.add('invalid');
      titleInput.focus();
      return;
    }

    var fields = { title: title, color: columnColors.dataset.value || 'slate' };
    var wasEdit = !!columnEditing.id;

    var work = wasEdit
      ? global.KB.updateColumn(columnEditing.id, fields)
      : global.KB.addColumn(fields);

    work.then(function () {
      closeColumnDialog();
      toast(wasEdit ? 'Column updated' : 'Column added');
    }).catch(function (err) {
      console.error(err);
      toast('Could not save the column');
    });
  });

  columnForm.elements.title.addEventListener('input', function () {
    columnForm.elements.title.classList.remove('invalid');
  });

  columnDeleteBtn.addEventListener('click', function () {
    if (!columnEditing.id) return;
    var id = columnEditing.id;
    var count = global.KB.getState().cards.filter(function (c) {
      return !c.deleted && c.columnId === id;
    }).length;

    var message = count
      ? 'Delete this column and its ' + count + ' card' + (count === 1 ? '' : 's') + '?'
      : 'Delete this column?';
    if (!global.confirm(message)) return;

    global.KB.deleteColumn(id).then(function (result) {
      if (result && result.ok === false && result.reason === 'last-column') {
        closeColumnDialog();
        toast('Keep at least one column');
        return;
      }
      closeColumnDialog();
      toast('Column deleted');
    });
  });

  /* ---- dialog close plumbing ------------------------------------------- */

  [cardDialog, columnDialog].forEach(function (dialog) {
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close]'), function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
  });

  /* ---- board interactions ---------------------------------------------- */

  function currentColumnId() {
    var columns = global.KB.getColumns();
    if (!columns.length) return null;

    var nodes = Array.prototype.slice.call(boardEl.querySelectorAll('.column'));
    if (!nodes.length) return columns[0].id;

    var boardRect = boardEl.getBoundingClientRect();
    var left = Math.max(boardRect.left, 0);
    var right = Math.min(boardRect.right, window.innerWidth);
    var top = Math.max(boardRect.top, 0);
    var bottom = Math.min(boardRect.bottom, window.innerHeight);
    var cx = (left + right) / 2;
    var cy = (top + bottom) / 2;

    var best = nodes[0];
    var bestDist = Infinity;

    nodes.forEach(function (node) {
      var r = node.getBoundingClientRect();
      var dx = (r.left + r.width / 2) - cx;
      var dy = (r.top + r.height / 2) - cy;
      var dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = node; }
    });

    return best.getAttribute('data-id');
  }

  function openNewCard() {
    var columnId = currentColumnId();
    if (!columnId) {
      openColumnDialog(null);
      return;
    }
    openCardDialog(null, columnId);
  }

  function onBoardClick(e) {
    if (global.KBDrag.justDragged()) return;

    var actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      var action = actionEl.getAttribute('data-action');
      var id = actionEl.getAttribute('data-id');

      if (action === 'add-card') {
        openCardDialog(null, id);
        return;
      }
      if (action === 'edit-column') {
        var column = global.KB.getColumns().find(function (c) { return c.id === id; });
        if (column) openColumnDialog(column);
        return;
      }
      if (action === 'new-column') {
        openColumnDialog(null);
        return;
      }
    }

    if (e.target.closest('[data-drag-handle]')) return;

    var cardEl = e.target.closest('.card');
    if (cardEl) {
      var card = global.KB.getCard(cardEl.getAttribute('data-id'));
      if (card) openCardDialog(card);
    }
  }

  function onBoardKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var cardEl = e.target.closest && e.target.closest('.card');
    if (!cardEl || e.target !== cardEl) return;
    e.preventDefault();
    var card = global.KB.getCard(cardEl.getAttribute('data-id'));
    if (card) openCardDialog(card);
  }

  /* ---- search ---------------------------------------------------------- */

  var searchTimer = null;

  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var value = searchInput.value;
    searchClear.hidden = !value;
    searchTimer = setTimeout(function () {
      global.KB.setQuery(value);
    }, 120);
  });

  searchClear.addEventListener('click', function () {
    searchInput.value = '';
    searchClear.hidden = true;
    global.KB.setQuery('');
    searchInput.focus();
  });

  /* ---- menu ------------------------------------------------------------ */

  function closeMenu() { menu.hidden = true; }

  menuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  document.addEventListener('click', function (e) {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) closeMenu();
  });

  menu.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    closeMenu();

    if (action === 'export') exportJSON();
    if (action === 'import') importFile.click();
    if (action === 'reset') resetBoard();
    if (action === 'add-column') openColumnDialog(null);
    if (action === 'signout') signOut();
  });

  function signOut() {
    if (!global.confirm('Sign out of this device?\n\nThe board stays in your Supabase account.')) return;
    if (global.KBSync) global.KBSync.stop();
    global.KBStore.signOut()
      .catch(function (err) { console.error(err); })
      .then(function () { global.location.reload(); });
  }

  /* ---- export / import / reset ----------------------------------------- */

  function exportJSON() {
    var data = global.KB.exportData();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'kanban-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    if (global.KBStore) global.KBStore.saveMeta('lastExportAt', Date.now()).catch(function () {});
    toast('Backup downloaded');
  }

  function importJSON(file) {
    var reader = new FileReader();

    reader.onload = function () {
      var raw;
      try {
        raw = JSON.parse(String(reader.result));
      } catch (err) {
        toast('That file is not valid JSON');
        return;
      }

      var preview = raw && raw.board ? raw.board : raw;
      var count = preview && Array.isArray(preview.cards) ? preview.cards.length : 0;
      if (!global.confirm('Replace the current board with this backup?\n' + count + ' card(s) will be imported.')) {
        return;
      }

      global.KB.importData(raw).then(function (result) {
        searchInput.value = '';
        searchClear.hidden = true;
        toast('Imported ' + result.cards + ' card(s) in ' + result.columns + ' column(s)');
      }).catch(function (err) {
        console.error(err);
        toast(err && err.message ? err.message : 'Import failed');
      });
    };

    reader.onerror = function () { toast('Could not read that file'); };
    reader.readAsText(file);
  }

  importFile.addEventListener('change', function () {
    var file = importFile.files && importFile.files[0];
    if (file) importJSON(file);
    importFile.value = '';
  });

  function resetBoard() {
    if (!global.confirm('Reset the board?\n\nEvery column and card will be deleted. Export a backup first if unsure.')) {
      return;
    }
    global.KB.resetBoard().then(function () {
      searchInput.value = '';
      searchClear.hidden = true;
      toast('Board reset');
    });
  }

  /* ---- toolbar --------------------------------------------------------- */

  sizeDown.addEventListener('click', function () { stepSize(-1); });
  sizeUp.addEventListener('click', function () { stepSize(1); });
  themeBtn.addEventListener('click', toggleTheme);
  fab.addEventListener('click', openNewCard);

  /* ---- shortcuts ------------------------------------------------------- */

  function isTyping(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (cardDialog.open || columnDialog.open) return;

    if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }

    if (e.key === 'n' || e.key === 'N') {
      if (!global.KB.getColumns().length) return;
      e.preventDefault();
      openNewCard();
    }
  });

  /* ---- auth ------------------------------------------------------------ */

  var boardStarted = false;

  function showAuthError(message) {
    if (!authError) return;
    authError.textContent = message;
    authError.hidden = false;
  }

  function stripAuthHash() {
    if (!global.location.hash) return;
    if (!/access_token|refresh_token|error_description|error=/.test(global.location.hash)) return;
    try {
      global.history.replaceState(null, '', global.location.pathname + global.location.search);
    } catch (e) {}
  }

  function showAuth() {
    if (global.KBSync) global.KBSync.stop();
    document.body.classList.remove('booting');
    document.body.classList.add('signed-out');
    authScreen.hidden = false;
  }

  function boardErrorHTML(err) {
    var message = err && err.message ? String(err.message) : 'Check your connection and try again.';
    message = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '' +
      '<div class="empty-board">' +
        '<h2>Can’t reach the board</h2>' +
        '<p>' + message + '</p>' +
        '<button type="button" class="btn btn-primary" id="board-retry">Retry</button>' +
      '</div>';
  }

  function showBoardError(err) {
    boardEl.innerHTML = boardErrorHTML(err);
    var retry = document.getElementById('board-retry');
    if (retry) retry.addEventListener('click', function () { global.location.reload(); });
  }

  function startBoard() {
    document.body.classList.remove('booting', 'signed-out');
    document.body.classList.add('signed-in');
    authScreen.hidden = true;
    stripAuthHash();

    if (boardStarted) {
      global.KB.reload().catch(showBoardError);
      return;
    }
    boardStarted = true;

    global.KB.init({ mount: boardEl })
      .then(function () {
        global.KBDrag.init({ board: boardEl, onChange: global.KB.reorder });

        boardEl.addEventListener('click', onBoardClick);
        boardEl.addEventListener('keydown', onBoardKeydown);

        if (global.KBSync) {
          global.KBSync.start({
            onChange: function () {
              global.KB.reload().catch(function (err) { console.error(err); });
            }
          });
        }
      })
      .catch(function (err) {
        console.error(err);
        showBoardError(err);
      });
  }

  function passwordError(err) {
    var message = err && err.message ? String(err.message) : '';
    if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
    if (/email not confirmed/i.test(message)) return 'This account is not confirmed yet. Confirm it in Supabase.';
    if (/failed to fetch|network/i.test(message)) return 'Can’t reach Supabase. Check your connection and try again.';
    return message || 'Could not sign in. Try again.';
  }

  authForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var email = (authEmail.value || '').trim();
    var password = authPassword.value || '';

    if (!email || email.indexOf('@') === -1) {
      showAuthError('Enter a valid email address.');
      return;
    }
    if (!password) {
      showAuthError('Enter your password.');
      return;
    }

    authError.hidden = true;
    authSubmit.disabled = true;
    authSubmit.textContent = 'Signing in…';

    global.KBStore.signInWithPassword(email, password)
      .then(function () {
        startBoard();
      })
      .catch(function (err) {
        showAuthError(passwordError(err));
        authPassword.value = '';
        authPassword.focus();
      })
      .then(function () {
        authSubmit.disabled = false;
        authSubmit.textContent = 'Sign in';
      });
  });

  /* ---- boot ------------------------------------------------------------ */

  function boot() {
    var theme = document.documentElement.dataset.theme;
    if (!theme) theme = 'light';
    applyTheme(theme);

    applySize(document.documentElement.dataset.size || 'large');

    global.KBStore.onAuthChange(function (event, session) {
      if (event === 'SIGNED_IN' && session && !boardStarted) startBoard();
    });

    global.KBStore.start().then(function (session) {
      if (session) startBoard();
      else showAuth();
    }).catch(function (err) {
      console.error(err);
      showAuth();
      showAuthError('Can’t reach Supabase. Check your connection and reload.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
