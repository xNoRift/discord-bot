/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, icon, openModal, confirmModal, toast, readForm } = Dash;

const RANK = { leader: '👑 Leiter', officer: '⭐ Offizier', member: 'Mitglied' };
let CLUBS = [];
let CFG = {};

function memberRow(clubId, m) {
  const label = escapeHtml(m.name || 'Mitglied ' + m.userId);
  const rankSel = m.rank === 'leader'
    ? `<span class="badge badge--active">${RANK.leader}</span>`
    : `<select data-rank="${clubId}:${m.userId}" style="max-width:130px;"><option value="member"${m.rank === 'member' ? ' selected' : ''}>Mitglied</option><option value="officer"${m.rank === 'officer' ? ' selected' : ''}>Offizier</option></select>`;
  const kick = m.rank === 'leader' ? '' : `<button type="button" class="btn btn--ghost btn--sm" data-kick="${clubId}:${m.userId}" title="Entfernen">${icon('x', 'icon--sm')}</button>`;
  return `<div class="row-inline" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line);">
    <span>${label} <span class="muted" style="font-size:.8rem;">${m.userId}</span></span><span class="row-inline">${rankSel}${kick}</span></div>`;
}

function clubCard(c) {
  return `<div class="card">
    <div class="card__head">
      <h2>${escapeHtml(c.emoji || '🛡️')} ${escapeHtml(c.name)} <span class="muted">(${c.members.length})</span></h2>
      <div class="spacer"></div>
      <button type="button" class="btn btn--ghost btn--sm" data-edit="${c.id}">${icon('edit', 'icon--sm')} Bearbeiten</button>
      <button type="button" class="btn btn--danger btn--sm" data-delclub="${c.id}">${icon('trash', 'icon--sm')}</button>
    </div>
    ${c.description ? `<p class="card__sub">${escapeHtml(c.description)}</p>` : ''}
    <div class="muted" style="font-size:.85rem;margin-bottom:8px;">
      ${c.role_id ? `Rolle: <code>${c.role_id}</code> · ` : ''}${c.channel_id ? `Kanal: <code>${c.channel_id}</code>` : 'Kein eigener Kanal'}
    </div>
    ${c.members.map((m) => memberRow(c.id, m)).join('')}
    <form class="row-inline" data-addmember="${c.id}" style="margin-top:10px;flex-wrap:wrap;">
      <input name="userId" placeholder="Nutzer-ID oder @Erwähnung" style="max-width:260px;" required />
      <button class="btn btn--outline btn--sm" type="submit">${icon('plus', 'icon--sm')} Mitglied hinzufügen</button>
    </form>
  </div>`;
}

async function load() {
  const w = document.getElementById('clubList');
  try {
    CLUBS = await apiFor('GET', '/clubs');
    w.innerHTML = CLUBS.length
      ? CLUBS.map(clubCard).join('')
      : `<div class="card"><div class="empty">${icon('users')}<b>Noch keine Clubs</b>Erstelle den ersten Club oben rechts.</div></div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

function clubModal(club) {
  const { modal, close } = openModal(`
    <h2>${icon('users')} ${club ? 'Club bearbeiten' : 'Club erstellen'}</h2>
    <form id="clubForm" class="form">
      <div class="col-2">
        <div class="field"><label>Name</label><input name="name" required maxlength="60" value="${escapeHtml(club?.name || '')}" /></div>
        <div class="field"><label>Emoji</label><input name="emoji" maxlength="16" data-emoji="one" value="${escapeHtml(club?.emoji || '')}" /></div>
      </div>
      <div class="field"><label>Beschreibung</label><textarea name="description" rows="2" maxlength="300">${escapeHtml(club?.description || '')}</textarea></div>
      <div class="field"><label>${club ? 'Neuer Leiter (Nutzer-ID, optional)' : 'Leiter (Nutzer-ID)'}</label><input name="leaderId" ${club ? '' : 'required'} placeholder="z. B. 123456789012345678" /><small>Discord: Profil → Rechtsklick → „Nutzer-ID kopieren" (Entwicklermodus).</small></div>
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-x>Abbrechen</button><button class="btn btn--primary" type="submit">${club ? 'Speichern' : 'Erstellen'}</button></div>
    </form>`);
  Dash.initEmojiInputs(modal);
  modal.querySelector('[data-x]').onclick = close;
  modal.querySelector('#clubForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = readForm(e.target);
    if (club && !d.leaderId) delete d.leaderId;
    try {
      if (club) await apiFor('PATCH', `/clubs/${club.id}`, d);
      else await apiFor('POST', '/clubs', d);
      toast('Gespeichert.', 'success'); close(); await load();
    } catch (err) { toast(err.message, 'error'); }
  };
}

document.getElementById('newClubBtn').addEventListener('click', () => clubModal(null));

document.getElementById('clubList').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]');
  const delc = e.target.closest('[data-delclub]');
  const kick = e.target.closest('[data-kick]');
  try {
    if (edit) return clubModal(CLUBS.find((c) => String(c.id) === edit.dataset.edit));
    if (delc) {
      const id = delc.dataset.delclub;
      const club = CLUBS.find((c) => String(c.id) === id);
      if (!(await confirmModal(`Club „${club?.name}" wirklich auflösen? Rolle und Kanal auf dem Server werden ebenfalls gelöscht.`, { danger: true, confirmLabel: 'Auflösen' }))) return;
      await apiFor('DELETE', `/clubs/${id}?discord=1`);
      toast('Club aufgelöst.', 'success');
      return load();
    }
    if (kick) {
      const [cid, uid] = kick.dataset.kick.split(':');
      if (!(await confirmModal('Mitglied aus dem Club entfernen?', { danger: true, confirmLabel: 'Entfernen' }))) return;
      await apiFor('DELETE', `/clubs/${cid}/members/${uid}`);
      return load();
    }
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('clubList').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-rank]');
  if (!sel) return;
  const [cid, uid] = sel.dataset.rank.split(':');
  try { await apiFor('PATCH', `/clubs/${cid}/members/${uid}`, { rank: sel.value }); toast('Rang geändert.', 'success'); await load(); }
  catch (err) { toast(err.message, 'error'); await load(); }
});

document.getElementById('clubList').addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-addmember]');
  if (!f) return;
  e.preventDefault();
  try {
    await apiFor('POST', `/clubs/${f.dataset.addmember}/members`, { userId: f.userId.value });
    toast('Mitglied hinzugefügt.', 'success');
    await load();
  } catch (err) { toast(err.message, 'error'); }
});

Dash.moduleForm('clubs', document.getElementById('clubSettings'), {
  on: 'Das Club-Modul ist aktiv. Du kannst Clubs erstellen und verwalten.',
  off: 'Das Club-Modul ist deaktiviert. Aktiviere es, um Clubs zu erstellen.',
}).then((mf) => { CFG = mf.cfg; return load(); }).catch((e) => toast(e.message, 'error'));
