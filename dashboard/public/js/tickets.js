/* global document, window, Dash */
'use strict';

const {
  apiFor, escapeHtml, fmtDate, icon,
  getChannels, getRoles, openModal, confirmModal, toast,
} = Dash;

let settings = {};
let CH = { categories: [], text: [] };
let ROLES = [];
let currentStatus = '';

const IX = document.getElementById('ticketsIndex');
const ED = document.getElementById('ticketsEditor');

function optList(list, val, prefix = '') {
  return (
    '<option value="">— nicht gesetzt —</option>' +
    list.map((x) => `<option value="${x.id}"${String(val) === String(x.id) ? ' selected' : ''}>${prefix}${escapeHtml(x.name)}</option>`).join('')
  );
}

function tqCard(q, i) {
  const max = q.max_length || 4000;
  return `<div class="qfield" data-q="${q.id}">
    <div class="qfield__head">
      <b>${i + 1}. ${escapeHtml(q.label || 'Neues Feld')}</b>
      <button class="btn btn--danger btn--icon" data-qa="del" title="Feld löschen">${icon('trash', 'icon--sm')}</button>
    </div>
    <div class="fgrid fgrid--2">
      <div class="field field--counter">
        <label>Anzeigename des Feldes <span class="req">*</span></label>
        <div class="field-hint">Name, der beim Feld angezeigt wird</div>
        <div class="in-wrap"><input data-qf="label" value="${escapeHtml(q.label)}" maxlength="45"><span class="in-count">${(q.label || '').length} / 45</span></div>
      </div>
      <div class="field">
        <label>Typ des Feldes <span class="req">*</span></label>
        <div class="field-hint">Kurzer oder langer Text</div>
        <select data-qf="style">
          <option value="short"${q.style === 'short' ? ' selected' : ''}>Einzeiliger Text</option>
          <option value="paragraph"${q.style === 'paragraph' ? ' selected' : ''}>Mehrzeiliger Text</option>
        </select>
      </div>
    </div>
    <div class="field field--counter">
      <label>Platzhalter</label>
      <div class="field-hint">Text, der im leeren Feld angezeigt wird</div>
      <div class="in-wrap"><input data-qf="placeholder" value="${escapeHtml(q.placeholder || '')}" maxlength="100"><span class="in-count">${(q.placeholder || '').length} / 100</span></div>
    </div>
    <div class="setting-row">
      <div class="setting-row__text"><b>Erforderlich</b><span>Muss das Feld ausgefüllt werden?</span></div>
      <label class="toggle"><input type="checkbox" data-qf="required" ${q.required ? 'checked' : ''}><span class="toggle__track"></span></label>
    </div>
    <div class="field">
      <label>Zeichenlimit</label>
      <div class="field-hint">Wie viele Zeichen maximal erlaubt sind (1–4000)</div>
      <div class="row-inline">
        <input type="range" data-qf="maxLength" min="1" max="4000" step="1" value="${max}" style="flex:1;">
        <b data-ql style="width:56px;text-align:right;">${max}</b>
      </div>
    </div>
    <div style="margin-top:12px;"><button class="btn btn--primary btn--sm" data-qa="save">${icon('check', 'icon--sm')} Feld speichern</button></div>
  </div>`;
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
    <span class="tile__name">${escapeHtml(p.name)}</span>
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
    grid.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
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

/* ================= Editor ================= */

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
      <h1>Ticket-Panel <span class="pill-badge" id="edName">${escapeHtml(p.name)}</span></h1>
      <div class="editor-head__actions">
        <button class="btn btn--danger btn--icon" id="edDelete" title="Panel löschen">${icon('trash', 'icon--sm')}</button>
        <button class="btn btn--outline btn--icon" id="edBack" title="Zurück">${icon('chevron', 'icon--sm')}</button>
      </div>
    </div>

    <div class="card">
      <div class="col-2">
        <div class="field field--counter">
          <label>Name</label><small>Name, wie das Panel heißen soll</small>
          <input id="edPName" value="${escapeHtml(p.name)}" maxlength="50" autocomplete="off" spellcheck="false" />
          <span class="char-count" id="edPNameCount">${(p.name || '').length} / 50</span>
        </div>
        <div class="field">
          <label>Kanal</label><small>Kanal, in dem die Panel-Nachricht gesendet wird</small>
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

  const pn = ED.querySelector('#edPName');
  pn.addEventListener('input', () => {
    ED.querySelector('#edPNameCount').textContent = `${pn.value.length} / 50`;
  });
  pn.addEventListener('change', () => {
    savePanel({ name: pn.value }, 'Name gespeichert.').then(() => {
      ED.querySelector('#edName').textContent = pn.value;
    });
  });

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
    ED.querySelectorAll('.editor-tab').forEach((t) => t.classList.remove('is-active'));
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
  } catch (e) { toast(e.message, 'error'); }
}
async function saveSettings(patch) {
  try { settings = await apiFor('PATCH', '/settings', patch); toast('Gespeichert.', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}

function renderTab(tab) {
  const p = P();
  const body = document.getElementById('edBody');
  body.className = 'editor-panel';

  if (tab === 'allgemein') {
    body.innerHTML = `
      <div class="card">
        <div class="card__head"><h2>${icon('settings')} Allgemeines</h2></div>
        <div class="setting-row">
          <div class="setting-row__text"><b>Team markieren</b><span>Markiere das Team, wenn ein Ticket geöffnet wird</span></div>
          <label class="toggle"><input type="checkbox" id="s_ping" ${settings.ticket_team_ping !== 0 ? 'checked' : ''}><span class="toggle__track"></span></label>
        </div>
        <div style="padding:14px 0;border-bottom:1px solid var(--line);">
          <div class="setting-row__text" style="margin-bottom:8px;"><b>Gleichzeitige Tickets-Limit</b><span>Anzahl, wie viele Tickets ein Nutzer gleichzeitig offen haben kann</span></div>
          <div class="stepper-bar"><button data-step="-1">−</button><input id="s_limit" value="${settings.ticket_max_per_user ?? 1}" /><button data-step="1">+</button></div>
        </div>
        <div class="setting-row">
          <div class="setting-row__text"><b>Ticket schließen einschränken</b><span>Nur Teammitglieder können Tickets schließen</span></div>
          <label class="toggle"><input type="checkbox" id="s_restrict" ${settings.ticket_close_restricted === 1 ? 'checked' : ''}><span class="toggle__track"></span></label>
        </div>
        <div style="padding:14px 0;">
          <div class="setting-row__text" style="margin-bottom:8px;"><b>Aktion beim Verlassen</b><span>Aktion, die ausgeführt wird, wenn der Ticket-Ersteller den Server verlässt <em>(benötigt Server-Members-Intent)</em></span></div>
          <select id="s_leave">
            <option value="nothing"${settings.ticket_on_leave === 'nothing' ? ' selected' : ''}>Nichts tun</option>
            <option value="close"${settings.ticket_on_leave === 'close' ? ' selected' : ''}>Ticket schließen</option>
            <option value="delete"${settings.ticket_on_leave === 'delete' ? ' selected' : ''}>Ticket löschen</option>
          </select>
        </div>
      </div>
      <div class="card">
        <div class="card__head"><h2>${icon('ticket')} Anzeige</h2></div>
        <div class="field"><label>Button-Text (bei genau 1 Kategorie)</label><input id="f_btn" value="${escapeHtml(p.button_label || '')}" placeholder="Ticket erstellen" /></div>
        <div class="setting-row">
          <div class="setting-row__text"><b>Auswahlmenü statt Buttons</b><span>Bei mehreren Kategorien ein Dropdown anzeigen</span></div>
          <label class="toggle"><input type="checkbox" id="f_select" ${p.use_select ? 'checked' : ''}><span class="toggle__track"></span></label>
        </div>
        <div style="margin-top:12px;"><button class="btn btn--primary btn--sm" id="f_save">Speichern</button></div>
      </div>`;
    body.querySelector('#f_save').onclick = () => savePanel({
      buttonLabel: body.querySelector('#f_btn').value,
      useSelect: body.querySelector('#f_select').checked,
    });
    body.querySelector('#s_ping').onchange = (e) => saveSettings({ ticket_team_ping: e.target.checked ? 1 : 0 });
    body.querySelector('#s_restrict').onchange = (e) => saveSettings({ ticket_close_restricted: e.target.checked ? 1 : 0 });
    body.querySelector('#s_leave').onchange = (e) => saveSettings({ ticket_on_leave: e.target.value });
    body.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
      const inp = body.querySelector('#s_limit');
      inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) + Number(b.dataset.step));
      saveSettings({ ticket_max_per_user: inp.value });
    });
  }

  else if (tab === 'embeds') {
    body.innerHTML = `
      <div class="card">
        <div class="card__head"><h2>${icon('file')} Embed</h2></div>
        <div class="form">
          <div class="field"><label>Titel</label><input id="e_title" value="${escapeHtml(p.title || '')}" /></div>
          <div class="field"><label>Text</label><textarea id="e_desc" rows="4">${escapeHtml(p.description || '')}</textarea></div>
          <div class="field"><label>Farbe</label><div class="row-inline"><input type="color" id="e_color" value="${/^#?[0-9a-f]{6}$/i.test(p.color || '') ? (p.color[0] === '#' ? p.color : '#' + p.color) : '#7c5cff'}" style="max-width:70px;"><input id="e_colortext" value="${escapeHtml(p.color || '')}" placeholder="#7c5cff (leer = Standard)"></div></div>
          <div><button class="btn btn--primary btn--sm" id="e_save">Speichern</button></div>
        </div>
      </div>`;
    body.querySelector('#e_color').oninput = (e) => { body.querySelector('#e_colortext').value = e.target.value; };
    body.querySelector('#e_save').onclick = () => savePanel({
      title: body.querySelector('#e_title').value,
      description: body.querySelector('#e_desc').value,
      color: body.querySelector('#e_colortext').value,
    });
  }

  else if (tab === 'kategorien') {
    renderCategoriesTab(body);
  }

  else if (tab === 'bewertung') {
    body.innerHTML = `
      <div class="card">
        <div class="card__head"><h2>${icon('star')} Bewertung nach Schließung</h2></div>
        <div class="setting-row">
          <div class="setting-row__text"><b>Bewertung aktivieren</b><span>Nutzer kann nach dem Schließen 1–5 Sterne vergeben</span></div>
          <label class="toggle"><input type="checkbox" id="r_on" ${p.rating_enabled ? 'checked' : ''}><span class="toggle__track"></span></label>
        </div>
        <div class="field"><label>Bewertungen posten in</label><select id="r_ch">${optList(CH.text, p.rating_channel_id, '#')}</select></div>
        <div style="margin-top:12px;"><button class="btn btn--primary btn--sm" id="r_save">Speichern</button></div>
      </div>`;
    body.querySelector('#r_save').onclick = () => savePanel({
      ratingEnabled: body.querySelector('#r_on').checked ? 1 : 0,
      rating_enabled: body.querySelector('#r_on').checked ? 1 : 0,
      rating_channel_id: body.querySelector('#r_ch').value,
    });
  }

  else if (tab === 'auto') {
    body.innerHTML = `
      <div class="card">
        <div class="card__head"><h2>${icon('bot')} Automationen</h2></div>
        <div class="field"><label>Automatisch schließen nach Inaktivität (Stunden)</label>
          <input type="number" id="a_hours" min="0" max="720" value="${p.autoclose_hours || 0}" />
          <small>0 = deaktiviert. Der Bot schließt offene Tickets ohne Nachricht nach dieser Zeit.</small>
        </div>
        <div style="margin-top:12px;"><button class="btn btn--primary btn--sm" id="a_save">Speichern</button></div>
      </div>`;
    body.querySelector('#a_save').onclick = () => savePanel({ autoclose_hours: parseInt(body.querySelector('#a_hours').value, 10) || 0 });
  }

  else if (tab === 'logs') {
    body.innerHTML = `
      <div class="card">
        <div class="card__head"><h2>${icon('file')} Panel-Logs</h2></div>
        <div class="field"><label>Eigener Log-Kanal für dieses Panel</label>
          <select id="l_ch">${optList(CH.text, p.log_channel_id, '#')}</select>
          <small>Leer = der serverweite Ticket-Log-Kanal wird verwendet.</small>
        </div>
        <div style="margin-top:12px;"><button class="btn btn--primary btn--sm" id="l_save">Speichern</button></div>
      </div>`;
    body.querySelector('#l_save').onclick = () => savePanel({ log_channel_id: body.querySelector('#l_ch').value });
  }

  else if (tab === 'claim') {
    body.innerHTML = `
      <div class="card">
        <div class="card__head"><h2>${icon('hash')} Claim-Kategorie</h2></div>
        <div class="field"><label>Übernommene Tickets verschieben nach</label>
          <select id="c_cat">${optList(CH.categories, p.claim_category_id)}</select>
          <small>Wenn ein Teammitglied ein Ticket übernimmt, wird der Kanal in diese Discord-Kategorie verschoben.</small>
        </div>
        <div style="margin-top:12px;"><button class="btn btn--primary btn--sm" id="c_save">Speichern</button></div>
      </div>`;
    body.querySelector('#c_save').onclick = () => savePanel({ claim_category_id: body.querySelector('#c_cat').value });
  }
}

async function refreshPanel() {
  window.__panel = (await apiFor('GET', '/ticket-panels')).find((x) => x.id === P().id);
}

function renderCategoriesTab(body, editCatId) {
  const p = P();
  const cats = p.categories || [];
  const tiles =
    cats.map((c) => `
      <div class="tile ${String(c.id) === String(editCatId) ? 'is-open' : ''}" data-cat="${c.id}">
        <span class="tile__name">${c.emoji ? escapeHtml(c.emoji) + ' ' : ''}${escapeHtml(c.label)}</span>
        <span class="tile__ico">${icon('edit', 'icon--sm')}</span>
      </div>`).join('') +
    `<div class="tile tile--add" data-cat-add><span class="tile__name">Kategorie erstellen</span><span class="tile__ico">${icon('plus', 'icon--sm')}</span></div>`;

  const c = cats.find((x) => String(x.id) === String(editCatId));
  const counted = (val, max) =>
    `<div class="in-wrap"><input data-cf="__F__" value="${escapeHtml(val || '')}" maxlength="${max}"><span class="in-count">${(val || '').length} / ${max}</span></div>`;

  const editor = c ? `
    <div class="editor-head" style="margin-top:16px;">
      <h1>Kategorie <span class="pill-badge">${c.emoji ? escapeHtml(c.emoji) + ' ' : ''}${escapeHtml(c.label)}</span></h1>
      <div class="editor-head__actions">
        <button class="btn btn--danger btn--icon" data-cat-del="${c.id}" title="Löschen">${icon('trash', 'icon--sm')}</button>
      </div>
    </div>
    <div class="card" id="catForm">
      <div class="card__head">
        <h2>${icon('settings')} Allgemein</h2>
        <label class="head-toggle"><span>Kategorie aktiv</span>
          <span class="toggle"><input type="checkbox" data-cf="enabled" ${c.enabled !== 0 ? 'checked' : ''}><span class="toggle__track"></span></span>
        </label>
      </div>

      <div class="fgrid fgrid--3">
        <div class="field">
          <label>Name <span class="req">*</span></label>
          <div class="field-hint">Name der Kategorie (im Panel sichtbar)</div>
          ${counted(c.label, 80).replace('__F__', 'label')}
        </div>
        <div class="field">
          <label>Prefix</label>
          <div class="field-hint">Steht vor dem Kanalnamen, z. B. <code>support</code> → support-0001</div>
          ${counted(c.prefix, 20).replace('__F__', 'prefix')}
        </div>
        <div class="field">
          <label>Emote</label>
          <div class="field-hint">Wird bei der Kategorie angezeigt</div>
          <button type="button" class="emote-btn" id="catEmoteBtn">${c.emoji ? escapeHtml(c.emoji) : '<span class="emote-btn__empty">Wählen…</span>'}</button>
          <input type="hidden" data-cf="emoji" id="catEmoteVal" value="${escapeHtml(c.emoji || '')}">
        </div>
      </div>

      <div class="fgrid fgrid--2">
        <div class="field">
          <label>Beschreibung</label>
          <div class="field-hint">Beschreibung, die beim Erstellen des Tickets angezeigt wird</div>
          ${counted(c.description, 100).replace('__F__', 'description')}
        </div>
        <div class="field">
          <label>Discord-Kategorie</label>
          <div class="field-hint">Kategorie auf dem Server, wo die Tickets erstellt werden</div>
          <select data-cf="discordCategoryId">${optList(CH.categories, c.discord_category_id)}</select>
        </div>
      </div>

      <div class="fgrid fgrid--2">
        <div class="field">
          <label>Support-Rolle</label>
          <div class="field-hint">Rolle, die für die Tickets dieser Kategorie zuständig ist</div>
          <select data-cf="supportRoleId">${optList(ROLES, c.support_role_id)}</select>
        </div>
        <div class="field">
          <label>Zusätzlich pingen</label>
          <div class="field-hint">Weitere Rolle, die beim Öffnen erwähnt wird</div>
          <select data-cf="pingRoleId">${optList(ROLES, c.ping_role_id)}</select>
        </div>
      </div>

      <div class="field">
        <label>Eröffnungs-Nachricht</label>
        <div class="field-hint">Begrüßung im Ticket (leer = Server-Standard). Platzhalter: {user}, {number}, {category}</div>
        <textarea data-cf="welcomeMessage" rows="3">${escapeHtml(c.welcome_message || '')}</textarea>
      </div>

      <div style="margin-top:16px;"><button class="btn btn--primary" data-cat-save="${c.id}">${icon('check', 'icon--sm')} Kategorie speichern</button></div>
    </div>

    <div class="card" id="catFormCard">
      <div class="card__head"><h2>${icon('file')} Ticket-Öffnen Formular <span class="muted">(max. 5 Felder – Discord-Limit)</span></h2></div>
      <p class="card__sub">Hat eine Kategorie Felder, erscheint beim Öffnen ein Formular (Discord-Modal). Die Antworten landen im Ticket. Ohne Felder wird das Ticket sofort geöffnet.</p>
      <div id="tqList">${(c.questions || []).map((q, i) => tqCard(q, i)).join('')}</div>
      <button class="tile tile--add" id="tqAdd" style="width:100%;margin-top:4px;">
        <span class="tile__name">Feld hinzufügen</span><span class="tile__ico">${icon('plus', 'icon--sm')}</span>
      </button>
    </div>` : '';

  body.innerHTML = `
    <div class="card">
      <div class="card__head"><h2>${icon('layers')} Kategorien</h2></div>
      <div class="tile-grid">${tiles}</div>
      <p class="card__sub" style="margin-top:12px;">Bei 1 Kategorie zeigt das Panel einen Button, bei mehreren mehrere Buttons (oder ein Dropdown). Wähle eine Kategorie zum Bearbeiten.</p>
    </div>
    ${editor}`;

  body.querySelectorAll('.in-wrap input').forEach((inp) => {
    const cnt = inp.parentElement.querySelector('.in-count');
    const max = inp.maxLength;
    inp.addEventListener('input', () => { cnt.textContent = `${inp.value.length} / ${max}`; });
  });

  body.querySelector('.tile-grid').onclick = async (e) => {
    if (e.target.closest('[data-cat-add]')) {
      const label = prompt('Bezeichnung (z. B. Support, Bug melden):');
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

  if (c) {
    const emoteBtn = body.querySelector('#catEmoteBtn');
    emoteBtn.onclick = () => {
      Dash.openEmojiPicker(emoteBtn, (val) => {
        body.querySelector('#catEmoteVal').value = val;
        emoteBtn.innerHTML = val ? val : '<span class="emote-btn__empty">Wählen…</span>';
      });
    };
    body.querySelector(`[data-cat-save]`).onclick = async (e) => {
      const patch = {};
      body.querySelectorAll('#catForm [data-cf]').forEach((el) => {
        patch[el.dataset.cf] = el.type === 'checkbox' ? el.checked : el.value;
      });
      const id = e.currentTarget.dataset.catSave;
      try {
        await apiFor('PATCH', `/ticket-panels/${p.id}/categories/${id}`, patch);
        toast('Kategorie gespeichert.', 'success');
        await refreshPanel();
        renderCategoriesTab(body, id);
      } catch (err) { toast(err.message, 'error'); }
    };
    body.querySelector(`[data-cat-del]`).onclick = async (e) => {
      if (!(await confirmModal('Kategorie löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
      await apiFor('DELETE', `/ticket-panels/${p.id}/categories/${e.currentTarget.dataset.catDel}`);
      await refreshPanel();
      renderCategoriesTab(body);
    };

    // Öffnen-Formular
    body.querySelector('#tqAdd').onclick = async () => {
      const label = prompt('Feldname (max. 45 Zeichen):');
      if (!label) return;
      try {
        await apiFor('POST', `/ticket-panels/${p.id}/categories/${c.id}/questions`, { label });
        await refreshPanel();
        renderCategoriesTab(body, c.id);
      } catch (err) { toast(err.message, 'error'); }
    };
    body.querySelectorAll('#tqList [data-qf="maxLength"]').forEach((slider) => {
      const out = slider.closest('.field').querySelector('[data-ql]');
      slider.addEventListener('input', () => { out.textContent = slider.value; });
    });
    body.querySelector('#tqList').onclick = async (e) => {
      const btn = e.target.closest('button[data-qa]');
      if (!btn) return;
      const row = btn.closest('[data-q]');
      const qid = row.dataset.q;
      try {
        if (btn.dataset.qa === 'save') {
          const patch = {};
          row.querySelectorAll('[data-qf]').forEach((el) => {
            patch[el.dataset.qf] = el.type === 'checkbox' ? el.checked : el.value;
          });
          await apiFor('PATCH', `/ticket-panels/${p.id}/categories/${c.id}/questions/${qid}`, patch);
          toast('Feld gespeichert.', 'success');
          await refreshPanel();
          renderCategoriesTab(body, c.id);
        } else if (btn.dataset.qa === 'del') {
          if (!(await confirmModal('Feld löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
          await apiFor('DELETE', `/ticket-panels/${p.id}/categories/${c.id}/questions/${qid}`);
          await refreshPanel();
          renderCategoriesTab(body, c.id);
        }
      } catch (err) { toast(err.message, 'error'); }
    };
  }
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
      <td>&lt;@${escapeHtml(t.opener_id)}&gt;</td>
      <td>${escapeHtml(t.category_label || '–')}</td>
      <td>${SB[t.status] || escapeHtml(t.status)}</td>
      <td>${t.claimed_by ? '&lt;@' + escapeHtml(t.claimed_by) + '&gt;' : '–'}</td>
      <td>${escapeHtml(fmtDate(t.created_at))}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">Keine Tickets.</td></tr>';
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(e.message)}</td></tr>`;
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

(async function init() {
  try {
    [CH, ROLES, settings] = await Promise.all([getChannels(), getRoles(), apiFor('GET', '/settings')]);
    renderModule();
    await loadPanels();
    await loadTickets();
    const m = window.location.hash.match(/panel-(\d+)/);
    if (m) openEditor(Number(m[1]));
  } catch (e) { toast(e.message, 'error'); }
})();
