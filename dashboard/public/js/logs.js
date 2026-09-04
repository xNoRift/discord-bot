/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, escapeHtml, fmtRelative, icon, toast } = Dash;

let filter = '';
const ICО = {
  ticket_create: 'ticket', ticket_close: 'ticket', ticket_reopen: 'ticket', ticket_delete: 'trash', ticket_claim: 'check',
  giveaway_create: 'gift', giveaway_end: 'gift', giveaway_winners: 'star', giveaway_reroll: 'refresh',
  giveaway_cancel: 'x', giveaway_role_granted: 'star', giveaway_role_removed: 'clock',
  application_create: 'clipboard', application_accept: 'check', application_reject: 'x',
  mod_warn: 'bell', mod_timeout: 'clock', mod_kick: 'x', mod_ban: 'x', mod_purge: 'trash',
};

function buildQuery() {
  const params = new URLSearchParams({ limit: '100' });
  if (filter) params.set('category', filter);
  const actorId = document.getElementById('logActorId').value.trim();
  if (actorId) params.set('actorId', actorId);
  const from = document.getElementById('logFrom').value;
  if (from) params.set('from', String(new Date(from + 'T00:00:00').getTime()));
  const to = document.getElementById('logTo').value;
  if (to) params.set('to', String(new Date(to + 'T23:59:59').getTime()));
  return params.toString();
}

async function loadLogs() {
  const w = document.getElementById('logList');
  w.innerHTML = '<li class="loading">Lädt…</li>';
  try {
    const rows = await apiFor('GET', `/activity?${buildQuery()}`);
    w.innerHTML = rows.length
      ? rows.map((r) => `<li>
      <span class="activity__ico">${icon(ICО[r.type] || 'bell', 'icon--sm')}</span>
      <span>${escapeHtml(r.message || r.type)}${r.actor_id ? ` <span class="muted">· von ${escapeHtml(r.actor_id)}</span>` : ''}</span>
      <time>${escapeHtml(fmtRelative(r.created_at))}</time></li>`).join('')
      : '<li class="muted">Keine Einträge.</li>';
  } catch (e) { w.innerHTML = `<li class="muted">${escapeHtml(e.message)}</li>`; }
}

document.getElementById('logTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (!b) return;
  document.querySelectorAll('#logTabs .tab').forEach((t) => t.classList.remove('is-active'));
  b.classList.add('is-active'); filter = b.dataset.f; loadLogs();
});
document.getElementById('reload').addEventListener('click', loadLogs);
document.getElementById('logFilterApply').addEventListener('click', loadLogs);
document.getElementById('logFilterClear').addEventListener('click', () => {
  document.getElementById('logActorId').value = '';
  document.getElementById('logFrom').value = '';
  document.getElementById('logTo').value = '';
  loadLogs();
});

document.getElementById('logChannels').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await apiFor('PATCH', '/settings', readForm(e.target)); toast('Gespeichert.', 'success'); }
  catch (err) { toast(err.message, 'error'); }
});

(async function init() {
  try {
    const s = await apiFor('GET', '/settings');
    await fillSelectors(s);
    ['log_channel_id', 'ticket_log_channel_id', 'giveaway_log_channel_id', 'application_log_channel_id'].forEach((k) => {
      const el = document.querySelector(`#logChannels [name=${k}]`);
      if (el && s[k]) el.value = s[k];
    });
    await loadLogs();
  } catch (e) { toast(e.message, 'error'); }
})();
