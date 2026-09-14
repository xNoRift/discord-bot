/* global document, Dash */
'use strict';

const {
  apiFor, fillSelectors, readForm, escapeHtml, fmtDate, fmtRelative, fmtDuration,
  icon, openModal, confirmModal, getChannels, getRoles, toast,
} = Dash;

let settings = {};
let tab = 'active';

async function loadSettings() {
  settings = await apiFor('GET', '/settings');
  await fillSelectors(settings);
  const f = document.getElementById('gwSettings');
  f.giveaway_channel_id.value = settings.giveaway_channel_id || '';
  f.giveaway_winner_role_id.value = settings.giveaway_winner_role_id || '';
  f.giveaway_log_channel_id.value = settings.giveaway_log_channel_id || '';
  f.giveaway_winner_role_duration_ms.value = fmtDuration(settings.giveaway_winner_role_duration_ms || 86400000);
  f.giveaway_ticket_button.checked = Boolean(settings.giveaway_ticket_button);
}

Dash.initModuleStatus('giveaways_enabled', {
  on: 'Giveaways sind aktiviert. Ein Klick deaktiviert das Modul – es lassen sich dann keine neuen Giveaways mehr erstellen.',
  off: 'Giveaways sind deaktiviert. Aktiviere das Modul, um neue Giveaways zu erstellen.',
});

async function saveGwSettings() {
  const a = readForm(document.getElementById('gwSettings'));
  try {
    settings = await apiFor('PATCH', '/settings', {
      giveaway_channel_id: a.giveaway_channel_id,
      giveaway_winner_role_id: a.giveaway_winner_role_id,
      giveaway_log_channel_id: a.giveaway_log_channel_id,
      giveaway_winner_role_duration_ms: a.giveaway_winner_role_duration_ms,
      giveaway_ticket_button: a.giveaway_ticket_button,
    });
    toast('Gespeichert.', 'success');
    await loadSettings();
  } catch (err) { toast(err.message, 'error'); throw err; }
}

/* ---------- Liste ---------- */

function gwCard(g) {
  const active = !g.ended && !g.cancelled;
  const actions = active
    ? `<button class="btn btn--ghost btn--sm" data-a="edit" data-id="${g.id}">${icon('edit', 'icon--sm')} Bearbeiten</button>
       <button class="btn btn--ghost btn--sm" data-a="time" data-id="${g.id}">${icon('clock', 'icon--sm')} +Zeit</button>
       <button class="btn btn--primary btn--sm" data-a="end" data-id="${g.id}">Beenden</button>
       <button class="btn btn--danger btn--sm" data-a="cancel" data-id="${g.id}">Abbrechen</button>`
    : `<button class="btn btn--ghost btn--sm" data-a="winners" data-id="${g.id}">Gewinner</button>
       <button class="btn btn--primary btn--sm" data-a="reroll" data-id="${g.id}">${icon('refresh', 'icon--sm')} Reroll</button>
       ${window.IS_OWNER ? `<button class="btn btn--ghost btn--sm" data-a="edit" data-id="${g.id}">${icon('edit', 'icon--sm')} Bearbeiten</button>` : ''}`;
  return `
  <div class="list-row" data-id="${g.id}">
    <div class="list-row__head">
      <span class="list-row__title">${icon('gift', 'icon--sm')} ${escapeHtml(g.prize)}</span>
      <span class="badge badge--${g.cancelled ? 'red' : active ? 'active' : 'green'}">${g.cancelled ? 'Abgebrochen' : active ? 'Aktiv' : 'Beendet'}</span>
      <span class="muted">#${g.id}</span>
    </div>
    <div class="list-row__meta">
      <span>${icon('users', 'icon--sm')} ${g.winner_count} Gewinner</span>
      <span>${icon('check', 'icon--sm')} ${g.entry_count} Teilnehmer</span>
      <span>${icon('clock', 'icon--sm')} ${active ? 'endet ' + escapeHtml(fmtRelative(g.ends_at)) : escapeHtml(fmtDate(g.ends_at))}</span>
      ${g.winner_role_id ? `<span>${icon('star', 'icon--sm')} Rolle ${fmtDuration(g.winner_role_duration_ms)}</span>` : ''}
    </div>
    ${(g.winners || []).length ? `<div class="list-row__meta"><span>🏆 ${g.winners.map((w) => '&lt;@' + escapeHtml(w) + '&gt;').join(', ')}</span></div>` : ''}
    <div class="list-row__actions">${actions}</div>
  </div>`;
}

async function loadList() {
  const w = document.getElementById('gwList');
  w.innerHTML = '<div class="loading">Lädt…</div>';
  try {
    const list = await apiFor('GET', `/giveaways?status=${tab}`);
    w.innerHTML = list.length ? list.map(gwCard).join('')
      : `<div class="empty">${icon('gift')}<b>Keine Giveaways</b>${tab === 'active' ? 'Erstelle dein erstes Giveaway.' : 'Noch keine abgeschlossen.'}</div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

async function loadTempRoles() {
  const w = document.getElementById('tempRoles');
  try {
    const list = await apiFor('GET', '/temp-roles');
    w.innerHTML = list.length ? list.map((r) => `
      <div class="list-row">
        <div class="list-row__head"><span class="list-row__title">${icon('star', 'icon--sm')} &lt;@${escapeHtml(r.user_id)}&gt;</span></div>
        <div class="list-row__meta">
          <span>${icon('hash', 'icon--sm')} Rolle &lt;@&amp;${escapeHtml(r.role_id)}&gt;</span>
          <span>${icon('clock', 'icon--sm')} Entfernung ${escapeHtml(fmtRelative(r.expires_at))}</span>
        </div>
      </div>`).join('')
      : `<div class="empty">${icon('star')}<b>Keine aktiven Gewinnerrollen</b></div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

/* ---------- Ticket-Buttons bei Gewinn ---------- */

let GWTB_CHAN = { categories: [] };
let GWTB_ROLES = [];

function gwtbCategoryName(id) {
  const c = (GWTB_CHAN.categories || []).find((x) => String(x.id) === String(id));
  return c ? c.name : null;
}
function gwtbRoleName(id) {
  const r = GWTB_ROLES.find((x) => String(x.id) === String(id));
  return r ? r.name : null;
}

function gwtbCard(b) {
  const cat = gwtbCategoryName(b.discord_category_id);
  const role = gwtbRoleName(b.support_role_id);
  return `
  <div class="list-row" data-id="${b.id}">
    <div class="list-row__head">
      <span class="list-row__title">${escapeHtml(b.emoji || '🎫')} ${escapeHtml(b.label)}</span>
    </div>
    <div class="list-row__meta">
      <span>${icon('hash', 'icon--sm')} ${cat ? escapeHtml(cat) : 'Standard-Kategorie'}</span>
      <span>${icon('users', 'icon--sm')} ${role ? '@' + escapeHtml(role) : 'Standard-Rolle'}</span>
      <span>${icon('gift', 'icon--sm')} Preis ${b.show_prize ? 'sichtbar' : 'ausgeblendet'}</span>
      ${(b.questions || []).length ? `<span>${icon('file', 'icon--sm')} ${b.questions.length} Formularfeld${b.questions.length > 1 ? 'er' : ''}</span>` : ''}
    </div>
    <div class="list-row__actions">
      <button class="btn btn--outline btn--sm" data-a="edit" data-id="${b.id}">${icon('edit', 'icon--sm')} Bearbeiten</button>
      <button class="btn btn--danger btn--sm" data-a="del" data-id="${b.id}">${icon('trash', 'icon--sm')} Entfernen</button>
    </div>
  </div>`;
}

let ticketButtons = [];

async function loadTicketButtons() {
  const w = document.getElementById('gwtbList');
  w.innerHTML = '<div class="loading">Lädt…</div>';
  try {
    ticketButtons = await apiFor('GET', '/giveaway-ticket-buttons');
    w.innerHTML = ticketButtons.length
      ? ticketButtons.map(gwtbCard).join('')
      : `<div class="empty">${icon('ticket')}<b>Keine Buttons</b>Füge einen hinzu, damit Gewinner sich ein Ticket erstellen können.</div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

function gwtbQCard(q, i) {
  const max = q.max_length || 4000;
  return `<div class="qfield" data-q="${q.id}">
    <div class="qfield__head">
      <b>${i + 1}. ${escapeHtml(q.label || 'Neues Feld')}</b>
      <button type="button" class="btn btn--danger btn--icon" data-qa="del" title="Feld löschen">${icon('trash', 'icon--sm')}</button>
    </div>
    <div class="col-2">
      <div class="field"><label>Anzeigename <span class="req">*</span></label><input data-qf="label" value="${escapeHtml(q.label)}" maxlength="45"></div>
      <div class="field"><label>Typ</label>
        <select data-qf="style">
          <option value="short"${q.style === 'short' ? ' selected' : ''}>Einzeiliger Text</option>
          <option value="paragraph"${q.style === 'paragraph' ? ' selected' : ''}>Mehrzeiliger Text</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Platzhalter</label><input data-qf="placeholder" value="${escapeHtml(q.placeholder || '')}" maxlength="100"></div>
    <div class="field"><label>Zeichenlimit</label><input data-qf="maxLength" type="number" min="1" max="4000" value="${max}"></div>
    <label class="row-inline"><input type="checkbox" data-qf="required" style="width:auto;" ${q.required ? 'checked' : ''}> <span>Erforderlich</span></label>
    <div style="margin-top:8px;"><button type="button" class="btn btn--primary btn--sm" data-qa="save">${icon('check', 'icon--sm')} Feld speichern</button></div>
  </div>`;
}

async function ticketButtonModal(existing) {
  const [ch, roles] = await Promise.all([getChannels(), getRoles()]);
  GWTB_CHAN = ch; GWTB_ROLES = roles;
  const catOpts = (ch.categories || []).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const roleOpts = roles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const questionsHtml = existing
    ? `<div style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px;">
        <b>${icon('file', 'icon--sm')} Formularfelder <span class="muted">(max. 5 – Discord-Limit)</span></b>
        <p class="muted" style="font-size:.85rem;margin:4px 0 8px;">Hat der Button Felder, erscheint beim Klick zuerst ein Formular (Discord-Modal). Die Antworten landen im Ticket. Ohne Felder wird das Ticket sofort geöffnet.</p>
        <div id="gwtbQList">${(existing.questions || []).map(gwtbQCard).join('')}</div>
        <button type="button" class="btn btn--ghost btn--sm" id="gwtbQAdd" style="margin-top:6px;">${icon('plus', 'icon--sm')} Feld hinzufügen</button>
      </div>`
    : `<p class="muted" style="margin-top:10px;">Speichere den Button zuerst, um Formularfelder hinzuzufügen.</p>`;
  const { modal, close } = openModal(`
    <h2>${icon('ticket')} ${existing ? 'Button bearbeiten' : 'Ticket-Button hinzufügen'}</h2>
    <form id="gwtbForm" class="form">
      <div class="col-2">
        <div class="field"><label>Beschriftung</label><input name="label" maxlength="80" required value="${escapeHtml(existing ? existing.label : 'Ticket erstellen')}" /></div>
        <div class="field">
          <label>Emoji</label>
          <button type="button" class="emote-btn" id="gwtbEmoteBtn">${existing?.emoji ? escapeHtml(existing.emoji) : '<span class="emote-btn__empty">Wählen…</span>'}</button>
          <input type="hidden" name="emoji" id="gwtbEmoteVal" value="${escapeHtml(existing?.emoji || '')}">
        </div>
      </div>
      <div class="col-2">
        <div class="field"><label>Discord-Kategorie</label><select name="discordCategoryId"><option value="">Standard</option>${catOpts}</select></div>
        <div class="field"><label>Support-Rolle</label><select name="supportRoleId"><option value="">Standard</option>${roleOpts}</select></div>
      </div>
      <div class="field">
        <label>Kanalname</label>
        <input name="nameFormat" placeholder="ticket-{user}" maxlength="90" value="${escapeHtml(existing?.name_format || '')}" />
        <small>Platzhalter: <code>{user}</code>, <code>{number}</code>. Leer = Ticket-Standard.</small>
      </div>
      <div class="field">
        <label>Begrüßung im Ticket</label>
        <textarea name="welcomeMessage" rows="3" placeholder="Herzlichen Glückwunsch {user}! Dein Preis: {prize}">${escapeHtml(existing?.welcome_message || '')}</textarea>
        <small>Platzhalter: <code>{user}</code>, <code>{number}</code>, <code>{prize}</code>. Leer = Ticket-Standard.</small>
      </div>
      <label class="row-inline"><input type="checkbox" name="showPrize" style="width:auto;" ${!existing || existing.show_prize ? 'checked' : ''}> <span>Preis im Ticket anzeigen (Feld + <code>{prize}</code>)</span></label>
      ${questionsHtml}
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-x>Abbrechen</button>
        <button type="submit" class="btn btn--primary">${existing ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    </form>`);
  if (existing?.discord_category_id) modal.querySelector('[name=discordCategoryId]').value = existing.discord_category_id;
  if (existing?.support_role_id) modal.querySelector('[name=supportRoleId]').value = existing.support_role_id;
  modal.querySelector('[data-x]').onclick = close;

  const emoteBtn = modal.querySelector('#gwtbEmoteBtn');
  emoteBtn.onclick = () => {
    Dash.openEmojiPicker(emoteBtn, (val) => {
      modal.querySelector('#gwtbEmoteVal').value = val;
      emoteBtn.innerHTML = val ? escapeHtml(val) : '<span class="emote-btn__empty">Wählen…</span>';
    });
  };

  modal.querySelector('#gwtbForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = readForm(e.target);
    try {
      if (existing) await apiFor('PATCH', `/giveaway-ticket-buttons/${existing.id}`, d);
      else await apiFor('POST', '/giveaway-ticket-buttons', d);
      toast('Gespeichert.', 'success'); close(); loadTicketButtons();
    } catch (err) { toast(err.message, 'error'); }
  };

  if (existing) {
    const reopen = async () => {
      close();
      await loadTicketButtons();
      await ticketButtonModal(ticketButtons.find((x) => String(x.id) === String(existing.id)));
    };
    modal.querySelector('#gwtbQAdd').onclick = async () => {
      const label = prompt('Feldname (max. 45 Zeichen):');
      if (!label) return;
      try {
        await apiFor('POST', `/giveaway-ticket-buttons/${existing.id}/questions`, { label });
        toast('Feld hinzugefügt.', 'success');
        await reopen();
      } catch (err) { toast(err.message, 'error'); }
    };
    modal.querySelector('#gwtbQList').addEventListener('click', async (e) => {
      const qbtn = e.target.closest('button[data-qa]'); if (!qbtn) return;
      const row = qbtn.closest('[data-q]'); const qid = row.dataset.q;
      try {
        if (qbtn.dataset.qa === 'save') {
          const patch = {};
          row.querySelectorAll('[data-qf]').forEach((el) => { patch[el.dataset.qf] = el.type === 'checkbox' ? el.checked : el.value; });
          await apiFor('PATCH', `/giveaway-ticket-buttons/${existing.id}/questions/${qid}`, patch);
          toast('Feld gespeichert.', 'success');
          await reopen();
        } else if (qbtn.dataset.qa === 'del') {
          if (!(await confirmModal('Feld löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
          await apiFor('DELETE', `/giveaway-ticket-buttons/${existing.id}/questions/${qid}`);
          await reopen();
        }
      } catch (err) { toast(err.message, 'error'); }
    });
  }
}

document.getElementById('gwtbAddBtn').addEventListener('click', () => {
  if (ticketButtons.length >= 5) { toast('Maximal 5 Ticket-Buttons.', 'error'); return; }
  ticketButtonModal(null).catch((e) => toast(e.message, 'error'));
});

document.getElementById('gwtbList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-a]'); if (!btn) return;
  const id = btn.dataset.id;
  try {
    if (btn.dataset.a === 'edit') {
      await ticketButtonModal(ticketButtons.find((x) => String(x.id) === String(id)));
    } else if (btn.dataset.a === 'del') {
      if (!(await confirmModal('Diesen Ticket-Button entfernen?', { danger: true, confirmLabel: 'Entfernen' }))) return;
      await apiFor('DELETE', `/giveaway-ticket-buttons/${id}`);
      toast('Entfernt.', 'success'); loadTicketButtons();
    }
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('gwTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (!b) return;
  document.querySelectorAll('#gwTabs .tab').forEach((t) => t.classList.remove('is-active'));
  b.classList.add('is-active'); tab = b.dataset.status; loadList();
});

document.getElementById('gwList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-a]'); if (!btn) return;
  const id = btn.dataset.id, a = btn.dataset.a;
  try {
    if (a === 'end') {
      if (!(await confirmModal('Giveaway jetzt beenden und auslosen?'))) return;
      const r = await apiFor('POST', `/giveaways/${id}/end`);
      toast(r.winners?.length ? `${r.winners.length} Gewinner ausgelost` : 'Beendet – keine Teilnahmen.', 'success');
      loadList(); loadTempRoles();
    } else if (a === 'cancel') {
      if (!(await confirmModal('Ohne Gewinner abbrechen?', { danger: true, confirmLabel: 'Abbrechen' }))) return;
      await apiFor('POST', `/giveaways/${id}/cancel`); toast('Abgebrochen.', 'success'); loadList();
    } else if (a === 'reroll') {
      await rerollModal(id);
    } else if (a === 'time') {
      await timeModal(id);
    } else if (a === 'edit') {
      await editModal(id);
    } else if (a === 'winners') {
      await winnersModal(id);
    }
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------- Modals ---------- */

function hostPickerHtml(hostId) {
  if (!window.IS_OWNER) return '';
  return `
    <div class="field">
      <label>Veranstalter <span class="muted">(optional, Standard: du selbst)</span></label>
      <input type="hidden" name="hostId" value="${hostId ? escapeHtml(hostId) : ''}">
      <div class="host-picker">
        <input type="text" class="host-picker__search" placeholder="Nach Namen oder ID suchen…" autocomplete="off">
        <button type="button" class="btn btn--ghost btn--sm host-picker__reset">Zurücksetzen</button>
        <div class="host-picker__selected muted"></div>
        <div class="host-picker__results"></div>
      </div>
    </div>`;
}

async function wireHostPicker(modal, initialHostId) {
  if (!window.IS_OWNER) return;
  const hidden = modal.querySelector('input[name=hostId]');
  const search = modal.querySelector('.host-picker__search');
  const resetBtn = modal.querySelector('.host-picker__reset');
  const selectedEl = modal.querySelector('.host-picker__selected');
  const resultsEl = modal.querySelector('.host-picker__results');

  const showSelected = (name, tag) => {
    selectedEl.textContent = name ? `Ausgewählt: ${name}${tag ? ' (' + tag + ')' : ''}` : 'Standard: du selbst';
  };
  showSelected(null);

  if (initialHostId) {
    try {
      const list = await apiFor('GET', `/members?q=${initialHostId}`);
      if (list[0]) showSelected(list[0].displayName, list[0].tag);
    } catch { /* ignore */ }
  }

  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    const q = search.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    t = setTimeout(async () => {
      try {
        const list = await apiFor('GET', `/members?q=${encodeURIComponent(q)}`);
        resultsEl.innerHTML = list.slice(0, 8).map((m) => `
          <div class="host-picker__row" data-id="${m.id}" data-name="${escapeHtml(m.displayName)}" data-tag="${escapeHtml(m.tag)}">
            <img src="${escapeHtml(m.avatarUrl)}" alt="" />
            <span>${escapeHtml(m.displayName)} <span class="muted">${escapeHtml(m.tag)}</span></span>
          </div>`).join('') || '<div class="muted" style="padding:6px;">Kein Treffer.</div>';
      } catch (err) { toast(err.message, 'error'); }
    }, 300);
  });

  resultsEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    hidden.value = row.dataset.id;
    showSelected(row.dataset.name, row.dataset.tag);
    resultsEl.innerHTML = '';
    search.value = '';
  });

  resetBtn.addEventListener('click', () => {
    hidden.value = '';
    showSelected(null);
    resultsEl.innerHTML = '';
    search.value = '';
  });
}

async function newGiveawayModal() {
  const [ch, roles] = await Promise.all([getChannels(), getRoles()]);
  const chOpts = ch.text.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  const roleOpts = roles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const { modal, close } = openModal(`
    <h2>🎉 Giveaway erstellen</h2>
    <form id="gForm" class="form">
      <div class="field"><label>Preis</label><input name="prize" required placeholder="z. B. Minecraft Rang" /></div>
      <div class="col-2">
        <div class="field"><label>Kanal</label><select name="channelId"><option value="">Standard</option>${chOpts}</select></div>
        <div class="field"><label>Dauer</label><input name="duration" required placeholder="24h" />${window.IS_OWNER ? '<small>Als Besitzer: auch unter 10 Sekunden möglich.</small>' : ''}</div>
        <div class="field"><label>Gewinner</label><input name="winnerCount" type="number" min="1" ${window.IS_OWNER ? '' : 'max="20"'} value="1" /></div>
        <div class="field"><label>Erforderliche Rolle</label><select name="requiredRoleId"><option value="">Keine</option>${roleOpts}</select></div>
        <div class="field"><label>Gewinnerrolle</label><select name="winnerRoleId"><option value="">Standard</option>${roleOpts}</select></div>
        <div class="field"><label>Rollen-Dauer</label><input name="winnerRoleDuration" placeholder="${fmtDuration(settings.giveaway_winner_role_duration_ms || 86400000)}" /></div>
      </div>
      <div class="field"><label>Beschreibung (optional)</label><textarea name="description" rows="2"></textarea></div>
      ${hostPickerHtml()}
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-x>Abbrechen</button>
        <button type="submit" class="btn btn--primary">🎉 Giveaway starten</button>
      </div>
    </form>`);
  wireHostPicker(modal, null);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#gForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await apiFor('POST', '/giveaways', readForm(e.target));
      toast('Giveaway gestartet!', 'success'); close();
      tab = 'active';
      document.querySelectorAll('#gwTabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.status === 'active'));
      loadList();
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function rerollModal(id) {
  const g = await apiFor('GET', `/giveaways/${id}`);
  const { modal, close } = openModal(`
    <h2>${icon('refresh')} Neu auslosen – #${id}</h2>
    <p class="muted">Bisher: ${(g.winners || []).map((w) => '&lt;@' + escapeHtml(w) + '&gt;').join(', ') || 'keine'}</p>
    <form id="rf" class="form">
      <div class="field"><label>Anzahl neuer Gewinner</label><input name="count" type="number" min="1" max="20" value="${g.winner_count}" /></div>
      <label class="row-inline"><input type="checkbox" name="keepPrevious" style="width:auto;"> <span>Bisherige behalten</span></label>
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-x>Abbrechen</button><button class="btn btn--primary">Auslosen</button></div>
    </form>`);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#rf').onsubmit = async (e) => {
    e.preventDefault();
    const d = readForm(e.target);
    try {
      const r = await apiFor('POST', `/giveaways/${id}/reroll`, { count: Number(d.count), keepPrevious: d.keepPrevious });
      toast(`${r.newWinners.length} neue Gewinner`, 'success'); close(); loadList(); loadTempRoles();
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function timeModal(id) {
  const { modal, close } = openModal(`
    <h2>${icon('clock')} Zeit hinzufügen – #${id}</h2>
    <form id="tf" class="form">
      <div class="field"><label>Zeit</label><input name="addTime" required placeholder="1h / 30m / 1d" /></div>
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-x>Abbrechen</button><button class="btn btn--primary">Verlängern</button></div>
    </form>`);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#tf').onsubmit = async (e) => {
    e.preventDefault();
    try { await apiFor('PATCH', `/giveaways/${id}`, { addTime: readForm(e.target).addTime }); toast('Verlängert.', 'success'); close(); loadList(); }
    catch (err) { toast(err.message, 'error'); }
  };
}

async function editModal(id) {
  const g = await apiFor('GET', `/giveaways/${id}`);
  const roles = await getRoles();
  const roleOpts = roles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const { modal, close } = openModal(`
    <h2>${icon('edit')} Bearbeiten – #${id}</h2>
    ${g.ended ? '<p class="muted">Dieses Giveaway ist bereits beendet – als Besitzer kannst du es trotzdem noch bearbeiten.</p>' : ''}
    <form id="ef" class="form">
      <div class="field"><label>Preis</label><input name="prize" value="${escapeHtml(g.prize)}" /></div>
      <div class="field"><label>Beschreibung</label><textarea name="description" rows="2">${escapeHtml(g.description || '')}</textarea></div>
      <div class="field"><label>Gewinner</label><input name="winnerCount" type="number" min="1" ${window.IS_OWNER ? '' : 'max="20"'} value="${g.winner_count}" /></div>
      <div class="field"><label>Erforderliche Rolle</label><select name="requiredRoleId"><option value="">Keine</option>${roleOpts}</select></div>
      <div class="field"><label>Gewinnerrolle</label><select name="winnerRoleId"><option value="">Keine</option>${roleOpts}</select></div>
      ${hostPickerHtml(g.host_id)}
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-x>Abbrechen</button><button class="btn btn--primary">Speichern</button></div>
    </form>`);
  if (g.required_role_id) modal.querySelector('[name=requiredRoleId]').value = g.required_role_id;
  if (g.winner_role_id) modal.querySelector('[name=winnerRoleId]').value = g.winner_role_id;
  wireHostPicker(modal, g.host_id);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#ef').onsubmit = async (e) => {
    e.preventDefault();
    try { await apiFor('PATCH', `/giveaways/${id}`, readForm(e.target)); toast('Gespeichert.', 'success'); close(); loadList(); }
    catch (err) { toast(err.message, 'error'); }
  };
}

async function winnersModal(id) {
  const g = await apiFor('GET', `/giveaways/${id}`);
  const hist = (g.winner_history || []).map((w) => `<li><span class="activity__ico">${icon(w.is_reroll ? 'refresh' : 'star', 'icon--sm')}</span><span>&lt;@${escapeHtml(w.user_id)}&gt;</span><time>${escapeHtml(fmtDate(w.drawn_at))}</time></li>`).join('');
  const { modal, close } = openModal(`
    <h2>🏆 Gewinner – #${id}</h2>
    <p><strong>${escapeHtml(g.prize)}</strong></p>
    <p class="muted">Aktuell: ${(g.winners || []).map((w) => '&lt;@' + escapeHtml(w) + '&gt;').join(', ') || 'keine'}</p>
    <ul class="activity">${hist || '<li class="muted">Keine Historie.</li>'}</ul>
    <div class="modal__actions"><button class="btn btn--primary" data-x>Schließen</button></div>`);
  modal.querySelector('[data-x]').onclick = close;
}

document.getElementById('newGiveawayBtn').addEventListener('click', () => newGiveawayModal().catch((e) => toast(e.message, 'error')));

(async function init() {
  try {
    await loadSettings();
    Dash.trackForm(document.getElementById('gwSettings'), saveGwSettings, { reset: loadSettings });
    await loadList();
    await loadTempRoles();
    await loadTicketButtons();
  } catch (e) { toast(e.message, 'error'); }
})();
