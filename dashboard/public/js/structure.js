/* global document, Dash */
'use strict';

const { apiFor, getChannels, getRoles, escapeHtml, icon, toast } = Dash;

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
