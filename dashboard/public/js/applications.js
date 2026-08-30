/* global document, window, Dash */
'use strict';

const {
  apiFor, fillSelectors, readForm, applyToForm, escapeHtml, fmtDate,
  icon, getRoles, openModal, confirmModal, toast,
} = Dash;

let settings = {};
let ROLES = [];
let appStatus = 'pending';

const IX = document.getElementById('appIndex');
const ED = document.getElementById('appEditor');

/* ---------- Modul ---------- */
function renderModule() {
  const on = !!settings.application_enabled;
  const box = document.getElementById('moduleStatus');
  box.classList.toggle('is-off', !on);
  document.getElementById('msTitle').textContent = on ? 'Modul aktiviert' : 'Modul deaktiviert';
  document.getElementById('msText').textContent = on
    ? 'Aktuell ist dieses Modul aktiviert. Durch einen Klick auf den Button wird das Modul wieder deaktiviert.'
    : 'Aktuell ist dieses Modul deaktiviert. Aktiviere es, damit sich Nutzer bewerben können.';
  const b = document.getElementById('msToggle');
  b.textContent = on ? 'Deaktivieren' : 'Aktivieren';
  b.className = 'btn btn--sm ' + (on ? 'btn--outline-green' : 'btn--success');
}
document.getElementById('msToggle').addEventListener('click', async () => {
  try { settings = await apiFor('PATCH', '/settings', { application_enabled: settings.application_enabled ? 0 : 1 }); renderModule(); toast('Gespeichert.', 'success'); }
  catch (e) { toast(e.message, 'error'); }
});

/* ---------- Settings ---------- */
async function loadSettings() {
  settings = await apiFor('GET', '/settings');
  await fillSelectors(settings);
  applyToForm(document.getElementById('appSettings'), settings);
  ['application_channel_id', 'application_team_role_id', 'application_log_channel_id'].forEach((k) => {
    if (settings[k]) document.querySelector(`#appSettings [name=${k}]`).value = settings[k];
  });
  if (settings.application_channel_id) document.getElementById('appPanelCh').value = settings.application_channel_id;
}
document.getElementById('appSettings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(e.target);
  try {
    settings = await apiFor('PATCH', '/settings', {
      application_channel_id: a.application_channel_id, application_team_role_id: a.application_team_role_id,
      application_log_channel_id: a.application_log_channel_id, application_panel_title: a.application_panel_title,
      application_panel_message: a.application_panel_message,
    });
    toast('Gespeichert.', 'success');
  } catch (err) { toast(err.message, 'error'); }
});
document.getElementById('appPanelSend').addEventListener('click', async () => {
  const channelId = document.getElementById('appPanelCh').value;
  if (!channelId) return toast('Bitte einen Kanal wählen.', 'warn');
  try {
    const r = await apiFor('POST', '/applications/panel', { channelId });
    document.getElementById('appPanelStatus').innerHTML = r.url ? `Aktiv – <a href="${r.url}" target="_blank" rel="noopener">zur Nachricht</a>` : 'Gesendet.';
    toast('Panel gesendet.', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------- Typ-Karten ---------- */
function typeTile(t) {
  return `
  <div class="tile" data-open="${t.id}">
    <span class="tile__name">${escapeHtml(t.emoji || '📋')} ${escapeHtml(t.name)}</span>
    <span class="tile__badge">${(t.questions || []).length} Fragen</span>
    <span class="badge badge--${t.enabled ? 'green' : 'red'}">${t.enabled ? 'Aktiv' : 'Aus'}</span>
    <span class="tile__ico">${icon('edit', 'icon--sm')}</span>
  </div>`;
}
async function loadTypes() {
  const g = document.getElementById('typeGrid');
  g.innerHTML = '<div class="loading">Lädt…</div>';
  try {
    const types = await apiFor('GET', '/application-types');
    window.__types = types;
    g.className = 'tile-grid';
    g.style.gridTemplateColumns = '1fr';
    g.innerHTML =
      types.map(typeTile).join('') +
      `<div class="tile tile--add" data-new><span class="tile__name">Bewerbungsart erstellen</span><span class="tile__ico">${icon('plus', 'icon--sm')}</span></div>`;
  } catch (e) { g.className = ''; g.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}
document.getElementById('typeGrid').addEventListener('click', (e) => {
  if (e.target.closest('[data-new]')) return newType();
  const el = e.target.closest('[data-open]');
  if (el) openEditor(Number(el.dataset.open));
});
document.getElementById('newTypeBtn').addEventListener('click', newType);
function newType() {
  const { modal, close } = openModal(`
    <h2>Neue Bewerbungsart</h2>
    <form id="ntf" class="form">
      <div class="field"><label>Name</label><input name="name" required placeholder="Support Bewerbung" /></div>
      <div class="field"><label>Emoji</label><input name="emoji" placeholder="🛡️" maxlength="8" /></div>
      <div class="field"><label>Beschreibung</label><input name="description" maxlength="200" /></div>
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-x>Abbrechen</button><button class="btn btn--primary">Erstellen</button></div>
    </form>`);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#ntf').onsubmit = async (ev) => {
    ev.preventDefault();
    try { const t = await apiFor('POST', '/application-types', readForm(ev.target)); close(); await loadTypes(); openEditor(t.id); }
    catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- Editor ---------- */
async function openEditor(typeId) {
  const types = window.__types || (await apiFor('GET', '/application-types'));
  const t = types.find((x) => x.id === typeId);
  if (!t) return;
  window.__type = t;
  IX.hidden = true; ED.hidden = false; window.scrollTo(0, 0);
  const roleOpts = ROLES.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  ED.innerHTML = `
    <div class="editor-head">
      <h1>Bewerbung <span class="pill-badge">${escapeHtml(t.emoji || '📋')} ${escapeHtml(t.name)}</span></h1>
      <div class="editor-head__actions">
        <button class="btn btn--outline btn--sm" id="eToggle">${t.enabled ? 'Deaktivieren' : 'Aktivieren'}</button>
        <button class="btn btn--danger btn--icon" id="eDel" title="Löschen">${icon('trash', 'icon--sm')}</button>
        <button class="btn btn--outline btn--icon" id="eBack" title="Zurück">${icon('chevron', 'icon--sm')}</button>
      </div>
    </div>
    <div class="card">
      <div class="card__head"><h2>${icon('settings')} Allgemeines</h2></div>
      <div class="form">
        <div class="col-2">
          <div class="field"><label>Name</label><input id="tn" value="${escapeHtml(t.name)}" /></div>
          <div class="field"><label>Emoji</label><input id="te" value="${escapeHtml(t.emoji || '')}" maxlength="8" /></div>
        </div>
        <div class="field"><label>Beschreibung</label><input id="td" value="${escapeHtml(t.description || '')}" maxlength="200" /></div>
        <div class="field"><label>Annahme-Rolle (bei „Annehmen" automatisch vergeben)</label><select id="tr"><option value="">— keine —</option>${roleOpts}</select></div>
        <div><button class="btn btn--primary btn--sm" id="tSave">Speichern</button></div>
      </div>
    </div>
    <div class="card">
      <div class="card__head"><h2>${icon('clipboard')} Fragen <span class="muted">(max. 5 – Discord-Limit)</span></h2><div class="spacer"></div>
        <button class="btn btn--primary btn--sm" id="qAdd">${icon('plus', 'icon--sm')} Frage</button></div>
      <div id="qList"></div>
    </div>`;
  if (t.accept_role_id) ED.querySelector('#tr').value = t.accept_role_id;
  ED.querySelector('#eBack').onclick = () => { ED.hidden = true; IX.hidden = false; loadTypes(); };
  ED.querySelector('#eDel').onclick = async () => {
    if (!(await confirmModal('Bewerbungsart samt Fragen löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
    await apiFor('DELETE', `/application-types/${t.id}`);
    ED.hidden = true; IX.hidden = false; loadTypes();
  };
  ED.querySelector('#eToggle').onclick = async () => {
    await apiFor('PATCH', `/application-types/${t.id}`, { enabled: !t.enabled });
    window.__types = await apiFor('GET', '/application-types');
    openEditor(t.id);
  };
  ED.querySelector('#tSave').onclick = async () => {
    try {
      await apiFor('PATCH', `/application-types/${t.id}`, {
        name: ED.querySelector('#tn').value, emoji: ED.querySelector('#te').value,
        description: ED.querySelector('#td').value, acceptRoleId: ED.querySelector('#tr').value,
      });
      toast('Gespeichert.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  ED.querySelector('#qAdd').onclick = async () => {
    const label = prompt('Fragetext (max. 45 Zeichen):');
    if (!label) return;
    try { await apiFor('POST', `/application-types/${t.id}/questions`, { label }); renderQuestions(); }
    catch (e) { toast(e.message, 'error'); }
  };
  renderQuestions();
}

async function renderQuestions() {
  const t = window.__type;
  const types = await apiFor('GET', '/application-types');
  window.__types = types;
  const fresh = types.find((x) => x.id === t.id);
  const qs = fresh.questions || [];
  const wrap = ED.querySelector('#qList');
  wrap.innerHTML = qs.length ? qs.map((q, i) => `
    <div class="q-item" data-q="${q.id}">
      <span class="q-item__num">${i + 1}</span>
      <input data-f="label" value="${escapeHtml(q.label)}" maxlength="45">
      <select data-f="style" style="max-width:110px;">
        <option value="short"${q.style === 'short' ? ' selected' : ''}>Kurz</option>
        <option value="paragraph"${q.style === 'paragraph' ? ' selected' : ''}>Lang</option>
      </select>
      <label class="toggle" title="Pflichtfeld"><input type="checkbox" data-f="required" ${q.required ? 'checked' : ''}><span class="toggle__track"></span></label>
      <button class="btn btn--ghost btn--sm" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn btn--ghost btn--sm" data-a="down" ${i === qs.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn btn--primary btn--sm" data-a="save">${icon('check', 'icon--sm')}</button>
      <button class="btn btn--danger btn--sm" data-a="del">${icon('trash', 'icon--sm')}</button>
    </div>`).join('')
    : `<div class="empty">${icon('clipboard')}<b>Keine Fragen</b>Füge bis zu 5 hinzu.</div>`;

  wrap.onclick = async (e) => {
    const btn = e.target.closest('button[data-a]');
    if (!btn) return;
    const row = btn.closest('[data-q]');
    const qid = row.dataset.q;
    const idx = qs.findIndex((x) => String(x.id) === qid);
    try {
      if (btn.dataset.a === 'save') {
        await apiFor('PATCH', `/application-types/${t.id}/questions/${qid}`, {
          label: row.querySelector('[data-f=label]').value,
          style: row.querySelector('[data-f=style]').value,
          required: row.querySelector('[data-f=required]').checked,
        });
        toast('Frage gespeichert.', 'success');
      } else if (btn.dataset.a === 'del') {
        if (!(await confirmModal('Frage löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
        await apiFor('DELETE', `/application-types/${t.id}/questions/${qid}`);
        renderQuestions();
      } else if (btn.dataset.a === 'up' || btn.dataset.a === 'down') {
        const swap = btn.dataset.a === 'up' ? qs[idx - 1] : qs[idx + 1];
        await apiFor('PATCH', `/application-types/${t.id}/questions/${qid}`, { position: swap.position });
        await apiFor('PATCH', `/application-types/${t.id}/questions/${swap.id}`, { position: qs[idx].position });
        renderQuestions();
      }
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- Eingereichte ---------- */
const SB = { pending: 'badge--pending', accepted: 'badge--green', rejected: 'badge--red' };
function appRow(a) {
  const answers = (a.answers || []).map((x) => `<div class="list-row__meta"><span><b>${escapeHtml(x.question)}</b> — ${escapeHtml(x.answer || '—')}</span></div>`).join('');
  const actions = a.status === 'pending'
    ? `<button class="btn btn--success btn--sm" data-a="accept" data-id="${a.id}">${icon('check', 'icon--sm')} Annehmen</button>
       <button class="btn btn--danger btn--sm" data-a="reject" data-id="${a.id}">${icon('x', 'icon--sm')} Ablehnen</button>`
    : `<span class="muted">Bearbeitet ${a.reviewed_at ? escapeHtml(fmtDate(a.reviewed_at)) : ''}</span>`;
  return `<div class="list-row" data-id="${a.id}">
    <div class="list-row__head">
      <span class="list-row__title">#${a.id} · ${escapeHtml(a.type_name || '?')}</span>
      <span class="badge ${SB[a.status] || ''}">${a.status}</span>
      <span class="muted">${escapeHtml(a.user_tag || a.user_id)}</span>
    </div>
    ${answers}
    <div class="list-row__actions">${actions}</div></div>`;
}
async function loadApps() {
  const w = document.getElementById('appList');
  w.innerHTML = '<div class="loading">Lädt…</div>';
  try {
    const list = await apiFor('GET', `/applications${appStatus ? '?status=' + appStatus : ''}`);
    w.innerHTML = list.length ? list.map(appRow).join('') : `<div class="empty">${icon('clipboard')}<b>Keine Bewerbungen</b></div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}
document.getElementById('appTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (!b) return;
  document.querySelectorAll('#appTabs .tab').forEach((t) => t.classList.remove('is-active'));
  b.classList.add('is-active'); appStatus = b.dataset.status; loadApps();
});
document.getElementById('appList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-a]'); if (!btn) return;
  const id = btn.dataset.id, decision = btn.dataset.a;
  const note = prompt(`Nachricht an den Bewerber (optional):`) || '';
  try {
    const r = await apiFor('POST', `/applications/${id}/review`, { decision, note });
    toast(`Bewerbung ${decision === 'accept' ? 'angenommen' : 'abgelehnt'}.${r.roleNote || ''}`, 'success');
    loadApps();
  } catch (err) { toast(err.message, 'error'); }
});

(async function init() {
  try {
    [ROLES] = await Promise.all([getRoles()]);
    await loadSettings();
    renderModule();
    await loadTypes();
    await loadApps();
  } catch (e) { toast(e.message, 'error'); }
})();
