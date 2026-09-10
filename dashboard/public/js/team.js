/* global document, Dash */
'use strict';

const { apiFor, getRoles, escapeHtml, toast } = Dash;

let ROLES = [];

function nameOf(id) {
  const r = ROLES.find((x) => String(x.id) === String(id));
  return r ? r.name : (id ? `Rolle ${id}` : '— nicht gesetzt —');
}

async function loadTeam() {
  const [roles, settings] = await Promise.all([getRoles(), apiFor('GET', '/settings')]);
  ROLES = roles;
  const selected = new Set((settings.team_role_ids || '').split(',').filter(Boolean));

  document.getElementById('roleChecks').innerHTML = roles.map((r) => `
    <label class="setting-row" style="cursor:pointer;">
      <input type="checkbox" name="role_${r.id}" value="${r.id}" ${selected.has(r.id) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);">
      <span class="setting-row__text"><b>${escapeHtml(r.name)}</b></span>
    </label>`).join('');

  document.getElementById('rSupport').textContent = nameOf(settings.ticket_support_role_id);
  document.getElementById('rApp').textContent = nameOf(settings.application_team_role_id);
  document.getElementById('rGw').textContent = nameOf(settings.giveaway_winner_role_id);
}

async function saveTeam() {
  const ids = [...document.querySelectorAll('#roleChecks input:checked')].map((c) => c.value).join(',');
  try {
    await apiFor('PATCH', '/settings', { team_role_ids: ids });
    toast('Team-Rollen gespeichert.', 'success');
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

(async function init() {
  try {
    await loadTeam();
    Dash.trackForm(document.getElementById('teamForm'), saveTeam, { reset: loadTeam });
  } catch (e) {
    toast(e.message, 'error');
  }
})();
