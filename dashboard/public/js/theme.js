/* global window, document, localStorage */
'use strict';

/**
 * Farbdesign-Umschalter (oben rechts). Läuft synchron im <head>, damit die
 * gespeicherte Farbe ohne Flackern greift; die Popup-Logik startet später.
 */
(function () {
  var KEY = 'norift-theme';
  var DEFAULT_ACCENT = '#7c5cff';

  var ACCENTS = [
    '#7c5cff', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6',
    '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#d946ef',
  ];
  var MODES = {
    standard: {},
    midnight: { '--bg': '#000000', '--bg-2': '#07070b', '--surface': '#0e0e15', '--surface-2': '#161620', '--surface-3': '#20202c' },
    slate: { '--bg': '#0f1420', '--bg-2': '#141b28', '--surface': '#1b2333', '--surface-2': '#232d41', '--surface-3': '#2e3a52' },
  };
  var MODE_KEYS = Object.keys(MODES.midnight); // Spalten, die ein Modus setzt

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }
  function write(t) {
    try {
      localStorage.setItem(KEY, JSON.stringify(t));
    } catch (e) {
      /* ignore */
    }
  }

  function apply(t) {
    var r = document.documentElement;
    // Modus
    MODE_KEYS.forEach(function (k) { r.style.removeProperty(k); });
    var m = MODES[t.mode] || MODES.standard;
    Object.keys(m).forEach(function (k) { r.style.setProperty(k, m[k]); });
    // Akzent
    var acc = t.accent || DEFAULT_ACCENT;
    r.style.setProperty('--accent', acc);
    var h = acc.replace('#', '');
    if (h.length === 6) {
      var lum = (0.299 * parseInt(h.substr(0, 2), 16) + 0.587 * parseInt(h.substr(2, 2), 16) + 0.114 * parseInt(h.substr(4, 2), 16)) / 255;
      r.style.setProperty('--accent-ink', lum > 0.62 ? '#0b0c14' : '#ffffff');
    }
  }

  // Sofort anwenden (vor dem ersten Paint).
  apply(read());

  // --- Popup / Bedienung (nach dem Laden des DOM) ---
  function initUI() {
    var btn = document.getElementById('themeBtn');
    var pop = document.getElementById('themePop');
    if (!btn || !pop) return;

    var grid = document.getElementById('swatchGrid');
    var custom = document.getElementById('themeCustom');
    var modeRow = document.getElementById('modeRow');
    var reset = document.getElementById('themeReset');

    function state() { return read(); }

    function refresh() {
      var t = state();
      var acc = (t.accent || DEFAULT_ACCENT).toLowerCase();
      [].forEach.call(grid.querySelectorAll('.swatch'), function (s) {
        s.classList.toggle('is-active', s.dataset.c.toLowerCase() === acc);
      });
      if (custom) custom.value = /^#[0-9a-f]{6}$/i.test(acc) ? acc : DEFAULT_ACCENT;
      [].forEach.call(modeRow.querySelectorAll('.theme-mode'), function (b) {
        b.classList.toggle('is-active', (t.mode || 'standard') === b.dataset.mode);
      });
    }

    function setAccent(c) {
      var t = state();
      t.accent = c;
      write(t);
      apply(t);
      refresh();
    }
    function setMode(mode) {
      var t = state();
      t.mode = mode;
      write(t);
      apply(t);
      refresh();
    }

    ACCENTS.forEach(function (c) {
      var s = document.createElement('button');
      s.type = 'button';
      s.className = 'swatch';
      s.dataset.c = c;
      s.style.background = c;
      s.style.color = c; // für den aktiven Ring
      s.title = c;
      s.addEventListener('click', function () { setAccent(c); });
      grid.appendChild(s);
    });

    if (custom) {
      custom.addEventListener('input', function () { setAccent(custom.value); });
    }
    [].forEach.call(modeRow.querySelectorAll('.theme-mode'), function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });
    if (reset) {
      reset.addEventListener('click', function () {
        write({});
        apply({});
        refresh();
      });
    }

    function open() { pop.hidden = false; refresh(); }
    function close() { pop.hidden = true; }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (pop.hidden) open(); else close();
    });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
