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

async function loadWarnings(userId) {
  warnList.innerHTML = '<li class="muted">Lädt…</li>';
  try {
    const { warnings } = await apiFor('GET', `/moderation/warnings?userId=${encodeURIComponent(userId)}`);
    if (!warnings.length) { warnList.innerHTML = '<li class="muted">Keine Verwarnungen gefunden.</li>'; return; }
    warnList.innerHTML = warnings
      .map(
        (w) => `<li>
          <span class="activity__ico">${w.active ? '⚠️' : '➖'}</span>
          <span>
            <b>${w.active ? 'Aktiv' : 'Zurückgezogen'}</b> · ${escapeHtml(w.reason || 'Kein Grund')}
            <br><span class="muted">${fmtDate(w.created_at)}${w.moderator_tag ? ' · von ' + escapeHtml(w.moderator_tag) : ''}</span>
          </span>
          ${w.active ? `<button class="btn btn--ghost btn--sm" data-remove-warn="${w.id}" style="margin-left:auto;">Zurückziehen</button>` : ''}
        </li>`,
      )
      .join('');
  } catch (err) {
    warnList.innerHTML = `<li style="color:var(--red)">${escapeHtml(err.message)}</li>`;
  }
}

document.getElementById('warnLookupBtn').addEventListener('click', () => {
  const id = document.getElementById('warnLookupId').value.trim();
  if (!/^\d{5,25}$/.test(id)) return toast('Bitte eine gültige User-ID angeben.', 'error');
  loadWarnings(id);
});

warnList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove-warn]');
  if (!btn) return;
  if (!(await Dash.confirmModal('Diese Verwarnung zurückziehen?'))) return;
  try {
    await apiFor('POST', `/moderation/warnings/${btn.dataset.removeWarn}/remove`, {});
    toast('Verwarnung zurückgezogen.', 'success');
    loadWarnings(document.getElementById('warnLookupId').value.trim());
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------------- Eskalationsregeln ---------------- */

const escRows = document.getElementById('escRows');
const ESC_ACTIONS = [
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
