/* global document, Dash */
'use strict';

const { api, apiFor, fillSelectors, readForm, escapeHtml, fmtDuration, toast } = Dash;

let settings = {};

async function load() {
  settings = await apiFor('GET', '/settings');
  await fillSelectors(settings);
  const form = document.getElementById('settingsForm');
  for (const el of form.elements) {
    if (!el.name || !(el.name in settings)) continue;
    if (el.name === 'giveaway_winner_role_duration_ms') el.value = fmtDuration(settings[el.name] || 86400000);
    else if (settings[el.name] != null) el.value = settings[el.name];
  }
  const ec = document.getElementById('ec');
  const ect = document.getElementById('ect');
  ect.value = settings.embed_color || '';
  ec.value = /^#?[0-9a-f]{6}$/i.test(settings.embed_color || '') ? (settings.embed_color[0] === '#' ? settings.embed_color : '#' + settings.embed_color) : '#7c5cff';
  ec.oninput = () => { ect.value = ec.value; };
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    settings = await apiFor('PATCH', '/settings', readForm(e.target));
    document.getElementById('sStatus').textContent = 'Gespeichert ✓';
    toast('Alle Einstellungen gespeichert.', 'success');
    await load();
  } catch (err) { toast(err.message, 'error'); }
});

load().catch((e) => toast(e.message, 'error'));

/* ---------------- Bot auf diesem Server (Nickname + Server-Avatar) ---------------- */

const statusEl = document.getElementById('botProfileStatus');

async function loadBotMember() {
  try {
    const p = await apiFor('GET', '/bot-member');
    document.getElementById('botAvatar').src = (p.avatarUrl || '') + (p.avatarUrl ? '?t=' + Date.now() : '');
    document.getElementById('botNick').value = p.nick || '';
    document.getElementById('botNick').placeholder = p.username || 'Bot';
  } catch (e) {
    statusEl.textContent = e.message;
  }
}

document.getElementById('botNickSave').addEventListener('click', async () => {
  const nick = document.getElementById('botNick').value.trim();
  try {
    const r = await apiFor('POST', '/bot-member/nick', { nick });
    toast(r.nick ? `Bot heißt hier jetzt "${r.nick}".` : 'Nickname zurückgesetzt.', 'success');
    statusEl.textContent = 'Gespeichert ✓';
  } catch (e) {
    toast(e.message, 'error');
    statusEl.textContent = e.message;
  }
});

document.getElementById('botAvatarFile').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return toast('Bild zu groß (max. 10 MB).', 'error');
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      statusEl.textContent = 'Bild wird hochgeladen…';
      const r = await apiFor('POST', '/bot-member/avatar', { avatar: reader.result }, { timeout: 60000 });
      document.getElementById('botAvatar').src = r.avatarUrl + '?t=' + Date.now();
      toast('Server-Bild des Bots geändert.', 'success');
      statusEl.textContent = 'Gespeichert ✓';
    } catch (e) {
      toast(e.message, 'error');
      statusEl.textContent = e.message;
    }
  };
  reader.readAsDataURL(file);
  ev.target.value = '';
});

document.getElementById('botAvatarReset').addEventListener('click', async () => {
  try {
    const r = await apiFor('POST', '/bot-member/avatar', { avatar: 'reset' });
    document.getElementById('botAvatar').src = r.avatarUrl + '?t=' + Date.now();
    toast('Server-Bild zurückgesetzt.', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
});

loadBotMember();

/* ---------------- Auto-Rolle ---------------- */

const { getRoles } = Dash;
const arStatus = document.getElementById('autoRoleStatus');

function roleChecklist(roles, selectedSet) {
  return roles
    .map(
      (r) => `<label class="setting-row" style="cursor:pointer;padding:8px 0;">
        <input type="checkbox" value="${r.id}" ${selectedSet.has(r.id) ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent);">
        <span class="setting-row__text"><b>${escapeHtml(r.name)}</b></span>
      </label>`,
    )
    .join('');
}

async function loadAutoRole() {
  try {
    const [roles, s] = await Promise.all([getRoles(), apiFor('GET', '/settings')]);
    const sel = new Set((s.autorole_ids || '').split(',').filter(Boolean));
    const selBot = new Set((s.autorole_bot_ids || '').split(',').filter(Boolean));
    document.getElementById('autoRoleChecks').innerHTML = roleChecklist(roles, sel);
    document.getElementById('autoRoleBotChecks').innerHTML = roleChecklist(roles, selBot);
  } catch (e) {
    arStatus.textContent = e.message;
  }
}

function collect(id) {
  return [...document.querySelectorAll(`#${id} input:checked`)].map((c) => c.value).join(',');
}

document.getElementById('autoRoleSave').addEventListener('click', async () => {
  try {
    await apiFor('PATCH', '/settings', {
      autorole_ids: collect('autoRoleChecks'),
      autorole_bot_ids: collect('autoRoleBotChecks'),
    });
    toast('Auto-Rolle gespeichert.', 'success');
    arStatus.textContent = 'Gespeichert ✓';
  } catch (e) {
    toast(e.message, 'error');
  }
});

document.getElementById('autoRoleApplyAll').addEventListener('click', async () => {
  if (!(await Dash.confirmModal('Die Auto-Rolle(n) jetzt an ALLE aktuellen Mitglieder vergeben? Das kann bei großen Servern etwas dauern.'))) return;
  try {
    arStatus.textContent = 'Wird vergeben…';
    const r = await apiFor('POST', '/autorole/apply-all', {}, { timeout: 120000 });
    toast(`Fertig: ${r.humans} Mitglieder, ${r.bots} Bots aktualisiert.`, 'success');
    arStatus.textContent = `${r.humans} Mitglieder, ${r.bots} Bots ✓`;
  } catch (e) {
    toast(e.message, 'error');
    arStatus.textContent = e.message;
  }
});

loadAutoRole();
