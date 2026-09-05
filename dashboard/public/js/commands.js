/* global document, Dash */
'use strict';

const { apiFor, readForm, toast, escapeHtml } = Dash;

const wrap = document.getElementById('cmdListWrap');

/* ---------------- Prefix-Hinweis ---------------- */
apiFor('GET', '/settings').then((s) => {
  const el = document.getElementById('prefixHint');
  if (el && s.bot_prefix) el.textContent = s.bot_prefix;
}).catch(() => {});

/* ---------------- Erstellen ---------------- */
document.getElementById('cmdCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(e.target);
  const status = document.getElementById('cmdCreateStatus');
  status.textContent = 'Wird erstellt…';
  try {
    await apiFor('POST', '/custom-commands', { name: a.name, response_type: a.response_type, content: a.content });
    toast('Command erstellt.', 'success');
    status.textContent = 'Erstellt ✓';
    e.target.reset();
    await load();
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

/* ---------------- Liste ---------------- */

function buttonsRowsHtml(buttons) {
  return (buttons || [])
    .map(
      (b) => `<div class="row-inline" style="gap:8px;margin-bottom:6px;" data-btn-row>
        <input data-f="label" placeholder="Label" value="${escapeHtml(b.label || '')}" style="max-width:160px;" />
        <input data-f="url" placeholder="https://..." value="${escapeHtml(b.url || '')}" style="max-width:260px;" />
        <input data-f="emoji" data-emoji placeholder="Emoji" value="${escapeHtml(b.emoji || '')}" style="max-width:80px;" />
        <button class="btn btn--ghost btn--icon" type="button" data-btn-remove>${Dash.icon('trash', 'icon--sm')}</button>
      </div>`,
    )
    .join('');
}

function cmdCardHtml(c) {
  let buttons = [];
  try { buttons = JSON.parse(c.buttons_json || '[]'); } catch { buttons = []; }
  return `<div class="card" data-cmd="${c.id}">
    <div class="card__head">
      <h2>${escapeHtml(c.name)}</h2>
      <div class="spacer"></div>
      <label class="switch-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);">
        <b>${c.enabled ? 'Aktiv' : 'Inaktiv'}</b>
      </label>
      <button class="btn btn--ghost btn--sm" data-delete>${Dash.icon('trash', 'icon--sm')} Löschen</button>
    </div>
    <form class="form" data-cmd-form>
      <div class="col-2">
        <div class="field"><label>Name</label><input name="name" maxlength="32" value="${escapeHtml(c.name)}" /></div>
        <div class="field"><label>Antwort-Typ</label>
          <select name="response_type">
            <option value="text" ${c.response_type === 'text' ? 'selected' : ''}>Text</option>
            <option value="embed" ${c.response_type === 'embed' ? 'selected' : ''}>Embed</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Antwort / Beschreibung</label><textarea name="content" rows="3" maxlength="4000">${escapeHtml(c.content || '')}</textarea></div>
      <div class="col-2" data-embed-only>
        <div class="field"><label>Embed-Titel</label><input name="embed_title" maxlength="240" value="${escapeHtml(c.embed_title || '')}" /></div>
        <div class="field"><label>Embed-Farbe</label><input name="embed_color" type="color" value="${c.embed_color || '#7c5cff'}" /></div>
        <div class="field"><label>Bild-URL</label><input name="embed_image_url" value="${escapeHtml(c.embed_image_url || '')}" placeholder="https://..." /></div>
        <div class="field"><label>Thumbnail-URL</label><input name="embed_thumbnail_url" value="${escapeHtml(c.embed_thumbnail_url || '')}" placeholder="https://..." /></div>
      </div>
      <label class="setting-row" style="cursor:pointer;padding:6px 0;">
        <input type="checkbox" name="delete_invocation" ${c.delete_invocation ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent);">
        <span class="setting-row__text">Auslösende Nachricht löschen</span>
      </label>
      <p class="muted" style="margin-top:10px;margin-bottom:4px;">Link-Buttons (max. 5)</p>
      <div data-btn-rows>${buttonsRowsHtml(buttons)}</div>
      <button class="btn btn--ghost btn--sm" type="button" data-btn-add style="margin-top:4px;">${Dash.icon('plus', 'icon--sm')} Button hinzufügen</button>
      <div style="margin-top:10px;"><button class="btn btn--primary btn--sm" type="submit">Speichern</button> <span class="muted" data-status></span></div>
    </form>
  </div>`;
}

async function load() {
  try {
    const cmds = await apiFor('GET', '/custom-commands');
    wrap.innerHTML = cmds.length ? cmds.map(cmdCardHtml).join('') : '<p class="muted">Noch keine Commands.</p>';
    Dash.initEmojiInputs(wrap);
    wrap.querySelectorAll('[data-cmd-form]').forEach(syncEmbedOnly);
  } catch (e) {
    wrap.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

function syncEmbedOnly(form) {
  const isEmbed = form.querySelector('[name="response_type"]').value === 'embed';
  form.querySelector('[data-embed-only]').hidden = !isEmbed;
}

wrap.addEventListener('change', async (e) => {
  if (e.target.matches('[name="response_type"]')) {
    syncEmbedOnly(e.target.closest('form'));
    return;
  }
  if (e.target.matches('[data-f="enabled"]')) {
    const card = e.target.closest('[data-cmd]');
    try {
      await apiFor('PATCH', `/custom-commands/${card.dataset.cmd}`, { enabled: e.target.checked });
      toast(e.target.checked ? 'Aktiviert.' : 'Deaktiviert.', 'success');
      card.querySelector('.switch-label b').textContent = e.target.checked ? 'Aktiv' : 'Inaktiv';
    } catch (err) {
      toast(err.message, 'error');
      e.target.checked = !e.target.checked;
    }
  }
});

wrap.addEventListener('click', async (e) => {
  const card = e.target.closest('[data-cmd]');
  if (!card) return;
  const id = card.dataset.cmd;

  if (e.target.closest('[data-delete]')) {
    if (!(await Dash.confirmModal('Diesen Command wirklich löschen?', { danger: true }))) return;
    try { await apiFor('DELETE', `/custom-commands/${id}`); toast('Gelöscht.', 'success'); await load(); }
    catch (err) { toast(err.message, 'error'); }
    return;
  }

  if (e.target.closest('[data-btn-add]')) {
    card.querySelector('[data-btn-rows]').insertAdjacentHTML('beforeend',
      `<div class="row-inline" style="gap:8px;margin-bottom:6px;" data-btn-row>
        <input data-f="label" placeholder="Label" style="max-width:160px;" />
        <input data-f="url" placeholder="https://..." style="max-width:260px;" />
        <input data-f="emoji" data-emoji placeholder="Emoji" style="max-width:80px;" />
        <button class="btn btn--ghost btn--icon" type="button" data-btn-remove>${Dash.icon('trash', 'icon--sm')}</button>
      </div>`);
    Dash.initEmojiInputs(card.querySelector('[data-btn-rows]'));
    return;
  }

  if (e.target.closest('[data-btn-remove]')) {
    e.target.closest('[data-btn-row]').remove();
  }
});

wrap.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-cmd-form]');
  if (!form) return;
  e.preventDefault();
  const card = form.closest('[data-cmd]');
  const id = card.dataset.cmd;
  const status = form.querySelector('[data-status]');
  const a = readForm(form);
  const buttons = [...card.querySelectorAll('[data-btn-row]')].map((row) => ({
    label: row.querySelector('[data-f="label"]').value.trim(),
    url: row.querySelector('[data-f="url"]').value.trim(),
    emoji: row.querySelector('[data-f="emoji"]').value.trim(),
  })).filter((b) => b.url);

  status.textContent = 'Speichert…';
  try {
    await apiFor('PATCH', `/custom-commands/${id}`, {
      name: a.name,
      response_type: a.response_type,
      content: a.content,
      embed_title: a.embed_title,
      embed_color: a.embed_color,
      embed_image_url: a.embed_image_url,
      embed_thumbnail_url: a.embed_thumbnail_url,
      delete_invocation: a.delete_invocation,
      buttons,
    });
    toast('Gespeichert.', 'success');
    status.textContent = 'Gespeichert ✓';
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

load().catch((e) => toast(e.message, 'error'));
