/* global document, window, Dash */
'use strict';

const { apiFor, getRoles, getChannels, escapeHtml, fmtDate, icon, toast } = Dash;

let ROLES = [];
let VOICE = []; // Sprachkanäle des Servers
let META = { botTopRolePosition: 0, canNick: false, canRoles: false, canMove: false, guildOwnerId: null };
let current = null; // aktuell bearbeitetes Mitglied

const $ = (id) => document.getElementById(id);

function roleById(id) {
  return ROLES.find((r) => String(r.id) === String(id));
}
function canManageRole(r) {
  return !r.managed && r.position < META.botTopRolePosition;
}

/* ---------------- Suche ---------------- */

let searchTimer = null;
$('mSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('mSearch').value.trim();
  if (q.length < 2) { $('mResults').innerHTML = '<p class="muted">Mindestens 2 Zeichen.</p>'; return; }
  searchTimer = setTimeout(() => runSearch(q), 300);
});

async function runSearch(q) {
  $('mResults').innerHTML = '<div class="loading">Suche…</div>';
  try {
    const list = await apiFor('GET', `/members?q=${encodeURIComponent(q)}`);
    if (!list.length) { $('mResults').innerHTML = '<p class="muted">Kein Mitglied gefunden.</p>'; return; }
    $('mResults').innerHTML = list.map((m) => `
      <div class="mres" data-id="${m.id}">
        <img src="${escapeHtml(m.avatarUrl)}" alt="" loading="lazy" />
        <div>
          <b>${escapeHtml(m.displayName)}</b>
          <div class="muted" style="font-size:.85rem;">${escapeHtml(m.tag)} · ${m.id}${m.bot ? ' · Bot' : ''}${m.isGuildOwner ? ' · Server-Inhaber' : ''}</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn--outline btn--sm" data-pick="${m.id}">${icon('edit', 'icon--sm')} Verwalten</button>
      </div>`).join('');
  } catch (e) {
    $('mResults').innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

$('mResults').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick]');
  if (btn) openMember(btn.dataset.pick);
});

/* ---------------- Editor ---------------- */

async function openMember(id) {
  try {
    current = await apiFor('GET', `/members/${id}`);
  } catch (e) { toast(e.message, 'error'); return; }
  renderEditor();
  $('mEditor').hidden = false;
  $('mEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Nach jedem Neu-Aufbau des Editors gilt der aktuelle Stand als "gespeichert".
function markMemberClean() {
  document.getElementById('memberForm').sbMarkClean?.();
}

function renderEditor() {
  const m = current;
  $('edName').textContent = m.displayName;
  $('edHeader').innerHTML = `
    <img src="${escapeHtml(m.avatarUrl)}" alt="" />
    <div>
      <b>${escapeHtml(m.tag)}</b>
      <div class="muted" style="font-size:.85rem;">ID ${m.id}${m.joinedAt ? ' · beigetreten ' + escapeHtml(fmtDate(m.joinedAt)) : ''}</div>
    </div>`;

  // Nickname
  $('edNick').value = m.nickname || '';
  const nickBlocked = m.isGuildOwner || !META.canNick;
  $('edNick').disabled = nickBlocked;
  $('edNickHint').textContent = m.isGuildOwner
    ? 'Der Server-Inhaber kann von keinem Bot umbenannt werden.'
    : !META.canNick
      ? 'Dem Bot fehlt die Berechtigung „Nicknamen verwalten".'
      : '';

  // Rollen
  const has = new Set(m.roleIds.map(String));
  $('edRoles').innerHTML = ROLES
    .slice()
    .sort((a, b) => b.position - a.position)
    .map((r) => {
      const locked = !canManageRole(r);
      return `<label class="mrole ${locked ? 'is-locked' : ''}">
        <input type="checkbox" name="role_${r.id}" value="${r.id}" ${has.has(String(r.id)) ? 'checked' : ''} ${locked ? 'disabled' : ''} data-has="${has.has(String(r.id)) ? 1 : 0}">
        <span class="mrole__dot" style="background:${r.color && r.color !== '#000000' ? r.color : 'var(--line)'}"></span>
        <span>${escapeHtml(r.name)}</span>
        ${locked ? `<span class="mrole__lock">${r.managed ? 'Integration' : 'über dem Bot'}</span>` : ''}
      </label>`;
    }).join('');
  $('edRolesMsg').textContent = META.canRoles ? '' : 'Dem Bot fehlt die Berechtigung „Rollen verwalten".';

  // Sprachkanal / Verschieben
  const inVoice = Boolean(m.voiceChannelId);
  $('edVoiceState').textContent = inVoice
    ? `Aktuell im Sprachkanal: 🔊 ${m.voiceChannelName || m.voiceChannelId}`
    : 'Aktuell in keinem Sprachkanal.';
  const moveBlocked = !META.canMove || !inVoice;
  $('edVoiceTarget').innerHTML = VOICE
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(m.voiceChannelId) ? 'disabled' : ''}>🔊 ${escapeHtml(c.name)}</option>`)
    .join('') || '<option value="">— keine Sprachkanäle —</option>';
  $('edVoiceTarget').disabled = moveBlocked;
  $('edVoiceMove').disabled = moveBlocked || !VOICE.length;
  $('edVoiceKick').disabled = moveBlocked;
  $('edVoiceHint').textContent = !META.canMove
    ? 'Dem Bot fehlt die Berechtigung „Mitglieder verschieben".'
    : !inVoice
      ? 'Verschieben geht nur, während die Person in einem Sprachkanal ist.'
      : '';

  markMemberClean();
}

async function saveMember() {
  const m = current;
  const body = {};
  const nick = $('edNick').value.trim();
  if (!$('edNick').disabled && nick !== (m.nickname || '')) body.nickname = nick;

  const boxes = [...document.querySelectorAll('#edRoles input[type=checkbox]:not(:disabled)')];
  const addRoles = boxes.filter((b) => b.checked && b.dataset.has === '0').map((b) => b.value);
  const removeRoles = boxes.filter((b) => !b.checked && b.dataset.has === '1').map((b) => b.value);
  if (addRoles.length) body.addRoles = addRoles;
  if (removeRoles.length) body.removeRoles = removeRoles;

  if (!Object.keys(body).length) return;
  try {
    const r = await apiFor('PATCH', `/members/${m.id}`, body);
    current = r.member || current;
    toast('Gespeichert.', 'success');
    renderEditor();
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

async function doVoice(body, okMsg) {
  try {
    const r = await apiFor('PATCH', `/members/${current.id}`, body);
    current = r.member || current;
    toast(okMsg, 'success');
    renderEditor();
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('edVoiceMove').addEventListener('click', () => {
  const target = $('edVoiceTarget').value;
  if (!target) return;
  doVoice({ moveTo: target }, 'Verschoben.');
});
$('edVoiceKick').addEventListener('click', () => doVoice({ moveTo: null }, 'Aus dem Sprachkanal getrennt.'));

Dash.trackForm(document.getElementById('memberForm'), saveMember, { reset: () => renderEditor() });

/* ---------------- Init ---------------- */

(async function init() {
  try {
    const [roles, meta, chans] = await Promise.all([getRoles(), apiFor('GET', '/member-tools'), getChannels()]);
    ROLES = roles;
    META = meta;
    VOICE = chans.voice || [];
    if (!META.canNick || !META.canRoles || !META.canMove) {
      const miss = [];
      if (!META.canNick) miss.push('„Nicknamen verwalten"');
      if (!META.canRoles) miss.push('„Rollen verwalten"');
      if (!META.canMove) miss.push('„Mitglieder verschieben"');
      $('permWarnText').textContent = `Dem Bot fehlt auf diesem Server: ${miss.join(', ')}. Gib dem Bot diese Rechte (und schiebe seine Rolle hoch genug), damit alles funktioniert.`;
      $('permWarn').hidden = false;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
})();
