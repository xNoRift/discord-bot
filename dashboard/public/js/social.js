/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, fmtDate, icon, getRoles, getChannels, confirmModal, toast } = Dash;

const PLAT = {
  youtube: { name: 'YouTube', color: '#ff0000' },
  twitch: { name: 'Twitch', color: '#9146ff' },
  tiktok: { name: 'TikTok', color: '#111' },
  rss: { name: 'Feed', color: '#f26522' },
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

/* ---------- Plattform-Checkboxen ---------- */

function syncPlatRows() {
  form.querySelectorAll('.social-plat').forEach((row) => {
    const cb = row.querySelector('input[type=checkbox]');
    row.classList.toggle('is-off', !cb.checked);
  });
}
form.querySelectorAll('.social-plat input[type=checkbox]').forEach((cb) => {
  cb.addEventListener('change', () => {
    if (cb.dataset.plat === 'twitch' && cb.checked && !twitchReady) {
      cb.checked = false;
      toast('Twitch ist noch nicht eingerichtet (siehe Kasten oben).', 'error');
    }
    syncPlatRows();
    if (cb.checked) form.querySelector(`input[data-acc="${cb.dataset.plat}"]`)?.focus();
  });
});

function mentionOptionsHtml(selected) {
  const roleOpts = ROLES.filter((r) => !r.managed)
    .map((r) => `<option value="${r.id}" ${selected === r.id ? 'selected' : ''}>Erwähnung: @${escapeHtml(r.name)}</option>`)
    .join('');
  const opt = (v, label) => `<option value="${v}" ${selected === v ? 'selected' : ''}>${label}</option>`;
  return (
    opt('none', 'Erwähnung: Keine') +
    opt('@everyone', 'Erwähnung: @everyone') +
    opt('@here', 'Erwähnung: @here') +
    roleOpts
  );
}

function fillMentionOptions() {
  form.querySelectorAll('select.social-plat__mention').forEach((sel) => {
    sel.innerHTML = mentionOptionsHtml('none');
  });
}

function fillChannelOptions() {
  form.querySelectorAll('select.social-plat__channel').forEach((sel) => {
    sel.innerHTML = channelOptionsHtml('', true);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('addMsg');
  const shared = {
    message: document.getElementById('f_message').value.trim() || null,
    embed: document.getElementById('f_embed').checked,
  };

  const jobs = [];
  const missingChannel = [];
  form.querySelectorAll('.social-plat input[type=checkbox]:checked').forEach((cb) => {
    const plat = cb.dataset.plat;
    const acc = form.querySelector(`input[data-acc="${plat}"]`).value.trim();
    if (!acc) return;
    const channelId = form.querySelector(`select[data-channel="${plat}"]`)?.value || '';
    const mention = form.querySelector(`select[data-mention="${plat}"]`)?.value || 'none';
    if (!channelId) { missingChannel.push(PLAT[plat].name); return; }
    jobs.push({ platform: plat, account: acc, channelId, mention });
  });
  if (missingChannel.length) { msg.textContent = `Bitte für ${missingChannel.join(', ')} einen Kanal wählen.`; return; }
  if (!jobs.length) { msg.textContent = 'Mindestens eine Plattform anhaken, Account/Link und Kanal eintragen.'; return; }

  msg.textContent = `Prüfe ${jobs.length} …`;
  const errors = [];
  let ok = 0;
  for (const job of jobs) {
    try {
      await apiFor('POST', '/social', { ...shared, ...job });
      ok++;
    } catch (err) {
      errors.push(`${PLAT[job.platform].name}: ${err.message}`);
    }
  }
  msg.textContent = errors.join(' · ');
  if (ok) {
    toast(`${ok} Benachrichtigung${ok > 1 ? 'en' : ''} hinzugefügt.`, 'success');
    form.querySelectorAll('input[data-acc]').forEach((i) => (i.value = ''));
    document.getElementById('f_message').value = '';
    await load();
  }
  if (errors.length) toast(errors.join('\n'), 'error');
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

function channelOptionsHtml(selected, withPlaceholder) {
  const opts = (CHAN.text || [])
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  return (withPlaceholder ? '<option value="">— Kanal wählen —</option>' : '') + opts;
}

function row(s) {
  const p = PLAT[s.platform] || { name: s.platform, color: '#888' };
  const acc = /^https?:\/\//i.test(s.account) ? s.account.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48) + '…' : s.account;
  return `<div class="qfield" data-id="${s.id}">
    <div class="qfield__head">
      <b><span style="color:${p.color}">${p.name}</span> · ${escapeHtml(s.accountLabel || acc)}</b>
      <span>${statusBadge(s)}</span>
    </div>
    <div class="muted" style="font-size:.85rem;margin:2px 0 8px;">
      → ${escapeHtml(channelName(s.channelId))} · Erwähnung: ${escapeHtml(mentionText(s.mention))}
      ${s.lastAnnouncedAt ? ' · zuletzt gepostet: ' + escapeHtml(fmtDate(s.lastAnnouncedAt)) : ''}
    </div>
    <div class="row-inline" data-view>
      <button class="btn btn--outline btn--sm" data-a="test">${icon('send', 'icon--sm')} Testen</button>
      <button class="btn btn--outline btn--sm" data-a="edit">${icon('edit', 'icon--sm')} Kanal/Erwähnung</button>
      <button class="btn btn--outline btn--sm" data-a="toggle">${s.enabled ? 'Pausieren' : 'Aktivieren'}</button>
      <button class="btn btn--danger btn--sm" data-a="del">${icon('trash', 'icon--sm')} Entfernen</button>
    </div>
    <div class="col-2" data-edit hidden style="margin-top:8px;">
      <div class="field"><label>Kanal</label><select data-e-channel>${channelOptionsHtml(s.channelId)}</select></div>
      <div class="field"><label>Erwähnung</label><select data-e-mention>${mentionOptionsHtml(s.mention || 'none')}</select></div>
      <div style="grid-column:1/-1;"><button class="btn btn--primary btn--sm" data-a="save">${icon('check', 'icon--sm')} Speichern</button> <button class="btn btn--ghost btn--sm" data-a="cancel">Abbrechen</button></div>
    </div>
  </div>`;
}

async function load() {
  const data = await apiFor('GET', '/social');
  twitchReady = data.twitchReady;
  document.getElementById('twitchHint').hidden = twitchReady;
  const tn = form.querySelector('[data-plat-note="twitch"]');
  if (tn) tn.hidden = twitchReady;

  const subs = data.subscriptions;
  listEl.innerHTML = subs.length
    ? subs.map(row).join('')
    : '<p class="muted">Noch keine Benachrichtigungen. Oben eine hinzufügen.</p>';
}

listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-a]');
  if (!btn) return;
  const box = btn.closest('[data-id]');
  const id = box.dataset.id;
  try {
    if (btn.dataset.a === 'test') {
      await apiFor('POST', `/social/${id}/test`);
      toast('Testmeldung gesendet.', 'success');
    } else if (btn.dataset.a === 'toggle') {
      await apiFor('PATCH', `/social/${id}`, { enabled: btn.textContent.trim() === 'Aktivieren' });
      await load();
    } else if (btn.dataset.a === 'edit') {
      box.querySelector('[data-edit]').hidden = false;
      box.querySelector('[data-view]').hidden = true;
    } else if (btn.dataset.a === 'cancel') {
      box.querySelector('[data-edit]').hidden = true;
      box.querySelector('[data-view]').hidden = false;
    } else if (btn.dataset.a === 'save') {
      const channelId = box.querySelector('[data-e-channel]').value;
      const mention = box.querySelector('[data-e-mention]').value;
      await apiFor('PATCH', `/social/${id}`, { channelId, mention });
      toast('Gespeichert.', 'success');
      await load();
    } else if (btn.dataset.a === 'del') {
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
    fillMentionOptions();
    fillChannelOptions();
    syncPlatRows();
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
})();
