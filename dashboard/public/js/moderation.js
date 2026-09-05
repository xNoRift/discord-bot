/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, toast, escapeHtml, fmtDate, getRoles } = Dash;

const modForm = document.getElementById('modForm');

async function loadModForm() {
  const s = await apiFor('GET', '/settings');
  await fillSelectors(s);
  const el = document.querySelector('#modForm [name=mod_log_channel_id]');
  if (el) el.value = s.mod_log_channel_id || '';
}

async function saveModForm() {
  try { await apiFor('PATCH', '/moderation/settings', readForm(modForm)); toast('Gespeichert.', 'success'); }
  catch (err) { toast(err.message, 'error'); throw err; }
}

loadModForm()
  .then(() => Dash.trackForm(modForm, saveModForm, { reset: loadModForm }))
  .catch((e) => toast(e.message, 'error'));

/* ---------------- Aktion gegen einen Nutzer ---------------- */

const actForm = document.getElementById('modActionForm');
const actStatus = document.getElementById('modActionStatus');
let pendingAct = 'timeout';

actForm.querySelectorAll('button[data-act]').forEach((b) => {
  b.addEventListener('click', () => { pendingAct = b.dataset.act; });
});

actForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(actForm);
  if (!a.userId) return toast('Bitte eine User-ID angeben.', 'error');

  const harsh = pendingAct === 'kick' || pendingAct === 'ban';
  if (harsh && !(await Dash.confirmModal(`Nutzer ${a.userId} wirklich ${pendingAct === 'kick' ? 'kicken' : 'bannen'}?`, { danger: true }))) return;

  actStatus.textContent = 'Wird ausgeführt…';
  try {
    const r = await apiFor('POST', '/moderation/action', {
      action: pendingAct,
      userId: a.userId,
      reason: a.reason,
      minutes: a.minutes,
    });
    toast(r.summary, 'success');
    actStatus.textContent = '✓ ' + r.summary;
    if (pendingAct === 'warn' && document.getElementById('warnLookupId').value.trim() === a.userId) {
      loadWarnings(a.userId);
    }
  } catch (err) {
    toast(err.message, 'error');
    actStatus.textContent = err.message;
  }
});

/* ---------------- Verwarnungshistorie ---------------- */

const warnList = document.getElementById('warnList');
const allWarnList = document.getElementById('allWarnList');
const modHistoryList = document.getElementById('modHistoryList');

const MOD_HISTORY_ICONS = {
  mod_warn: 'bell',
  mod_timeout: 'clock',
  mod_kick: 'x',
  mod_ban: 'x',
  mod_unban: 'check',
  mod_untimeout: 'check',
  mod_purge: 'trash',
  automod_spam: 'shield',
  automod_caps: 'shield',
  automod_links: 'shield',
  automod_invites: 'shield',
  automod_mention_spam: 'shield',
  automod_wordlist: 'shield',
};

function warnRowHtml(w, { showUser = false } = {}) {
  return `<li>
    <span class="activity__ico">${w.active ? '⚠️' : '➖'}</span>
    <span>
      <b>#${w.id} · ${w.active ? 'Aktiv' : 'Zurückgezogen'}</b>${showUser ? ` · User-ID ${escapeHtml(w.user_id)}` : ''} · ${escapeHtml(w.reason || 'Kein Grund')}
      <br><span class="muted">${fmtDate(w.created_at)}${w.moderator_tag ? ' · von ' + escapeHtml(w.moderator_tag) : ''}</span>
    </span>
    ${w.active ? `<button class="btn btn--ghost btn--sm" data-remove-warn="${w.id}" style="margin-left:auto;">Zurückziehen</button>` : ''}
  </li>`;
}

async function loadWarnings(userId) {
  warnList.innerHTML = '<li class="muted">Lädt…</li>';
  try {
    const { warnings } = await apiFor('GET', `/moderation/warnings?userId=${encodeURIComponent(userId)}`);
    warnList.innerHTML = warnings.length
      ? warnings.map((w) => warnRowHtml(w)).join('')
      : '<li class="muted">Keine Verwarnungen gefunden.</li>';
  } catch (err) {
    warnList.innerHTML = `<li style="color:var(--red)">${escapeHtml(err.message)}</li>`;
  }
}

async function loadAllWarnings() {
  try {
    const { warnings } = await apiFor('GET', '/moderation/warnings?limit=50');
    allWarnList.innerHTML = warnings.length
      ? warnings.map((w) => warnRowHtml(w, { showUser: true })).join('')
      : '<li class="muted">Noch keine Verwarnungen auf diesem Server.</li>';
  } catch (err) {
    allWarnList.innerHTML = `<li style="color:var(--red)">${escapeHtml(err.message)}</li>`;
  }
}

async function loadModHistory(userId) {
  modHistoryList.innerHTML = '<li class="muted">Lädt…</li>';
  try {
    const rows = await apiFor('GET', `/activity?category=moderation&targetId=${encodeURIComponent(userId)}&limit=50`);
    modHistoryList.innerHTML = rows.length
      ? rows
          .map(
            (r) => `<li>
              <span class="activity__ico">${Dash.icon(MOD_HISTORY_ICONS[r.type] || 'shield', 'icon--sm')}</span>
              <span>${escapeHtml(r.message || r.type)}</span>
              <time>${fmtDate(r.created_at)}</time>
            </li>`,
          )
          .join('')
      : '<li class="muted">Keine Moderations-Historie gefunden.</li>';
  } catch (err) {
    modHistoryList.innerHTML = `<li style="color:var(--red)">${escapeHtml(err.message)}</li>`;
  }
}

document.getElementById('warnLookupBtn').addEventListener('click', () => {
  const id = document.getElementById('warnLookupId').value.trim();
  if (!/^\d{5,25}$/.test(id)) return toast('Bitte eine gültige User-ID angeben.', 'error');
  loadWarnings(id);
  loadModHistory(id);
});

async function removeWarning(id) {
  if (!(await Dash.confirmModal('Diese Verwarnung zurückziehen?'))) return;
  try {
    await apiFor('POST', `/moderation/warnings/${id}/remove`, {});
    toast('Verwarnung zurückgezogen.', 'success');
    const lookupId = document.getElementById('warnLookupId').value.trim();
    if (lookupId) loadWarnings(lookupId);
    loadAllWarnings();
  } catch (err) {
    toast(err.message, 'error');
  }
}

warnList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-warn]');
  if (btn) removeWarning(btn.dataset.removeWarn);
});

allWarnList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-warn]');
  if (btn) removeWarning(btn.dataset.removeWarn);
});

loadAllWarnings().catch((e) => toast(e.message, 'error'));

/* ---------------- Eskalationsregeln ---------------- */

const escRows = document.getElementById('escRows');
const ESC_ACTIONS = [
  ['notice', 'Hinweis'],
  ['timeout', 'Timeout'],
  ['kick', 'Kick'],
  ['ban', 'Ban'],
];

function escRow(rule = {}) {
  const row = document.createElement('div');
  row.className = 'row-inline';
  row.style.cssText = 'flex-wrap:wrap;gap:8px;margin-bottom:8px;align-items:center;';
  row.innerHTML = `
    <span class="muted">Bei</span>
    <input type="number" min="1" max="50" value="${rule.count || ''}" data-f="count" placeholder="3" style="max-width:70px;" />
    <span class="muted">aktiven Verwarnungen →</span>
    <select data-f="action" style="max-width:140px;">
      ${ESC_ACTIONS.map(([v, l]) => `<option value="${v}" ${rule.action === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <input type="number" min="1" max="40320" value="${rule.minutes || ''}" data-f="minutes" placeholder="Minuten (nur Timeout)" style="max-width:170px;" data-role="minutes" />
    <button class="btn btn--ghost btn--icon" type="button" data-remove-rule>${Dash.icon('trash', 'icon--sm')}</button>
  `;
  const sel = row.querySelector('[data-f="action"]');
  const minInput = row.querySelector('[data-role="minutes"]');
  const syncMinutes = () => { minInput.hidden = sel.value !== 'timeout'; };
  sel.addEventListener('change', syncMinutes);
  syncMinutes();
  row.querySelector('[data-remove-rule]').addEventListener('click', () => row.remove());
  return row;
}

document.getElementById('escAdd').addEventListener('click', () => escRows.appendChild(escRow()));

document.getElementById('escSave').addEventListener('click', async () => {
  const rules = [...escRows.children]
    .map((row) => ({
      count: parseInt(row.querySelector('[data-f="count"]').value, 10),
      action: row.querySelector('[data-f="action"]').value,
      minutes: parseInt(row.querySelector('[data-f="minutes"]').value, 10) || undefined,
    }))
    .filter((r) => r.count > 0);
  const status = document.getElementById('escStatus');
  try {
    await apiFor('PATCH', '/settings', { warn_escalation: JSON.stringify(rules) });
    toast('Eskalationsregeln gespeichert.', 'success');
    status.textContent = 'Gespeichert ✓';
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

async function loadEscalation() {
  const s = await apiFor('GET', '/settings');
  let rules = [];
  try { rules = JSON.parse(s.warn_escalation || '[]'); } catch { rules = []; }
  escRows.innerHTML = '';
  (rules.length ? rules : []).forEach((r) => escRows.appendChild(escRow(r)));
}
loadEscalation().catch((e) => toast(e.message, 'error'));

/* ---------------- Zugriff (Dashboard-Rollen für "moderation") ---------------- */

function roleChecklist(roles, selected) {
  return roles
    .map(
      (r) => `<label class="setting-row" style="cursor:pointer;padding:8px 0;">
        <input type="checkbox" value="${r.id}" ${selected.has(r.id) ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent);">
        <span class="setting-row__text"><b>${escapeHtml(r.name)}</b></span>
      </label>`,
    )
    .join('');
}

async function loadModRoles() {
  const [roles, d] = await Promise.all([getRoles(), apiFor('GET', '/dashboard-roles?scope=moderation')]);
  const selected = new Set(d.roleIds || []);
  document.getElementById('modRoleChecks').innerHTML = roles.length
    ? roleChecklist(roles, selected)
    : '<p class="muted">Keine Rollen gefunden.</p>';
}

document.getElementById('modRoleSave').addEventListener('click', async () => {
  const roleIds = [...document.querySelectorAll('#modRoleChecks input:checked')].map((c) => c.value);
  const status = document.getElementById('modRoleStatus');
  try {
    await apiFor('POST', '/dashboard-roles', { scope: 'moderation', roleIds });
    toast('Zugriff gespeichert.', 'success');
    status.textContent = 'Gespeichert ✓';
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

loadModRoles().catch((e) => toast(e.message, 'error'));

/* ---------------- Purge ---------------- */

const purgeForm = document.getElementById('modPurgeForm');
const purgeStatus = document.getElementById('modPurgeStatus');

purgeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(purgeForm);
  if (!a.channelId) return toast('Bitte einen Kanal wählen.', 'error');
  if (!(await Dash.confirmModal(`Die letzten ${a.count || 10} Nachrichten löschen?`, { danger: true }))) return;

  purgeStatus.textContent = 'Wird gelöscht…';
  try {
    const r = await apiFor('POST', '/moderation/purge', { channelId: a.channelId, count: a.count, userId: a.userId });
    toast(`${r.deleted} Nachricht(en) gelöscht.`, 'success');
    purgeStatus.textContent = `✓ ${r.deleted} gelöscht`;
  } catch (err) {
    toast(err.message, 'error');
    purgeStatus.textContent = err.message;
  }
});

/* ---------------- AutoMod ---------------- */

const TYPE_INFO = {
  spam: ['Spam / Flooding', 'Zu viele Nachrichten in kurzer Zeit vom selben Nutzer.'],
  caps: ['Übermäßige Großschreibung', 'Nachrichten, die größtenteils aus Großbuchstaben bestehen.'],
  links: ['Links', 'Blockiert Links, optional mit einer Ausnahmeliste an Domains.'],
  invites: ['Discord-Einladungen', 'Blockiert Einladungslinks zu anderen Servern.'],
  mention_spam: ['Erwähnungs-Spam', 'Zu viele @Erwähnungen in einer Nachricht.'],
  wordlist: ['Wortfilter', 'Blockiert Nachrichten mit bestimmten Wörtern.'],
};
const ACTION_LABELS = { none: 'Nur löschen', warn: '+ Verwarnen', timeout: '+ Timeout', kick: '+ Kick', ban: '+ Bann' };

let automodState = {}; // type -> { enabled, action, timeoutMinutes, config, exceptRoleIds, exceptChannelIds }

function configFieldsHtml(type, cfg) {
  if (type === 'spam') {
    return `<div class="col-2">
      <div class="field"><label>Max. Nachrichten</label><input type="number" min="2" max="30" data-cfg="maxMessages" value="${cfg.maxMessages ?? 5}" /></div>
      <div class="field"><label>Zeitfenster (Sekunden)</label><input type="number" min="1" max="60" data-cfg="windowSeconds" value="${cfg.windowSeconds ?? 5}" /></div>
    </div>`;
  }
  if (type === 'caps') {
    return `<div class="col-2">
      <div class="field"><label>Mindestlänge (Zeichen)</label><input type="number" min="1" max="200" data-cfg="minLength" value="${cfg.minLength ?? 10}" /></div>
      <div class="field"><label>Anteil Großbuchstaben (%)</label><input type="number" min="10" max="100" data-cfg="maxPercent" value="${cfg.maxPercent ?? 70}" /></div>
    </div>`;
  }
  if (type === 'links') {
    return `<div class="field"><label>Erlaubte Domains (eine pro Zeile, leer = alle Links blockieren)</label>
      <textarea data-cfg="allowlist" rows="3" placeholder="tenor.com\nyoutube.com">${(cfg.allowlist || []).join('\n')}</textarea></div>`;
  }
  if (type === 'mention_spam') {
    return `<div class="field"><label>Max. Erwähnungen pro Nachricht</label><input type="number" min="1" max="50" data-cfg="maxMentions" value="${cfg.maxMentions ?? 5}" /></div>`;
  }
  if (type === 'wordlist') {
    return `<div class="field"><label>Verbotene Wörter (eines pro Zeile)</label>
      <textarea data-cfg="words" rows="4" placeholder="wort1\nwort2">${(cfg.words || []).join('\n')}</textarea></div>`;
  }
  return '<p class="muted">Für diesen Filter gibt es keine weiteren Einstellungen.</p>';
}

function readConfigFields(modal, type) {
  const cfg = {};
  modal.querySelectorAll('[data-cfg]').forEach((el) => {
    const key = el.dataset.cfg;
    if (el.tagName === 'TEXTAREA') {
      cfg[key] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    } else {
      cfg[key] = Number(el.value) || 0;
    }
  });
  return cfg;
}

async function openAutomodConfig(type) {
  const [roles, channels] = await Promise.all([getRoles(), Dash.getChannels()]);
  const st = automodState[type];
  const { modal, close } = Dash.openModal(`
    <h2>${escapeHtml(TYPE_INFO[type][0])}</h2>
    <p class="muted">${escapeHtml(TYPE_INFO[type][1])}</p>
    ${configFieldsHtml(type, st.config || {})}
    <div class="field" style="margin-top:10px;"><label>Ausnahme-Rollen (nie gefiltert)</label>
      <div data-am-roles style="max-height:160px;overflow:auto;">${roleChecklist(roles, new Set(st.exceptRoleIds || []))}</div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Ausnahme-Kanäle (dort nie gefiltert)</label>
      <div data-am-channels style="max-height:160px;overflow:auto;">${roleChecklist(channels.text || [], new Set(st.exceptChannelIds || []))}</div>
    </div>
    <div class="modal__actions">
      <button class="btn btn--ghost" data-act="cancel">Abbrechen</button>
      <button class="btn btn--primary" data-act="ok">Übernehmen</button>
    </div>
  `);
  modal.querySelector('[data-act="cancel"]').onclick = close;
  modal.querySelector('[data-act="ok"]').onclick = () => {
    st.config = readConfigFields(modal, type);
    st.exceptRoleIds = [...modal.querySelectorAll('[data-am-roles] input:checked')].map((c) => c.value);
    st.exceptChannelIds = [...modal.querySelectorAll('[data-am-channels] input:checked')].map((c) => c.value);
    close();
  };
}

function automodRow(type) {
  const st = automodState[type];
  const row = document.createElement('div');
  row.className = 'setting-row';
  row.dataset.type = type;
  row.innerHTML = `
    <span class="setting-row__text"><b>${escapeHtml(TYPE_INFO[type][0])}</b><span class="muted">${escapeHtml(TYPE_INFO[type][1])}</span></span>
    <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;">
      <input type="checkbox" data-f="enabled" ${st.enabled ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent);"> Aktiv
    </label>
    <select data-f="action" style="max-width:150px;">
      ${Object.entries(ACTION_LABELS).map(([v, l]) => `<option value="${v}" ${st.action === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <input type="number" min="1" max="40320" data-f="timeoutMinutes" value="${st.timeoutMinutes || 10}" placeholder="Minuten" style="max-width:100px;" data-role="minutes" />
    <button class="btn btn--ghost btn--sm" type="button" data-configure>Einstellungen</button>
  `;
  const sel = row.querySelector('[data-f="action"]');
  const minInput = row.querySelector('[data-role="minutes"]');
  const syncMinutes = () => { minInput.hidden = sel.value !== 'timeout'; };
  sel.addEventListener('change', () => { st.action = sel.value; syncMinutes(); });
  minInput.addEventListener('change', () => { st.timeoutMinutes = parseInt(minInput.value, 10) || 10; });
  row.querySelector('[data-f="enabled"]').addEventListener('change', (e) => { st.enabled = e.target.checked; });
  row.querySelector('[data-configure]').addEventListener('click', () => openAutomodConfig(type));
  syncMinutes();
  return row;
}

async function loadAutomod() {
  const wrap = document.getElementById('automodRows');
  try {
    const { rules } = await apiFor('GET', '/automod');
    automodState = {};
    for (const r of rules) {
      automodState[r.type] = {
        enabled: Boolean(r.enabled),
        action: r.action || 'none',
        timeoutMinutes: r.timeout_minutes || 10,
        config: JSON.parse(r.config_json || '{}'),
        exceptRoleIds: JSON.parse(r.except_role_ids || '[]'),
        exceptChannelIds: JSON.parse(r.except_channel_ids || '[]'),
      };
    }
    wrap.innerHTML = '';
    Object.keys(TYPE_INFO).forEach((type) => wrap.appendChild(automodRow(type)));
  } catch (e) {
    wrap.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

document.getElementById('automodSave').addEventListener('click', async () => {
  const status = document.getElementById('automodStatus');
  status.textContent = 'Speichert…';
  try {
    for (const type of Object.keys(TYPE_INFO)) {
      const st = automodState[type];
      await apiFor('PATCH', `/automod/${type}`, {
        enabled: st.enabled,
        action: st.action,
        timeoutMinutes: st.timeoutMinutes,
        config: st.config,
        exceptRoleIds: st.exceptRoleIds,
        exceptChannelIds: st.exceptChannelIds,
      });
    }
    toast('AutoMod-Einstellungen gespeichert.', 'success');
    status.textContent = 'Gespeichert ✓';
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

loadAutomod().catch((e) => toast(e.message, 'error'));

/* ---------------- Anti-Raid ---------------- */

const antiRaidForm = document.getElementById('antiRaidForm');
const liftLockdownBtn = document.getElementById('antiRaidLiftLockdown');

function applyAntiRaidData(settings) {
  antiRaidForm.elements.enabled.checked = Boolean(settings.enabled);
  antiRaidForm.elements.windowSeconds.value = settings.window_seconds;
  antiRaidForm.elements.maxJoins.value = settings.max_joins;
  antiRaidForm.elements.minAccountAgeHours.value = settings.min_account_age_hours;
  antiRaidForm.elements.action.value = settings.action;
  antiRaidForm.elements.notifyOwner.checked = Boolean(settings.notify_owner);
  antiRaidForm.elements.lockdown.checked = Boolean(settings.lockdown);
  antiRaidForm.elements.lockdownMinutes.value = settings.lockdown_minutes;
  antiRaidForm.elements.exemptUserIds.value = (JSON.parse(settings.exempt_user_ids || '[]')).join('\n');
}

async function loadAntiRaid() {
  try {
    const [{ settings, status }, roles] = await Promise.all([apiFor('GET', '/antiraid'), getRoles()]);
    applyAntiRaidData(settings);
    const selectedRoles = new Set(JSON.parse(settings.exempt_role_ids || '[]'));
    document.getElementById('antiRaidRoles').innerHTML = roles.length
      ? roleChecklist(roles, selectedRoles)
      : '<p class="muted">Keine Rollen gefunden.</p>';

    const parts = [`${status.recentJoins} Beitritt(e) im aktuellen Zeitfenster`];
    if (status.raidActive) parts.push('⚠️ Alarm aktuell aktiv');
    if (status.lockdownActive) parts.push(`Lockdown aktiv bis ${new Date(status.lockdownRevertAt).toLocaleTimeString('de-DE')}`);
    document.getElementById('antiRaidStatus').textContent = parts.join(' · ');
    liftLockdownBtn.hidden = !status.lockdownActive;
  } catch (e) {
    document.getElementById('antiRaidStatus').textContent = e.message;
  }
}

antiRaidForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('antiRaidFormStatus');
  const a = readForm(antiRaidForm);
  const exemptRoleIds = [...document.querySelectorAll('#antiRaidRoles input:checked')].map((c) => c.value);
  const exemptUserIds = a.exemptUserIds.split('\n').map((s) => s.trim()).filter(Boolean);
  status.textContent = 'Speichert…';
  try {
    await apiFor('PATCH', '/antiraid', {
      enabled: a.enabled,
      windowSeconds: a.windowSeconds,
      maxJoins: a.maxJoins,
      minAccountAgeHours: a.minAccountAgeHours,
      action: a.action,
      notifyOwner: a.notifyOwner,
      lockdown: a.lockdown,
      lockdownMinutes: a.lockdownMinutes,
      exemptRoleIds,
      exemptUserIds,
    });
    toast('Anti-Raid-Einstellungen gespeichert.', 'success');
    status.textContent = 'Gespeichert ✓';
    loadAntiRaid();
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

liftLockdownBtn.addEventListener('click', async () => {
  try {
    await apiFor('POST', '/antiraid/lockdown/lift', {});
    toast('Lockdown aufgehoben.', 'success');
    loadAntiRaid();
  } catch (err) {
    toast(err.message, 'error');
  }
});

loadAntiRaid().catch((e) => toast(e.message, 'error'));
