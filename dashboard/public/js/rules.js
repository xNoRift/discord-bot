/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, icon, openModal, confirmModal, toast, readForm } = Dash;

const form = document.getElementById('rulesForm');
const preview = document.getElementById('rlPreview');
const previewBtns = document.getElementById('rlPreviewBtns');
const listEl = document.getElementById('rlList');
let SECTIONS = [];
let MAX = 25;

/* ---------------- Vorschau ---------------- */

function renderPreview() {
  const f = (n) => form.elements[n].value;
  const color = /^#?[0-9a-f]{6}$/i.test(f('color')) ? f('color').replace(/^#?/, '#') : '#7c5cff';
  const img = /^https:\/\//i.test(f('imageUrl')) ? f('imageUrl') : '';
  preview.style.borderLeftColor = color;
  preview.innerHTML =
    `<div class="embed-preview__title">${escapeHtml(f('title') || '📜 Server-Regeln')}</div>` +
    (f('intro') ? `<div class="embed-preview__text" style="padding-right:0;">${escapeHtml(f('intro'))}</div>` : '') +
    (f('noticeText')
      ? `<div><div class="embed-preview__title" style="font-size:.85rem;">${escapeHtml(f('noticeTitle') || 'Hinweis')}</div><div class="embed-preview__text" style="padding-right:0;">${escapeHtml(f('noticeText'))}</div></div>`
      : '') +
    (img ? `<img class="embed-img-preview" alt="" src="${escapeHtml(img)}" style="max-height:120px;" />` : '') +
    (f('footer') ? `<div class="embed-preview__foot">${escapeHtml(f('footer'))}</div>` : '');
  previewBtns.innerHTML = SECTIONS.map((s) => `<span class="rules-btn">${s.emoji ? escapeHtml(s.emoji) + ' ' : ''}${escapeHtml(s.label)}</span>`).join('');
}

/* ---------------- Abschnitte ---------------- */

function renderList() {
  listEl.innerHTML = SECTIONS.length
    ? SECTIONS.map((s, i) => `<div class="list-row">
        <div class="list-row__head">
          <span class="list-row__title">${escapeHtml(s.emoji || '📌')} ${escapeHtml(s.label)}</span>
          <span class="spacer"></span>
          <button type="button" class="btn btn--ghost btn--sm" data-move="${s.id}:up" title="Nach oben"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="btn btn--ghost btn--sm" data-move="${s.id}:down" title="Nach unten"${i === SECTIONS.length - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" class="btn btn--ghost btn--sm" data-edit="${s.id}">${icon('edit', 'icon--sm')} Bearbeiten</button>
          <button type="button" class="btn btn--danger btn--sm" data-del="${s.id}" title="Entfernen">${icon('trash', 'icon--sm')}</button>
        </div>
        <div class="list-row__meta"><span>${escapeHtml(s.content.replace(/\s+/g, ' ').slice(0, 140))}${s.content.length > 140 ? '…' : ''}</span></div>
      </div>`).join('')
    : `<div class="empty">${icon('clipboard')}<b>Noch keine Abschnitte</b>Starte mit „Beispiel-Regeln einfügen“ oder lege oben rechts den ersten Abschnitt an.</div>`;
  document.getElementById('rlAdd').disabled = SECTIONS.length >= MAX;
  renderPreview();
}

async function loadSections() {
  try {
    const r = await apiFor('GET', '/rules/sections');
    SECTIONS = r.sections;
    MAX = r.max;
    renderList();
  } catch (e) { listEl.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

function sectionModal(section) {
  const { modal, close } = openModal(`
    <h2>${icon('clipboard')} ${section ? 'Abschnitt bearbeiten' : 'Abschnitt hinzufügen'}</h2>
    <form id="rlSecForm" class="form">
      <div class="col-2">
        <div class="field"><label>Button-Text</label><input name="label" required maxlength="80" placeholder="z. B. §1 Allgemein" value="${escapeHtml(section?.label || '')}" /></div>
        <div class="field"><label>Emoji (optional)</label><input name="emoji" maxlength="64" data-emoji="one" value="${escapeHtml(section?.emoji || '')}" /></div>
      </div>
      <div class="field"><label>Überschrift (optional)</label><input name="title" maxlength="240" placeholder="z. B. §1 – Allgemeine Regeln" value="${escapeHtml(section?.title || '')}" /><small>Wird über den Regeln angezeigt. Leer = Button-Text.</small></div>
      <div class="field"><label>Regeln</label><textarea name="content" rows="9" required maxlength="4000" placeholder="**1.1** Sei respektvoll …">${escapeHtml(section?.content || '')}</textarea><small>Eine Regel pro Zeile. Markdown wie <code>**fett**</code> funktioniert. Wird nur dem Klickenden angezeigt.</small></div>
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-x>Abbrechen</button><button class="btn btn--primary" type="submit">Speichern</button></div>
    </form>`);
  Dash.initEmojiInputs(modal);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#rlSecForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (section) await apiFor('PATCH', `/rules/sections/${section.id}`, readForm(e.target));
      else await apiFor('POST', '/rules/sections', readForm(e.target));
      toast('Gespeichert.', 'success');
      close();
      await loadSections();
    } catch (err) { toast(err.message, 'error'); }
  };
}

document.getElementById('rlAdd').addEventListener('click', () => sectionModal(null));

document.getElementById('rlTemplate').addEventListener('click', async () => {
  try {
    if (SECTIONS.length && !(await confirmModal('Die Beispiel-Regeln (4 Abschnitte) werden zu deinen vorhandenen Abschnitten hinzugefügt. Fortfahren?', { confirmLabel: 'Hinzufügen' }))) return;
    await apiFor('POST', '/rules/template', {});
    toast('Beispiel-Regeln eingefügt – passe die Texte an deinen Server an.', 'success');
    await loadSections();
  } catch (err) { toast(err.message, 'error'); }
});

listEl.addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  const move = e.target.closest('[data-move]');
  try {
    if (edit) return sectionModal(SECTIONS.find((s) => s.id === Number(edit.dataset.edit)));
    if (move) {
      const [id, dir] = move.dataset.move.split(':');
      await apiFor('POST', `/rules/sections/${id}/move`, { dir });
      return await loadSections();
    }
    if (del) {
      const s = SECTIONS.find((x) => x.id === Number(del.dataset.del));
      if (!(await confirmModal(`Abschnitt „${s?.label}“ entfernen?`, { danger: true, confirmLabel: 'Entfernen' }))) return;
      await apiFor('DELETE', `/rules/sections/${del.dataset.del}`);
      toast('Entfernt.', 'success');
      await loadSections();
    }
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------------- Senden ---------------- */

document.getElementById('rlPost').addEventListener('click', async () => {
  const st = document.getElementById('rlMsg');
  try {
    if (Dash.saveBar.dirty().length) await Dash.saveBar.saveAll();
    if (Dash.saveBar.dirty().length) throw new Error('Bitte zuerst die Einstellungen speichern.');
    st.textContent = 'Wird gesendet…';
    await apiFor('POST', '/rules/post', {});
    Dash.toast('Regel-Nachricht gesendet.', 'success');
    st.textContent = 'Gesendet ✓';
  } catch (err) { Dash.toast(err.message, 'error'); st.textContent = err.message; }
});

/* ---------------- Start ---------------- */

Dash.moduleForm('rules', form, {
  on: 'Die Regeln sind aktiv. Die Buttons in der Regel-Nachricht zeigen den Mitgliedern die Regeln.',
  off: 'Die Regeln sind deaktiviert. Die Buttons in Discord reagieren nicht, solange das Modul aus ist.',
  afterLoad: renderPreview,
}).then(() => {
  form.addEventListener('input', renderPreview);
  return loadSections();
}).catch((e) => toast(e.message, 'error'));
