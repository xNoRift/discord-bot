/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, getRoles, icon, confirmModal, toast } = Dash;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('de-DE');

let ROLES = [];
let REWARDS = [];
const roleName = (id) => ROLES.find((r) => String(r.id) === String(id))?.name || 'gelöschte Rolle';

/* ---------------- Level-Belohnungen ---------------- */

async function loadRewards() {
  const w = $('rewardList');
  try {
    REWARDS = await apiFor('GET', '/levels/rewards');
    w.innerHTML = REWARDS.length
      ? REWARDS.map((r) => `<div class="list-row">
          <div class="list-row__head">
            <span class="list-row__title">${icon('star', 'icon--sm')} Level ${r.level} → @${escapeHtml(roleName(r.role_id))}</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--danger btn--sm" data-del="${r.id}">${icon('trash', 'icon--sm')}</button>
          </div></div>`).join('')
      : `<div class="empty">${icon('gift')}<b>Keine Belohnungen</b>Lege oben eine an.</div>`;
    if (curve.ready) renderCurve(true); // Rollen-Hinweise in der Stufen-Tabelle aktualisieren
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

$('rewardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiFor('POST', '/levels/rewards', {
      level: $('rwLevel').value,
      roleId: $('rwRole').value,
    });
    $('rwLevel').value = '';
    toast('Belohnung hinzugefügt.', 'success');
    await loadRewards();
  } catch (err) { toast(err.message, 'error'); }
});

$('rewardList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  const id = btn.dataset.del;
  try {
    if (!(await confirmModal('Diese Belohnung entfernen?', { danger: true, confirmLabel: 'Entfernen' }))) return;
    await apiFor('DELETE', `/levels/rewards/${id}`);
    await loadRewards();
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------------- Rangliste ---------------- */

let boardRows = [];

async function loadBoard() {
  const w = $('board');
  try {
    const d = await apiFor('GET', '/levels/leaderboard?limit=20');
    boardRows = d.rows;
    w.innerHTML = d.rows.length
      ? d.rows.map((r) => `<div class="list-row">
          <div class="list-row__head">
            <span class="list-row__title">#${r.rank} ${escapeHtml(r.name || 'Mitglied ' + r.userId)}</span>
            <span class="badge badge--active">Level ${r.level}</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--ghost btn--sm" data-xp="${r.userId}" title="XP verwalten">${icon('edit', 'icon--sm')}</button>
            <button type="button" class="btn btn--ghost btn--sm" data-reset="${r.userId}" title="XP zurücksetzen">${icon('refresh', 'icon--sm')}</button>
          </div>
          <div class="list-row__meta"><span>${fmt(r.xp)} XP</span><span>${r.messages} Nachrichten</span><span>${r.voiceMinutes} Min. Sprache</span><span>${r.maxLevel ? 'Höchstlevel erreicht' : r.progress + '% zum nächsten Level'}</span></div>
        </div>`).join('')
      : `<div class="empty">${icon('chart')}<b>Noch keine Daten</b>Sobald Mitglieder schreiben, erscheint hier die Rangliste.</div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

$('board').addEventListener('click', async (e) => {
  const xpBtn = e.target.closest('[data-xp]');
  if (xpBtn) {
    const r = boardRows.find((x) => x.userId === xpBtn.dataset.xp);
    if (r) pickTarget({ id: r.userId, name: r.name || 'Mitglied ' + r.userId, avatarUrl: r.avatarUrl, xp: r.xp, level: r.level }, true);
    return;
  }
  const btn = e.target.closest('[data-reset]');
  if (!btn) return;
  const uid = btn.dataset.reset;
  try {
    if (!(await confirmModal('XP dieses Mitglieds zurücksetzen?', { danger: true, confirmLabel: 'Zurücksetzen' }))) return;
    await apiFor('DELETE', `/levels/users/${uid}`);
    if (xpTarget?.id === uid) pickTarget({ ...xpTarget, xp: 0, level: 0 });
    await loadBoard();
  } catch (err) { toast(err.message, 'error'); }
});

$('lvlResetAll').addEventListener('click', async () => {
  try {
    if (!(await confirmModal('ALLE XP und Level auf diesem Server zurücksetzen? Das kann nicht rückgängig gemacht werden.', { danger: true, confirmLabel: 'Alles zurücksetzen' }))) return;
    await apiFor('POST', '/levels/reset');
    toast('Zurückgesetzt.', 'success');
    if (xpTarget) pickTarget({ ...xpTarget, xp: 0, level: 0 });
    await loadBoard();
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------------- XP vergeben ---------------- */

let xpTarget = null; // { id, name, avatarUrl, xp, level }
let xpFound = [];
let xpTimer = null;

function renderTarget() {
  const t = $('xpTarget');
  $('xpApply').disabled = !xpTarget;
  if (!xpTarget) { t.hidden = true; t.innerHTML = ''; return; }
  t.hidden = false;
  t.innerHTML = `
    ${xpTarget.avatarUrl ? `<img src="${escapeHtml(xpTarget.avatarUrl)}" alt="" />` : ''}
    <div><b>${escapeHtml(xpTarget.name)}</b><small>Level ${xpTarget.level} · ${fmt(xpTarget.xp)} XP</small></div>
    <span class="spacer"></span>
    <button type="button" class="btn btn--ghost btn--sm" data-clear title="Auswahl aufheben">${icon('x', 'icon--sm')}</button>`;
}

function pickTarget(t, focus) {
  xpTarget = t;
  xpFound = [];
  $('xpResults').innerHTML = '';
  $('xpSearch').value = '';
  renderTarget();
  if (focus) {
    $('xpCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('xpAmount').focus();
  }
}

$('xpSearch').addEventListener('input', () => {
  clearTimeout(xpTimer);
  const q = $('xpSearch').value.trim();
  if (q.length < 2) { $('xpResults').innerHTML = ''; return; }
  xpTimer = setTimeout(async () => {
    $('xpResults').innerHTML = '<div class="loading">Suche…</div>';
    try {
      xpFound = await apiFor('GET', `/levels/search?q=${encodeURIComponent(q)}`);
      $('xpResults').innerHTML = xpFound.length
        ? xpFound.map((m, i) => `
          <div class="xp-row">
            <img src="${escapeHtml(m.avatarUrl)}" alt="" loading="lazy" />
            <div><b>${escapeHtml(m.name)}</b><small>${escapeHtml(m.tag)} · Level ${m.level} · ${fmt(m.xp)} XP</small></div>
            <span class="spacer"></span>
            <button type="button" class="btn btn--outline btn--sm" data-pick="${i}">Auswählen</button>
          </div>`).join('')
        : '<p class="muted">Kein Mitglied gefunden.</p>';
    } catch (e) { $('xpResults').innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
  }, 300);
});

$('xpResults').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick]');
  const m = btn && xpFound[Number(btn.dataset.pick)];
  if (m) pickTarget({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, xp: m.xp, level: m.level });
});

$('xpTarget').addEventListener('click', (e) => {
  if (e.target.closest('[data-clear]')) pickTarget(null);
});

async function applyXp() {
  if (!xpTarget) return;
  const amount = $('xpAmount').value.trim();
  if (amount === '' || Number(amount) < 0) { toast('Bitte eine XP-Menge angeben.', 'error'); return; }
  const btn = $('xpApply');
  btn.disabled = true;
  try {
    const r = await apiFor('POST', `/levels/users/${xpTarget.id}/xp`, { mode: $('xpMode').value, amount });
    const name = xpTarget.name;
    xpTarget = { ...xpTarget, xp: r.xp, level: r.level };
    $('xpAmount').value = '';
    const lvl = r.level !== r.oldLevel ? `Level ${r.oldLevel} → ${r.level}` : `Level ${r.level}`;
    toast(`${name}: ${fmt(r.previousXp)} → ${fmt(r.xp)} XP (${lvl})`, 'success');
    if (r.roleFailures) toast(`${r.roleFailures} Rolle(n) konnten nicht angepasst werden – steht die Bot-Rolle über der Belohnungs-Rolle?`, 'error');
    await loadBoard();
  } catch (err) { toast(err.message, 'error'); }
  renderTarget();
}

$('xpApply').addEventListener('click', applyXp);
$('xpAmount').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyXp(); });

/* ---------------- Level-Stufen ---------------- */

const curve = { ready: false, custom: false, values: [], defaults: [], maxLevels: 200 };

/** Übernimmt die eingetippten Werte aus den Feldern in den Zustand. */
function readCurveDom() {
  if (!curve.custom) return;
  const inputs = [...document.querySelectorAll('#curveBody input[data-lvl]')];
  if (inputs.length) curve.values = inputs.map((i) => (i.value === '' ? NaN : Number(i.value)));
}

function rewardBadges(level) {
  return REWARDS.filter((r) => r.level === level)
    .map((r) => `<span class="badge badge--active">${icon('gift', 'icon--sm')} @${escapeHtml(roleName(r.role_id))}</span>`)
    .join(' ');
}

function renderCurve(readFirst) {
  if (readFirst) readCurveDom();
  const body = $('curveBody');
  const v = curve.values;
  const rows = v.map((xp, i) => {
    const level = i + 1;
    const diff = `<span class="curve-row__diff" data-diff="${level}"></span>`;
    const field = curve.custom
      ? `<input type="number" min="1" step="1" name="t${level}" data-lvl="${level}" value="${Number.isFinite(xp) ? xp : ''}" />`
      : `<span style="min-width:150px;display:inline-block;">ab ${fmt(xp)} XP</span>`;
    return `<div class="curve-row"><span class="curve-row__lvl">Level ${level}</span>${field}${diff}${rewardBadges(level)}</div>`;
  }).join('');
  const tools = curve.custom
    ? `<div class="curve-tools">
        <button type="button" class="btn btn--outline btn--sm" data-act="add">${icon('plus', 'icon--sm')} Stufe hinzufügen</button>
        <button type="button" class="btn btn--outline btn--sm" data-act="remove">Letzte Stufe entfernen</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="reset">${icon('refresh', 'icon--sm')} Standard-Kurve laden</button>
      </div>`
    : '';
  const note = curve.custom
    ? `<p class="curve-note">Trage bei jedem Level die <b>Gesamt-XP</b> ein, ab der es gilt (Level 1 ab 100 XP, Level 2 ab 250 XP …). Höchstlevel: <b>${v.length}</b>. Mitglieder darüber bleiben auf dem Höchstlevel.</p>`
    : `<p class="curve-note">Standard-Kurve (erste ${v.length} Level, danach nach derselben Formel unbegrenzt weiter). Aktiviere oben die eigenen Stufen, um sie anzupassen.</p>`;
  body.innerHTML = `${tools}<div class="curve-list">${rows}</div>${note}`;
  updateDiffs();
}

/** Zeigt pro Zeile den Abstand zum vorigen Level und markiert unzulässige Werte. */
function updateDiffs() {
  const v = curve.custom
    ? [...document.querySelectorAll('#curveBody input[data-lvl]')].map((i) => (i.value === '' ? NaN : Number(i.value)))
    : curve.values;
  v.forEach((xp, i) => {
    const prev = i === 0 ? 0 : v[i - 1];
    const bad = !Number.isInteger(xp) || xp < 1 || xp <= prev;
    const d = document.querySelector(`#curveBody [data-diff="${i + 1}"]`);
    if (d) d.textContent = Number.isFinite(xp) && Number.isFinite(prev) ? `+${fmt(Math.max(0, xp - prev))} XP` : '';
    const input = document.querySelector(`#curveBody input[data-lvl="${i + 1}"]`);
    input?.classList.toggle('is-invalid', bad);
  });
}

async function loadCurve() {
  const d = await apiFor('GET', '/levels/curve');
  curve.custom = d.custom;
  curve.values = d.custom ? d.curve.slice() : d.defaults.slice();
  curve.defaults = d.defaults;
  curve.maxLevels = d.maxLevels;
  document.querySelector('#curveForm [name="curveCustom"]').checked = d.custom;
  curve.ready = true;
  renderCurve(false);
  $('curveForm').sbMarkClean?.();
}

async function saveCurve() {
  try {
    readCurveDom();
    if (!curve.custom) {
      await apiFor('DELETE', '/levels/curve');
    } else {
      const v = curve.values;
      for (let i = 0; i < v.length; i++) {
        if (!Number.isInteger(v[i]) || v[i] < 1) throw new Error(`Level ${i + 1}: bitte eine ganze Zahl ab 1 eintragen.`);
        if (i > 0 && v[i] <= v[i - 1]) throw new Error(`Level ${i + 1} braucht mehr XP als Level ${i}.`);
      }
      await apiFor('PUT', '/levels/curve', { curve: v });
    }
    toast('Gespeichert. Die Level der Mitglieder wurden neu berechnet.', 'success');
    await loadCurve();
    await loadBoard();
  } catch (err) { toast(err.message, 'error'); throw err; }
}

document.querySelector('#curveForm [name="curveCustom"]').addEventListener('change', (e) => {
  readCurveDom();
  curve.custom = e.target.checked;
  if (curve.custom && !curve.values.length) curve.values = curve.defaults.slice();
  renderCurve(false);
});

$('curveBody').addEventListener('input', updateDiffs);

$('curveBody').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  readCurveDom();
  const v = curve.values;
  if (btn.dataset.act === 'add') {
    if (v.length >= curve.maxLevels) { toast(`Maximal ${curve.maxLevels} Level-Stufen.`, 'error'); return; }
    const last = v[v.length - 1];
    const before = v[v.length - 2];
    const step = Number.isFinite(last) && Number.isFinite(before) ? last - before : last;
    v.push(Number.isFinite(last) ? last + Math.max(1, step) : 100);
  } else if (btn.dataset.act === 'remove') {
    if (v.length <= 1) { toast('Mindestens eine Level-Stufe wird gebraucht – oder eigene Stufen oben ausschalten.', 'error'); return; }
    v.pop();
  } else if (btn.dataset.act === 'reset') {
    curve.values = curve.defaults.slice();
  }
  renderCurve(false);
  // Änderungen an der Zeilenzahl gelten als "geändert" für die Speicher-Leiste.
  $('curveForm').dispatchEvent(new Event('input', { bubbles: true }));
  if (btn.dataset.act === 'add') $('curveBody').querySelector('.curve-list').scrollTop = 1e6;
});

/* ---------------- Start ---------------- */

(async function init() {
  try {
    ROLES = await getRoles();
    await Dash.moduleForm('levels', $('lvlForm'), {
      on: 'Das Level-System ist aktiv. Mitglieder sammeln ab jetzt XP.',
      off: 'Das Level-System ist deaktiviert. Aktiviere es, damit Mitglieder XP sammeln.',
    });
    await loadRewards();
    await Promise.all([loadCurve(), loadBoard()]);
    Dash.trackForm($('curveForm'), saveCurve, { reset: loadCurve });
    renderTarget();
  } catch (e) { toast(e.message, 'error'); }
})();
