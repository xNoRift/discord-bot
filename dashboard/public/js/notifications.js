/* global document, Dash */
'use strict';

const { apiFor, toast, escapeHtml, fmtRelative, getChannels } = Dash;

let channels = [];

function channelOptions(selectedId) {
  return `<option value="">— Kategorie-Standardkanal —</option>` +
    channels.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
}

function configRowHtml(c) {
  return `<div class="setting-row" data-event="${c.event_key}">
    <div class="setting-row__text"><b>${escapeHtml(c.label)}</b></div>
    <label class="toggle" title="In einen Kanal posten">
      <input type="checkbox" data-f="toChannel" ${c.to_channel ? 'checked' : ''}><span class="toggle__track"></span>
    </label>
    <select data-f="channelId" style="max-width:200px;" ${c.to_channel ? '' : 'disabled'}>${channelOptions(c.channel_id)}</select>
    <label class="toggle" title="Ins Dashboard-Postfach" style="margin-left:8px;">
      <input type="checkbox" data-f="toDashboard" ${c.to_dashboard ? 'checked' : ''}><span class="toggle__track"></span>
    </label>
    <span class="muted" data-status style="min-width:70px;"></span>
  </div>`;
}

async function loadConfig() {
  const wrap = document.getElementById('notifConfig');
  try {
    channels = (await getChannels()).text;
    const cfg = await apiFor('GET', '/notifications/config');
    wrap.innerHTML = `<p class="muted" style="display:flex;gap:24px;margin-bottom:10px;font-size:.82rem;">
        <span>Linker Schalter + Kanal = in Discord posten</span><span>Rechter Schalter = ins Dashboard-Postfach</span>
      </p>` + cfg.map(configRowHtml).join('');
  } catch (e) {
    wrap.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

async function saveRow(row) {
  const status = row.querySelector('[data-status]');
  const toChannel = row.querySelector('[data-f="toChannel"]').checked;
  const chanSel = row.querySelector('[data-f="channelId"]');
  chanSel.disabled = !toChannel;
  status.textContent = '…';
  try {
    await apiFor('PUT', `/notifications/config/${row.dataset.event}`, {
      toChannel,
      channelId: chanSel.value || undefined,
      toDashboard: row.querySelector('[data-f="toDashboard"]').checked,
    });
    status.textContent = '✓';
    setTimeout(() => { status.textContent = ''; }, 1500);
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = '';
  }
}

document.getElementById('notifConfig').addEventListener('change', (e) => {
  const row = e.target.closest('[data-event]');
  if (row) saveRow(row);
});

/* ---------------- Postfach ---------------- */

async function loadInbox() {
  const list = document.getElementById('notifInbox');
  try {
    const { items, unread } = await apiFor('GET', '/notifications/inbox');
    document.getElementById('notifUnread').textContent = unread ? `(${unread} ungelesen)` : '';
    list.innerHTML = items.length
      ? items
          .map(
            (n) => `<li${n.read ? '' : ' style="background:var(--accent-soft);border-radius:8px;"'}>
              <span class="activity__ico">${Dash.icon('bell', 'icon--sm')}</span>
              <span><b>${escapeHtml(n.title || n.event_key || '')}</b>${n.body ? `<br><span class="muted">${escapeHtml(n.body)}</span>` : ''}</span>
              <time>${escapeHtml(fmtRelative(n.created_at))}</time>
            </li>`,
          )
          .join('')
      : '<li class="muted">Keine Benachrichtigungen im Postfach.</li>';
  } catch (e) {
    list.innerHTML = `<li style="color:var(--red)">${escapeHtml(e.message)}</li>`;
  }
}

document.getElementById('notifReadAll').addEventListener('click', async () => {
  try {
    await apiFor('POST', '/notifications/inbox/read-all', {});
    await loadInbox();
  } catch (err) {
    toast(err.message, 'error');
  }
});

loadConfig().catch((e) => toast(e.message, 'error'));
loadInbox().catch((e) => toast(e.message, 'error'));
