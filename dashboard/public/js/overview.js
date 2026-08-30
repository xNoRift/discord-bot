/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, fmtRelative, icon, toast } = Dash;

const ACT_ICON = {
  ticket_create: 'ticket', ticket_close: 'ticket', ticket_reopen: 'ticket', ticket_delete: 'trash', ticket_claim: 'check',
  giveaway_create: 'gift', giveaway_end: 'gift', giveaway_winners: 'star', giveaway_reroll: 'refresh',
  giveaway_cancel: 'x', giveaway_role_granted: 'star', giveaway_role_removed: 'clock', giveaway_role_failed: 'x',
  application_create: 'clipboard', application_accept: 'check', application_reject: 'x',
};

async function load() {
  try {
    const d = await apiFor('GET', '/overview');
    document.getElementById('kBot').textContent = d.bot.online ? '🟢 Online' : '🔴 Offline';
    document.getElementById('kBotSub').textContent = `${d.bot.ping} ms · ${d.bot.guildCount} Server`;
    document.getElementById('kMembers').textContent = d.guild.memberCount ?? '–';
    document.getElementById('kTickets').textContent = d.tickets.open;
    document.getElementById('kTicketsSub').textContent = `${d.tickets.total} insgesamt`;
    document.getElementById('kGiveaways').textContent = d.giveaways.active;
    document.getElementById('kApps').textContent = d.applications.pending;
    document.getElementById('kAppsSub').textContent = `${d.applications.accepted} ✓ · ${d.applications.rejected} ✗`;

    document.getElementById('iName').textContent = d.guild.name;
    document.getElementById('iOwner').textContent = d.guild.ownerId ? `<@${d.guild.ownerId}>` : '–';
    document.getElementById('iTempRoles').textContent = d.tempRoles ?? 0;

    const list = document.getElementById('activityList');
    list.innerHTML = d.activity.length
      ? d.activity.map((a) => `<li>
          <span class="activity__ico">${icon(ACT_ICON[a.type] || 'bell', 'icon--sm')}</span>
          <span>${escapeHtml(a.message || a.type)}</span>
          <time>${escapeHtml(fmtRelative(a.created_at))}</time></li>`).join('')
      : '<li class="muted">Noch keine Aktivität.</li>';
  } catch (e) { toast(e.message, 'error'); }
}

load();
setInterval(load, 20000);
