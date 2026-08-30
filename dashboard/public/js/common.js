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

function openModal(innerHtml) {
  const root = document.getElementById('modalRoot');
  const overlay = h(`<div class="modal-overlay"><div class="modal">${innerHtml}</div></div>`);
  root.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  });
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
    `);
    modal.querySelector('[data-act="cancel"]').onclick = () => {
      close();
      resolve(false);
    };
    modal.querySelector('[data-act="ok"]').onclick = () => {
      close();
      resolve(true);
    };
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
    const current = selected[sel.name] ?? sel.dataset.value ?? '';
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

window.Dash = {
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
  getChannels,
  getRoles,
  fillSelectors,
  readForm,
  applyToForm,
  icon,
  GUILD_ID,
  PAGE_DATA,
};

})();
