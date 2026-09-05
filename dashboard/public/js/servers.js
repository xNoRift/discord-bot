/* global window, document, Dash */
'use strict';

const { api, escapeHtml, icon, toast } = Dash;
const CLIENT_ID = Dash.PAGE_DATA.clientId;
const INVITE_PERMS = Dash.PAGE_DATA.invitePermissions || '8';

let DATA = { managed: [], invitable: [] };

function serverIcon(g) {
  if (g.icon) return `<img class="server-icon" src="https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128" alt="" />`;
  return `<span class="server-icon">${escapeHtml((g.name || '?').charAt(0).toUpperCase())}</span>`;
}

function inviteUrl(id) {
  return `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot+applications.commands&permissions=${INVITE_PERMS}${id ? `&guild_id=${id}` : ''}`;
}

function render() {
  const q = document.getElementById('guildSearch').value.trim().toLowerCase();
  const match = (g) => !q || (g.name || '').toLowerCase().includes(q);
  const managed = DATA.managed.filter(match);
  const invitable = DATA.invitable.filter(match);

  const mWrap = document.getElementById('managedGuilds');
  mWrap.innerHTML = managed.length
    ? managed.map((g) => `
        <a class="server-card" href="/dashboard/${g.id}">
          ${serverIcon(g)}
          <b>${escapeHtml(g.name)}</b>
          <span class="server-meta">${g.memberCount ? g.memberCount + ' Mitglieder' : 'Verwalten'}</span>
          <span class="badge badge--green">Bot aktiv</span>
        </a>`).join('')
    : q
      ? `<div class="empty">${icon('server')}<b>Kein Treffer für „${escapeHtml(q)}"</b></div>`
      : `<div class="empty">${icon('server')}<b>Keine verwaltbaren Server</b>Lade den Bot auf einen Server ein, auf dem du Admin bist.</div>`;

  const invCard = document.getElementById('invitableCard');
  const invWrap = document.getElementById('invitableGuilds');
  if (invitable.length) {
    invCard.hidden = false;
    invWrap.innerHTML = invitable.map((g) => `
        <div class="server-card">
          ${serverIcon(g)}
          <b>${escapeHtml(g.name)}</b>
          <a class="btn btn--primary btn--sm" href="${inviteUrl(g.id)}" target="_blank" rel="noopener">${icon('plus', 'icon--sm')} Bot einladen</a>
        </div>`).join('');
  } else {
    invCard.hidden = true;
  }
}

async function load(refresh) {
  document.getElementById('managedGuilds').innerHTML = '<div class="loading">Server werden geladen…</div>';
  try {
    DATA = await api('GET', `/api/guilds${refresh ? '?refresh=1' : ''}`);
    render();
  } catch (e) {
    document.getElementById('managedGuilds').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    toast(e.message, 'error');
  }
}

document.getElementById('guildSearch').addEventListener('input', render);
document.getElementById('refreshGuilds').addEventListener('click', () => { toast('Aktualisiere…', 'info', 1200); load(true); });
load(false);
