/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, fmtDate, icon, getRoles, getChannels, fillSelectors, confirmModal, toast } = Dash;

const PLAT = {
  youtube: { name: 'YouTube', color: '#ff0000' },
  twitch: { name: 'Twitch', color: '#9146ff' },
  tiktok: { name: 'TikTok', color: '#888' },
};

const form = document.getElementById('addForm');
const listEl = document.getElementById('subList');
let ROLES = [];
let CHAN = { text: [] };
let twitchReady = false;

function channelName(id) {
  const c = (CHAN.text || []).find((x) => x.id === id);
  return c ? '#' + c.name : '#gelöschter-kanal';
}

/* ---------- Formular ---------- */

function syncAccountField() {
  const p = document.getElementById('f_platform').value;
  const label = document.getElementById('f_account_label');
  const hint = document.getElementById('f_account_hint');
  const input = document.getElementById('f_account');
  if (p === 'twitch') {
    label.textContent = 'Twitch-Kanal';
    input.placeholder = 'z. B. ninja oder twitch.tv/ninja';
    hint.textContent = 'Twitch-Benutzername oder Kanal-Link.';
  } else {
    label.textContent = 'YouTube-Kanal';
    input.placeholder = 'Kanal-ID (UC…), @handle oder Kanal-Link';
    hint.innerHTML = 'Am zuverlässigsten ist die Kanal-ID (beginnt mit <code>UC…</code>).';
  }
}
document.getElementById('f_platform').addEventListener('change', syncAccountField);

function fillMentionOptions() {
  const sel = document.getElementById('f_mention');
  const roleOpts = ROLES.filter((r) => !r.managed)
    .map((r) => `<option value="${r.id}">@${escapeHtml(r.name)}</option>`)
    .join('');
  sel.innerHTML =
    '<option value="none">Keine</option><option value="@everyone">@everyone</option><option value="@here">@here</option>' +
    roleOpts;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('addMsg');
  msg.textContent = 'Prüfe…';
  const body = {
    platform: document.getElementById('f_platform').value,
    account: document.getElementById('f_account').value.trim(),
    channelId: document.getElementById('f_channel').value,
    mention: document.getElementById('f_mention').value,
    message: document.getElementById('f_message').value.trim() || null,
    embed: document.getElementById('f_embed').checked,
  };
  if (!body.account || !body.channelId) {
    msg.textContent = 'Account und Kanal sind Pflicht.';
    return;
  }
  try {
    await apiFor('POST', '/social', body);
    msg.textContent = '';
    document.getElementById('f_account').value = '';
    document.getElementById('f_message').value = '';
    toast('Benachrichtigung hinzugefügt.', 'success');
    await load();
  } catch (err) {
    msg.textContent = err.message;
    toast(err.message, 'error');
  }
});

/* ---------- Liste ---------- */

function mentionText(m) {
  if (!m) return '–';
  if (m === '@everyone' || m === '@here') return m;
  const r = ROLES.find((x) => x.id === m.replace(/\D/g, ''));
  return r ? '@' + r.name : 'Rolle';
}

function statusBadge(s) {
  if (!s.enabled) return '<span class="badge badge--deleted">Pausiert</span>';
  if (s.failing) return '<span class="badge badge--closed">Abruf-Fehler</span>';
  if (s.platform === 'twitch' && s.isLive) return '<span class="badge badge--open">LIVE</span>';
  return '<span class="badge badge--open">Aktiv</span>';
}

function row(s) {
  const p = PLAT[s.platform] || { name: s.platform, color: '#888' };
  return `<div class="qfield" data-id="${s.id}">
    <div class="qfield__head">
      <b><span style="color:${p.color}">${p.name}</span> · ${escapeHtml(s.accountLabel || s.account)}</b>
      <span>${statusBadge(s)}</span>
    </div>
    <div class="muted" style="font-size:.85rem;margin:2px 0 8px;">
      → ${escapeHtml(channelName(s.channelId))} · Erwähnung: ${escapeHtml(mentionText(s.mention))}
      ${s.lastAnnouncedAt ? ' · zuletzt gepostet: ' + escapeHtml(fmtDate(s.lastAnnouncedAt)) : ''}
    </div>
    <div class="row-inline">
      <button class="btn btn--outline btn--sm" data-a="test">${icon('send', 'icon--sm')} Testen</button>
      <button class="btn btn--outline btn--sm" data-a="toggle">${s.enabled ? 'Pausieren' : 'Aktivieren'}</button>
      <button class="btn btn--danger btn--sm" data-a="del">${icon('trash', 'icon--sm')} Entfernen</button>
    </div>
  </div>`;
}

async function load() {
  const data = await apiFor('GET', '/social');
  twitchReady = data.twitchReady;
  document.getElementById('twitchHint').hidden = twitchReady;

  // Twitch-Option nur zeigen, wenn eingerichtet
  const psel = document.getElementById('f_platform');
  if (!twitchReady && psel.querySelector('option[value="twitch"]')) {
    psel.querySelector('option[value="twitch"]').remove();
    syncAccountField();
  }

  const subs = data.subscriptions;
  if (!subs.length) {
    listEl.innerHTML = '<p class="muted">Noch keine Benachrichtigungen. Oben eine hinzufügen.</p>';
    return;
  }
  listEl.innerHTML = subs.map(row).join('');
}

listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-a]');
  if (!btn) return;
  const box = btn.closest('[data-id]');
  const id = box.dataset.id;
  const action = btn.dataset.a;
  try {
    if (action === 'test') {
      await apiFor('POST', `/social/${id}/test`);
      toast('Testmeldung gesendet.', 'success');
    } else if (action === 'toggle') {
      const paused = btn.textContent.trim() === 'Aktivieren';
      await apiFor('PATCH', `/social/${id}`, { enabled: paused });
      await load();
    } else if (action === 'del') {
      if (!(await confirmModal('Diese Benachrichtigung entfernen?', { danger: true, confirmLabel: 'Entfernen' }))) return;
      await apiFor('DELETE', `/social/${id}`);
      toast('Entfernt.', 'success');
      await load();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------- Init ---------- */

(async function init() {
  try {
    [ROLES, CHAN] = await Promise.all([getRoles(), getChannels()]);
    await fillSelectors({});
    fillMentionOptions();
    syncAccountField();
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
})();
