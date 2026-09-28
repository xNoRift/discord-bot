/* global document, window, Dash */
'use strict';

// Reiter auf der Social-Media-Seite
function showTab(name) {
  document.querySelectorAll('#socialTabs .tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  document.querySelectorAll('section[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}
document.querySelectorAll('#socialTabs .tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    showTab(btn.dataset.tab);
    const url = new URL(window.location.href);
    if (btn.dataset.tab === 'subs') url.searchParams.set('tab', 'subs'); else url.searchParams.delete('tab');
    window.history.replaceState(null, '', url);
  });
});
if (new URLSearchParams(window.location.search).get('tab') === 'subs') showTab('subs');

const connBox = document.getElementById('tsConn');
const membersBox = document.getElementById('tsMembers');
const esc = Dash.escapeHtml;
const tierBadge = (t) => (t ? `<span class="badge badge--green">Stufe ${t}</span>` : '<span class="badge badge--off">kein Sub</span>');
const connectUrl = `/twitch/connect/${Dash.GUILD_ID}`;

async function loadStatus() {
  let st;
  try {
    st = await Dash.apiFor('GET', '/twitchsubs/status');
  } catch (err) {
    connBox.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  document.getElementById('tsSetup').hidden = st.configured;
  document.getElementById('tsRedirect').innerHTML = st.configured
    ? `Einmalig auf dev.twitch.tv bei deiner App als <b>OAuth Redirect URL</b> eintragen: <code>${esc(st.redirectUri)}</code>`
    : '';

  const b = st.broadcaster;
  if (!b) {
    connBox.innerHTML = `
      <div class="row-inline">
        ${st.configured
          ? `<a class="btn btn--primary btn--sm" href="${connectUrl}">${Dash.icon('external', 'icon--sm')} Mit Twitch verbinden</a>`
          : `<button type="button" class="btn btn--primary btn--sm" disabled>${Dash.icon('external', 'icon--sm')} Mit Twitch verbinden</button>`}
        <span class="muted">Noch kein Twitch-Kanal verbunden.</span>
      </div>`;
  } else {
    connBox.innerHTML = `
      <div class="setting-row">
        <div class="setting-row__text">
          <b>Verbunden mit <a href="https://twitch.tv/${esc(b.login)}" target="_blank" rel="noopener">${esc(b.name)}</a></b>
          <span>${b.lastSyncAt ? `Letzter Abgleich ${esc(Dash.fmtRelative(b.lastSyncAt))} · ${b.subCount ?? 0} Abonnenten auf Twitch` : 'Noch kein Abgleich gelaufen.'}</span>
        </div>
      </div>
      ${b.lastError ? `<p class="muted" style="color:var(--red);margin:8px 0;">⚠ ${esc(b.lastError)}</p>` : ''}
      <div class="row-inline" style="flex-wrap:wrap;margin-top:10px;">
        <button type="button" class="btn btn--primary btn--sm" id="tsSync">${Dash.icon('refresh', 'icon--sm')} Jetzt abgleichen</button>
        <a class="btn btn--ghost btn--sm" href="${connectUrl}">${Dash.icon('external', 'icon--sm')} Neu verbinden</a>
        <button type="button" class="btn btn--ghost btn--sm" id="tsDisconnect">${Dash.icon('x', 'icon--sm')} Trennen</button>
      </div>`;
    const syncBtn = document.getElementById('tsSync');
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      try {
        const r = await Dash.apiFor('POST', '/twitchsubs/sync', {}, { timeout: 120000 });
        const x = r.result || {};
        Dash.toast(`Abgeglichen: ${x.subs ?? 0} Subs, ${x.added ?? 0} Rollen vergeben, ${x.removed ?? 0} entfernt.`, 'success');
      } catch (err) { Dash.toast(err.message, 'error'); }
      loadStatus();
    });
    document.getElementById('tsDisconnect').addEventListener('click', async () => {
      const ok = await Dash.confirmModal(
        'Twitch-Kanal trennen? Der Bot kann danach keine Abonnenten mehr prüfen. Bereits vergebene Rollen bleiben, die Verknüpfungen der Mitglieder bleiben erhalten.',
        { danger: true, confirmLabel: 'Trennen' },
      );
      if (!ok) return;
      try {
        await Dash.apiFor('DELETE', '/twitchsubs/broadcaster');
        Dash.toast('Twitch-Kanal getrennt.', 'success');
      } catch (err) { Dash.toast(err.message, 'error'); }
      loadStatus();
    });
  }

  membersBox.innerHTML = st.members.length
    ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Mitglied</th><th>Twitch</th><th>Status</th><th>Verknüpft</th></tr></thead>
        <tbody>${st.members.map((m) => `<tr>
          <td><b>${esc(m.name)}</b> <span class="muted">@${esc(m.username)}</span></td>
          <td>${esc(m.twitch)}</td>
          <td>${tierBadge(m.tier)}</td>
          <td>${m.linkedAt ? esc(Dash.fmtDate(m.linkedAt)) : '–'}</td>
        </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Noch niemand hat sein Twitch-Konto verknüpft.</div>';
}

Dash.moduleForm('twitchsubs', document.getElementById('tsForm'), {
  statusId: 'tsStatus',
  on: 'Twitch-Sub-Rollen sind aktiv. Der Bot gleicht alle 10 Minuten ab.',
  off: 'Twitch-Sub-Rollen sind deaktiviert. Die Buttons in Discord reagieren nicht, und es werden keine Rollen verändert.',
}).then((mf) => {
  document.getElementById('tsPost').addEventListener('click', async () => {
    const st = document.getElementById('tsPostMsg');
    try {
      st.textContent = 'Wird gesendet…';
      await Dash.apiFor('POST', '/twitchsubs/post', {});
      Dash.toast('Nachricht gesendet.', 'success');
      st.textContent = 'Gesendet ✓';
      await mf.reload();
    } catch (err) { Dash.toast(err.message, 'error'); st.textContent = err.message; }
  });
}).catch((e) => Dash.toast(e.message, 'error'));

document.getElementById('tsForm').after(Dash.buttonEmojiCard('twitchsubs'));
loadStatus();
