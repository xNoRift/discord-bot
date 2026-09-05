/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, toast, escapeHtml, getRoles } = Dash;

const wrap = document.getElementById('panelListWrap');
let panels = [];
let allRoles = [];

/* ---------------- Erstellen ---------------- */

document.getElementById('panelCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(e.target);
  const status = document.getElementById('panelCreateStatus');
  status.textContent = 'Wird erstellt…';
  try {
    await apiFor('POST', '/role-panels', { name: a.name });
    toast('Panel erstellt.', 'success');
    status.textContent = 'Erstellt ✓';
    e.target.reset();
    await loadPanels();
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

/* ---------------- Rollen-Zeilen ---------------- */

const BUTTON_STYLES = [
  ['secondary', 'Grau'],
  ['primary', 'Blau'],
  ['success', 'Grün'],
  ['danger', 'Rot'],
];

function roleOptionsHtml(selectedId) {
  return allRoles.map((r) => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
}

function roleRowHtml(r = {}) {
  return `<div class="row-inline" style="flex-wrap:wrap;gap:8px;margin-bottom:8px;align-items:center;" data-role-row>
    <select data-f="roleId" style="max-width:200px;">${roleOptionsHtml(r.role_id)}</select>
    <input data-f="label" placeholder="Anzeigename (leer = Rollenname)" value="${escapeHtml(r.label || '')}" style="max-width:200px;" />
    <input data-f="emoji" data-emoji placeholder="Emoji" value="${escapeHtml(r.emoji || '')}" style="max-width:90px;" />
    <select data-f="buttonStyle" style="max-width:110px;">
      ${BUTTON_STYLES.map(([v, l]) => `<option value="${v}" ${r.button_style === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <button class="btn btn--ghost btn--icon" type="button" data-remove-role>${Dash.icon('trash', 'icon--sm')}</button>
  </div>`;
}

/* ---------------- Panel-Karten ---------------- */

function panelCardHtml(p) {
  return `<div class="card" data-panel="${p.id}">
    <div class="card__head">
      <h2>${escapeHtml(p.name)}</h2>
      <div class="spacer"></div>
      <button class="btn btn--ghost btn--sm" data-delete-panel>${Dash.icon('trash', 'icon--sm')} Löschen</button>
    </div>

    <form class="form" data-panel-settings>
      <div class="col-2">
        <div class="field"><label>Titel</label><input name="title" maxlength="240" value="${escapeHtml(p.title || '')}" /></div>
        <div class="field"><label>Farbe</label><input name="color" type="color" value="${p.color || '#7c5cff'}" /></div>
      </div>
      <div class="field"><label>Beschreibung</label><textarea name="description" rows="2" maxlength="2000">${escapeHtml(p.description || '')}</textarea></div>
      <div class="col-2">
        <div class="field"><label>Bild-URL</label><input name="image_url" value="${escapeHtml(p.image_url || '')}" placeholder="https://..." /></div>
        <div class="field"><label>Thumbnail-URL</label><input name="thumbnail_url" value="${escapeHtml(p.thumbnail_url || '')}" placeholder="https://..." /></div>
      </div>
      <div class="col-2">
        <div class="field"><label>Darstellung</label>
          <select name="style">
            <option value="buttons" ${p.style === 'buttons' ? 'selected' : ''}>Buttons</option>
            <option value="select" ${p.style === 'select' ? 'selected' : ''}>Auswahlmenü</option>
          </select>
        </div>
        <div class="field"><label>Modus</label>
          <select name="mode">
            <option value="multi" ${p.mode === 'multi' ? 'selected' : ''}>Mehrfachauswahl</option>
            <option value="single" ${p.mode === 'single' ? 'selected' : ''}>Nur eine Rolle gleichzeitig</option>
          </select>
        </div>
      </div>
      <div><button class="btn btn--primary btn--sm" type="submit">Einstellungen speichern</button> <span class="muted" data-status="settings"></span></div>
    </form>

    <p class="muted" style="margin-top:16px;margin-bottom:4px;">Rollen (max. 25)</p>
    <div data-role-rows>${p.roles.map(roleRowHtml).join('')}</div>
    <button class="btn btn--ghost btn--sm" type="button" data-add-role style="margin-top:4px;">${Dash.icon('plus', 'icon--sm')} Rolle hinzufügen</button>
    <div style="margin-top:8px;"><button class="btn btn--primary btn--sm" type="button" data-save-roles>Rollen speichern</button> <span class="muted" data-status="roles"></span></div>

    <div class="row-inline" style="margin-top:16px;flex-wrap:wrap;gap:10px;">
      <select data-f="channelId" data-type="text" style="max-width:220px;"></select>
      <button class="btn btn--sm" type="button" data-publish>${Dash.icon('send', 'icon--sm')} Veröffentlichen</button>
      <span class="muted" data-status="publish">${p.message_id ? 'Bereits veröffentlicht – erneutes Veröffentlichen aktualisiert die Nachricht.' : 'Noch nicht veröffentlicht.'}</span>
    </div>
  </div>`;
}

async function loadPanels() {
  try {
    [panels, allRoles] = await Promise.all([apiFor('GET', '/role-panels'), getRoles()]);
    wrap.innerHTML = panels.length ? panels.map(panelCardHtml).join('') : '<p class="muted">Noch keine Panels.</p>';
    await fillSelectors({});
    Dash.initEmojiInputs(wrap);
  } catch (e) {
    wrap.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

wrap.addEventListener('click', async (e) => {
  const card = e.target.closest('[data-panel]');
  if (!card) return;
  const panelId = card.dataset.panel;

  if (e.target.closest('[data-delete-panel]')) {
    if (!(await Dash.confirmModal('Dieses Panel wirklich löschen? Eine evtl. veröffentlichte Nachricht bleibt stehen, funktioniert aber nicht mehr.', { danger: true }))) return;
    try {
      await apiFor('DELETE', `/role-panels/${panelId}`);
      toast('Panel gelöscht.', 'success');
      await loadPanels();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (e.target.closest('[data-add-role]')) {
    const rowsWrap = card.querySelector('[data-role-rows]');
    rowsWrap.insertAdjacentHTML('beforeend', roleRowHtml());
    Dash.initEmojiInputs(rowsWrap);
    return;
  }

  if (e.target.closest('[data-remove-role]')) {
    e.target.closest('[data-role-row]').remove();
    return;
  }

  if (e.target.closest('[data-save-roles]')) {
    const status = card.querySelector('[data-status="roles"]');
    const roles = [...card.querySelectorAll('[data-role-row]')].map((row) => ({
      roleId: row.querySelector('[data-f="roleId"]').value,
      label: row.querySelector('[data-f="label"]').value.trim(),
      emoji: row.querySelector('[data-f="emoji"]').value.trim(),
      buttonStyle: row.querySelector('[data-f="buttonStyle"]').value,
    }));
    status.textContent = 'Speichert…';
    try {
      await apiFor('PUT', `/role-panels/${panelId}/roles`, { roles });
      toast('Rollen gespeichert.', 'success');
      status.textContent = 'Gespeichert ✓';
    } catch (err) {
      toast(err.message, 'error');
      status.textContent = err.message;
    }
    return;
  }

  if (e.target.closest('[data-publish]')) {
    const status = card.querySelector('[data-status="publish"]');
    const channelId = card.querySelector('[data-f="channelId"]').value;
    status.textContent = 'Wird veröffentlicht…';
    try {
      const r = await apiFor('POST', `/role-panels/${panelId}/publish`, { channelId: channelId || undefined });
      toast('Panel veröffentlicht.', 'success');
      status.textContent = `Veröffentlicht ✓ (${r.messageId})`;
    } catch (err) {
      toast(err.message, 'error');
      status.textContent = err.message;
    }
  }
});

wrap.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-panel-settings]');
  if (!form) return;
  e.preventDefault();
  const card = form.closest('[data-panel]');
  const panelId = card.dataset.panel;
  const status = form.querySelector('[data-status="settings"]');
  const a = readForm(form);
  status.textContent = 'Speichert…';
  try {
    await apiFor('PATCH', `/role-panels/${panelId}`, a);
    toast('Gespeichert.', 'success');
    status.textContent = 'Gespeichert ✓';
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

loadPanels().catch((e) => toast(e.message, 'error'));
