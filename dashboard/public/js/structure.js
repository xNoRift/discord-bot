/* global document, Dash */
'use strict';

const { apiFor, getChannels, getRoles, escapeHtml, icon, toast, GUILD_ID } = Dash;

let META = { botTopRolePosition: 0, canRoles: false, canChannels: false };
let orderIds = []; // aktuelle Reihenfolge der verschiebbaren Rollen (oben zuerst)
let savedOrder = [];

const $ = (id) => document.getElementById(id);

/* ---------------- Kanal / Kategorie erstellen ---------------- */

function syncParentField() {
  $('chParentField').hidden = $('chType').value === 'category';
}
$('chType').addEventListener('change', syncParentField);

$('chForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('chName').value.trim();
  if (!name) return;
  $('chMsg').textContent = 'Erstelle…';
  try {
    const r = await apiFor('POST', '/channels', {
      name,
      type: $('chType').value,
      parentId: $('chType').value === 'category' ? '' : $('chParent').value,
    });
    toast(`„${r.channel.name}" erstellt.`, 'success');
    $('chMsg').textContent = '';
    $('chName').value = '';
    await loadParents();
  } catch (err) {
    $('chMsg').textContent = err.message;
    toast(err.message, 'error');
  }
});

async function loadParents() {
  const ch = await apiFor('GET', '/channels');
  $('chParent').innerHTML = '<option value="">— keine —</option>' +
    (ch.categories || []).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

/* ---------------- Rollen-Berechtigungen ---------------- */

const PERM_GROUPS = [
  ['Allgemein', [
    ['ViewChannel', 'Kanäle ansehen'],
    ['ManageChannels', 'Kanäle verwalten'],
    ['ManageRoles', 'Rollen verwalten'],
    ['ManageGuildExpressions', 'Emojis & Sticker verwalten'],
    ['ViewAuditLog', 'Audit-Log ansehen'],
    ['ManageWebhooks', 'Webhooks verwalten'],
    ['ManageGuild', 'Server verwalten'],
    ['ViewGuildInsights', 'Server-Einblicke ansehen'],
  ]],
  ['Mitglieder', [
    ['CreateInstantInvite', 'Einladung erstellen'],
    ['ChangeNickname', 'Eigenen Nickname ändern'],
    ['ManageNicknames', 'Nicknamen verwalten'],
    ['KickMembers', 'Mitglieder kicken'],
    ['BanMembers', 'Mitglieder bannen'],
    ['ModerateMembers', 'Mitglieder im Timeout'],
    ['Administrator', 'Administrator', true],
  ]],
  ['Text', [
    ['SendMessages', 'Nachrichten senden'],
    ['SendMessagesInThreads', 'In Threads senden'],
    ['CreatePublicThreads', 'Öffentliche Threads erstellen'],
    ['CreatePrivateThreads', 'Private Threads erstellen'],
    ['EmbedLinks', 'Links einbetten'],
    ['AttachFiles', 'Dateien anhängen'],
    ['AddReactions', 'Reaktionen hinzufügen'],
    ['UseExternalEmojis', 'Externe Emojis'],
    ['UseExternalStickers', 'Externe Sticker'],
    ['MentionEveryone', '@everyone / @here / alle Rollen'],
    ['ManageMessages', 'Nachrichten verwalten'],
    ['ManageThreads', 'Threads verwalten'],
    ['ReadMessageHistory', 'Nachrichtenverlauf lesen'],
    ['SendTTSMessages', 'TTS-Nachrichten senden'],
    ['UseApplicationCommands', 'Anwendungsbefehle nutzen'],
    ['SendVoiceMessages', 'Sprachnachrichten senden'],
  ]],
  ['Sprache', [
    ['Connect', 'Verbinden'],
    ['Speak', 'Sprechen'],
    ['Stream', 'Video / Stream'],
    ['UseEmbeddedActivities', 'Aktivitäten nutzen'],
    ['UseSoundboard', 'Soundboard nutzen'],
    ['UseExternalSounds', 'Externe Sounds'],
    ['UseVAD', 'Sprachaktivierung'],
    ['PrioritySpeaker', 'Prioritätssprecher'],
    ['MuteMembers', 'Mitglieder stummschalten'],
    ['DeafenMembers', 'Mitglieder taub schalten'],
    ['MoveMembers', 'Mitglieder verschieben'],
  ]],
  ['Events', [
    ['CreateEvents', 'Events erstellen'],
    ['ManageEvents', 'Events verwalten'],
  ]],
];

let permState = null; // { roleId, canEdit, botPermissions:Set, saved:Set, current:Set }

async function loadRolePerms(roleId) {
  if (!roleId) { $('permBody').hidden = true; return; }
  $('permMsg').textContent = 'Lädt…';
  try {
    const d = await apiFor('GET', `/roles/${roleId}/permissions`);
    permState = {
      roleId,
      canEdit: d.canEdit,
      botPermissions: new Set(d.botPermissions),
      saved: new Set(d.permissions),
      current: new Set(d.permissions),
    };
    renderPerms();
    $('permBody').hidden = false;
    $('permMsg').textContent = d.canEdit ? '' : 'Diese Rolle kann der Bot nicht bearbeiten.';
  } catch (e) {
    $('permMsg').textContent = e.message;
    $('permBody').hidden = true;
  }
}

function renderPerms() {
  const s = permState;
  const adminOn = s.current.has('Administrator');
  $('permGroups').innerHTML = PERM_GROUPS.map(([group, perms]) => `
    <div class="perm-group">
      <h4>${escapeHtml(group)}</h4>
      ${perms.map(([flag, label, danger]) => {
        const botHas = s.botPermissions.has(flag) || s.botPermissions.has('Administrator');
        const disabled = !s.canEdit || !botHas || (adminOn && flag !== 'Administrator');
        return `<label class="perm-row ${danger ? 'perm-row--danger' : ''} ${disabled ? 'is-off' : ''}">
          <input type="checkbox" data-flag="${flag}" ${s.current.has(flag) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span><b>${escapeHtml(label)}</b>${!botHas ? '<small>Der Bot hat diese Berechtigung selbst nicht.</small>' : (adminOn && flag !== 'Administrator' ? '<small>Durch „Administrator" ohnehin aktiv.</small>' : '')}</span>
        </label>`;
      }).join('')}
    </div>`).join('');
  refreshPermSave();
}

function refreshPermSave() {
  const s = permState;
  const dirty = s.current.size !== s.saved.size || [...s.current].some((p) => !s.saved.has(p));
  $('permSave').disabled = !dirty || !s.canEdit;
  if (s.canEdit) $('permMsg').textContent = dirty ? 'Ungespeicherte Änderungen.' : '';
}

$('permRole').addEventListener('change', () => loadRolePerms($('permRole').value));

$('permGroups').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-flag]');
  if (!cb) return;
  if (cb.checked) permState.current.add(cb.dataset.flag);
  else permState.current.delete(cb.dataset.flag);
  if (cb.dataset.flag === 'Administrator') renderPerms(); // andere Zeilen ausgrauen
  else refreshPermSave();
});

$('permSave').addEventListener('click', async () => {
  try {
    const r = await apiFor('PATCH', `/roles/${permState.roleId}/permissions`, { permissions: [...permState.current] });
    permState.saved = new Set(r.permissions);
    permState.current = new Set(r.permissions);
    toast('Berechtigungen gespeichert.', 'success');
    renderPerms();
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------------- Rollen-Reihenfolge ---------------- */

function movableRoles(roles) {
  return roles
    .filter((r) => !r.managed && r.position < META.botTopRolePosition)
    .sort((a, b) => b.position - a.position);
}

function renderOrder(roles) {
  const byId = new Map(roles.map((r) => [String(r.id), r]));
  $('roleOrder').innerHTML = orderIds.map((id, i) => {
    const r = byId.get(String(id));
    if (!r) return '';
    return `<div class="ro-item" data-id="${id}">
      <span class="ro-item__dot" style="background:${r.color && r.color !== '#000000' ? r.color : 'var(--line)'}"></span>
      <span class="ro-item__name">${escapeHtml(r.name)}</span>
      <span class="ro-item__btns">
        <button class="btn btn--outline btn--sm" data-dir="up" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn btn--outline btn--sm" data-dir="down" ${i === orderIds.length - 1 ? 'disabled' : ''}>▼</button>
      </span>
    </div>`;
  }).join('') || '<p class="muted">Keine verschiebbaren Rollen (alle stehen über der Bot-Rolle oder werden von Integrationen verwaltet).</p>';

  const dirty = JSON.stringify(orderIds) !== JSON.stringify(savedOrder);
  $('roleOrderSave').disabled = !dirty || !META.canRoles || orderIds.length < 2;
  $('roMsg').textContent = !META.canRoles ? 'Dem Bot fehlt „Rollen verwalten".' : (dirty ? 'Ungespeicherte Reihenfolge.' : '');
}

$('roleOrder').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-dir]');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  const i = orderIds.indexOf(id);
  const j = btn.dataset.dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= orderIds.length) return;
  [orderIds[i], orderIds[j]] = [orderIds[j], orderIds[i]];
  window.__roles && renderOrder(window.__roles);
});

$('roleOrderSave').addEventListener('click', async () => {
  try {
    await apiFor('PATCH', '/roles/order', { order: orderIds });
    savedOrder = [...orderIds];
    toast('Reihenfolge gespeichert.', 'success');
    window.__roles = await apiFor('GET', '/roles');
    renderOrder(window.__roles);
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------------- Init ---------------- */

(async function init() {
  try {
    const [chans, roles, meta] = await Promise.all([getChannels(), getRoles(), apiFor('GET', '/member-tools')]);
    META = meta;
    window.__roles = roles;

    $('chParent').innerHTML = '<option value="">— keine —</option>' +
      (chans.categories || []).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    syncParentField();

    orderIds = movableRoles(roles).map((r) => String(r.id));
    savedOrder = [...orderIds];
    renderOrder(roles);

    // Rollen-Auswahl für den Berechtigungs-Editor (verschiebbare Rollen + @everyone)
    const editable = roles.filter((r) => !r.managed && r.position < META.botTopRolePosition);
    $('permRole').innerHTML = '<option value="">— Rolle wählen —</option>' +
      `<option value="${GUILD_ID}">@everyone</option>` +
      editable.sort((a, b) => b.position - a.position)
        .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

    if (!META.canChannels || !META.canRoles) {
      const miss = [];
      if (!META.canChannels) miss.push('„Kanäle verwalten"');
      if (!META.canRoles) miss.push('„Rollen verwalten"');
      $('permWarnText').textContent = `Dem Bot fehlt auf diesem Server: ${miss.join(' und ')}. Ohne diese Rechte funktioniert der jeweilige Bereich nicht.`;
      $('permWarn').hidden = false;
    }
    if (!META.canChannels) $('chForm').querySelectorAll('input, select, button').forEach((el) => (el.disabled = true));
  } catch (e) {
    toast(e.message, 'error');
  }
})();
