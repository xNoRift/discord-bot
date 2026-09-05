/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, toast, escapeHtml, getRoles } = Dash;

/** Rollen frisch vom Server holen (getRoles() ist seitenweit gecacht und würde
 * neu erstellte/gelöschte Rollen auf dieser Seite nicht ohne Reload zeigen). */
function fetchRolesFresh() {
  return apiFor('GET', '/roles');
}

/* ---------------- Rolle erstellen ---------------- */

const createForm = document.getElementById('roleCreateForm');
createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(createForm);
  const status = document.getElementById('roleCreateStatus');
  status.textContent = 'Wird erstellt…';
  try {
    await apiFor('POST', '/roles', { name: a.name, color: a.color, hoist: a.hoist, mentionable: a.mentionable });
    toast('Rolle erstellt.', 'success');
    status.textContent = 'Erstellt ✓';
    createForm.reset();
    await loadRoles();
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

/* ---------------- Alle Rollen ---------------- */

const roleList = document.getElementById('roleList');

async function loadRoles() {
  roleList.innerHTML = '<li class="loading">Lädt…</li>';
  try {
    const roles = await fetchRolesFresh();
    roleList.innerHTML = roles.length
      ? roles
          .map(
            (r) => `<li>
          <span style="width:16px;height:16px;border-radius:50%;background:${r.color === '#000000' ? 'var(--text-2)' : r.color};flex-shrink:0;"></span>
          <span><b>${escapeHtml(r.name)}</b><br><span class="muted">Position ${r.position}${r.managed ? ' · verwaltet (nicht editierbar)' : ''}</span></span>
          ${
            r.managed
              ? ''
              : `<button class="btn btn--ghost btn--sm" data-edit="${r.id}" style="margin-left:auto;">Bearbeiten</button>
                 <button class="btn btn--ghost btn--sm" data-delete="${r.id}" data-name="${escapeHtml(r.name)}">Löschen</button>`
          }
        </li>`,
          )
          .join('')
      : '<li class="muted">Keine Rollen gefunden.</li>';
  } catch (e) {
    roleList.innerHTML = `<li style="color:var(--red)">${escapeHtml(e.message)}</li>`;
  }
}

roleList.addEventListener('click', async (e) => {
  const delBtn = e.target.closest('[data-delete]');
  if (delBtn) {
    if (!(await Dash.confirmModal(`Rolle „${delBtn.dataset.name}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`, { danger: true }))) return;
    try {
      await apiFor('DELETE', `/roles/${delBtn.dataset.delete}`);
      toast('Rolle gelöscht.', 'success');
      await loadRoles();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) openEditModal(editBtn.dataset.edit);
});

async function openEditModal(roleId) {
  const roles = await fetchRolesFresh();
  const role = roles.find((r) => r.id === roleId);
  if (!role) return;
  const { modal, close } = Dash.openModal(`
    <h2>Rolle bearbeiten</h2>
    <div class="field"><label>Name</label><input id="editRoleName" maxlength="100" value="${escapeHtml(role.name)}" /></div>
    <div class="field"><label>Farbe</label><input id="editRoleColor" type="color" value="${role.color}" /></div>
    <div class="modal__actions">
      <button class="btn btn--ghost" data-act="cancel">Abbrechen</button>
      <button class="btn btn--primary" data-act="ok">Speichern</button>
    </div>
  `);
  modal.querySelector('[data-act="cancel"]').onclick = close;
  modal.querySelector('[data-act="ok"]').onclick = async () => {
    const name = modal.querySelector('#editRoleName').value.trim();
    const color = modal.querySelector('#editRoleColor').value;
    try {
      await apiFor('PATCH', `/roles/${roleId}`, { name, color });
      toast('Rolle geändert.', 'success');
      close();
      await loadRoles();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/* ---------------- Rolle vergeben/entfernen ---------------- */

const assignForm = document.getElementById('roleAssignForm');
let pendingAssignAct = 'assign';

assignForm.querySelectorAll('button[data-act]').forEach((b) => {
  b.addEventListener('click', () => { pendingAssignAct = b.dataset.act; });
});

assignForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(assignForm);
  const status = document.getElementById('roleAssignStatus');
  if (!/^\d{5,25}$/.test(a.userId)) return toast('Bitte eine gültige User-ID angeben.', 'error');
  if (!a.roleId) return toast('Bitte eine Rolle wählen.', 'error');

  status.textContent = 'Wird ausgeführt…';
  try {
    if (pendingAssignAct === 'remove') {
      await apiFor('DELETE', `/roles/${a.roleId}/members/${a.userId}`, {});
      toast('Rolle entfernt.', 'success');
      status.textContent = '✓ Entfernt';
    } else {
      const r = await apiFor('POST', `/roles/${a.roleId}/members/${a.userId}`, { duration: a.duration });
      toast(r.temporary ? 'Befristet vergeben.' : 'Rolle vergeben.', 'success');
      status.textContent = '✓ Vergeben';
    }
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

/* ---------------- Zugriff (Dashboard-Rollen für "settings") ---------------- */

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

async function loadRoleAccess() {
  const [roles, d] = await Promise.all([getRoles(), apiFor('GET', '/dashboard-roles?scope=settings')]);
  const selected = new Set(d.roleIds || []);
  document.getElementById('roleAccessChecks').innerHTML = roles.length
    ? roleChecklist(roles, selected)
    : '<p class="muted">Keine Rollen gefunden.</p>';
}

document.getElementById('roleAccessSave').addEventListener('click', async () => {
  const roleIds = [...document.querySelectorAll('#roleAccessChecks input:checked')].map((c) => c.value);
  const status = document.getElementById('roleAccessStatus');
  try {
    await apiFor('POST', '/dashboard-roles', { scope: 'settings', roleIds });
    toast('Zugriff gespeichert.', 'success');
    status.textContent = 'Gespeichert ✓';
  } catch (err) {
    toast(err.message, 'error');
    status.textContent = err.message;
  }
});

(async function init() {
  try {
    await fillSelectors({});
    await Promise.all([loadRoles(), loadRoleAccess()]);
  } catch (e) {
    toast(e.message, 'error');
  }
})();
