/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, applyToForm, escapeHtml, toast } = Dash;
const { getRoles } = Dash;

const form = document.getElementById('welcomeForm');
const statusEl = document.getElementById('wcStatus');
const colorPick = document.getElementById('wcColor');
const colorText = document.getElementById('wcColorText');

function roleChecklist(roles, selected) {
  return roles
    .map(
      (r) => `<label class="setting-row" style="cursor:pointer;padding:8px 0;">
        <input type="checkbox" value="${r.id}" ${selected.has(r.id) ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent);">
        <span class="setting-row__text"><b>${escapeHtml(r.name)}</b></span>
      </label>`,
    )
    .join('');
}

let current = {};

async function load() {
  const [s, roles] = await Promise.all([apiFor('GET', '/settings'), getRoles()]);
  current = s;
  await fillSelectors(s);
  applyToForm(form, s);

  const col = /^#?[0-9a-f]{6}$/i.test(s.welcome_color || '') ? s.welcome_color : '#7c5cff';
  colorPick.value = col[0] === '#' ? col : '#' + col;
  colorText.value = s.welcome_color || '';

  const sel = new Set((s.autorole_ids || '').split(',').filter(Boolean));
  document.getElementById('joinRoleChecks').innerHTML =
    roles.length ? roleChecklist(roles, sel) : '<p class="muted">Keine Rollen gefunden.</p>';
}

colorPick.addEventListener('input', () => { colorText.value = colorPick.value; });
colorText.addEventListener('input', () => {
  const v = colorText.value.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(v)) colorPick.value = v[0] === '#' ? v : '#' + v;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(form);
  const joinRoles = [...document.querySelectorAll('#joinRoleChecks input:checked')].map((c) => c.value).join(',');
  try {
    await apiFor('PATCH', '/settings', {
      welcome_enabled: a.welcome_enabled ? 1 : 0,
      welcome_channel_id: a.welcome_channel_id || null,
      welcome_message: a.welcome_message || null,
      welcome_embed: a.welcome_embed ? 1 : 0,
      welcome_ping: a.welcome_ping ? 1 : 0,
      welcome_color: a.welcome_color || null,
      welcome_dm_enabled: a.welcome_dm_enabled ? 1 : 0,
      welcome_dm_message: a.welcome_dm_message || null,
      leave_enabled: a.leave_enabled ? 1 : 0,
      leave_channel_id: a.leave_channel_id || null,
      leave_message: a.leave_message || null,
      autorole_ids: joinRoles,
    });
    toast('Willkommens-System gespeichert.', 'success');
    statusEl.textContent = 'Gespeichert ✓';
    await load();
  } catch (err) {
    toast(err.message, 'error');
    statusEl.textContent = err.message;
  }
});

document.getElementById('wcTest').addEventListener('click', async () => {
  try {
    statusEl.textContent = 'Test wird gesendet…';
    await apiFor('POST', '/welcome/test', { kind: 'join' });
    toast('Testnachricht gesendet – schau in den gewählten Kanal.', 'success');
    statusEl.textContent = 'Test gesendet ✓';
  } catch (err) {
    toast(err.message, 'error');
    statusEl.textContent = err.message;
  }
});

load().catch((e) => toast(e.message, 'error'));
