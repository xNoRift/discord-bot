/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, getRoles, icon, confirmModal, toast } = Dash;

let ROLES = [];
const roleName = (id) => ROLES.find((r) => String(r.id) === String(id))?.name || 'gelöschte Rolle';

async function loadRewards() {
  const w = document.getElementById('rewardList');
  try {
    const list = await apiFor('GET', '/levels/rewards');
    w.innerHTML = list.length
      ? list.map((r) => `<div class="list-row">
          <div class="list-row__head">
            <span class="list-row__title">${icon('star', 'icon--sm')} Level ${r.level} → @${escapeHtml(roleName(r.role_id))}</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--danger btn--sm" data-del="${r.id}">${icon('trash', 'icon--sm')}</button>
          </div></div>`).join('')
      : `<div class="empty">${icon('gift')}<b>Keine Belohnungen</b>Lege oben eine an.</div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

async function loadBoard() {
  const w = document.getElementById('board');
  try {
    const d = await apiFor('GET', '/levels/leaderboard?limit=20');
    w.innerHTML = d.rows.length
      ? d.rows.map((r) => `<div class="list-row">
          <div class="list-row__head">
            <span class="list-row__title">#${r.rank} ${escapeHtml(r.name || 'Mitglied ' + r.userId)}</span>
            <span class="badge badge--active">Level ${r.level}</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--ghost btn--sm" data-reset="${r.userId}" title="XP zurücksetzen">${icon('refresh', 'icon--sm')}</button>
          </div>
          <div class="list-row__meta"><span>${r.xp} XP</span><span>${r.messages} Nachrichten</span><span>${r.voiceMinutes} Min. Sprache</span><span>${r.progress}% zum nächsten Level</span></div>
        </div>`).join('')
      : `<div class="empty">${icon('chart')}<b>Noch keine Daten</b>Sobald Mitglieder schreiben, erscheint hier die Rangliste.</div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

document.getElementById('rewardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiFor('POST', '/levels/rewards', {
      level: document.getElementById('rwLevel').value,
      roleId: document.getElementById('rwRole').value,
    });
    document.getElementById('rwLevel').value = '';
    toast('Belohnung hinzugefügt.', 'success');
    await loadRewards();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('rewardList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  const id = btn.dataset.del;
  try {
    if (!(await confirmModal('Diese Belohnung entfernen?', { danger: true, confirmLabel: 'Entfernen' }))) return;
    await apiFor('DELETE', `/levels/rewards/${id}`);
    await loadRewards();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('board').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-reset]');
  if (!btn) return;
  const uid = btn.dataset.reset;
  try {
    if (!(await confirmModal('XP dieses Mitglieds zurücksetzen?', { danger: true, confirmLabel: 'Zurücksetzen' }))) return;
    await apiFor('DELETE', `/levels/users/${uid}`);
    await loadBoard();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('lvlResetAll').addEventListener('click', async () => {
  try {
    if (!(await confirmModal('ALLE XP und Level auf diesem Server zurücksetzen? Das kann nicht rückgängig gemacht werden.', { danger: true, confirmLabel: 'Alles zurücksetzen' }))) return;
    await apiFor('POST', '/levels/reset');
    toast('Zurückgesetzt.', 'success');
    await loadBoard();
  } catch (err) { toast(err.message, 'error'); }
});

(async function init() {
  try {
    ROLES = await getRoles();
    await Dash.moduleForm('levels', document.getElementById('lvlForm'), {
      on: 'Das Level-System ist aktiv. Mitglieder sammeln ab jetzt XP.',
      off: 'Das Level-System ist deaktiviert. Aktiviere es, damit Mitglieder XP sammeln.',
    });
    await Promise.all([loadRewards(), loadBoard()]);
  } catch (e) { toast(e.message, 'error'); }
})();
