/* global document, Dash */
'use strict';

const { apiFor, getChannels, escapeHtml, fmtRelative, toast, trackForm } = Dash;

const $ = (id) => document.getElementById(id);
const form = $('logRouting');
let CFG = null; // { general, groups: [{ key, label, emoji, channel, events: [{ type, label, on, channel }] }] }
let TEXT = []; // Textkanäle
const GROUP_OF = new Map(); // Ereignis-Typ -> Gruppe

const chName = (id) => {
  const c = TEXT.find((x) => x.id === id);
  return c ? '#' + c.name : id ? '#gelöschter-kanal' : '';
};
const options = (first) => `<option value="">${escapeHtml(first)}</option>` + TEXT.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');

/* ---------------- Verlauf ---------------- */

let group = '';
let oldestId = null;

function row(r) {
  const g = GROUP_OF.get(r.type);
  return `<li>
    <span class="activity__ico log-list__emoji" title="${escapeHtml(g ? g.label : 'Sonstiges')}">${g ? g.emoji : '📝'}</span>
    <span class="log-list__text">${escapeHtml(String(r.message || r.type).replace(/^\p{Extended_Pictographic}️?\s*/u, ''))}${r.actorName ? `<small>von ${escapeHtml(r.actorName)}</small>` : ''}</span>
    <time title="${escapeHtml(new Date(r.created_at).toLocaleString('de-DE'))}">${escapeHtml(fmtRelative(r.created_at))}</time></li>`;
}

async function loadLogs(more = false) {
  const w = $('logList');
  if (!more) { w.innerHTML = '<li class="loading">Lädt…</li>'; oldestId = null; }
  try {
    const q = new URLSearchParams({ limit: '50' });
    if (group) q.set('group', group);
    if (more && oldestId) q.set('before', String(oldestId));
    const rows = await apiFor('GET', `/activity?${q}`);
    if (rows.length) oldestId = rows[rows.length - 1].id;
    const html = rows.map(row).join('');
    if (more) w.insertAdjacentHTML('beforeend', html);
    else w.innerHTML = html || '<li class="muted">Noch keine Einträge.</li>';
    $('logMore').hidden = rows.length < 50;
  } catch (e) { w.innerHTML = `<li class="muted">${escapeHtml(e.message)}</li>`; }
}

$('logTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (!b) return;
  document.querySelectorAll('#logTabs .tab').forEach((t) => t.classList.toggle('is-active', t === b));
  group = b.dataset.g;
  loadLogs();
});
$('reload').addEventListener('click', () => loadLogs());
$('logMore').addEventListener('click', () => loadLogs(true));

/* ---------------- Was wird wohin geloggt ---------------- */

function renderRouting() {
  form.elements.general.innerHTML = options('— kein allgemeiner Log-Kanal —');
  $('logGroups').innerHTML = CFG.groups.map((g) => `
    <details class="log-group" data-group="${g.key}">
      <summary>
        <span class="log-group__emoji">${g.emoji}</span>
        <b>${escapeHtml(g.label)}</b>
        <span class="log-group__state" data-state="${g.key}"></span>
      </summary>
      <div class="log-group__body">
        ${g.note ? `<p class="card__sub" style="margin:12px 0 0;">${escapeHtml(g.note)}</p>` : ''}
        <div class="field log-group__channel">
          <label>Kanal für ${escapeHtml(g.label)}</label>
          <select name="group:${g.key}" data-logsel="group" data-g="${g.key}"></select>
        </div>
        ${g.events.map((ev) => `
          <div class="log-event">
            <label class="toggle"><input type="checkbox" name="on:${ev.type}" /><span class="toggle__track"></span></label>
            <span class="log-event__label">${escapeHtml(ev.label)}</span>
            <select name="ch:${ev.type}" data-logsel="event" data-g="${g.key}"></select>
          </div>`).join('')}
      </div>
    </details>`).join('');
  // Texte der ersten Option („Standard“) setzt refreshLabels()
  form.querySelectorAll('select[data-logsel="group"], select[data-logsel="event"]').forEach((sel) => { sel.innerHTML = options(''); });
  fill();
}

/** Werte aus CFG in das Formular schreiben. */
function fill() {
  form.elements.general.value = CFG.general;
  for (const g of CFG.groups) {
    form.elements[`group:${g.key}`].value = g.channel;
    for (const ev of g.events) {
      form.elements[`on:${ev.type}`].checked = ev.on;
      form.elements[`ch:${ev.type}`].value = ev.channel;
    }
  }
  refreshLabels();
}

/** „Standard“-Texte der Auswahlfelder und die Zusammenfassung je Gruppe aktualisieren. */
function refreshLabels() {
  const general = form.elements.general.value;
  for (const g of CFG.groups) {
    const gSel = form.elements[`group:${g.key}`];
    gSel.options[0].textContent = `Allgemeiner Log-Kanal${general ? ` (${chName(general)})` : ' (nicht gesetzt)'}`;
    const groupTarget = gSel.value || general;
    let on = 0;
    const targets = new Set();
    for (const ev of g.events) {
      const sel = form.elements[`ch:${ev.type}`];
      const enabled = form.elements[`on:${ev.type}`].checked;
      sel.options[0].textContent = `Wie Gruppe${groupTarget ? ` (${chName(groupTarget)})` : ' (kein Kanal)'}`;
      sel.disabled = !enabled;
      sel.closest('.log-event').classList.toggle('is-off', !enabled);
      if (enabled) {
        on++;
        const t = sel.value || groupTarget;
        targets.add(t ? chName(t) : 'nur Verlauf');
      }
    }
    const where = on ? [...targets].join(', ') : 'nur Verlauf';
    form.querySelector(`[data-state="${g.key}"]`).textContent = `${on} von ${g.events.length} an · ${where}`;
  }
}
form.addEventListener('change', refreshLabels);

async function save() {
  const body = { general: form.elements.general.value, groups: {}, events: {} };
  for (const g of CFG.groups) {
    body.groups[g.key] = form.elements[`group:${g.key}`].value;
    for (const ev of g.events) {
      body.events[ev.type] = { on: form.elements[`on:${ev.type}`].checked, channel: form.elements[`ch:${ev.type}`].value };
    }
  }
  try {
    await apiFor('PATCH', '/logs/config', body);
    CFG = await apiFor('GET', '/logs/config');
    toast('Log-Einstellungen gespeichert.', 'success');
  } catch (err) { toast(err.message, 'error'); throw err; }
}

async function reset() {
  CFG = await apiFor('GET', '/logs/config');
  fill();
}

(async function init() {
  try {
    const [chans, cfg] = await Promise.all([getChannels(), apiFor('GET', '/logs/config')]);
    TEXT = chans.text || [];
    CFG = cfg;
    for (const g of CFG.groups) {
      for (const ev of g.events) GROUP_OF.set(ev.type, g);
      $('logTabs').insertAdjacentHTML('beforeend', `<button class="tab" data-g="${g.key}" type="button">${g.emoji} ${escapeHtml(g.label)}</button>`);
    }
    renderRouting();
    trackForm(form, save, { reset, key: 'logRouting' });
    await loadLogs();
  } catch (e) { toast(e.message, 'error'); }
})();
