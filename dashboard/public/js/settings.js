/* global document, Dash */
'use strict';

const { api, apiFor, fillSelectors, readForm, escapeHtml, fmtRelative, toast } = Dash;

let settings = {};

async function load() {
  settings = await apiFor('GET', '/settings');
  await fillSelectors(settings);
  const form = document.getElementById('settingsForm');
  for (const el of form.elements) {
    if (!el.name || !(el.name in settings)) continue;
    if (settings[el.name] != null) el.value = settings[el.name];
  }
  const ec = document.getElementById('ec');
  const ect = document.getElementById('ect');
  ect.value = settings.embed_color || '';
  ec.value = /^#?[0-9a-f]{6}$/i.test(settings.embed_color || '') ? (settings.embed_color[0] === '#' ? settings.embed_color : '#' + settings.embed_color) : '#7c5cff';
  ec.oninput = () => { ect.value = ec.value; };
}

const settingsForm = document.getElementById('settingsForm');
async function saveSettings() {
  try {
    settings = await apiFor('PATCH', '/settings', readForm(settingsForm));
    document.getElementById('sStatus').textContent = 'Gespeichert ✓';
    toast('Alle Einstellungen gespeichert.', 'success');
    await load();
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

load()
  .then(() => Dash.trackForm(settingsForm, saveSettings))
  .catch((e) => toast(e.message, 'error'));

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

/* ---------------- Bot-Status / Aktivität (bot-weit) ---------------- */

const psMsg = document.getElementById('psStatusMsg');

function psToggleUrl() {
  document.getElementById('psUrlWrap').hidden = document.getElementById('psType').value !== 'streaming';
}
document.getElementById('psType').addEventListener('change', psToggleUrl);

async function loadBotPresence() {
  try {
    const p = await api('GET', '/api/bot/presence');
    document.getElementById('psStatus').value = p.status || 'online';
    document.getElementById('psType').value = p.activityType || 'none';
    document.getElementById('psText').value = p.activityText || '';
    document.getElementById('psUrl').value = p.activityUrl || '';
    psToggleUrl();
  } catch (e) {
    psMsg.textContent = e.message;
  }
}

document.getElementById('psSave').addEventListener('click', async () => {
  const body = {
    status: document.getElementById('psStatus').value,
    activityType: document.getElementById('psType').value,
    activityText: document.getElementById('psText').value.trim(),
    activityUrl: document.getElementById('psUrl').value.trim(),
  };
  try {
    await api('POST', '/api/bot/presence', body);
    toast('Bot-Status aktualisiert.', 'success');
    psMsg.textContent = 'Gespeichert ✓';
  } catch (e) {
    toast(e.message, 'error');
    psMsg.textContent = e.message;
  }
});

loadBotPresence();

/* ---------------- Sicherheit: Login-Protokoll (nur Besitzer) ---------------- */

async function loadSecurity() {
  const list = document.getElementById('loginList');
  if (!list) return; // Karte nur für Besitzer im DOM
  try {
    const d = await api('GET', '/api/security/logins');
    const st = document.getElementById('secOwnerOnlyState');
    if (st) {
      st.textContent = d.ownerOnly
        ? 'AN – nur der Bot-Besitzer kann sich einloggen.'
        : 'AUS – jeder Server-Admin kann sich einloggen. (In der .env: DASHBOARD_OWNER_ONLY=true)';
    }
    if (!d.logins.length) {
      list.innerHTML = '<li>Noch keine Anmeldungen protokolliert.</li>';
      return;
    }
    list.innerHTML = d.logins
      .map((l) => {
        const ico = l.ok ? '✅' : '⛔';
        const name = escapeHtml(l.username || l.userId || '?');
        const ip = escapeHtml(l.ip || '?');
        return `<li><span class="activity__ico">${ico}</span>
          <span><b>${name}</b> · ${ip}${l.ok ? '' : ' · <span style="color:var(--red)">abgelehnt</span>'}</span>
          <time>${fmtRelative ? fmtRelative(l.at) : new Date(l.at).toLocaleString()}</time></li>`;
      })
      .join('');
  } catch (e) {
    list.innerHTML = `<li style="color:var(--red)">${escapeHtml(e.message)}</li>`;
  }
}

loadSecurity();
