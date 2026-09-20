/* global document, window, Dash */
'use strict';

const {
  apiFor, fillSelectors, readForm, escapeHtml, fmtDate, icon,
  getRoles, getChannels, openModal, confirmModal, toast, initEmojiInputs,
} = Dash;

const $ = (id) => document.getElementById(id);
const IX = $('appIndex');
const ED = $('appEditor');
const PE = $('panelEditor');

let settings = {};
let TYPES = [];
let PANELS = [];
let ROLES = [];
let CH = { text: [], categories: [] };

const SOURCE_LABEL = { modal: 'Discord-Fenster', dm: 'Direktnachricht', web: 'Webseite' };

const ROLE_FIELDS = [
  ['restrictedRoleIds', 'Gesperrte Rollen', 'Diese Rollen dürfen sich NICHT bewerben.', 'restrictedMode'],
  ['requiredRoleIds', 'Benötigte Rollen', 'Diese Rollen braucht man, um sich zu bewerben.', 'requiredMode'],
  ['acceptedRoleIds', 'Rollen bei Annahme', 'Diese Rollen bekommt der Bewerber, wenn er angenommen wird.'],
  ['deniedRoleIds', 'Rollen bei Ablehnung', 'Diese Rollen bekommt der Bewerber, wenn er abgelehnt wird.'],
  ['pingRoleIds', 'Ping-Rollen', 'Diese Rollen werden erwähnt, wenn eine Bewerbung eingeht.'],
  ['acceptedRemovalRoleIds', 'Rollen entfernen bei Annahme', 'Diese Rollen werden bei Annahme entfernt.'],
  ['deniedRemovalRoleIds', 'Rollen entfernen bei Ablehnung', 'Diese Rollen werden bei Ablehnung entfernt.'],
  ['pendingRoleIds', 'Rollen während der Prüfung', 'Diese Rollen bekommt der Bewerber, solange die Bewerbung offen ist.'],
  ['submitRemovalRoleIds', 'Rollen entfernen beim Einreichen', 'Diese Rollen werden beim Einreichen entfernt.'],
  ['managerRoleIds', 'Bewerbungs-Manager-Rollen', 'Diese Rollen dürfen diese Bewerbung annehmen/ablehnen und sehen den Chat.'],
];

const errMsg = (e) => (e && e.message) || 'Fehler';
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg, 'success'); return r; }
  catch (e) { toast(errMsg(e), 'error'); return null; }
}
const chName = (id) => { const c = CH.text.find((x) => x.id === id); return c ? '#' + c.name : ''; };

/* ================= Reiter ================= */

const VIEWS = { apps: 'viewApps', panels: 'viewPanels', subs: 'viewSubs', general: 'viewGeneral' };
function showView(name) {
  document.querySelectorAll('#mainTabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
  for (const [k, id] of Object.entries(VIEWS)) $(id).hidden = k !== name;
  if (name === 'apps') loadTypes();
  if (name === 'panels') loadPanels();
  if (name === 'subs') loadSubs();
}
$('mainTabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) showView(b.dataset.view); });

/* ================= Allgemein ================= */

async function loadSettings() {
  settings = await apiFor('GET', '/settings');
  await fillSelectors(settings);
  const form = $('appSettings');
  for (const k of ['application_channel_id', 'application_team_role_id', 'application_log_channel_id', 'application_chat_category_id']) {
    form.querySelector(`[name=${k}]`).value = settings[k] || '';
  }
}
async function saveSettings() {
  const a = readForm($('appSettings'));
  try {
    settings = await apiFor('PATCH', '/settings', {
      application_channel_id: a.application_channel_id, application_team_role_id: a.application_team_role_id,
      application_log_channel_id: a.application_log_channel_id, application_chat_category_id: a.application_chat_category_id,
    });
    toast('Gespeichert.', 'success');
  } catch (err) { toast(err.message, 'error'); throw err; }
}

/* ================= Bewerbungen (Liste) ================= */

function iconBtn(cls, action, id, ico, title) {
  return `<button class="btn ${cls} btn--icon" data-a="${action}" data-id="${id}" title="${title}">${icon(ico, 'icon--sm')}</button>`;
}
function typeRow(t) {
  return `<div class="list-row" data-t="${t.id}">
    <div class="list-row__head">
      <span class="list-row__title">${escapeHtml(t.emoji || '📋')} ${escapeHtml(t.name)}</span>
      <span class="badge badge--${t.enabled ? 'green' : 'red'}">${t.enabled ? 'Offen' : 'Geschlossen'}</span>
      <span class="muted">${t.questions.length} ${t.questions.length === 1 ? 'Frage' : 'Fragen'}</span>
      <div class="spacer"></div>
      <div class="list-row__actions">
        ${iconBtn('btn--outline', 'edit', t.id, 'edit', 'Bearbeiten')}
        ${iconBtn('btn--outline', 'dup', t.id, 'layers', 'Duplizieren')}
        ${iconBtn('btn--danger', 'del', t.id, 'trash', 'Löschen')}
      </div>
    </div></div>`;
}
function renderTypes() {
  const q = $('appSearch').value.trim().toLowerCase();
  const list = TYPES.filter((t) => !q || t.name.toLowerCase().includes(q));
  $('appCount').textContent = TYPES.length;
  $('appList').innerHTML = list.length ? list.map(typeRow).join('') : `<div class="empty">${icon('clipboard')}<b>Keine Bewerbungen</b>Erstelle deine erste Bewerbung mit „Neue Bewerbung“.</div>`;
}
async function loadTypes() {
  try { TYPES = await apiFor('GET', '/application-types'); renderTypes(); }
  catch (e) { $('appList').innerHTML = `<div class="empty">${escapeHtml(errMsg(e))}</div>`; }
}
$('appSearch').addEventListener('input', renderTypes);
$('appList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-a]');
  const row = e.target.closest('[data-t]');
  if (!row) return;
  const id = Number(row.dataset.t);
  if (!btn) return openEditor(id);
  if (btn.dataset.a === 'edit') return openEditor(id);
  if (btn.dataset.a === 'dup') { if (await run(() => apiFor('POST', `/application-types/${id}/duplicate`), 'Bewerbung dupliziert.')) loadTypes(); return; }
  if (btn.dataset.a === 'del') {
    if (!(await confirmModal('Bewerbung samt Fragen löschen? Bereits eingereichte Bewerbungen bleiben erhalten.', { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await run(() => apiFor('DELETE', `/application-types/${id}`), 'Bewerbung gelöscht.')) loadTypes();
  }
});
$('newAppBtn').addEventListener('click', () => {
  const { modal, close } = openModal(`
    <h2>Neue Bewerbung</h2>
    <form id="ntf" class="form">
      <div class="field"><label>Name</label><input name="name" required maxlength="80" placeholder="Support-Team" /></div>
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-x>Abbrechen</button><button class="btn btn--primary">Erstellen</button></div>
    </form>`);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#ntf').onsubmit = async (ev) => {
    ev.preventDefault();
    try { const t = await apiFor('POST', '/application-types', readForm(ev.target)); close(); toast('Bewerbung erstellt.', 'success'); await loadTypes(); openEditor(t.id); }
    catch (err) { toast(err.message, 'error'); }
  };
});

/* ================= Bewerbung bearbeiten ================= */

const VARS_HINT = 'Platzhalter: <code>{applicationName}</code> <code>{user}</code> (Bearbeiter) <code>{applicant}</code> <code>{server}</code> <code>{note}</code>';
const toggle = (name, checked) => `<label class="toggle"><input type="checkbox" name="${name}"${checked ? ' checked' : ''} /><span class="toggle__track"></span></label>`;
const settingRow = (title, text, control) => `<div class="setting-row"><div class="setting-row__text"><b>${title}</b><span>${text}</span></div>${control}</div>`;

function editorHtml(t) {
  const c = t.cfg;
  const cd = c.cooldownMin;
  return `
    <div class="editor-head">
      <h1>Bewerbung <span class="pill-badge">${escapeHtml(t.emoji || '📋')} ${escapeHtml(t.name)}</span></h1>
      <div class="editor-head__actions">
        <button class="btn btn--outline btn--icon" id="eBack" title="Zurück">${icon('chevron', 'icon--sm')}</button>
      </div>
    </div>
    <div class="tabs tabs--wrap" id="edTabs" style="margin-bottom:16px;">
      <button class="tab is-active" data-sec="all">Alle</button>
      <button class="tab" data-sec="req">Anforderungen</button>
      <button class="tab" data-sec="embed">Nachrichten</button>
      <button class="tab" data-sec="roles">Rollen</button>
      <button class="tab" data-sec="other">Sonstiges</button>
      <button class="tab" data-sec="questions">Fragen</button>
    </div>
    <form id="typeForm">
      <div class="card" data-sec="req">
        <div class="card__head"><h2>${icon('settings')} Anforderungen</h2></div>
        <div class="form">
          ${settingRow('Bewerbung geöffnet', 'Geschlossene Bewerbungen können keine Einreichungen mehr erhalten.', toggle('enabled', t.enabled))}
          <div class="col-2">
            <div class="field"><label>Name</label><input name="name" required maxlength="80" value="${escapeHtml(t.name)}" /></div>
            <div class="field"><label>Emoji</label><input name="emoji" maxlength="8" data-emoji="one" value="${escapeHtml(t.emoji || '')}" /></div>
          </div>
          <div class="field"><label>Beschreibung</label><input name="description" maxlength="100" value="${escapeHtml(t.description || '')}" /><small>Wird im Auswahlmenü des Panels angezeigt.</small></div>
          <div class="field"><label>Zeit zum Ausfüllen (Minuten)</label><input name="timeLimitMin" type="number" min="1" value="${c.timeLimitMin}" /><small>Der Bot stellt die Fragen nacheinander per Direktnachricht – beliebig viele.</small></div>
          <hr class="divider" />
          <div class="field"><label>Kanal für offene Einreichungen</label><select name="pendingChannelId" data-type="text"></select><small>Leer = Standard-Kanal aus „Allgemein“.</small></div>
          <div class="col-2">
            <div class="field"><label>Kanal für angenommene</label><select name="acceptedChannelId" data-type="text"></select><small>Leer = bleibt im Kanal der offenen Einreichungen.</small></div>
            <div class="field"><label>Kanal für abgelehnte</label><select name="deniedChannelId" data-type="text"></select><small>Leer = bleibt im Kanal der offenen Einreichungen.</small></div>
          </div>
        </div>
      </div>

      <div class="card" data-sec="embed">
        <div class="card__head"><h2>${icon('chat')} Nachrichten</h2></div>
        <div class="form">
          <p class="muted" style="margin:0;">${VARS_HINT}</p>
          <div class="col-2">
            <div class="field"><label>Nachricht bei Annahme</label><textarea name="acceptedMessage" rows="3" maxlength="1000">${escapeHtml(c.acceptedMessage)}</textarea></div>
            <div class="field"><label>Nachricht bei Ablehnung</label><textarea name="deniedMessage" rows="3" maxlength="1000">${escapeHtml(c.deniedMessage)}</textarea></div>
          </div>
          <div class="col-2">
            <div class="field"><label>Bestätigungs-Nachricht</label><textarea name="confirmationMessage" rows="4" maxlength="1500" placeholder="Leer = Standardtext („Möchtest du dich bewerben? …“)">${escapeHtml(c.confirmationMessage)}</textarea><small>Erste Nachricht, wenn jemand die Bewerbung startet.</small></div>
            <div class="field"><label>Abschluss-Nachricht</label><textarea name="completionMessage" rows="4" maxlength="1000">${escapeHtml(c.completionMessage)}</textarea><small>Wird nach dem Einreichen an den Bewerber geschickt.</small></div>
          </div>
          <hr class="divider" />
          ${settingRow('Statistiken anzeigen', 'Zeigt Methode und Ausfüllzeit in der Einreichung.', toggle('showStats', c.showStats))}
          ${settingRow('Antworten ausblenden', 'Die Antworten stehen nicht in der Discord-Nachricht, nur im Dashboard.', toggle('hideAnswers', c.hideAnswers))}
        </div>
      </div>

      <div class="card" data-sec="roles">
        <div class="card__head"><h2>${icon('shield')} Rollen</h2></div>
        <div class="form">
          ${ROLE_FIELDS.map(([key, label, hint, mode]) => `
            <div class="field"><label>${label}</label>
              ${mode ? `<select name="${mode}" style="max-width:340px;margin-bottom:6px;">${mode === 'restrictedMode' ? '<option value="all">Gesperrt, wenn er ALLE Rollen hat</option><option value="any">Gesperrt, wenn er EINE der Rollen hat</option>' : '<option value="all">Er braucht ALLE Rollen</option><option value="any">Er braucht EINE der Rollen</option>'}</select>` : ''}
              <div class="rolepick"><input type="hidden" name="${key}" value="${escapeHtml(c[key])}" /></div><small>${hint}</small></div>`).join('')}
        </div>
      </div>

      <div class="card" data-sec="other">
        <div class="card__head"><h2>${icon('layers')} Sonstiges</h2></div>
        <div class="form">
          ${settingRow('Team-Thread pro Einreichung', 'Legt an jeder Einreichung einen Thread an, in dem das Team darüber sprechen kann.', toggle('staffThreads', c.staffThreads))}
          <div class="field"><label>Wartezeit bis zur nächsten Bewerbung</label>
            <div class="col-2" style="grid-template-columns:repeat(3,1fr);">
              <div><small>Tage</small><input name="cdDays" type="number" min="0" value="${Math.floor(cd / 1440)}" /></div>
              <div><small>Stunden</small><input name="cdHours" type="number" min="0" max="23" value="${Math.floor((cd % 1440) / 60)}" /></div>
              <div><small>Minuten</small><input name="cdMins" type="number" min="0" max="59" value="${cd % 60}" /></div>
            </div><small>Wie lange ein Mitglied nach einer Einreichung warten muss. 0 = keine Wartezeit.</small></div>
          <div class="field"><label>Aktion, wenn der Bewerber den Server verlässt</label>
            <select name="onLeave"><option value="nothing">Nichts</option><option value="deny">Bewerbung ablehnen</option><option value="delete">Einreichung löschen</option></select></div>
          <hr class="divider" />
          <div class="field"><label>${icon('chat', 'icon--sm')} Kategorie für Bewerber-Chats <span class="muted">(optional)</span></label>
            <select name="chatCategoryId" data-type="category"></select>
            <small>Leer = Server-Standard (Reiter „Allgemein“), sonst Kanal ohne Kategorie.</small></div>
          ${settingRow('Chat automatisch öffnen', 'Sobald eine Bewerbung eingeht, wird sofort ein privater Chat mit dem Bewerber angelegt.', toggle('autoChat', t.auto_chat))}
        </div>
      </div>
    </form>

    <div class="card" data-sec="questions">
      <div class="card__head"><h2>${icon('clipboard')} Fragen: <span id="qCount">${t.questions.length}</span></h2><div class="spacer"></div>
        <button class="btn btn--primary btn--sm" id="qAdd">${icon('plus', 'icon--sm')} Neue Frage</button></div>
      <div id="qList"></div>
    </div>`;
}

function showSection(sec) {
  ED.querySelectorAll('#edTabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.sec === sec));
  ED.querySelectorAll('[data-sec]:not(.tab)').forEach((s) => { s.hidden = sec !== 'all' && s.dataset.sec !== sec; });
}

function typeBody(form) {
  const f = readForm(form);
  const cfg = {
    pendingChannelId: f.pendingChannelId, acceptedChannelId: f.acceptedChannelId, deniedChannelId: f.deniedChannelId,
    acceptedMessage: f.acceptedMessage, deniedMessage: f.deniedMessage, confirmationMessage: f.confirmationMessage, completionMessage: f.completionMessage,
    showStats: f.showStats, hideAnswers: f.hideAnswers, staffThreads: f.staffThreads, onLeave: f.onLeave,
    restrictedMode: f.restrictedMode, requiredMode: f.requiredMode,
    timeLimitMin: Number(f.timeLimitMin) || 180,
    cooldownMin: (Number(f.cdDays) || 0) * 1440 + (Number(f.cdHours) || 0) * 60 + (Number(f.cdMins) || 0),
  };
  for (const [key] of ROLE_FIELDS) cfg[key] = f[key];
  return { name: f.name, emoji: f.emoji, description: f.description, enabled: f.enabled, chatCategoryId: f.chatCategoryId, autoChat: f.autoChat, cfg };
}

async function openEditor(typeId) {
  TYPES = await apiFor('GET', '/application-types');
  const t = TYPES.find((x) => x.id === typeId);
  if (!t) return;
  window.__type = t;
  IX.hidden = true; PE.hidden = true; ED.hidden = false; window.scrollTo(0, 0);
  ED.innerHTML = editorHtml(t);
  initEmojiInputs(ED);
  const form = ED.querySelector('#typeForm');
  form.restrictedMode.value = t.cfg.restrictedMode; form.requiredMode.value = t.cfg.requiredMode; form.onLeave.value = t.cfg.onLeave;
  await fillSelectors({
    pendingChannelId: t.cfg.pendingChannelId, acceptedChannelId: t.cfg.acceptedChannelId, deniedChannelId: t.cfg.deniedChannelId,
    chatCategoryId: t.chat_category_id || '',
  });
  await Dash.renderRolePickers(ED);

  ED.querySelector('#eBack').onclick = () => { ED.hidden = true; IX.hidden = false; showView('apps'); };
  ED.querySelector('#edTabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) showSection(b.dataset.sec); });

  Dash.trackForm(form, async () => {
    try {
      const updated = await apiFor('PATCH', `/application-types/${t.id}`, typeBody(form));
      window.__type = updated;
      toast('Gespeichert.', 'success');
    } catch (e) { toast(errMsg(e), 'error'); throw e; }
  }, { key: 'typeForm' });

  ED.querySelector('#qAdd').onclick = async () => {
    const q = await run(() => apiFor('POST', `/application-types/${t.id}/questions`, { label: 'Neue Frage', style: 'short' }));
    if (q) { await renderQuestions(); ED.querySelector(`[data-q="${q.id}"] [data-f=label]`)?.focus(); }
  };
  showSection('all');
  renderQuestions();
}

/* ---------- Fragen ---------- */

const Q_TYPES = [['short', 'Text (kurz)'], ['paragraph', 'Text (lang)'], ['choice', 'Auswahl'], ['number', 'Zahl']];

function questionCard(q, i, total) {
  const isNum = q.style === 'number';
  return `
  <form class="card q-card" data-q="${q.id}" style="margin:0 0 12px;">
    <div class="list-row__head" style="margin-bottom:10px;">
      <span class="q-item__num">${i + 1}</span>
      <b>Frage ${i + 1}</b>
      <div class="spacer"></div>
      <select data-f="style" style="max-width:150px;">${Q_TYPES.map(([v, l]) => `<option value="${v}"${q.style === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn btn--ghost btn--sm" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="btn btn--ghost btn--sm" data-a="down" ${i === total - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="btn btn--outline btn--icon" data-a="dup" title="Duplizieren">${icon('layers', 'icon--sm')}</button>
      <button type="button" class="btn btn--danger btn--icon" data-a="del" title="Löschen">${icon('trash', 'icon--sm')}</button>
    </div>
    <div class="form">
      <div class="field"><input data-f="label" maxlength="200" value="${escapeHtml(q.label)}" placeholder="Fragetext" /></div>
      <div class="field q-opts"${q.style === 'choice' ? '' : ' hidden'}><label>Antwortmöglichkeiten (eine pro Zeile, mind. 2)</label><textarea data-f="options" rows="3">${escapeHtml((q.options || []).join('\n'))}</textarea></div>
      <details><summary style="cursor:pointer;font-weight:700;">Einstellungen</summary>
        <div class="form" style="margin-top:10px;">
          <div class="field"><label>Hilfetext (optional)</label><input data-f="description" maxlength="100" value="${escapeHtml(q.description || '')}" /></div>
          ${settingRow('Pflichtfrage', 'Ohne Antwort kann die Bewerbung nicht abgeschickt werden.', `<label class="toggle"><input type="checkbox" data-f="required"${q.required ? ' checked' : ''} /><span class="toggle__track"></span></label>`)}
          <div class="col-2 q-range">
            <div class="field"><label class="q-min">${isNum ? 'Kleinster Wert' : 'Mindestlänge'} (0 = keine)</label><input data-f="minLength" type="number" min="0" value="${q.min_length || 0}" /></div>
            <div class="field"><label class="q-max">${isNum ? 'Größter Wert' : 'Höchstlänge'} (0 = keine)</label><input data-f="maxLength" type="number" min="0" max="4000" value="${q.max_length || 0}" /></div>
          </div>
        </div>
      </details>
    </div>
  </form>`;
}

async function renderQuestions() {
  const t = window.__type;
  TYPES = await apiFor('GET', '/application-types');
  const fresh = TYPES.find((x) => x.id === t.id);
  const qs = fresh.questions;
  $('qCount').textContent = qs.length;
  const wrap = ED.querySelector('#qList');
  wrap.innerHTML = qs.length ? qs.map((q, i) => questionCard(q, i, qs.length)).join('') : `<div class="empty">${icon('clipboard')}<b>Keine Fragen</b>Füge mit „Neue Frage“ die erste hinzu.</div>`;

  wrap.querySelectorAll('[data-q]').forEach((row) => {
    const qid = row.dataset.q;
    const typeSel = row.querySelector('[data-f=style]');
    typeSel.addEventListener('change', () => {
      const s = typeSel.value;
      row.querySelector('.q-opts').hidden = s !== 'choice';
      row.querySelector('.q-min').textContent = (s === 'number' ? 'Kleinster Wert' : 'Mindestlänge') + ' (0 = keine)';
      row.querySelector('.q-max').textContent = (s === 'number' ? 'Größter Wert' : 'Höchstlänge') + ' (0 = keine)';
      const max = row.querySelector('[data-f=maxLength]');
      if (s === 'number' && Number(max.value) === 400) max.value = 0;
      if (s !== 'number' && Number(max.value) === 0) max.value = 400;
    });
    Dash.trackForm(row, async () => {
      try {
        await apiFor('PATCH', `/application-types/${t.id}/questions/${qid}`, {
          label: row.querySelector('[data-f=label]').value,
          style: typeSel.value,
          options: row.querySelector('[data-f=options]').value,
          description: row.querySelector('[data-f=description]').value,
          required: row.querySelector('[data-f=required]').checked,
          minLength: Number(row.querySelector('[data-f=minLength]').value) || 0,
          maxLength: Number(row.querySelector('[data-f=maxLength]').value) || 0,
        });
        toast('Frage gespeichert.', 'success');
      } catch (err) { toast(errMsg(err), 'error'); throw err; }
    }, { fieldAttr: 'data-f', key: 'q-' + qid });
  });

  wrap.onclick = async (e) => {
    const btn = e.target.closest('button[data-a]');
    if (!btn) return;
    const row = btn.closest('[data-q]');
    const qid = row.dataset.q;
    const idx = qs.findIndex((x) => String(x.id) === qid);
    const q = qs[idx];
    try {
      if (btn.dataset.a === 'del') {
        if (!(await confirmModal('Frage löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
        await apiFor('DELETE', `/application-types/${t.id}/questions/${qid}`);
      } else if (btn.dataset.a === 'dup') {
        const g = (f) => row.querySelector(`[data-f=${f}]`); // aktuelle Eingaben der Karte kopieren (auch ungespeicherte)
        await apiFor('POST', `/application-types/${t.id}/questions`, { label: g('label').value || q.label, style: g('style').value, required: g('required').checked, minLength: Number(g('minLength').value) || 0, maxLength: Number(g('maxLength').value) || 0, options: g('options').value, description: g('description').value });
      } else {
        const swap = btn.dataset.a === 'up' ? qs[idx - 1] : qs[idx + 1];
        // Positionen tauschen (bei gleichen Werten eindeutig machen)
        const a = idx, b = qs.indexOf(swap);
        await apiFor('PATCH', `/application-types/${t.id}/questions/${q.id}`, { position: b });
        await apiFor('PATCH', `/application-types/${t.id}/questions/${swap.id}`, { position: a });
        for (const [i, other] of qs.entries()) if (i !== a && i !== b && other.position !== i) await apiFor('PATCH', `/application-types/${t.id}/questions/${other.id}`, { position: i });
      }
      renderQuestions();
    } catch (err) { toast(errMsg(err), 'error'); }
  };
}

/* ================= Panels ================= */

async function loadPanels() {
  try {
    [PANELS, TYPES] = await Promise.all([apiFor('GET', '/application-panels'), apiFor('GET', '/application-types')]);
    $('panelCount').textContent = PANELS.length;
    $('panelList').innerHTML = PANELS.length ? PANELS.map((p) => `
      <div class="list-row" data-p="${p.id}">
        <div class="list-row__head">
          <span class="list-row__title">${escapeHtml(p.name)}</span>
          <span class="muted">${p.typeIds.length} Bewerbung${p.typeIds.length === 1 ? '' : 'en'} · ${p.panel_type === 'select' ? 'Auswahlmenü' : 'Buttons'}${p.channel_id ? ' · ' + escapeHtml(chName(p.channel_id) || 'Kanal gesetzt') : ' · kein Kanal'}</span>
          <span class="badge badge--${p.message_id ? 'green' : 'pending'}">${p.message_id ? 'Gesendet' : 'Nicht gesendet'}</span>
          <div class="spacer"></div>
          <div class="list-row__actions">
            ${iconBtn('btn--outline', 'edit', p.id, 'edit', 'Bearbeiten')}
            ${iconBtn('btn--outline', 'dup', p.id, 'layers', 'Duplizieren')}
            ${iconBtn('btn--danger', 'del', p.id, 'trash', 'Löschen')}
          </div>
        </div></div>`).join('')
      : `<div class="empty">${icon('layers')}<b>Keine Panels</b>${TYPES.length ? 'Erstelle ein Panel, um deine Bewerbungen im Server anzubieten.' : 'Erstelle zuerst mindestens eine Bewerbung.'}</div>`;
  } catch (e) { $('panelList').innerHTML = `<div class="empty">${escapeHtml(errMsg(e))}</div>`; }
}
$('panelList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-a]');
  const row = e.target.closest('[data-p]');
  if (!row) return;
  const id = Number(row.dataset.p);
  if (!btn || btn.dataset.a === 'edit') return openPanelEditor(id);
  if (btn.dataset.a === 'dup') { if (await run(() => apiFor('POST', `/application-panels/${id}/duplicate`), 'Panel dupliziert.')) loadPanels(); return; }
  if (btn.dataset.a === 'del') {
    if (!(await confirmModal('Panel löschen? Die Nachricht im Server wird ebenfalls entfernt.', { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await run(() => apiFor('DELETE', `/application-panels/${id}`), 'Panel gelöscht.')) loadPanels();
  }
});
$('newPanelBtn').addEventListener('click', async () => {
  if (!TYPES.length) return toast('Erstelle zuerst mindestens eine Bewerbung.', 'warn');
  const p = await run(() => apiFor('POST', '/application-panels', { name: 'Neues Panel' }), 'Panel erstellt.');
  if (p) openPanelEditor(p.id);
});

function panelPreview(f) {
  const color = /^#?[0-9a-fA-F]{6}$/.test(f.color) ? '#' + f.color.replace('#', '') : '#5865f2';
  const isUrl = (u) => /^https?:\/\//i.test(u || '');
  return `<div style="border-left:4px solid ${color};background:var(--bg-2);border-radius:6px;padding:10px 12px;max-width:440px;">
    <div style="display:flex;gap:12px;align-items:flex-start;">
      <div style="flex:1;min-width:0;"><b>${escapeHtml(f.title || 'Bewerbungen')}</b>
        <div style="white-space:pre-wrap;margin-top:4px;">${escapeHtml(f.description || 'Wähle eine Bewerbung, um zu beginnen!')}</div></div>
      ${isUrl(f.thumbnailUrl) ? `<img src="${escapeHtml(f.thumbnailUrl)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:6px;flex-shrink:0;" />` : ''}
    </div>
    ${isUrl(f.imageUrl) ? `<img src="${escapeHtml(f.imageUrl)}" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:6px;margin-top:10px;" />` : ''}
    ${f.footer ? `<div class="muted" style="margin-top:8px;font-size:.8rem;">${escapeHtml(f.footer)}</div>` : ''}
  </div>
  <div style="margin-top:8px;">${f.panelType === 'select'
    ? '<div style="background:var(--bg-2);border:1px solid var(--line);border-radius:6px;padding:8px 12px;max-width:440px;">Wähle eine Bewerbung …  ▾</div>'
    : `<div style="display:flex;gap:6px;flex-wrap:wrap;">${f.names.map((n) => `<span class="badge">${escapeHtml(n)}</span>`).join('') || '<span class="muted">Keine Bewerbung verknüpft</span>'}</div>`}</div>`;
}

async function openPanelEditor(panelId) {
  [PANELS, TYPES] = await Promise.all([apiFor('GET', '/application-panels'), apiFor('GET', '/application-types')]);
  const p = PANELS.find((x) => x.id === panelId);
  if (!p) return;
  IX.hidden = true; ED.hidden = true; PE.hidden = false; window.scrollTo(0, 0);
  const c = p.cfg;
  PE.innerHTML = `
    <div class="editor-head">
      <h1>Panel <span class="pill-badge">${escapeHtml(p.name)}</span></h1>
      <div class="editor-head__actions">
        <button class="btn btn--primary btn--sm" id="pSend">${icon('send', 'icon--sm')} Panel senden</button>
        <button class="btn btn--outline btn--icon" id="pBack" title="Zurück">${icon('chevron', 'icon--sm')}</button>
      </div>
    </div>
    <form id="panelForm">
      <div class="card">
        <div class="card__head"><h2>${icon('settings')} Panel-Einstellungen</h2></div>
        <div class="form">
          <div class="field"><label>Name</label><input name="name" required maxlength="80" value="${escapeHtml(p.name)}" /></div>
          <div class="field"><label>Kanal</label><select name="channelId" data-type="text"></select><small>In diesen Kanal wird das Panel gesendet.</small></div>
          <div class="field"><label>Verknüpfte Bewerbungen</label>
            ${TYPES.length ? TYPES.map((t) => `<label class="setting-row" style="cursor:pointer;"><div class="setting-row__text"><b>${escapeHtml(t.emoji || '📋')} ${escapeHtml(t.name)}</b><span>${t.enabled ? 'Offen' : 'Geschlossen – wird im Panel nicht angezeigt'}</span></div><span class="toggle"><input type="checkbox" name="t_${t.id}"${p.typeIds.includes(t.id) ? ' checked' : ''} /><span class="toggle__track"></span></span></label>`).join('') : '<div class="muted">Noch keine Bewerbungen.</div>'}
          </div>
          <div class="field"><label>Panel-Art</label><select name="panelType"><option value="buttons">Buttons (ein Button pro Bewerbung)</option><option value="select">Auswahlmenü</option></select></div>
        </div>
      </div>
      <div class="card">
        <div class="card__head"><h2>${icon('bell')} Aussehen</h2></div>
        <div class="col-2">
          <div class="form">
            <div class="field"><label>Titel</label><input name="title" maxlength="256" value="${escapeHtml(c.title)}" placeholder="Bewerbungen" /></div>
            <div class="field"><label>Beschreibung</label><textarea name="description" rows="5" maxlength="4000" placeholder="Wähle eine Bewerbung, um zu beginnen!">${escapeHtml(c.description)}</textarea></div>
            <div class="field"><label>Fußzeile</label><input name="footer" maxlength="2048" value="${escapeHtml(c.footer)}" /></div>
            <div class="field"><label>Farbe (Hex)</label><input name="color" data-color maxlength="7" value="${escapeHtml(c.color ? '#' + c.color : '')}" /></div>
            <div class="field"><label>Großes Bild</label><input name="imageUrl" data-image value="${escapeHtml(c.imageUrl)}" /></div>
            <div class="field"><label>Vorschaubild (klein)</label><input name="thumbnailUrl" data-image value="${escapeHtml(c.thumbnailUrl)}" /></div>
          </div>
          <div><h3 style="margin:0 0 8px;">Vorschau</h3><p class="muted" style="margin-top:0;">So ähnlich sieht das Panel in Discord aus (Buttons und Menü sind hier nicht klickbar).</p><div id="panelPreview"></div></div>
        </div>
      </div>
    </form>`;
  const form = PE.querySelector('#panelForm');
  form.panelType.value = p.panel_type === 'select' ? 'select' : 'buttons';
  await fillSelectors({ channelId: p.channel_id || '' });

  const collect = () => {
    const f = readForm(form);
    const typeIds = TYPES.filter((t) => f[`t_${t.id}`]).map((t) => t.id);
    return { f, typeIds, body: { name: f.name, channelId: f.channelId, typeIds, panelType: f.panelType, cfg: { title: f.title, description: f.description, footer: f.footer, color: f.color, imageUrl: f.imageUrl, thumbnailUrl: f.thumbnailUrl } } };
  };
  const drawPreview = () => {
    const { f, typeIds } = collect();
    $('panelPreview').innerHTML = panelPreview({ ...f, names: TYPES.filter((t) => typeIds.includes(t.id) && t.enabled).map((t) => `${t.emoji || '📋'} ${t.name}`) });
  };
  form.addEventListener('input', drawPreview);
  drawPreview();

  const save = async () => {
    try { await apiFor('PATCH', `/application-panels/${p.id}`, collect().body); toast('Gespeichert.', 'success'); }
    catch (e) { toast(errMsg(e), 'error'); throw e; }
  };
  Dash.trackForm(form, save, { key: 'panelForm' });
  PE.querySelector('#pBack').onclick = () => { PE.hidden = true; IX.hidden = false; showView('panels'); };
  PE.querySelector('#pSend').onclick = async () => {
    try {
      await apiFor('PATCH', `/application-panels/${p.id}`, collect().body); // aktuellen Stand zuerst sichern
      const r = await apiFor('POST', `/application-panels/${p.id}/send`);
      toast('Panel gesendet.', 'success');
      if (r.url) window.open(r.url, '_blank', 'noopener');
    } catch (e) { toast(errMsg(e), 'error'); }
  };
}

/* ================= Einreichungen ================= */

let subPage = 1;
const SB = { pending: 'badge--pending', accepted: 'badge--green', rejected: 'badge--red' };
const SL = { pending: 'Offen', accepted: 'Angenommen', rejected: 'Abgelehnt' };

function subRow(a) {
  const answers = (a.answers || []).map((x) => `<div class="list-row__meta"><span><b>${escapeHtml(x.question)}</b> — ${escapeHtml(x.answer || '—')}</span></div>`).join('');
  const dur = a.duration_ms ? ` · ${Math.max(1, Math.round(a.duration_ms / 1000))} Sek.` : '';
  const actions = a.status === 'pending'
    ? `<button class="btn btn--success btn--sm" data-a="accept" data-id="${a.id}">${icon('check', 'icon--sm')} Annehmen</button>
       <button class="btn btn--danger btn--sm" data-a="reject" data-id="${a.id}">${icon('x', 'icon--sm')} Ablehnen</button>`
    : `<span class="muted">Bearbeitet ${a.reviewed_at ? escapeHtml(fmtDate(a.reviewed_at)) : ''}</span>`;
  const chat = !a.chat
    ? `<button class="btn btn--primary btn--sm" data-a="chat" data-id="${a.id}">${icon('chat', 'icon--sm')} Chat öffnen</button>`
    : a.chat.status === 'closed'
      ? `<a class="btn btn--outline btn--sm" href="${escapeHtml(a.chat.url)}" target="_blank" rel="noopener">${icon('chat', 'icon--sm')} Chat (geschlossen)</a><button class="btn btn--ghost btn--sm" data-a="chat" data-id="${a.id}">Wieder öffnen</button>`
      : `<a class="btn btn--outline btn--sm" href="${escapeHtml(a.chat.url)}" target="_blank" rel="noopener">${icon('chat', 'icon--sm')} Zum Chat</a>`;
  return `<div class="list-row" data-id="${a.id}">
    <div class="list-row__head">
      <span class="list-row__title">#${a.id} · ${escapeHtml(a.type_name || '?')}</span>
      <span class="badge ${SB[a.status] || ''}">${SL[a.status] || a.status}</span>
      <span class="muted">${escapeHtml(a.user_tag || a.user_id)} (${escapeHtml(a.user_id)})</span>
      <span class="muted">${escapeHtml(fmtDate(a.created_at))}${a.source ? ' · ' + (SOURCE_LABEL[a.source] || a.source) : ''}${dur}</span>
    </div>
    ${answers}
    <div class="list-row__actions">${actions}${chat}
      <button class="btn btn--ghost btn--sm" data-a="del" data-id="${a.id}" title="Einreichung löschen">${icon('trash', 'icon--sm')}</button></div></div>`;
}

async function loadSubs() {
  const w = $('subList');
  w.innerHTML = '<div class="loading">Lädt…</div>';
  const typeSel = $('subType');
  if (typeSel.options.length <= 1) {
    TYPES = TYPES.length ? TYPES : await apiFor('GET', '/application-types').catch(() => []);
    typeSel.innerHTML = '<option value="">Alle</option>' + TYPES.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  }
  const qs = new URLSearchParams({
    status: $('subStatus').value, typeId: typeSel.value, order: $('subOrder').value,
    limit: $('subLimit').value, page: String(subPage), q: $('subSearch').value.trim(),
  });
  for (const [k, v] of [...qs]) if (!v) qs.delete(k);
  try {
    const r = await apiFor('GET', `/applications?${qs}`);
    $('sTotal').textContent = r.stats.total; $('sAccepted').textContent = r.stats.accepted;
    $('sPending').textContent = r.stats.pending; $('sRejected').textContent = r.stats.rejected;
    const pages = Math.max(1, Math.ceil(r.total / r.limit));
    $('subInfo').textContent = `Zeige ${r.items.length} von ${r.total} Einreichungen`;
    $('subPage').textContent = `Seite ${r.page} / ${pages}`;
    $('subPrev').disabled = r.page <= 1; $('subNext').disabled = r.page >= pages;
    w.innerHTML = r.items.length ? r.items.map(subRow).join('') : `<div class="empty">${icon('clipboard')}<b>Keine Einreichungen</b></div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(errMsg(e))}</div>`; }
}
['subType', 'subOrder', 'subStatus', 'subLimit'].forEach((id) => $(id).addEventListener('change', () => { subPage = 1; loadSubs(); }));
let subTimer = null;
$('subSearch').addEventListener('input', () => { clearTimeout(subTimer); subTimer = setTimeout(() => { subPage = 1; loadSubs(); }, 350); });
$('subPrev').addEventListener('click', () => { subPage = Math.max(1, subPage - 1); loadSubs(); });
$('subNext').addEventListener('click', () => { subPage += 1; loadSubs(); });

$('subList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-a]'); if (!btn) return;
  const id = btn.dataset.id, action = btn.dataset.a;
  if (action === 'chat') {
    btn.disabled = true;
    const r = await run(() => apiFor('POST', `/applications/${id}/chat`));
    if (r) toast(r.created ? 'Chat geöffnet.' : 'Chat ist bereits vorhanden.', 'success');
    return loadSubs();
  }
  if (action === 'del') {
    if (!(await confirmModal('Einreichung endgültig löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await run(() => apiFor('DELETE', `/applications/${id}`), 'Einreichung gelöscht.')) loadSubs();
    return;
  }
  const note = await Dash.promptModal('Nachricht an den Bewerber (optional)', {
    title: action === 'accept' ? 'Bewerbung annehmen' : 'Bewerbung ablehnen',
    multiline: true, required: false, maxLength: 1000,
    confirmLabel: action === 'accept' ? 'Annehmen' : 'Ablehnen',
    hint: 'Der Bewerber bekommt diese Nachricht zusammen mit dem Ergebnis per Direktnachricht. Strg+Enter bestätigt.',
  });
  if (note === null) return;
  const r = await run(() => apiFor('POST', `/applications/${id}/review`, { decision: action, note }));
  if (r) { toast(`Bewerbung ${action === 'accept' ? 'angenommen' : 'abgelehnt'}.${r.roleNote || ''}`, 'success'); loadSubs(); }
});

/* ================= Start ================= */

(async function init() {
  try {
    [ROLES, CH] = await Promise.all([getRoles(), getChannels()]);
    Dash.initModuleStatus('application_enabled', {
      on: 'Das Bewerbungssystem ist aktiv. Ein Klick auf den Button deaktiviert es.',
      off: 'Das Bewerbungssystem ist deaktiviert. Aktiviere es, damit sich Mitglieder bewerben können.',
    });
    await loadSettings();
    Dash.trackForm($('appSettings'), saveSettings, { reset: loadSettings });
    await loadTypes();
  } catch (e) { toast(errMsg(e), 'error'); }
})();
