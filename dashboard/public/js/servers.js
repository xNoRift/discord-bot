/* global window, document, Dash */
'use strict';

const { api, escapeHtml, icon, toast } = Dash;
const CLIENT_ID = Dash.PAGE_DATA.clientId;
const INVITE_PERMS = Dash.PAGE_DATA.invitePermissions || '8';

function serverIcon(g) {
  if (g.icon) return `<img class="server-icon" src="https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128" alt="" />`;
  return `<span class="server-icon">${escapeHtml((g.name || '?').charAt(0).toUpperCase())}</span>`;
}

function inviteUrl(id) {
  return `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot+applications.commands&permissions=${INVITE_PERMS}${id ? `&guild_id=${id}` : ''}`;
}

async function load(refresh) {
  const managed = document.getElementById('managedGuilds');
  const invCard = document.getElementById('invitableCard');
  const invWrap = document.getElementById('invitableGuilds');
  managed.innerHTML = '<div class="loading">Server werden geladen…</div>';
  try {
    const data = await api('GET', `/api/guilds${refresh ? '?refresh=1' : ''}`);
    managed.innerHTML = data.managed.length
      ? data.managed.map((g) => `
        <a class="server-card" href="/dashboard/${g.id}">
          ${serverIcon(g)}
          <b>${escapeHtml(g.name)}</b>
          <span class="server-meta">${g.memberCount ? g.memberCount + ' Mitglieder' : 'Verwalten'}</span>
          <span class="badge badge--green">Bot aktiv</span>
        </a>`).join('')
      : `<div class="empty">${icon('server')}<b>Keine verwaltbaren Server</b>Lade den Bot auf einen Server ein, auf dem du Admin bist.</div>`;

    if (data.invitable.length) {
      invCard.hidden = false;
      invWrap.innerHTML = data.invitable.map((g) => `
        <div class="server-card">
          ${serverIcon(g)}
          <b>${escapeHtml(g.name)}</b>
          <a class="btn btn--primary btn--sm" href="${inviteUrl(g.id)}" target="_blank" rel="noopener">${icon('plus', 'icon--sm')} Bot einladen</a>
        </div>`).join('');
    } else invCard.hidden = true;
  } catch (e) {
    managed.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    toast(e.message, 'error');
  }
}

document.getElementById('refreshGuilds').addEventListener('click', () => { toast('Aktualisiere…', 'info', 1200); load(true); });
load(false);
