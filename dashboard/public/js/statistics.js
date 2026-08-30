/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, toast } = Dash;

function bars(counts) {
  const max = Math.max(1, ...Object.values(counts));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div style="display:flex;align-items:center;gap:12px;margin:8px 0;">
        <span style="width:170px;color:var(--text-2);font-size:.85rem;">${escapeHtml(k)}</span>
        <span style="flex:1;height:10px;border-radius:6px;background:var(--surface-3);overflow:hidden;">
          <span style="display:block;height:100%;width:${(v / max) * 100}%;background:linear-gradient(90deg,var(--accent),var(--accent-2));"></span>
        </span>
        <b style="width:34px;text-align:right;">${v}</b>
      </div>`).join('');
}

(async function init() {
  try {
    const d = await apiFor('GET', '/stats');
    document.getElementById('sMembers').textContent = d.guild.memberCount ?? '–';
    document.getElementById('sChannels').textContent = d.guild.channels;
    document.getElementById('sRoles').textContent = d.guild.roles;
    document.getElementById('sTickets').textContent = d.tickets.total;
    document.getElementById('sTicketsSub').textContent = `${d.tickets.open} offen · ${d.tickets.closed} zu`;
    document.getElementById('sGiveaways').textContent = d.giveaways.total;
    document.getElementById('sGiveawaysSub').textContent = `${d.giveaways.active} aktiv`;
    document.getElementById('sApps').textContent = d.applications.total;
    document.getElementById('sAppsSub').textContent = `${d.applications.pending} offen · ${d.applications.accepted} ✓`;

    const counts = {};
    for (const a of d.activity) counts[a.type] = (counts[a.type] || 0) + 1;
    document.getElementById('actChart').innerHTML = Object.keys(counts).length
      ? bars(counts)
      : '<p class="muted">Noch keine Aktivität.</p>';
  } catch (e) { toast(e.message, 'error'); }
})();
