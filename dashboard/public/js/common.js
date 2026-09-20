/* global window, document, fetch */
'use strict';

/* ============================================================
   Gemeinsame Dashboard-Helfer
   Alles in eine IIFE gekapselt, damit KEINE globalen Namen
   ("api", "toast", ...) entstehen, die mit den Seiten-Skripten
   kollidieren würden. Nach außen nur window.Dash.
   ============================================================ */

(function () {

const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';

/** guildId aus dem Pfad /dashboard/<id>/... lesen. */
const GUILD_ID = (() => {
  const m = window.location.pathname.match(/\/dashboard\/(\d{5,25})/);
  return m ? m[1] : null;
})();

/** Optionale Seiten-Daten aus <script id="pageData">. */
const PAGE_DATA = (() => {
  const el = document.getElementById('pageData');
  if (!el) return {};
  try {
    return JSON.parse(el.textContent);
  } catch {
    return {};
  }
})();

/* ---------------- API ---------------- */

async function api(method, path, body, { timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const opts = {
    method,
    headers: { 'X-CSRF-Token': CSRF },
    signal: controller.signal,
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Zeitüberschreitung – der Server hat nicht geantwortet.');
    throw new Error('Verbindung zum Server fehlgeschlagen.');
  }
  clearTimeout(timer);

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Deine Sitzung ist abgelaufen. Bitte neu anmelden.');
    }
    throw new Error(data?.error || `Fehler ${res.status}`);
  }
  return data;
}

const apiFor = (method, subPath, body, opts) =>
  api(method, `/api/guilds/${GUILD_ID}${subPath}`, body, opts);

/* ---------------- Toast ---------------- */

function toast(message, type = 'info', timeout = 4000) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .25s ease';
    setTimeout(() => node.remove(), 250);
  }, timeout);
}

/* ---------------- DOM-Helfer ---------------- */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function fmtDate(ts) {
  if (!ts) return '–';
  const d = new Date(Number(ts));
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtRelative(ts) {
  if (!ts) return '';
  const diff = Number(ts) - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
  const units = [
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'second') {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return '';
}

function fmtDuration(ms) {
  ms = Number(ms) || 0;
  const d = Math.floor(ms / 86400000);
  const hr = Math.floor((ms % 86400000) / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (hr) parts.push(`${hr}h`);
  if (min) parts.push(`${min}m`);
  return parts.join(' ') || '0m';
}

/* ---------------- Emoji-Picker ---------------- */

const EMOJI_GROUPS = [
  ['Beliebt', ['🎫', '❓', '💬', '📩', '📝', '📋', '🔔', '⚠️', '🚨', '✅', '❌', '⭐', '🔥', '💡', '🎁', '🎉', '🏆', '🛡️', '🔒', '👑', '💰', '🤝', '❤️', '👋']],
  ['Smileys', ['😀', '😄', '😁', '😆', '😊', '🙂', '😉', '😍', '🥰', '😎', '🤩', '🥳', '🤔', '🧐', '😴', '😇', '🙃', '😜', '😅', '😂', '🤣', '😭', '😢', '😤', '😠', '😡', '🥺', '😳', '😬', '🤗', '🤝', '🙏', '👀']],
  ['Hände', ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '👐', '🤲', '💪', '✍️', '👆', '👉', '👈', '👇', '☝️', '✋', '🖐️', '🫡', '🫶']],
  ['Symbole', ['✅', '❌', '❗', '❓', '⁉️', '➕', '➖', '✖️', '➗', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🔺', '🔻', '🔶', '🔷', '💠', '♻️', '✔️', '☑️', '🔘', '🔹', '🔸', '💯', '🆗', '🆕', '🆙', '🔝', '🔞']],
  ['Objekte', ['📩', '📨', '📬', '📭', '📢', '📣', '🔔', '🔕', '📌', '📍', '🔗', '📎', '🗂️', '📁', '📂', '📄', '📃', '📑', '📊', '📈', '📉', '🗒️', '🗓️', '📅', '📆', '🧾', '💼', '🗃️', '🗄️', '📦', '✏️', '📝', '🖊️', '🖋️', '🔍', '🔎', '🔧', '🔨', '🛠️', '⚙️', '🧰', '🔑', '🗝️', '🔒', '🔓', '🛡️', '⚔️', '🚀', '🛰️', '💻', '🖥️', '⌨️', '🖱️', '💾', '💿', '📀', '🔌', '🔋', '💡', '🔦', '🕯️']],
  ['Aktivität', ['🎮', '🕹️', '🎲', '🎯', '🎰', '🎳', '♟️', '🧩', '🎨', '🎭', '🎤', '🎧', '🎵', '🎶', '🎬', '📷', '📸', '📹', '🎥', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🏸', '🥅', '⛳', '🎣', '🥊', '🥋', '🛹', '🛼']],
  ['Natur', ['🐛', '🐞', '🦋', '🐝', '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐢', '🐧', '🦅', '🦉', '🐺', '🐗', '🦄', '🌟', '⭐', '✨', '⚡', '🔥', '💥', '☄️', '🌈', '☀️', '🌙', '⛅', '☁️', '❄️', '💧', '🌊', '🍀', '🌿', '🌱', '🌳', '🌲', '🌵', '🌸', '🌺', '🌻', '🌼', '🌷', '💐']],
  ['Essen', ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🌽', '🥕', '🍞', '🧀', '🍗', '🍕', '🍔', '🌭', '🌮', '🌯', '🍜', '🍝', '🍣', '🍩', '🍪', '🎂', '🧁', '🍫', '🍬', '🍭', '☕', '🍵', '🥤', '🧃', '🍺', '🍻', '🥂', '🍷']],
  ['Herzen', ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖', '💗', '💓', '💞', '💕', '💘', '💝', '❣️', '💔', '❤️‍🔥', '💟']],
  ['Flaggen', ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🇩🇪', '🇦🇹', '🇨🇭', '🇬🇧', '🇺🇸', '🇪🇺', '🇫🇷', '🇪🇸', '🇮🇹', '🇳🇱', '🇵🇱', '🇹🇷']],
];
const EMOJI_ALL = EMOJI_GROUPS.flatMap(([, list]) => list);

function openEmojiPicker(anchorEl, onPick) {
  document.querySelectorAll('.emoji-pop').forEach((p) => p.remove());
  const groupsHtml = EMOJI_GROUPS.map(
    ([name, list]) => `<div class="emoji-pop__group" data-group="${name}">
      <div class="emoji-pop__label">${name}</div>
      <div class="emoji-pop__grid">${list.map((e) => `<button type="button" class="emoji-pop__b">${e}</button>`).join('')}</div>
    </div>`,
  ).join('');
  const pop = h(`<div class="emoji-pop">
    <div class="emoji-pop__search"><input type="text" placeholder="Emoji suchen…" autocomplete="off" /></div>
    <div class="emoji-pop__body">${groupsHtml}
      <div class="emoji-pop__group emoji-pop__results" hidden><div class="emoji-pop__grid"></div></div>
      <div class="emoji-pop__none" hidden>Nichts gefunden.</div>
    </div>
    <div class="emoji-pop__foot"><button type="button" class="emoji-pop__clear">Kein Emoji</button></div>
  </div>`);
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  const w = pop.getBoundingClientRect().width || 300;
  const vw = document.documentElement.clientWidth;
  // Rechtsbündig zum Anker ausrichten, aber im sichtbaren Bereich halten.
  let left = r.right - w;
  left = Math.max(8, Math.min(left, vw - w - 8));
  pop.style.left = `${left + window.scrollX}px`;
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', outside, true);
  };
  const outside = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorEl) close();
  };
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);

  const pick = (val) => { onPick(val); close(); };
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('.emoji-pop__b');
    if (b) pick(b.textContent);
  });
  pop.querySelector('.emoji-pop__clear').onclick = () => pick('');

  // Suche (nach Namen ist ohne Lib nicht möglich -> einfache Teilstring-Suche im Emoji selbst
  // plus vorbereitete Stichworte).
  const search = pop.querySelector('.emoji-pop__search input');
  const results = pop.querySelector('.emoji-pop__results');
  const resultsGrid = results.querySelector('.emoji-pop__grid');
  const none = pop.querySelector('.emoji-pop__none');
  const groups = [...pop.querySelectorAll('.emoji-pop__group:not(.emoji-pop__results)')];
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) {
      groups.forEach((g) => (g.hidden = false));
      results.hidden = true;
      none.hidden = true;
      return;
    }
    const hits = EMOJI_ALL.filter((e) => (EMOJI_KEYWORDS[e] || '').includes(q) || e === q);
    groups.forEach((g) => (g.hidden = true));
    resultsGrid.innerHTML = [...new Set(hits)].map((e) => `<button type="button" class="emoji-pop__b">${e}</button>`).join('');
    results.hidden = hits.length === 0;
    none.hidden = hits.length !== 0;
  });
  setTimeout(() => search.focus(), 30);
}

// Minimal-Stichworte für die Suche (nur häufige).
const EMOJI_KEYWORDS = {
  '✅': 'check haken ja ok richtig gruen', '❌': 'kreuz nein falsch rot x', '⭐': 'stern star favorit',
  '🔥': 'feuer fire hot lit', '🎉': 'party feier confetti tada', '🎁': 'geschenk gift praesent',
  '🏆': 'pokal trophy gewinner sieg', '🛡️': 'schild shield schutz', '🔒': 'schloss lock sperre',
  '👑': 'krone crown koenig admin', '💰': 'geld money geldsack', '🤝': 'handschlag deal',
  '❤️': 'herz love liebe rot', '👍': 'daumen hoch gut like ja', '👎': 'daumen runter schlecht nein',
  '🎫': 'ticket support', '❓': 'frage question hilfe', '💬': 'sprechblase chat nachricht',
  '📩': 'mail brief nachricht', '📝': 'notiz stift schreiben', '📋': 'clipboard liste bewerbung',
  '🔔': 'glocke bell benachrichtigung', '⚠️': 'warnung achtung', '🚨': 'alarm sirene notfall',
  '💡': 'idee gluehbirne lampe vorschlag', '🎮': 'controller gaming spiel', '🐛': 'bug fehler kaefer',
  '🔧': 'schraubenschluessel werkzeug fix', '⚙️': 'zahnrad einstellung settings', '🚀': 'rakete launch start',
  '🎨': 'palette kunst design farbe', '🎵': 'musik note song', '🎧': 'kopfhoerer musik',
  '😀': 'lachen smile freude', '😎': 'cool sonnenbrille', '🥳': 'party feier',
  '🤔': 'nachdenken denken hmm', '😴': 'schlafen muede', '🙏': 'danke beten bitte',
};

/**
 * Hängt an ein <input> einen Emoji-Auswahl-Button an (😀). Klick öffnet die
 * Emoji-Übersicht; die Auswahl wird in das Feld geschrieben.
 * Manuelles Tippen (auch Server-Emojis) bleibt möglich.
 */
function attachEmojiPicker(input) {
  if (!input || input.dataset.emojiReady) return;
  input.dataset.emojiReady = '1';

  const fire = () => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  // data-emoji="one" -> Feld hält genau EIN Emoji (ersetzen).
  // sonst -> Emoji an der Cursor-Position in den Text einfügen.
  const replace = input.dataset.emoji === 'one';
  const floaty = input.tagName === 'TEXTAREA';

  const wrap = h(`<div class="${floaty ? 'emoji-area' : 'emoji-input'}"></div>`);
  const btn = h(
    `<button type="button" class="emoji-add${floaty ? ' emoji-add--float' : ''}" title="Emoji ${replace ? 'wählen' : 'einfügen'}" aria-label="Emoji">😀</button>`,
  );
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  wrap.appendChild(btn);

  btn.addEventListener('click', () => {
    openEmojiPicker(btn, (val) => {
      if (replace) {
        input.value = val;
      } else {
        if (!val) return;
        const s = input.selectionStart ?? input.value.length;
        const e = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, s) + val + input.value.slice(e);
        const pos = s + val.length;
        input.focus();
        try { input.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
      }
      fire();
    });
  });
}

/** Alle statischen Felder mit [data-emoji] automatisch ausstatten. */
function initEmojiInputs(root = document) {
  root.querySelectorAll('input[data-emoji], textarea[data-emoji]').forEach(attachEmojiPicker);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initEmojiInputs());
} else {
  initEmojiInputs();
}

/* ---------------- Modal ---------------- */

function openModal(innerHtml, { onClose } = {}) {
  const root = document.getElementById('modalRoot');
  const overlay = h(`<div class="modal-overlay"><div class="modal">${innerHtml}</div></div>`);
  root.appendChild(overlay);
  let closed = false;
  const onKey = (e) => {
    // Bei mehreren übereinander liegenden Fenstern schließt Esc nur das oberste
    if (e.key === 'Escape' && root.lastElementChild === overlay) close();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (onClose) onClose();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  return { overlay, modal: overlay.querySelector('.modal'), close };
}

function confirmModal(message, { danger = false, confirmLabel = 'Bestätigen' } = {}) {
  return new Promise((resolve) => {
    const { modal, close } = openModal(`
      <h2>Bestätigen</h2>
      <p>${escapeHtml(message)}</p>
      <div class="modal__actions">
        <button class="btn btn--ghost" data-act="cancel">Abbrechen</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok">${escapeHtml(confirmLabel)}</button>
      </div>
    `, { onClose: () => resolve(false) });
    modal.querySelector('[data-act="cancel"]').onclick = close;
    modal.querySelector('[data-act="ok"]').onclick = () => {
      resolve(true); // vor close(), damit onClose nicht "false" liefert
      close();
    };
  });
}

/**
 * Eingabe-Fenster im Dashboard-Design (Ersatz für window.prompt).
 * Liefert den eingegebenen Text oder null bei Abbruch (Abbrechen, Esc, Klick daneben).
 */
function promptModal(message, { title = 'Eingabe', placeholder = '', value = '', maxLength = 200, required = true, multiline = false, confirmLabel = 'OK', hint = '' } = {}) {
  return new Promise((resolve) => {
    const attrs = `data-input maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}"`;
    const control = multiline
      ? `<textarea rows="4" ${attrs}>${escapeHtml(value)}</textarea>`
      : `<input type="text" ${attrs} value="${escapeHtml(value)}" />`;
    const { modal, close } = openModal(`
      <h2>${escapeHtml(title)}</h2>
      <form class="form" data-form>
        <div class="field">
          <label>${escapeHtml(String(message).replace(/:\s*$/, ''))}</label>
          ${control}
          ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
          <div class="field-error" data-error hidden>Bitte etwas eingeben.</div>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" data-act="cancel">Abbrechen</button>
          <button type="submit" class="btn btn--primary">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`, { onClose: () => resolve(null) });
    const field = modal.querySelector('[data-input]');
    const error = modal.querySelector('[data-error]');
    setTimeout(() => { field.focus(); field.select?.(); }, 30);
    modal.querySelector('[data-act="cancel"]').onclick = close;
    field.addEventListener('input', () => { error.hidden = true; });
    if (multiline) field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); modal.querySelector('[data-form]').requestSubmit(); } });
    modal.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = field.value.trim();
      if (required && !v) { error.hidden = false; field.focus(); return; }
      resolve(v); // vor close(), damit onClose nicht "null" liefert
      close();
    });
  });
}

/* ---------------- Channels & Roles (gecached) ---------------- */

let _channelsPromise = null;
let _rolesPromise = null;

function getChannels() {
  if (!_channelsPromise) _channelsPromise = apiFor('GET', '/channels');
  return _channelsPromise;
}
function getRoles() {
  if (!_rolesPromise) _rolesPromise = apiFor('GET', '/roles');
  return _rolesPromise;
}

/**
 * Fuellt alle <select data-type="text|category|role"> auf der Seite.
 * @param {object} selected  Map von name -> aktuell gewaehlte ID
 */
async function fillSelectors(selected = {}) {
  const selects = [...document.querySelectorAll('select[data-type]')];
  if (!selects.length) return;
  const needChannels = selects.some((s) => s.dataset.type !== 'role');
  const needRoles = selects.some((s) => s.dataset.type === 'role');

  const [channels, roles] = await Promise.all([
    needChannels ? getChannels() : null,
    needRoles ? getRoles() : null,
  ]);

  for (const sel of selects) {
    const type = sel.dataset.type;
    const current = selected[sel.name] ?? sel.dataset.value ?? sel.value ?? '';
    let options = '<option value="">— nicht gesetzt —</option>';

    if (type === 'role' && roles) {
      options += roles
        .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
        .join('');
    } else if (type === 'category' && channels) {
      options += channels.categories
        .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join('');
    } else if (type === 'voice' && channels) {
      options += (channels.voice || [])
        .map((c) => `<option value="${c.id}">🔊 ${escapeHtml(c.name)}</option>`)
        .join('');
    } else if (channels) {
      options += channels.text
        .map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`)
        .join('');
    }

    sel.innerHTML = options;
    if (current) sel.value = current;
  }
}

/**
 * Rollen-Mehrfachauswahl: <div class="rolepick"><input type="hidden" name="feld"></div>
 * Der Wert ist eine kommagetrennte Liste von Rollen-IDs. Aufrufen nach dem Befüllen des Formulars.
 */
async function renderRolePickers(root) {
  const boxes = [...(root || document).querySelectorAll('.rolepick')];
  if (!boxes.length) return;
  const roles = await getRoles();
  const byId = new Map(roles.map((r) => [r.id, r]));
  for (const box of boxes) {
    const input = box.querySelector('input[type=hidden]');
    if (!input) continue;
    const ids = String(input.value || '').split(',').map((x) => x.trim()).filter(Boolean);
    const free = roles.filter((r) => !ids.includes(r.id));
    box.querySelectorAll('.rolepick__ui').forEach((n) => n.remove());
    const ui = document.createElement('div');
    ui.className = 'rolepick__ui';
    ui.innerHTML = '<div class="rolepick__chips">' + ids.map((id) =>
      '<span class="rolepick__chip">' + escapeHtml(byId.get(id)?.name || id) +
      '<button type="button" data-rm="' + escapeHtml(id) + '" aria-label="Entfernen">×</button></span>').join('') + '</div>' +
      '<select class="rolepick__add"><option value="">＋ Rolle hinzufügen …</option>' +
      free.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.name) + '</option>').join('') + '</select>';
    box.appendChild(ui);
    const commit = (next) => {
      input.value = next.join(',');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      renderRolePickers(box.parentElement || box);
    };
    ui.querySelector('.rolepick__add').addEventListener('change', (e) => { if (e.target.value) commit([...ids, e.target.value]); });
    ui.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => commit(ids.filter((x) => x !== b.dataset.rm))));
  }
}

/* ---------------- Speicher-Leiste (ungespeicherte Änderungen) ---------------- */

/**
 * Eine gemeinsame Speicher-Leiste für die ganze Seite.
 * Beliebig viele Formulare können sich registrieren; die Leiste sammelt alle
 * ungespeicherten Bereiche und speichert/verwirft sie zusammen.
 */
const saveBar = {
  el: null,
  saveBtn: null,
  cancelBtn: null,
  hintEl: null,
  titleEl: null,
  wired: false,
  trackers: new Set(),
  ensure() {
    if (!this.el) {
      this.el = document.getElementById('saveBar');
      if (!this.el) return null;
      this.saveBtn = document.getElementById('saveBarSave');
      this.cancelBtn = document.getElementById('saveBarCancel');
      this.hintEl = this.el.querySelector('.savebar__text > span');
      this.titleEl = this.el.querySelector('.savebar__text > b');
    }
    if (!this.wired && this.saveBtn) {
      this.wired = true;
      this.saveBtn.addEventListener('click', () => this.saveAll());
      this.cancelBtn.addEventListener('click', () => this.cancelAll());
    }
    return this.el;
  },
  register(tracker) {
    // Ersetzt einen evtl. vorhandenen Tracker mit demselben Key (z. B. wenn ein
    // dynamisch neu gezeichneter Bereich sich erneut registriert) statt Leichen anzusammeln.
    if (tracker.key !== undefined) {
      for (const t of this.trackers) if (t.key === tracker.key) this.trackers.delete(t);
    }
    this.trackers.add(tracker);
    this.ensure();
  },
  unregister(tracker) {
    this.trackers.delete(tracker);
    this.refresh();
  },
  dirty() {
    return [...this.trackers].filter((t) => {
      try { return t.isDirty(); } catch { return false; }
    });
  },
  refresh() {
    if (!this.ensure()) return;
    const list = this.dirty();
    const n = list.length;
    this.el.hidden = n === 0;
    const invalid = list.some((t) => {
      try { return t.isInvalid ? t.isInvalid() : false; } catch { return false; }
    });
    this.el.classList.toggle('is-invalid', invalid);
    if (this.saveBtn) this.saveBtn.disabled = invalid;
    if (this.titleEl) this.titleEl.textContent = invalid ? 'Ungültige Eingaben' : 'Ungespeicherte Änderungen';
    if (n && this.hintEl) {
      this.hintEl.textContent = invalid
        ? 'Einige Felder haben ungültige Eingaben. Speichern ist nicht möglich.'
        : n === 1
          ? 'Nicht vergessen zu speichern.'
          : `${n} Bereiche mit ungespeicherten Änderungen.`;
    }
  },
  busy(on) {
    if (this.saveBtn) this.saveBtn.disabled = !!on;
    if (this.cancelBtn) this.cancelBtn.disabled = !!on;
    if (this.el) this.el.classList.toggle('is-busy', !!on);
  },
  async saveAll() {
    const list = this.dirty();
    if (!list.length) return;
    if (list.some((t) => t.isInvalid && t.isInvalid())) return; // ungültige Eingaben blockieren das Speichern
    this.busy(true);
    try {
      for (const t of list) {
        try { await t.save(); } catch { /* Fehler-Toast kommt aus save() */ }
      }
    } finally {
      this.busy(false);
      this.refresh();
    }
  },
  async cancelAll() {
    const list = this.dirty();
    this.busy(true);
    try {
      for (const t of list) {
        try { await t.cancel(); } catch { /* ignore */ }
      }
    } finally {
      this.busy(false);
      this.refresh();
    }
  },
};

/**
 * Beobachtet ein <form> (oder einen beliebigen Container mit z. B. [data-cf]-Feldern)
 * auf Änderungen und meldet sie an die Speicher-Leiste.
 * @param {HTMLElement} container  <form> mit name-Attributen, oder ein anderer Container
 *   zusammen mit fieldAttr (z. B. ein <div> mit [data-cf]-Feldern)
 * @param {() => Promise<void>} saveFn  wird beim Speichern aufgerufen (wirft bei Fehler)
 * @param {{extra?: () => string, reset?: () => (void|Promise), fieldAttr?: string, key?: string}} [o]
 *   extra: zusätzlicher Zustand (z. B. Checklisten außerhalb der Felder)
 *   reset: eigenes Zurücksetzen (sonst: nur Feldwerte wiederherstellen)
 *   fieldAttr: Attribut, das die Felder markiert (Standard: "name")
 *   key: eindeutiger Schlüssel für dynamisch neu gezeichnete Bereiche (Standard: container.id).
 *        Ein erneutes trackForm() mit demselben key ersetzt den alten Tracker (kein Leck bei Re-Render).
 */
function trackForm(container, saveFn, o) {
  if (!container || container.dataset.sbTracked) return;
  container.dataset.sbTracked = '1';
  const opts = o || {};
  const extra = opts.extra;
  const resetFn = opts.reset;
  const fieldAttr = opts.fieldAttr || 'name';
  const key = opts.key || container.id || undefined;
  const isForm = container.tagName === 'FORM';
  const selector = fieldAttr === 'name' ? '[name]' : `[${fieldAttr}]`;
  const fieldKey = (el) => (fieldAttr === 'name' ? el.name : el.getAttribute(fieldAttr));
  const fields = () => [...container.querySelectorAll(selector)];

  const snapshot = () => {
    const m = {};
    for (const el of fields()) {
      const k = fieldKey(el);
      if (!k) continue;
      m[k] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return JSON.stringify(m) + (extra ? '|' + extra() : '');
  };
  let clean = snapshot();

  // Pflichtfelder: [data-required] (Wert = Fehlermeldung, sonst Standardtext)
  const validate = () => {
    let invalid = false;
    container.querySelectorAll('[data-required]').forEach((el) => {
      const empty = !String(el.value || '').trim();
      const host = el.closest('.in-wrap') || el;
      let msg = host.parentElement.querySelector(':scope > .field-error');
      el.classList.toggle('is-invalid', empty);
      if (host !== el) host.classList.toggle('is-invalid', empty);
      if (empty) {
        invalid = true;
        if (!msg) {
          msg = document.createElement('div');
          msg.className = 'field-error';
          host.after(msg);
        }
        msg.textContent = el.dataset.required && el.dataset.required !== '1' ? el.dataset.required : 'Dieses Feld darf nicht leer sein.';
      } else if (msg) {
        msg.remove();
      }
    });
    return invalid;
  };
  validate();

  const restore = async () => {
    if (resetFn) { await resetFn(); return; }
    const m = JSON.parse(clean.split('|')[0]);
    for (const el of fields()) {
      const k = fieldKey(el);
      if (!k || !(k in m)) continue;
      if (el.type === 'checkbox') el.checked = m[k];
      else el.value = m[k];
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  const tracker = {
    key,
    isInvalid: validate,
    isDirty: () => snapshot() !== clean,
    save: async () => { await saveFn(); clean = snapshot(); },
    cancel: async () => { await restore(); clean = snapshot(); },
    markClean: () => { clean = snapshot(); },
  };
  saveBar.register(tracker);

  const check = () => { validate(); saveBar.refresh(); };
  container.addEventListener('input', check);
  container.addEventListener('change', check);
  if (isForm) {
    container.addEventListener('submit', (e) => { e.preventDefault(); saveBar.saveAll(); });
  }

  // Von außen (nach eigenem Speichern der Seite) aufrufbar.
  container.sbMarkClean = () => { tracker.markClean(); saveBar.refresh(); };
  return tracker;
}

/* ---------------- Sidebar (Mobile) ---------------- */

(function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const open = document.getElementById('sidebarOpen');
  const close = document.getElementById('sidebarClose');
  open?.addEventListener('click', () => sidebar.classList.add('is-open'));
  close?.addEventListener('click', () => sidebar.classList.remove('is-open'));
  // Klick außerhalb schließt die Sidebar (mobil)
  document.addEventListener('click', (e) => {
    if (
      sidebar?.classList.contains('is-open') &&
      !sidebar.contains(e.target) &&
      e.target !== open
    ) {
      sidebar.classList.remove('is-open');
    }
  });
})();

/* ---------------- Autofill unterdrücken (verhindert weiße Felder) ---------------- */

(function killAutofill() {
  const apply = (root) => {
    root.querySelectorAll('input:not([type=checkbox]):not([type=color]):not([data-autofill])').forEach((el) => {
      if (!el.getAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
      el.setAttribute('data-autofill', 'off');
    });
  };
  apply(document);
  // Auch dynamisch nachgeladene Felder abdecken
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1) apply(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();

/* ---------------- Button-Effekte (Cursor-Glow + Ripple) ---------------- */

(function initButtonFx() {
  document.addEventListener('pointermove', (e) => {
    const btn = e.target.closest?.('.btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--mx', `${e.clientX - r.left}px`);
    btn.style.setProperty('--my', `${e.clientY - r.top}px`);
  });

  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest?.('.btn');
    if (!btn || btn.disabled) return;
    const r = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(r.width, r.height);
    ripple.style.cssText = `position:absolute;border-radius:50%;pointer-events:none;z-index:2;
      width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px;
      background:radial-gradient(circle,rgba(255,255,255,.5),transparent 60%);
      transform:scale(0);opacity:.7;transition:transform .5s ease,opacity .6s ease;`;
    btn.appendChild(ripple);
    requestAnimationFrame(() => {
      ripple.style.transform = 'scale(2.4)';
      ripple.style.opacity = '0';
    });
    setTimeout(() => ripple.remove(), 650);
  });
})();

/* ---------------- Icons (Client, spiegelt dashboard/lib/icons.js) ---------------- */

const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ticket: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z"/>',
  gift: '<path d="M20 12v9H4v-9"/><rect x="2" y="7" width="20" height="5" rx="1"/><path d="M12 21V7"/>',
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h4"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="4" width="3" height="14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z"/>',
  chevron: '<path d="m15 18-6-6 6-6"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 4h6"/><circle cx="9" cy="14" r="1.2"/><circle cx="15" cy="14" r="1.2"/>',
  star: '<path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3 1.1-6.5L2.6 9.8l6.5-.9Z"/>',
  power: '<path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  scale: '<path d="M12 3v18"/><path d="M7 21h10"/><path d="m5 7 14-2"/><path d="M5 7 2 13a3 3 0 0 0 6 0Z"/><path d="m19 5-3 6a3 3 0 0 0 6 0Z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/>',
};

function icon(name, cls = '') {
  const body = ICON_PATHS[name] || ICON_PATHS.grid;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon${cls ? ' ' + cls : ''}" aria-hidden="true">${body}</svg>`;
}

/* ---------------- Formular-Helfer ---------------- */

function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  }
  return out;
}

function applyToForm(form, data) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in data)) continue;
    const val = data[el.name];
    if (el.type === 'checkbox') el.checked = Boolean(val);
    else if (val !== null && val !== undefined) el.value = val;
  }
}

/* ---------------- Modul-Status-Box (einheitlicher Aktivieren-Schalter) ---------------- */

/**
 * Zeichnet die #moduleStatus-Box. Standard-Markup:
 *   <div class="module-status" id="moduleStatus">
 *     <span class="module-status__dot"></span>
 *     <span class="module-status__text"><b id="msTitle"></b><span id="msText"></span></span>
 *     <button id="msToggle"></button>
 *   </div>
 */
function renderModuleStatus(enabled, opts = {}) {
  const box = document.getElementById(opts.statusId || 'moduleStatus');
  if (!box) return;
  box.classList.toggle('is-off', !enabled);
  box.querySelector('.module-status__text b').textContent = enabled ? 'Modul aktiviert' : 'Modul deaktiviert';
  box.querySelector('.module-status__text span').textContent = enabled
    ? opts.on || 'Dieses Modul ist aktiviert. Ein Klick auf den Button deaktiviert es.'
    : opts.off || 'Dieses Modul ist deaktiviert. Aktiviere es, damit die Funktion greift.';
  const btn = box.querySelector('button');
  btn.textContent = enabled ? 'Deaktivieren' : 'Aktivieren';
  btn.className = 'btn btn--sm ' + (enabled ? 'btn--outline-green' : 'btn--success');
}

/**
 * Verkabelt die #moduleStatus-Box mit einem guild_settings-Feld (der Normalfall).
 * @param {string} field  z.B. 'welcome_enabled'
 * @param {{on?:string, off?:string, onChange?:(enabled:boolean)=>void}} [opts]
 */
async function initModuleStatus(field, opts = {}) {
  const btn = document.getElementById('msToggle');
  if (!btn) return;
  let enabled = true;
  try {
    enabled = (await apiFor('GET', '/settings'))[field] !== 0;
  } catch {
    /* zeigt vorsichtshalber "aktiviert" */
  }
  renderModuleStatus(enabled, opts);

  btn.addEventListener('click', async () => {
    const next = !enabled;
    try {
      await apiFor('PATCH', '/settings', { [field]: next ? 1 : 0 });
      enabled = next;
      renderModuleStatus(enabled, opts);
      toast('Gespeichert.', 'success');
      if (opts.onChange) opts.onChange(enabled);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/**
 * Formular + Aktivieren-Schalter für ein "neues Modul" (Einstellungen aus /modules/:module).
 * Felder werden über ihr name-Attribut gefüllt; Speichern läuft über die Speicher-Leiste.
 */
async function moduleForm(module, form, opts = {}) {
  let cfg = {};
  const fill = async () => {
    cfg = await apiFor('GET', '/modules/' + module);
    await fillSelectors(cfg);
    for (const el of form.elements) {
      if (!el.name || !(el.name in cfg)) continue;
      if (el.type === 'checkbox') el.checked = Boolean(cfg[el.name]);
      else el.value = cfg[el.name] ?? '';
    }
    if (document.getElementById(opts.statusId || 'moduleStatus')) renderModuleStatus(Boolean(cfg.enabled), opts);
    await renderRolePickers(form);
    form.sbMarkClean?.();
    if (opts.afterLoad) opts.afterLoad(cfg);
  };
  const save = async () => {
    try {
      cfg = await apiFor('PATCH', '/modules/' + module, readForm(form));
      toast('Gespeichert.', 'success');
      await fill();
    } catch (err) { toast(err.message, 'error'); throw err; }
  };
  await fill();
  trackForm(form, save, { reset: fill });
  const statusBox = document.getElementById(opts.statusId || 'moduleStatus');
  const btn = statusBox ? statusBox.querySelector('button') : null;
  if (btn && 'enabled' in cfg) {
    btn.addEventListener('click', async () => {
      try {
        cfg = await apiFor('PATCH', '/modules/' + module, { enabled: !cfg.enabled });
        renderModuleStatus(Boolean(cfg.enabled), opts);
        toast('Gespeichert.', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  return { get cfg() { return cfg; }, reload: fill };
}

/* ---------------- Bild-Upload (Drag & Drop) und Farbauswahl ---------------- */

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Bild hochladen -> öffentliche URL. */
function uploadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !IMAGE_TYPES.includes(file.type)) return reject(new Error('Bitte ein Bild (PNG, JPG, GIF oder WebP) wählen.'));
    if (file.size > MAX_IMAGE_BYTES) return reject(new Error('Das Bild ist zu groß (max. 8 MB).'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.onload = () => apiFor('POST', '/uploads', { data: reader.result }, { timeout: 120000 }).then((r) => resolve(r.url), (err) => {
      // Ein Reverse-Proxy (nginx) mit kleinem Limit antwortet mit einer HTML-Fehlerseite
      const m = String(err.message || '');
      reject(/413|entity too large|<html/i.test(m) ? new Error('Das Bild ist für den Server zu groß. Nimm ein kleineres Bild (unter 1 MB) oder erhöhe „client_max_body_size“ in nginx.') : err);
    });
    reader.readAsDataURL(file);
  });
}

/** Ersetzt die value-Eigenschaft eines Feldes, damit Änderungen per Code (el.value = …) die Anzeige aktualisieren. */
function watchValue(input, onChange) {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); onChange(); },
  });
}
const fireInput = (el) => el.dispatchEvent(new Event('input', { bubbles: true }));

/**
 * <input data-image name="…"> wird zu einer Drop-Fläche: Bild hineinziehen, anklicken oder mit Strg+V einfügen.
 * Das Feld selbst bleibt (versteckt) bestehen und enthält die URL – bestehende Formular-Logik ändert sich nicht.
 */
function enhanceImageInput(input) {
  if (input.dataset.imageReady) return;
  input.dataset.imageReady = '1';
  input.hidden = true;

  const box = document.createElement('div');
  box.className = 'imgdrop';
  box.tabIndex = 0;
  box.innerHTML = `
    <div class="imgdrop__thumb" hidden><img alt="" /></div>
    <div class="imgdrop__text"><b></b><span>PNG, JPG, GIF oder WebP · max. 8 MB</span></div>
    <button type="button" class="btn btn--ghost btn--sm imgdrop__clear" hidden>Entfernen</button>
    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden />`;
  input.insertAdjacentElement('afterend', box);
  const fileInput = box.querySelector('input[type=file]');
  const thumb = box.querySelector('.imgdrop__thumb');
  const img = thumb.querySelector('img');
  const title = box.querySelector('.imgdrop__text b');
  const clear = box.querySelector('.imgdrop__clear');

  const refresh = () => {
    const url = input.value.trim();
    const has = /^https?:\/\//i.test(url);
    thumb.hidden = !has;
    clear.hidden = !has;
    if (has) img.src = url;
    title.textContent = has ? 'Bild ersetzen: hierher ziehen oder klicken' : 'Bild hierher ziehen oder klicken';
  };
  watchValue(input, refresh);

  const setBusy = (busy) => { box.classList.toggle('is-busy', busy); if (busy) title.textContent = 'Wird hochgeladen …'; else refresh(); };
  const handle = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadImage(file);
      input.value = url; // löst refresh aus
      fireInput(input);
      toast('Bild hochgeladen.', 'success');
    } catch (e) { toast(e.message || 'Upload fehlgeschlagen.', 'error'); }
    setBusy(false);
  };

  box.addEventListener('click', (e) => { if (!e.target.closest('.imgdrop__clear')) fileInput.click(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { handle(fileInput.files[0]); fileInput.value = ''; });
  clear.addEventListener('click', (e) => { e.stopPropagation(); input.value = ''; fireInput(input); });
  ['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.remove('is-over'); }));
  box.addEventListener('drop', (e) => handle([...(e.dataTransfer?.files || [])].find((f) => IMAGE_TYPES.includes(f.type)) || e.dataTransfer?.files?.[0]));
  box.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); handle(f); } });
  refresh();
}

const COLOR_PRESETS = ['#5865f2', '#7c5cff', '#3498db', '#1abc9c', '#57f287', '#fee75c', '#f26522', '#ed4245', '#eb459e', '#9b59b6', '#ffffff', '#2b2d31'];
const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/**
 * <input data-color name="…"> bekommt eine Farbauswahl (Farbfeld + Schnellwahl); das Textfeld mit dem Hex-Wert bleibt bestehen.
 * Optional: data-color-default="#5865f2" (Farbe, die das Farbfeld bei leerem Wert zeigt).
 */
function enhanceColorInput(input) {
  if (input.dataset.colorReady) return;
  input.dataset.colorReady = '1';
  const fallback = input.dataset.colorDefault || '#5865f2';

  const wrap = document.createElement('div');
  wrap.className = 'colorpick';
  input.insertAdjacentElement('beforebegin', wrap);
  const row = document.createElement('div');
  row.className = 'row-inline';
  const pick = document.createElement('input');
  pick.type = 'color';
  pick.className = 'colorpick__native';
  pick.title = 'Farbe wählen';
  row.append(pick, input);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--ghost btn--sm';
  reset.textContent = 'Standard';
  reset.title = 'Farbe zurücksetzen';
  row.append(reset);
  const sw = document.createElement('div');
  sw.className = 'colorpick__swatches';
  sw.innerHTML = COLOR_PRESETS.map((c) => `<button type="button" class="colorpick__swatch" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('');
  wrap.append(row, sw);
  if (!input.placeholder) input.placeholder = `${fallback} (leer = Standard)`;
  input.maxLength = 7;

  const norm = (v) => { const m = String(v || '').trim().match(HEX_RE); return m ? '#' + m[1].toLowerCase() : ''; };
  const refresh = () => {
    const c = norm(input.value);
    pick.value = c || fallback;
    sw.querySelectorAll('.colorpick__swatch').forEach((b) => b.classList.toggle('is-active', b.dataset.c === c));
  };
  watchValue(input, refresh);
  const set = (v) => { input.value = v; fireInput(input); };
  pick.addEventListener('input', () => set(pick.value));
  sw.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) set(b.dataset.c); });
  reset.addEventListener('click', () => set(''));
  input.addEventListener('input', refresh);
  refresh();
}

function enhanceWidgets(root) {
  (root || document).querySelectorAll('input[data-image]:not([data-image-ready])').forEach(enhanceImageInput);
  (root || document).querySelectorAll('input[data-color]:not([data-color-ready])').forEach(enhanceColorInput);
}
enhanceWidgets(document);
// Auch dynamisch erzeugte Formulare (Editoren) automatisch ausstatten
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) enhanceWidgets(n.matches?.('input') ? n.parentNode : n);
}).observe(document.body, { childList: true, subtree: true });

window.Dash = {
  promptModal,
  uploadImage,
  enhanceWidgets,
  moduleForm,
  renderRolePickers,
  api,
  apiFor,
  toast,
  escapeHtml,
  h,
  fmtDate,
  fmtRelative,
  fmtDuration,
  openModal,
  confirmModal,
  openEmojiPicker,
  attachEmojiPicker,
  initEmojiInputs,
  trackForm,
  saveBar,
  getChannels,
  getRoles,
  fillSelectors,
  readForm,
  applyToForm,
  initModuleStatus,
  renderModuleStatus,
  icon,
  GUILD_ID,
  PAGE_DATA,
};

})();
