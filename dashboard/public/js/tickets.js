/* global document, window, Dash */
'use strict';

const {
  apiFor, escapeHtml, fmtDate, icon,
  getChannels, getRoles, openModal, confirmModal, toast,
  fillSelectors, readForm,
} = Dash;

const esc = escapeHtml;
const num = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

let settings = {};
let CH = { categories: [], text: [] };
let ROLES = [];
let currentStatus = '';

const IX = document.getElementById('ticketsIndex');
const ED = document.getElementById('ticketsEditor');

/* ================= HTML-Bausteine ================= */

function optList(list, val, prefix = '') {
  return (
    '<option value="">— nicht gesetzt —</option>' +
    list.map((x) => `<option value="${x.id}"${String(val) === String(x.id) ? ' selected' : ''}>${prefix}${esc(x.name)}</option>`).join('')
  );
}

/** Eingabe mit Zeichenzähler ("14 / 50"). attr = "name" oder "data-cf" … */
function counted(name, value, max, { area = false, req = '', attr = 'name', ph = '' } = {}) {
  const v = String(value ?? '');
  const reqAttr = req ? ` data-required="${esc(req)}"` : '';
  const tag = area
    ? `<textarea ${attr}="${name}" maxlength="${max}" rows="3" placeholder="${esc(ph)}"${reqAttr}>${esc(v)}</textarea>`
    : `<input ${attr}="${name}" value="${esc(v)}" maxlength="${max}" placeholder="${esc(ph)}"${reqAttr}>`;
  return `<div class="in-wrap${area ? ' in-wrap--area' : ''}">${tag}<span class="in-count">${v.length} / ${max}</span></div>`;
}

function wireCounters(root) {
  root.querySelectorAll('.in-wrap').forEach((wrap) => {
    const inp = wrap.querySelector('input, textarea');
    const cnt = wrap.querySelector('.in-count');
    if (!inp || !cnt) return;
    const max = inp.maxLength;
    inp.addEventListener('input', () => { cnt.textContent = `${inp.value.length} / ${max}`; });
  });
}

/** Zahlenfeld mit − / + (z. B. Stunden). */
function stepper(attr, name, value, { min = 0, max = 720 } = {}) {
  return `<div class="stepper-bar"><button type="button" data-step="-1" aria-label="weniger">−</button><input ${attr}="${name}" data-min="${min}" data-max="${max}" inputmode="numeric" value="${value}"><button type="button" data-step="1" aria-label="mehr">+</button></div>`;
}

function wireSteppers(root) {
  root.querySelectorAll('.stepper-bar').forEach((bar) => {
    const inp = bar.querySelector('input');
    const clamp = () => {
      inp.value = Math.min(num(inp.dataset.max, 720), Math.max(num(inp.dataset.min, 0), num(inp.value, num(inp.dataset.min, 0))));
    };
    bar.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      inp.value = num(inp.value, 0) + Number(b.dataset.step);
      clamp();
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    inp.addEventListener('change', clamp);
  });
}

/** Schalter-Block: Titel, Beschreibung, darunter der Schalter (+ optionale Zusatzfelder). */
function switchBlock(title, desc, attr, name, checked, extra = '') {
  return `<div class="set-block">
    <div class="set-block__title">${title}</div>
    <div class="set-block__desc">${desc}</div>
    <label class="toggle"><input type="checkbox" ${attr}="${name}"${checked ? ' checked' : ''}><span class="toggle__track"></span></label>
    ${extra}
  </div>`;
}

/** [data-showif="feldname"]-Bereiche nur zeigen, solange der Schalter an ist. */
function wireShowIf(root) {
  root.querySelectorAll('[data-showif]').forEach((el) => {
    const key = el.dataset.showif;
    const sw = root.querySelector(`[name="${key}"], [data-cf="${key}"]`);
    if (!sw) return;
    const sync = () => { el.hidden = !sw.checked; };
    sw.addEventListener('change', sync);
    sync();
  });
}

function wireAll(root) {
  wireCounters(root);
  wireSteppers(root);
  wireShowIf(root);
  Dash.initEmojiInputs?.(root);
}

const colorHex = (c) => (/^#?[0-9a-f]{6}$/i.test(c || '') ? (String(c)[0] === '#' ? c : '#' + c) : '#7c5cff');

/** Embed-Editor (Titel, Beschreibung; Farbe, Bilder und Fußzeile ausklappbar). */
function embedBlock(prefix, e, { footer = false } = {}) {
  const col = colorHex(e.color);
  return `<div class="embed-edit">
    <div class="embed-edit__bar" data-bar="${prefix}" style="background:${col}"></div>
    <div class="embed-edit__body">
      <div class="embed-edit__row">${counted(prefix + '_title', e.title, 256, { ph: 'Titel' })}</div>
      <div class="embed-edit__row">${counted(prefix + '_description', e.description, 4000, { area: true, ph: 'Beschreibung' })}</div>
      <details class="embed-edit__more">
        <summary>${icon('edit', 'icon--sm')} Farbe, Bilder${footer ? ' &amp; Fußzeile' : ''} bearbeiten</summary>
        <div class="fgrid fgrid--2">
          <div class="field"><label>Farbe</label><div class="row-inline"><input type="color" data-colorfor="${prefix}_color" value="${col}" style="max-width:70px;"><input name="${prefix}_color" value="${esc(e.color || '')}" placeholder="#7c5cff (leer = Standard)" maxlength="7"></div></div>
          ${footer ? `<div class="field"><label>Fußzeile</label>${counted(prefix + '_footer', e.footer, 2048)}</div>` : '<div></div>'}
        </div>
        <div class="fgrid fgrid--2">
          <div class="field"><label>Bild (groß)</label><input name="${prefix}_image" data-image value="${esc(e.image || '')}"></div>
          <div class="field"><label>Vorschaubild (klein)</label><input name="${prefix}_thumb" data-image value="${esc(e.thumb || '')}"></div>
        </div>
      </details>
    </div>
  </div>`;
}

function wireEmbedColors(root) {
  root.querySelectorAll('[data-colorfor]').forEach((pick) => {
    const text = root.querySelector(`[name="${pick.dataset.colorfor}"]`);
    const bar = root.querySelector(`[data-bar="${pick.dataset.colorfor.replace(/_color$/, '')}"]`);
    pick.addEventListener('input', () => {
      text.value = pick.value;
      if (bar) bar.style.background = pick.value;
      text.dispatchEvent(new Event('input', { bubbles: true }));
    });
    text.addEventListener('input', () => {
      if (/^#?[0-9a-f]{6}$/i.test(text.value.trim())) {
        pick.value = colorHex(text.value.trim());
        if (bar) bar.style.background = pick.value;
      }
    });
  });
}

const readEmbed = (f, prefix, footer = false) => ({
  title: f[prefix + '_title'].value,
  description: f[prefix + '_description'].value,
  color: f[prefix + '_color'].value.trim(),
  image: f[prefix + '_image'].value.trim(),
  thumb: f[prefix + '_thumb'].value.trim(),
  ...(footer ? { footer: f[prefix + '_footer'].value } : {}),
});

/* ================= Automationen (Panel + Kategorie) ================= */

const AUTO_ITEMS = [
  ['autoClose', 'Auto-Close aktivieren?', 'Aktiviere, dass nach einer bestimmten Zeit das Ticket geschlossen wird, wenn es inaktiv ist.', true],
  ['autoAlert', 'Auto-Alert aktivieren?', 'Aktiviere, dass nach einer bestimmten Zeit der Ersteller des Tickets markiert wird, wenn das Ticket inaktiv ist.', true],
  ['autoTeamAlert', 'Auto-Team-Alert aktivieren?', 'Aktiviere, dass nach einer bestimmten Zeit das Teammitglied des Tickets markiert, und nach der selben Zeit unclaimed wird, wenn das Ticket inaktiv ist.', true],
  ['autoUnclaim', 'Auto-Unclaim aktivieren?', 'Aktiviere, dass nach einer bestimmten Zeit das Ticket freigegeben wird, wenn es inaktiv ist.', true],
  ['closeUnresponsive', 'Ticket automatisch schließen, wenn der Ersteller nicht reagiert?', 'Aktiviere, dass das Ticket geschlossen wird, wenn der Ersteller nach dem Auto-Alert nicht reagiert ist.', true],
  ['autoClaim', 'Auto-Claim aktivieren?', 'Aktiviere, dass das Ticket automatisch geclaimed wird, wenn ein Teammitglied eine Nachricht schreibt.', false],
  ['closeAfterRequest', 'Ticket automatisch schließen nach Close-Request?', 'Aktiviere, dass das Ticket direkt geschlossen wird, wenn die Close-Request abgeschlossen ist.', false],
];

function autoControls(prefix, auto) {
  return AUTO_ITEMS.map(([key, title, desc, timed]) => {
    if (!timed) return switchBlock(title, desc, 'name', `${prefix}_${key}`, Boolean(auto[key]));
    const a = auto[key] || { enabled: false, hours: 12 };
    const extra = `<div class="set-sub" data-showif="${prefix}_${key}_enabled">
      <div class="set-block__desc">Zeit in Stunden, nach der die Aktion ausgelöst wird</div>
      ${stepper('name', `${prefix}_${key}_hours`, a.hours, { min: 1, max: 720 })}
    </div>`;
    return switchBlock(title, desc, 'name', `${prefix}_${key}_enabled`, Boolean(a.enabled), extra);
  }).join('');
}

function readAuto(f, prefix) {
  const out = {};
  for (const [key, , , timed] of AUTO_ITEMS) {
    out[key] = timed
      ? { enabled: f[`${prefix}_${key}_enabled`].checked, hours: num(f[`${prefix}_${key}_hours`].value, 12) }
      : f[`${prefix}_${key}`].checked;
  }
  return out;
}

/* ================= Modul-Status ================= */

function renderModule() {
  const on = settings.tickets_enabled !== 0;
  const box = document.getElementById('moduleStatus');
  box.classList.toggle('is-off', !on);
  document.getElementById('msTitle').textContent = on ? 'Modul aktiviert' : 'Modul deaktiviert';
  document.getElementById('msText').textContent = on
    ? 'Aktuell ist dieses Modul aktiviert. Durch einen Klick auf den Button wird das Modul wieder deaktiviert.'
    : 'Aktuell ist dieses Modul deaktiviert. Aktiviere es, damit Nutzer Tickets erstellen können.';
  const btn = document.getElementById('msToggle');
  btn.textContent = on ? 'Deaktivieren' : 'Aktivieren';
  btn.className = 'btn btn--sm ' + (on ? 'btn--outline-green' : 'btn--success');
}

document.getElementById('msToggle').addEventListener('click', async () => {
  try {
    settings = await apiFor('PATCH', '/settings', { tickets_enabled: settings.tickets_enabled !== 0 ? 0 : 1 });
    renderModule();
    toast('Gespeichert.', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

/* ================= Panel-Grid ================= */

function panelTile(p) {
  return `
  <div class="tile" data-open="${p.id}">
    <span class="tile__name">${esc(p.name)}</span>
    ${p.message_id ? '' : '<span class="tile__badge">Entwurf</span>'}
    <span class="tile__ico">${icon('edit', 'icon--sm')}</span>
  </div>`;
}

async function loadPanels() {
  const grid = document.getElementById('panelGrid');
  grid.innerHTML = '<div class="loading">Lädt…</div>';
  try {
    const panels = await apiFor('GET', '/ticket-panels');
    window.__panels = panels;
    grid.className = 'tile-grid';
    grid.innerHTML =
      panels.map(panelTile).join('') +
      `<div class="tile tile--add" data-new><span class="tile__name">Neues Panel erstellen</span><span class="tile__ico">${icon('plus', 'icon--sm')}</span></div>`;
  } catch (e) {
    grid.className = '';
    grid.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

document.getElementById('panelGrid').addEventListener('click', (e) => {
  if (e.target.closest('[data-new]')) return newPanel();
  const el = e.target.closest('[data-open]');
  if (el) openEditor(Number(el.dataset.open));
});

document.getElementById('newPanelBtn').addEventListener('click', newPanel);

function newPanel() {
  const { modal, close } = openModal(`
    <h2>Neues Ticket-Panel</h2>
    <form id="npForm" class="form">
      <div class="field"><label>Interner Name</label><input name="name" required placeholder="z. B. Haupt-Support" /></div>
      <div class="field"><label>Embed-Titel</label><input name="title" value="🎫 Support" /></div>
      <div class="field"><label>Embed-Text</label><textarea name="description" rows="2">Brauchst du Hilfe? Erstelle hier ein Ticket und unser Team hilft dir.</textarea></div>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-x>Abbrechen</button>
        <button type="submit" class="btn btn--primary">Erstellen</button>
      </div>
    </form>`);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#npForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Dash.readForm(ev.target);
    try {
      const p = await apiFor('POST', '/ticket-panels', d);
      close();
      await loadPanels();
      openEditor(p.id);
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ================= Panel-Editor ================= */

const TABS = [
  ['allgemein', 'Allgemeines', 'settings'],
  ['embeds', 'Embeds', 'file'],
  ['kategorien', 'Kategorien', 'layers'],
  ['bewertung', 'Bewertung', 'star'],
  ['auto', 'Automationen', 'bot'],
  ['logs', 'Logs', 'file'],
  ['claim', 'Claim-Kategorie', 'hash'],
];

async function openEditor(panelId) {
  const panels = window.__panels || (await apiFor('GET', '/ticket-panels'));
  const p = panels.find((x) => x.id === panelId);
  if (!p) return;
  window.__panel = p;

  IX.hidden = true;
  ED.hidden = false;
  window.scrollTo(0, 0);
  window.location.hash = 'panel-' + panelId;

  ED.innerHTML = `
    <div class="editor-head">
      <h1>Ticket-Panel <span class="pill-badge" id="edName">${esc(p.name)}</span></h1>
      <div class="editor-head__actions">
        <button class="btn btn--danger btn--icon" id="edDelete" title="Panel löschen">${icon('trash', 'icon--sm')}</button>
        <button class="btn btn--outline btn--icon" id="edBack" title="Zurück">${icon('chevron', 'icon--sm')}</button>
      </div>
    </div>

    <div class="card" id="edHeadCard">
      <div class="col-2">
        <div class="field field--counter">
          <label>Name <span class="req">*</span></label><small>Name, wie das Panel heißen soll</small>
          ${counted('edPName', p.name, 50, { req: 'Der Name darf nicht leer sein.', attr: 'data-pf' })}
        </div>
        <div class="field">
          <label>Kanal <span class="req">*</span></label><small>Kanal, in dem die Panel-Nachricht gesendet wird</small>
          <select id="edChannel">${optList(CH.text, p.channel_id, '#')}</select>
        </div>
      </div>
      <div class="row-inline" style="margin-top:6px;">
        <button class="btn btn--primary" id="edPost">${icon('send', 'icon--sm')} Panel senden</button>
        <span class="muted" id="edPostStatus"></span>
      </div>
    </div>

    <div class="editor-tabs" id="edTabs">
      ${TABS.map((t, i) => `<button class="editor-tab ${i === 0 ? 'is-active' : ''}" data-tab="${t[0]}">${icon(t[2], 'icon--sm')} ${t[1]}</button>`).join('')}
    </div>
    <div id="edBody"></div>`;

  const headCard = ED.querySelector('#edHeadCard');
  wireCounters(headCard);
  const pn = headCard.querySelector('[data-pf="edPName"]');
  Dash.trackForm(headCard, async () => {
    await savePanel({ name: pn.value.trim() }, 'Name gespeichert.');
    ED.querySelector('#edName').textContent = pn.value.trim();
  }, { fieldAttr: 'data-pf', key: 'panelHead' });

  ED.querySelector('#edBack').onclick = closeEditor;
  ED.querySelector('#edDelete').onclick = async () => {
    if (!(await confirmModal('Panel samt Kategorien löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
    await apiFor('DELETE', `/ticket-panels/${p.id}`);
    closeEditor();
    loadPanels();
  };
  ED.querySelector('#edPost').onclick = async () => {
    const channelId = ED.querySelector('#edChannel').value;
    try {
      const r = await apiFor('POST', `/ticket-panels/${p.id}/post`, channelId ? { channelId } : {});
      ED.querySelector('#edPostStatus').innerHTML = r.url ? `Aktiv – <a href="${r.url}" target="_blank" rel="noopener">zur Nachricht</a>` : 'Gesendet.';
      toast('Panel gesendet.', 'success');
      window.__panels = await apiFor('GET', '/ticket-panels');
      window.__panel = window.__panels.find((x) => x.id === p.id);
    } catch (e) { toast(e.message, 'error'); }
  };
  ED.querySelector('#edTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.editor-tab');
    if (!b) return;
    ED.querySelectorAll('#edTabs .editor-tab').forEach((t) => t.classList.remove('is-active'));
    b.classList.add('is-active');
    renderTab(b.dataset.tab);
  });

  renderTab('allgemein');
}

function closeEditor() {
  ED.hidden = true;
  IX.hidden = false;
  history.replaceState(null, '', window.location.pathname);
}

function P() { return window.__panel; }

async function savePanel(patch, msg = 'Gespeichert.') {
  try {
    const updated = await apiFor('PATCH', `/ticket-panels/${P().id}`, patch);
    window.__panel = updated;
    toast(msg, 'success');
  } catch (e) { toast(e.message, 'error'); throw e; }
}

const LEAVE = [['nothing', 'Nichts tun'], ['close', 'Ticket schließen'], ['delete', 'Ticket löschen']];
const NAME_CHIPS = ['%CASEID%', '%PREFIX%', '%USERNAME%', '%USER_ID%', '%USER_NICK_NAME%', '%DISPLAY_NAME%'];

/** Jedes Tab-Formular: Felder erfassen, in die Speicher-Leiste einhängen. */
function mountForm(body, id, saveFn) {
  const form = body.querySelector('#' + id);
  wireAll(form);
  Dash.trackForm(form, saveFn, { key: id });
  return form;
}

function renderTab(tab) {
  const p = P();
  const c = p.cfg || {};
  const body = document.getElementById('edBody');
  body.className = 'editor-panel';

  /* ---------- Allgemeines ---------- */
  if (tab === 'allgemein') {
    const layout = p.panel_layout || (p.use_select ? 'select' : 'buttons');
    body.innerHTML = `
      <form class="card" id="panelGeneralForm">
        <div class="card__head"><h2>${icon('settings')} Allgemeines</h2></div>
        ${switchBlock('Team markieren', 'Markiere das Team, wenn ein Ticket geöffnet wird', 'name', 's_team_ping', settings.ticket_team_ping !== 0)}
        <div class="set-block">
          <div class="set-block__title">Gleichzeitige Tickets-Limit</div>
          <div class="set-block__desc">Anzahl, wie viele Tickets ein Nutzer gleichzeitig offen haben kann</div>
          ${stepper('name', 's_max', settings.ticket_max_per_user ?? 1, { min: 0, max: 50 })}
        </div>
        ${switchBlock('Ticket schließen einschränken', 'Nur Teammitglieder können Tickets schließen', 'name', 's_restrict', settings.ticket_close_restricted === 1)}
        <div class="set-block">
          <div class="set-block__title">Aktion beim Verlassen</div>
          <div class="set-block__desc">Aktion, die ausgeführt wird, wenn der Ticket-Ersteller den Server verlässt</div>
          <select name="s_leave">${LEAVE.map(([v, l]) => `<option value="${v}"${(settings.ticket_on_leave || 'nothing') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        ${switchBlock('Weitere Personen hinzufügen lassen', 'Erlaube Nutzern, weitere Personen zum Ticket hinzuzufügen (/ticket add)', 'name', 'c_allowUserAdd', c.allowUserAdd)}
        <div class="set-block">
          <div class="set-block__title">Format</div>
          <div class="set-block__desc">Der Name, den das Ticket haben soll (leer = Standard der Kategorie bzw. des Servers)</div>
          <input name="c_nameFormat" value="${esc(c.nameFormat || '')}" maxlength="90" placeholder="%PREFIX%-%CASEID%">
          <div class="chip-row">${NAME_CHIPS.map((x) => `<button type="button" class="chip" data-chip="${x}">${x}</button>`).join('')}</div>
        </div>
        ${switchBlock('Ticketauslastung anzeigen', 'Steuert, ob die Anzahl an Tickets im Panel-Embed angezeigt wird', 'name', 'c_showLoad', c.showLoad)}
        <div class="set-block">
          <div class="set-block__title">Button-Text</div>
          <div class="set-block__desc">Beschriftung des Buttons bei genau einer Kategorie</div>
          <input name="buttonLabel" value="${esc(p.button_label || '')}" maxlength="60" placeholder="Ticket erstellen">
        </div>
        <div class="set-block">
          <div class="set-block__title">Darstellung</div>
          <div class="set-block__desc">Wie mehrere Kategorien im Panel gezeigt werden</div>
          <select name="layout">
            <option value="buttons"${layout === 'buttons' ? ' selected' : ''}>Nur Buttons</option>
            <option value="select"${layout === 'select' ? ' selected' : ''}>Nur Auswahlmenü</option>
            <option value="both"${layout === 'both' ? ' selected' : ''}>Buttons + Auswahlmenü</option>
          </select>
        </div>
      </form>`;
    const form = mountForm(body, 'panelGeneralForm', async () => {
      const f = form.elements;
      try {
        settings = await apiFor('PATCH', '/settings', {
          ticket_team_ping: f.s_team_ping.checked ? 1 : 0,
          ticket_max_per_user: num(f.s_max.value, 1),
          ticket_close_restricted: f.s_restrict.checked ? 1 : 0,
          ticket_on_leave: f.s_leave.value,
        });
      } catch (e) { toast(e.message, 'error'); throw e; }
      await savePanel({
        buttonLabel: f.buttonLabel.value,
        layout: f.layout.value,
        cfg: { allowUserAdd: f.c_allowUserAdd.checked, nameFormat: f.c_nameFormat.value, showLoad: f.c_showLoad.checked },
      });
    });
    form.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
      const inp = form.elements.c_nameFormat;
      inp.value = (inp.value + b.dataset.chip).slice(0, 90);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }));
  }

  /* ---------- Embeds ---------- */
  else if (tab === 'embeds') {
    const oe = c.openEmbed || {};
    body.innerHTML = `
      <form id="panelEmbedsForm">
        <div class="card">
          <div class="card__head"><h2>Panel-Embed</h2></div>
          ${embedBlock('pe', { title: p.title, description: p.description, color: p.color, image: p.image_url, thumb: p.thumbnail_url })}
        </div>
        <div class="card">
          <div class="card__head"><h2>Eröffnungs-Embed</h2></div>
          <p class="card__sub">Die Nachricht, die im neu geöffneten Ticket erscheint. Leer = Standard-Begrüßung. Platzhalter: <code>{user}</code> <code>{username}</code> <code>{number}</code> <code>{category}</code></p>
          ${embedBlock('oe', { title: oe.title, description: oe.description, color: oe.color, image: oe.imageUrl, thumb: oe.thumbnailUrl, footer: oe.footer }, { footer: true })}
        </div>
      </form>`;
    const form = mountForm(body, 'panelEmbedsForm', async () => {
      const a = readEmbed(form.elements, 'pe');
      const o = readEmbed(form.elements, 'oe', true);
      await savePanel({
        title: a.title, description: a.description, color: a.color, image_url: a.image, thumbnail_url: a.thumb,
        cfg: { openEmbed: { title: o.title, description: o.description, color: o.color, imageUrl: o.image, thumbnailUrl: o.thumb, footer: o.footer } },
      });
    });
    wireEmbedColors(form);
  }

  /* ---------- Kategorien ---------- */
  else if (tab === 'kategorien') {
    renderCategoriesTab(body);
  }

  /* ---------- Bewertung ---------- */
  else if (tab === 'bewertung') {
    const show = c.ratingShow || ['creator', 'category', 'time'];
    body.innerHTML = `
      <form class="card" id="panelRatingForm">
        <div class="card__head"><h2>Bewertung</h2></div>
        ${switchBlock('Bewertungen aktivieren', 'Ermögliche Nutzern, eine Bewertung abzugeben', 'name', 'rating_enabled', Boolean(p.rating_enabled), `
          <div class="fgrid fgrid--2" data-showif="rating_enabled" style="margin-top:14px;">
            <div class="field"><label>Kanal</label><div class="field-hint">Kanal, in dem die Bewertung gesendet wird</div><select name="rating_channel_id">${optList(CH.text, p.rating_channel_id, '#')}</select></div>
            <div class="field"><label>Kanal für Öffentliche Kanal</label><div class="field-hint">Wenn ein Kanal ausgewählt ist, wird zusätzlich eine Nachricht in einen öffentlichen Kanal gesendet</div><select name="c_ratingPublicChannelId">${optList(CH.text, c.ratingPublicChannelId, '#')}</select></div>
          </div>
          <div class="field" data-showif="rating_enabled" style="margin-top:14px;">
            <label>Angezeigte Werte</label><div class="field-hint">Definiere, welche Daten in der Bewertung angezeigt werden sollen</div>
            <div class="check-row">
              ${[['creator', 'Ersteller'], ['category', 'Kategorie'], ['time', 'Bearbeitungszeit']].map(([v, l]) => `<label class="check"><input type="checkbox" name="show_${v}"${show.includes(v) ? ' checked' : ''}><span>${l}</span></label>`).join('')}
            </div>
          </div>`)}
        <p class="card__sub" style="margin-top:12px;">Ein Kommentar-Formular richtest du pro Kategorie unter „Bewertungs-Formular“ ein.</p>
      </form>`;
    const form = mountForm(body, 'panelRatingForm', async () => {
      const f = form.elements;
      await savePanel({
        rating_enabled: f.rating_enabled.checked,
        rating_channel_id: f.rating_channel_id.value,
        cfg: {
          ratingPublicChannelId: f.c_ratingPublicChannelId.value,
          ratingShow: ['creator', 'category', 'time'].filter((v) => f['show_' + v].checked),
        },
      });
    });
  }

  /* ---------- Automationen ---------- */
  else if (tab === 'auto') {
    const auto = JSON.parse(JSON.stringify(c.auto || {}));
    // Alter Wert "autoclose_hours" wird als aktive Auto-Close-Automation angezeigt
    if (!(auto.autoClose && auto.autoClose.enabled) && Number(p.autoclose_hours) > 0) {
      auto.autoClose = { enabled: true, hours: Number(p.autoclose_hours) };
    }
    body.innerHTML = `
      <form class="card" id="panelAutoForm">
        <div class="card__head"><h2>Automationen</h2></div>
        ${autoControls('pa', auto)}
      </form>`;
    const form = mountForm(body, 'panelAutoForm', async () => {
      await savePanel({ autoclose_hours: 0, cfg: { auto: readAuto(form.elements, 'pa') } });
    });
  }

  /* ---------- Logs ---------- */
  else if (tab === 'logs') {
    body.innerHTML = `
      <form class="card" id="panelLogForm">
        <div class="card__head"><h2>Logs</h2></div>
        ${switchBlock('Ticket Aktivitäten loggen', 'Aktiviere, dass Ticket Aktivitäten geloggt werden', 'name', 'c_logEnabled', c.logEnabled !== false, `
          <div class="field" data-showif="c_logEnabled" style="margin-top:14px;max-width:560px;">
            <label>Kanal <span class="req">*</span></label><div class="field-hint">Kanal, in denen Änderungen an Tickets geloggt werden (leer = serverweiter Ticket-Log-Kanal)</div>
            <select name="log_channel_id">${optList(CH.text, p.log_channel_id, '#')}</select>
          </div>`)}
        ${switchBlock('Aktiviere Ticket Transkripte', 'Aktiviere, dass nach dem Schließen des Tickets ein Transskript erstellt wird (wird in den Log-Kanal gesendet)', 'name', 'c_transcripts', c.transcripts)}
      </form>`;
    const form = mountForm(body, 'panelLogForm', async () => {
      const f = form.elements;
      await savePanel({ log_channel_id: f.log_channel_id.value, cfg: { logEnabled: f.c_logEnabled.checked, transcripts: f.c_transcripts.checked } });
    });
  }

  /* ---------- Claim-Kategorie ---------- */
  else if (tab === 'claim') {
    const on = c.claimCategoryEnabled === null || c.claimCategoryEnabled === undefined ? Boolean(p.claim_category_id) : c.claimCategoryEnabled;
    body.innerHTML = `
      <form class="card" id="panelClaimForm">
        <div class="card__head"><h2>Claim-Kategorie</h2></div>
        ${switchBlock('Claim-Kategorie aktivieren', 'Verschiebe Tickets in eine andere Kategorie, sobald diese beansprucht wurden', 'name', 'c_claimCategoryEnabled', on, `
          <div class="field" data-showif="c_claimCategoryEnabled" style="margin-top:14px;max-width:560px;">
            <label>Kategorie <span class="req">*</span></label><div class="field-hint">Kategorie, in dem beanspruchte Tickets verschoben werden</div>
            <select name="claim_category_id">${optList(CH.categories, p.claim_category_id)}</select>
          </div>`)}
      </form>`;
    const form = mountForm(body, 'panelClaimForm', async () => {
      const f = form.elements;
      await savePanel({ claim_category_id: f.claim_category_id.value, cfg: { claimCategoryEnabled: f.c_claimCategoryEnabled.checked } });
    });
  }
}

async function refreshPanel() {
  window.__panel = (await apiFor('GET', '/ticket-panels')).find((x) => x.id === P().id);
}

/* ================= Kategorien ================= */

const CAT_TABS = [
  ['allgemein', 'Allgemein', 'settings'],
  ['embed', 'Eröffnungs-Embed', 'file'],
  ['open', 'Ticket-Öffnen Formular', 'plus'],
  ['close', 'Ticket-Schließen Formular', 'x'],
  ['rating', 'Bewertungs-Formular', 'star'],
  ['auto', 'Automationen', 'bot'],
];

function renderCategoriesTab(body, editCatId, sub = 'allgemein') {
  const p = P();
  const cats = p.categories || [];
  const c = cats.find((x) => String(x.id) === String(editCatId));

  if (!c) {
    const tiles =
      cats.map((k) => `
        <div class="tile" data-cat="${k.id}">
          <span class="tile__name">${k.emoji ? esc(k.emoji) + ' ' : ''}${esc(k.label)}</span>
          <span class="tile__ico">${icon('edit', 'icon--sm')}</span>
        </div>`).join('') +
      `<div class="tile tile--add" data-cat-add><span class="tile__name">Kategorie erstellen</span><span class="tile__ico">${icon('plus', 'icon--sm')}</span></div>`;
    body.innerHTML = `
      <div class="card">
        <div class="card__head"><h2>Kategorien</h2></div>
        <div class="tile-grid">${tiles}</div>
        <p class="card__sub" style="margin-top:12px;">Bei 1 Kategorie zeigt das Panel einen Button, bei mehreren mehrere Buttons (oder ein Dropdown). Wähle eine Kategorie zum Bearbeiten.</p>
      </div>`;
    body.querySelector('.tile-grid').onclick = async (e) => {
      if (e.target.closest('[data-cat-add]')) {
        const label = await Dash.promptModal('Bezeichnung der Kategorie', { title: 'Neue Kategorie', placeholder: 'z. B. Support, Bug melden', maxLength: 80, confirmLabel: 'Erstellen' });
        if (!label) return;
        try {
          const nc = await apiFor('POST', `/ticket-panels/${p.id}/categories`, { label });
          await refreshPanel();
          renderCategoriesTab(body, nc.id);
        } catch (err) { toast(err.message, 'error'); }
        return;
      }
      const t = e.target.closest('[data-cat]');
      if (t) renderCategoriesTab(body, t.dataset.cat);
    };
    return;
  }

  body.innerHTML = `
    <div class="editor-head editor-head--inner">
      <h1>Kategorie <span class="pill-badge">${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(c.label)}</span></h1>
      <div class="editor-head__actions">
        <button class="btn btn--danger btn--icon" data-cat-del="${c.id}" title="Kategorie löschen">${icon('trash', 'icon--sm')}</button>
        <button class="btn btn--outline btn--icon" data-cat-back title="Zurück">${icon('chevron', 'icon--sm')}</button>
      </div>
    </div>
    <div class="editor-tabs editor-tabs--sub" id="catTabs">
      ${CAT_TABS.map(([k, l, ic]) => `<button class="editor-tab ${k === sub ? 'is-active' : ''}" data-ctab="${k}">${icon(ic, 'icon--sm')} ${l}</button>`).join('')}
    </div>
    <div id="catBody"></div>`;

  body.querySelector('[data-cat-back]').onclick = () => renderCategoriesTab(body);
  body.querySelector('[data-cat-del]').onclick = async () => {
    if (!(await confirmModal('Kategorie löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await apiFor('DELETE', `/ticket-panels/${p.id}/categories/${c.id}`);
      await refreshPanel();
      renderCategoriesTab(body);
    } catch (err) { toast(err.message, 'error'); }
  };
  body.querySelector('#catTabs').onclick = (e) => {
    const b = e.target.closest('[data-ctab]');
    if (b) renderCategoriesTab(body, c.id, b.dataset.ctab);
  };

  renderCategorySub(body.querySelector('#catBody'), body, c, sub);
}

async function saveCategory(c, patch, msg = 'Kategorie gespeichert.') {
  try {
    await apiFor('PATCH', `/ticket-panels/${P().id}/categories/${c.id}`, patch);
    toast(msg, 'success');
    await refreshPanel();
  } catch (err) { toast(err.message, 'error'); throw err; }
}

function renderCategorySub(cb, body, c, sub) {
  const cfg = c.cfg || {};

  /* ---------- Allgemein ---------- */
  if (sub === 'allgemein') {
    cb.innerHTML = `
      <form class="card" id="catForm">
        <div class="card__head">
          <h2>Allgemein</h2>
          <label class="head-toggle"><span>Kategorie aktiv</span>
            <span class="toggle"><input type="checkbox" data-cf="enabled" ${c.enabled !== 0 ? 'checked' : ''}><span class="toggle__track"></span></span>
          </label>
        </div>

        <div class="fgrid fgrid--3">
          <div class="field"><label>Name <span class="req">*</span></label><div class="field-hint">Name der Kategorie</div>${counted('label', c.label, 25, { attr: 'data-cf', req: 'Der Name darf nicht leer sein.' })}</div>
          <div class="field"><label>Prefix <span class="req">*</span></label><div class="field-hint">Prefix, der vor dem Kanal des Tickets steht</div>${counted('prefix', c.prefix, 10, { attr: 'data-cf' })}</div>
          <div class="field">
            <label>Emote</label><div class="field-hint">Emote, der bei der Kategorie angezeigt wird</div>
            <button type="button" class="emote-btn" id="catEmoteBtn">${c.emoji ? esc(c.emoji) : '<span class="emote-btn__empty">Wählen…</span>'}</button>
            <input type="hidden" data-cf="emoji" id="catEmoteVal" value="${esc(c.emoji || '')}">
          </div>
        </div>

        <div class="fgrid fgrid--2">
          <div class="field"><label>Beschreibung</label><div class="field-hint">Beschreibung, die beim Erstellen des Tickets angezeigt wird</div>${counted('description', c.description, 100, { attr: 'data-cf' })}</div>
          <div class="field"><label>Kategorie</label><div class="field-hint">Kategorie auf dem Server, wo die Tickets erstellt werden</div><select data-cf="discordCategoryId">${optList(CH.categories, c.discord_category_id)}</select></div>
        </div>

        <div class="fgrid fgrid--2">
          <div class="field"><label>Auslastung <span class="req">*</span></label><div class="field-hint">Anzahl, wie viele Tickets offen sein müssen, damit die maximale Auslastungsgrenze erreicht wird (0 = unbegrenzt)</div>${stepper('data-cf', 'maxOpen', c.max_open || 0, { min: 0, max: 500 })}</div>
          <div class="field"><label>Rollen <span class="req">*</span></label><div class="field-hint">Rollen, die für die Tickets dieser Kategorie zuständig sind</div>
            <select data-cf="supportRoleId">${optList(ROLES, c.support_role_id)}</select>
            <div class="rolepick" style="margin-top:8px;"><input type="hidden" data-cf="cfg.supportRoleIds" value="${esc(cfg.supportRoleIds || '')}"></div>
            <div class="field-hint">Oben die Haupt-Rolle, darunter weitere Rollen.</div>
          </div>
        </div>

        <div class="fgrid fgrid--2">
          <div class="field"><label>Zusätzlich pingen</label><div class="field-hint">Weitere Rolle, die beim Öffnen erwähnt wird</div><select data-cf="pingRoleId">${optList(ROLES, c.ping_role_id)}</select></div>
          <div class="field"><label>Im Auftrag erlauben <span class="req">*</span></label><div class="field-hint">Erlaube, dass Supporter Tickets im Auftrag eines Nutzers für diese Kategorie aufmachen dürfen (<code>/ticket open</code>), obwohl diese keine Rechte drauf haben.</div>
            <label class="toggle"><input type="checkbox" data-cf="cfg.onBehalf"${cfg.onBehalf ? ' checked' : ''}><span class="toggle__track"></span></label>
          </div>
        </div>

        <div class="field">
          <label>Eröffnungs-Nachricht</label><div class="field-hint">Begrüßung im Ticket (leer = Server-Standard). Platzhalter: {user}, {number}, {category}</div>
          <textarea data-cf="welcomeMessage" rows="3">${esc(c.welcome_message || '')}</textarea>
        </div>
      </form>`;
    const form = cb.querySelector('#catForm');
    wireAll(form);
    Dash.renderRolePickers?.(form);
    const emoteBtn = cb.querySelector('#catEmoteBtn');
    emoteBtn.onclick = () => {
      Dash.openEmojiPicker(emoteBtn, (val) => {
        const hidden = cb.querySelector('#catEmoteVal');
        hidden.value = val;
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
        emoteBtn.innerHTML = val ? val : '<span class="emote-btn__empty">Wählen…</span>';
      });
    };
    Dash.trackForm(form, async () => {
      const patch = { cfg: {} };
      form.querySelectorAll('[data-cf]').forEach((el) => {
        const k = el.dataset.cf;
        const v = el.type === 'checkbox' ? el.checked : el.value;
        if (k.startsWith('cfg.')) patch.cfg[k.slice(4)] = v;
        else patch[k] = v;
      });
      patch.maxOpen = num(patch.maxOpen, 0);
      await saveCategory(c, patch);
      renderCategoriesTab(body, c.id, 'allgemein');
    }, { fieldAttr: 'data-cf', key: 'catForm' });
  }

  /* ---------- Eröffnungs-Embed (Überschreibung) ---------- */
  else if (sub === 'embed') {
    const oe = cfg.openEmbed || {};
    cb.innerHTML = `
      <form class="card" id="catEmbedForm">
        <div class="card__head"><h2>Eröffnungs-Embed</h2></div>
        ${switchBlock('Eröffnungs-Embed überschreiben?', 'Überschreibe das Eröffnungs-Embed vom Panel, und setze ein eigenes nur für diese Kategorie.', 'name', 'override', cfg.openEmbedOverride, `
          <div data-showif="override" style="margin-top:14px;">
            <p class="card__sub">Platzhalter: <code>{user}</code> <code>{username}</code> <code>{number}</code> <code>{category}</code></p>
            ${embedBlock('oe', { title: oe.title, description: oe.description, color: oe.color, image: oe.imageUrl, thumb: oe.thumbnailUrl, footer: oe.footer }, { footer: true })}
          </div>`)}
      </form>`;
    const form = mountForm(cb, 'catEmbedForm', async () => {
      const o = readEmbed(form.elements, 'oe', true);
      await saveCategory(c, {
        cfg: { openEmbedOverride: form.elements.override.checked, openEmbed: { title: o.title, description: o.description, color: o.color, imageUrl: o.image, thumbnailUrl: o.thumb, footer: o.footer } },
      });
    });
    wireEmbedColors(form);
  }

  /* ---------- Formulare (Öffnen / Schließen / Bewertung) ---------- */
  else if (sub === 'open' || sub === 'close' || sub === 'rating') {
    renderFormsSub(cb, body, c, sub);
  }

  /* ---------- Automationen (Überschreibung) ---------- */
  else if (sub === 'auto') {
    const auto = JSON.parse(JSON.stringify(cfg.auto || {}));
    cb.innerHTML = `
      <form class="card" id="catAutoForm">
        <div class="card__head"><h2>Automationen</h2></div>
        ${switchBlock('Automationen überschreiben?', 'Überschreibe die Automationen vom Panel, und setze eigene nur für diese Kategorie.', 'name', 'override', cfg.autoOverride, `
          <div data-showif="override" style="margin-top:6px;">${autoControls('ca', auto)}</div>`)}
      </form>`;
    const form = mountForm(cb, 'catAutoForm', async () => {
      await saveCategory(c, { cfg: { autoOverride: form.elements.override.checked, auto: readAuto(form.elements, 'ca') } });
    });
  }
}

/* ---------- Formular-Editor ---------- */

const Q_TYPES = [
  ['user', 'Benutzer'], ['channel', 'Kanal'], ['mentionable', 'Erwähnbar'], ['short', 'Einzeiliger Text'],
  ['paragraph', 'Mehrzeiliger Text'], ['select', 'Options-Auswahl'], ['checkbox', 'Checkbox'], ['radio', 'Radio-Auswahl'], ['role', 'Rolle'],
];
const Q_ONLY = {
  placeholder: new Set(['short', 'paragraph', 'select', 'user', 'role', 'channel', 'mentionable']),
  required: new Set(['short', 'paragraph', 'select', 'radio', 'user', 'role', 'channel', 'mentionable']),
  options: new Set(['select', 'radio']),
  limit: new Set(['short', 'paragraph']),
};
const FORM_TEXT = {
  open: ['Ticket-Öffnen Formular', 'Hat die Kategorie Felder, erscheint beim Öffnen ein Formular. Die Antworten landen im Ticket. Ohne Felder wird das Ticket sofort geöffnet.'],
  close: ['Ticket-Schließen Formular', 'Hat die Kategorie Felder, erscheint beim Schließen ein Formular. Die Antworten stehen im Schließen-Hinweis, im Log und werden am Ticket gespeichert.'],
  rating: ['Bewertungs-Formular', 'Hat die Kategorie Felder, erscheint nach der Sternebewertung ein Formular (z. B. Kommentar). Die Antworten landen in den Bewertungs-Kanälen.'],
};

function tqCard(q, i) {
  const max = q.max_length || 4000;
  const type = q.style || 'short';
  const opts = (q.options || []).map((o) => o.label).join('\n');
  return `<form class="qfield" data-q="${q.id}">
    <div class="qfield__head">
      <b>${q.label ? `${i + 1}. ${esc(q.label)}` : `${icon('alert', 'icon--sm')} N/A`}</b>
      <button type="button" class="btn btn--danger btn--icon" data-qa="del" title="Feld löschen">${icon('trash', 'icon--sm')}</button>
    </div>
    <div class="fgrid fgrid--2">
      <div class="field">
        <label>Anzeigename des Feldes <span class="req">*</span></label>
        <div class="field-hint">Name, der beim Feld angezeigt wird</div>
        ${counted('label', q.label, 45, { attr: 'data-qf', req: 'Der Name darf nicht leer sein.', ph: 'Name des Feldes' })}
      </div>
      <div class="field">
        <label>Typ des Feldes <span class="req">*</span></label>
        <div class="field-hint">Welcher Typ soll das Feld haben?</div>
        <select data-qf="style">${Q_TYPES.map(([v, l]) => `<option value="${v}"${type === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </div>
    </div>
    <div class="fgrid fgrid--2">
      <div class="field" data-qonly="placeholder">
        <label>Placeholder</label><div class="field-hint">Text, der im Feld angezeigt wird, wenn es nicht ausgefüllt ist</div>
        ${counted('placeholder', q.placeholder, 100, { attr: 'data-qf', ph: 'Placeholder' })}
      </div>
      <div class="field">
        <label>Beschreibung des Feldes</label><div class="field-hint">Beschreibung, die beim Feld angezeigt wird</div>
        ${counted('description', q.description, 100, { attr: 'data-qf', ph: 'Beschreibung des Feldes' })}
      </div>
    </div>
    <div class="field" data-qonly="options">
      <label>Optionen <span class="req">*</span></label><div class="field-hint">Eine Option pro Zeile (Auswahl: max. 25, Radio: 2 bis 10)</div>
      <textarea data-qf="options" rows="4" placeholder="Option 1&#10;Option 2">${esc(opts)}</textarea>
      ${(q.form || 'open') === 'open' ? `
      <input type="hidden" data-qf="optionEmbeds" value="${esc(JSON.stringify(q.optionEmbeds || {}))}">
      <div class="row-inline" style="margin-top:8px;">
        <button type="button" class="btn btn--outline btn--sm" data-qa="optemb">${icon('edit', 'icon--sm')} Embed pro Option</button>
        <span class="muted" data-optemb-count></span>
      </div>` : ''}
    </div>
    <div class="set-block" data-qonly="required">
      <div class="set-block__title">Erforderlich <span class="req">*</span></div>
      <div class="set-block__desc">Ist das Feld erforderlich?</div>
      <label class="toggle"><input type="checkbox" data-qf="required" ${q.required ? 'checked' : ''}><span class="toggle__track"></span></label>
    </div>
    <div class="field" data-qonly="limit">
      <div class="row-inline" style="justify-content:space-between;"><label>Zeichenlimit</label><span class="muted">0 - 4000</span></div>
      <div class="field-hint">Limit, wie viele Zeichen in das Eingabefeld dürfen</div>
      <div class="row-inline"><input type="range" data-qf="maxLength" min="1" max="4000" step="1" value="${max}" style="flex:1;"><b data-ql style="width:56px;text-align:right;">${max}</b></div>
    </div>
  </form>`;
}

/** Button „Embed pro Option“: bearbeitet das versteckte JSON-Feld, die Speicherleiste übernimmt das Speichern. */
function wireOptionEmbeds(row) {
  const hidden = row.querySelector('[data-qf="optionEmbeds"]');
  if (!hidden) return;
  const count = row.querySelector('[data-optemb-count]');
  const lines = () => row.querySelector('[data-qf="options"]').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const refresh = () => {
    const map = JSON.parse(hidden.value || '{}');
    const n = lines().filter((o) => map[o]).length;
    count.textContent = n ? `${n} Option${n === 1 ? '' : 'en'} mit eigenem Embed` : 'Noch keine eigenen Embeds';
  };
  refresh();
  row.querySelector('[data-qf="options"]').addEventListener('input', refresh);
  row.querySelector('[data-qa="optemb"]').onclick = async () => {
    const res = await Dash.optionEmbedsModal(lines(), JSON.parse(hidden.value || '{}'), {
      hint: 'Wählt jemand beim Öffnen des Tickets diese Option, erscheint ihr Embed zusätzlich im Ticket. Leer lassen = kein Embed.',
      vars: '<code>{user}</code> <code>{username}</code> <code>{number}</code> <code>{category}</code> <code>{server}</code>',
    });
    if (!res) return;
    hidden.value = JSON.stringify(res);
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    refresh();
  };
}

function applyQuestionTypes(row) {
  const type = row.querySelector('[data-qf="style"]').value;
  row.querySelectorAll('[data-qonly]').forEach((el) => { el.hidden = !Q_ONLY[el.dataset.qonly].has(type); });
}

function renderFormsSub(cb, body, c, form) {
  const p = P();
  const qs = (c.questions || []).filter((q) => (q.form || 'open') === form);
  const [title, hint] = FORM_TEXT[form];
  cb.innerHTML = `
    <div class="card" id="catFormCard">
      <div class="card__head"><h2>${title} <span class="muted">(max. 5 Felder – Discord-Limit)</span></h2></div>
      <p class="card__sub">${hint}</p>
      <div id="tqList">${qs.map((q, i) => tqCard(q, i)).join('')}</div>
      <button class="tile tile--add" id="tqAdd" style="width:100%;margin-top:4px;">
        <span class="tile__name">Feld hinzufügen</span><span class="tile__ico">${icon('plus', 'icon--sm')}</span>
      </button>
    </div>`;

  cb.querySelector('#tqAdd').onclick = async () => {
    try {
      await apiFor('POST', `/ticket-panels/${p.id}/categories/${c.id}/questions`, { label: 'Neues Feld', form });
      await refreshPanel();
      renderCategoriesTab(body, c.id, form);
    } catch (err) { toast(err.message, 'error'); }
  };

  cb.querySelectorAll('#tqList [data-q]').forEach((row) => {
    const qid = row.dataset.q;
    wireAll(row);
    applyQuestionTypes(row);
    row.querySelector('[data-qf="style"]').addEventListener('change', () => applyQuestionTypes(row));
    const slider = row.querySelector('[data-qf="maxLength"]');
    slider.addEventListener('input', () => { row.querySelector('[data-ql]').textContent = slider.value; });
    wireOptionEmbeds(row);
    Dash.trackForm(row, async () => {
      const patch = {};
      row.querySelectorAll('[data-qf]').forEach((el) => {
        patch[el.dataset.qf] = el.type === 'checkbox' ? el.checked : el.value;
      });
      if (patch.optionEmbeds !== undefined) patch.optionEmbeds = JSON.parse(patch.optionEmbeds || '{}');
      try {
        await apiFor('PATCH', `/ticket-panels/${p.id}/categories/${c.id}/questions/${qid}`, patch);
        toast('Feld gespeichert.', 'success');
        await refreshPanel();
      } catch (err) { toast(err.message, 'error'); throw err; }
    }, { fieldAttr: 'data-qf', key: 'q-' + qid });
  });

  cb.querySelector('#tqList').onclick = async (e) => {
    const btn = e.target.closest('button[data-qa="del"]');
    if (!btn) return;
    const qid = btn.closest('[data-q]').dataset.q;
    try {
      if (!(await confirmModal('Feld löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
      await apiFor('DELETE', `/ticket-panels/${p.id}/categories/${c.id}/questions/${qid}`);
      await refreshPanel();
      renderCategoriesTab(body, c.id, form);
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ================= Ticket-Liste ================= */

const SB = {
  open: '<span class="badge badge--open">Offen</span>',
  closed: '<span class="badge badge--closed">Geschlossen</span>',
  deleted: '<span class="badge badge--deleted">Gelöscht</span>',
};

async function loadTickets() {
  const tb = document.querySelector('#ticketsTable tbody');
  tb.innerHTML = '<tr><td colspan="6" class="loading">Lädt…</td></tr>';
  try {
    const rows = await apiFor('GET', `/tickets${currentStatus ? '?status=' + currentStatus : ''}`);
    tb.innerHTML = rows.length ? rows.map((t) => `<tr>
      <td>#${t.number ?? t.id}</td>
      <td>&lt;@${esc(t.opener_id)}&gt;</td>
      <td>${esc(t.category_label || '–')}</td>
      <td>${SB[t.status] || esc(t.status)}</td>
      <td>${t.claimed_by ? '&lt;@' + esc(t.claimed_by) + '&gt;' : '–'}</td>
      <td>${esc(fmtDate(t.created_at))}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">Keine Tickets.</td></tr>';
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="6" class="muted">${esc(e.message)}</td></tr>`;
  }
}

document.getElementById('ticketTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  document.querySelectorAll('#ticketTabs .tab').forEach((t) => t.classList.remove('is-active'));
  b.classList.add('is-active');
  currentStatus = b.dataset.status;
  loadTickets();
});

/* ================= Init ================= */

async function loadDefaults() {
  const f = document.getElementById('ticketDefaults');
  if (!f) return;
  await fillSelectors({
    ticket_category_id: settings.ticket_category_id,
    ticket_support_role_id: settings.ticket_support_role_id,
  });
  if (f.ticket_name_format) f.ticket_name_format.value = settings.ticket_name_format || 'ticket-{user}';
}

async function saveDefaults() {
  const f = document.getElementById('ticketDefaults');
  const st = document.getElementById('tdStatus');
  try {
    settings = await apiFor('PATCH', '/settings', readForm(f));
    toast('Standard-Einstellungen gespeichert.', 'success');
    st.textContent = 'Gespeichert ✓';
  } catch (err) {
    toast(err.message, 'error');
    st.textContent = err.message;
    throw err;
  }
}

async function initDefaults() {
  const f = document.getElementById('ticketDefaults');
  if (!f) return;
  await loadDefaults();
  Dash.trackForm(f, saveDefaults, { reset: loadDefaults });
}

(async function init() {
  try {
    [CH, ROLES, settings] = await Promise.all([getChannels(), getRoles(), apiFor('GET', '/settings')]);
    renderModule();
    await initDefaults();
    await loadPanels();
    await loadTickets();
    const m = window.location.hash.match(/panel-(\d+)/);
    if (m) openEditor(Number(m[1]));
  } catch (e) { toast(e.message, 'error'); }
})();
