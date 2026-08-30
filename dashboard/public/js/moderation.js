/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, toast } = Dash;

(async function init() {
  try {
    const s = await apiFor('GET', '/settings');
    await fillSelectors(s);
    const el = document.querySelector('#modForm [name=mod_log_channel_id]');
    if (el && s.mod_log_channel_id) el.value = s.mod_log_channel_id;
  } catch (e) { toast(e.message, 'error'); }
})();

document.getElementById('modForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await apiFor('PATCH', '/settings', readForm(e.target)); toast('Gespeichert.', 'success'); }
  catch (err) { toast(err.message, 'error'); }
});

/* ---------------- Aktion gegen einen Nutzer ---------------- */

const actForm = document.getElementById('modActionForm');
const actStatus = document.getElementById('modActionStatus');
let pendingAct = 'timeout';

actForm.querySelectorAll('button[data-act]').forEach((b) => {
  b.addEventListener('click', () => { pendingAct = b.dataset.act; });
});

actForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(actForm);
  if (!a.userId) return toast('Bitte eine User-ID angeben.', 'error');

  const harsh = pendingAct === 'kick' || pendingAct === 'ban';
  if (harsh && !(await Dash.confirmModal(`Nutzer ${a.userId} wirklich ${pendingAct === 'kick' ? 'kicken' : 'bannen'}?`, { danger: true }))) return;

  actStatus.textContent = 'Wird ausgeführt…';
  try {
    const r = await apiFor('POST', '/moderation/action', {
      action: pendingAct,
      userId: a.userId,
      reason: a.reason,
      minutes: a.minutes,
    });
    toast(r.summary, 'success');
    actStatus.textContent = '✓ ' + r.summary;
  } catch (err) {
    toast(err.message, 'error');
    actStatus.textContent = err.message;
  }
});

/* ---------------- Purge ---------------- */

const purgeForm = document.getElementById('modPurgeForm');
const purgeStatus = document.getElementById('modPurgeStatus');

purgeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(purgeForm);
  if (!a.channelId) return toast('Bitte einen Kanal wählen.', 'error');
  if (!(await Dash.confirmModal(`Die letzten ${a.count || 10} Nachrichten löschen?`, { danger: true }))) return;

  purgeStatus.textContent = 'Wird gelöscht…';
  try {
    const r = await apiFor('POST', '/moderation/purge', { channelId: a.channelId, count: a.count, userId: a.userId });
    toast(`${r.deleted} Nachricht(en) gelöscht.`, 'success');
    purgeStatus.textContent = `✓ ${r.deleted} gelöscht`;
  } catch (err) {
    toast(err.message, 'error');
    purgeStatus.textContent = err.message;
  }
});
