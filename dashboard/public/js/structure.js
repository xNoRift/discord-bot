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

/* ---------------- Rolle erstellen ---------------- */

$('rcColor').addEventListener('input', () => { $('rcColorText').value = $('rcColor').value; });
$('rcColorText').addEventListener('input', () => {
  const v = $('rcColorText').value.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(v)) $('rcColor').value = v[0] === '#' ? v : '#' + v;
});

$('roleCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('rcName').value.trim();
  if (!name) return;
  if ($('rcAdmin').checked && !(await Dash.confirmModal(
    `Rolle „${name}" mit vollen Administrator-Rechten erstellen?`, { danger: true, confirmLabel: 'Ja, erstellen' },
  ))) return;
  $('rcMsg').textContent = 'Erstelle…';
  try {
    const r = await apiFor('POST', '/roles', {
      name,
      color: $('rcColorText').value.trim(),
      hoist: $('rcHoist').checked,
      mentionable: $('rcMentionable').checked,
      admin: $('rcAdmin').checked,
    });
    toast(`Rolle „${r.role.name}" erstellt.`, 'success');
    $('rcMsg').textContent = '';
    $('roleCreateForm').reset();
    $('rcColor').value = '#7c5cff';
    await refreshRoles();
  } catch (err) {
    $('rcMsg').textContent = err.message;
    toast(err.message, 'error');
  }
});

/** Rollen neu laden und die Rollen-Bereiche (Reihenfolge + Berechtigungs-Auswahl) aktualisieren. */
async function refreshRoles() {
  const roles = await apiFor('GET', '/roles');
  window.__roles = roles;

  orderIds = movableRoles(roles).map((r) => String(r.id));
  savedOrder = [...orderIds];
  renderOrder(roles);

  const keep = $('permRole').value;
  const editable = roles.filter((r) => !r.managed && r.position < META.botTopRolePosition);
  $('permRole').innerHTML = '<option value="">— Rolle wählen —</option>' +
    `<option value="${GUILD_ID}">@everyone</option>` +
    editable.sort((a, b) => b.position - a.position)
      .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  if (keep && $('permRole').querySelector(`option[value="${keep}"]`)) $('permRole').value = keep;
  else { $('permBody').hidden = true; permState = null; }
}

/* ---------------- Rollen-Berechtigungen ---------------- */

// Vollständige Liste aller Discord-Berechtigungen (Flag-Name -> Label; true = heikel).
const PERM_GROUPS = [
  ['Allgemeine Serverrechte', [
    ['ViewChannel', 'Kanäle ansehen'],
    ['ManageChannels', 'Kanäle verwalten'],
    ['ManageRoles', 'Rollen verwalten'],
    ['CreateGuildExpressions', 'Ausdrücke erstellen (Emojis/Sticker/Sounds)'],
    ['ManageGuildExpressions', 'Ausdrücke verwalten (Emojis/Sticker/Sounds)'],
    ['ViewAuditLog', 'Audit-Log einsehen'],
    ['ViewGuildInsights', 'Server-Einblicke anzeigen'],
    ['ManageWebhooks', 'Webhooks verwalten'],
    ['ManageGuild', 'Server verwalten', true],
    ['ViewCreatorMonetizationAnalytics', 'Monetarisierungs-Analysen anzeigen'],
  ]],
  ['Mitglieder', [
    ['CreateInstantInvite', 'Einladung erstellen'],
    ['ChangeNickname', 'Eigenen Nickname ändern'],
    ['ManageNicknames', 'Nicknames verwalten'],
    ['KickMembers', 'Mitglieder kicken', true],
    ['BanMembers', 'Mitglieder bannen', true],
    ['ModerateMembers', 'Mitglieder moderieren (Timeout)', true],
    ['Administrator', 'Administrator', true],
  ]],
  ['Textkanäle', [
    ['SendMessages', 'Nachrichten senden'],
    ['SendMessagesInThreads', 'Nachrichten in Threads senden'],
    ['CreatePublicThreads', 'Öffentliche Threads erstellen'],
    ['CreatePrivateThreads', 'Private Threads erstellen'],
    ['EmbedLinks', 'Links einbetten'],
    ['AttachFiles', 'Dateien anhängen'],
    ['AddReactions', 'Reaktionen hinzufügen'],
    ['UseExternalEmojis', 'Externe Emojis verwenden'],
    ['UseExternalStickers', 'Externe Sticker verwenden'],
    ['MentionEveryone', '@everyone, @here und alle Rollen erwähnen', true],
    ['ManageMessages', 'Nachrichten verwalten', true],
    ['PinMessages', 'Nachrichten anpinnen'],
    ['ManageThreads', 'Threads verwalten'],
    ['ReadMessageHistory', 'Nachrichtenverlauf anzeigen'],
    ['SendTTSMessages', 'Text-zu-Sprache-Nachrichten senden'],
    ['SendVoiceMessages', 'Sprachnachrichten senden'],
    ['SendPolls', 'Umfragen erstellen'],
    ['UseApplicationCommands', 'Anwendungsbefehle verwenden'],
    ['UseExternalApps', 'Externe Apps verwenden'],
    ['BypassSlowmode', 'Langsamen Modus umgehen'],
  ]],
  ['Sprachkanäle', [
    ['Connect', 'Verbinden'],
    ['Speak', 'Sprechen'],
    ['Stream', 'Video / Bildschirm teilen'],
    ['UseEmbeddedActivities', 'Aktivitäten verwenden'],
    ['UseSoundboard', 'Soundboard verwenden'],
    ['UseExternalSounds', 'Externe Sounds verwenden'],
    ['UseVAD', 'Sprachaktivierung verwenden'],
    ['PrioritySpeaker', 'Prioritäts-Sprecher'],
    ['SetVoiceChannelStatus', 'Status des Sprachkanals setzen'],
    ['MuteMembers', 'Mitglieder stummschalten', true],
    ['DeafenMembers', 'Mitglieder taub schalten', true],
    ['MoveMembers', 'Mitglieder verschieben', true],
  ]],
  ['Events & Bühne', [
    ['CreateEvents', 'Events erstellen'],
    ['ManageEvents', 'Events verwalten'],
    ['RequestToSpeak', 'Redeerlaubnis anfragen'],
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

    window.__roles = roles;
    await refreshRoles();

    if (!META.canChannels || !META.canRoles) {
      const miss = [];
      if (!META.canChannels) miss.push('„Kanäle verwalten"');
      if (!META.canRoles) miss.push('„Rollen verwalten"');
      $('permWarnText').textContent = `Dem Bot fehlt auf diesem Server: ${miss.join(' und ')}. Ohne diese Rechte funktioniert der jeweilige Bereich nicht.`;
      $('permWarn').hidden = false;
    }
    if (!META.canChannels) $('chForm').querySelectorAll('input, select, button').forEach((el) => (el.disabled = true));
    if (!META.canRoles) {
      $('roleCreateForm').querySelectorAll('input, button').forEach((el) => (el.disabled = true));
      $('rcMsg').textContent = 'Dem Bot fehlt „Rollen verwalten".';
    }
  } catch (e) {
    toast(e.message, 'error');
  }
})();
