/* global document, window, Dash */
'use strict';

const { apiFor, escapeHtml, toast } = Dash;

const npBox = document.getElementById('npBox');
const npControls = document.getElementById('npControls');
const npVoice = document.getElementById('npVoice');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');
const mcVol = document.getElementById('mcVol');
const mcVolVal = document.getElementById('mcVolVal');
const mcStatus = document.getElementById('mcStatus');

let volDragging = false;
let pollTimer = null;

function fmtDur(sec, live) {
  if (live || !sec) return 'LIVE';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function render(state) {
  const c = state.current;
  if (!c) {
    npBox.innerHTML = `<div class="empty">${Dash.icon('music')}<b>Es läuft gerade nichts</b>Unten einen Song suchen oder einen Radio-Sender starten.</div>`;
    npControls.hidden = true;
    npVoice.textContent = '';
  } else {
    npControls.hidden = false;
    npVoice.textContent = state.voiceChannelId ? 'verbunden' : '';
    npBox.innerHTML = `
      <div class="row-inline" style="gap:16px;align-items:flex-start;flex-wrap:wrap;">
        ${c.thumbnail ? `<img src="${escapeHtml(c.thumbnail)}" alt="" style="width:120px;height:90px;object-fit:cover;border-radius:10px;">` : ''}
        <div style="flex:1;min-width:200px;">
          <div style="font-size:1.1rem;font-weight:700;">${escapeHtml(c.title)}</div>
          <div class="muted" style="margin-top:4px;">
            ${c.source === 'youtube' ? 'YouTube' : c.source === 'radio' ? 'Radio' : 'Stream'} ·
            ${fmtDur(c.duration, c.live)}${c.requestedBy ? ` · von ${escapeHtml(c.requestedBy)}` : ''}
            ${state.paused ? ' · <b>pausiert</b>' : ''}${state.loop ? ' · 🔁' : ''}
          </div>
          ${c.url && /^https?:/.test(c.url) ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener" style="font-size:.85rem;">Link öffnen</a>` : ''}
        </div>
      </div>`;
    document.getElementById('mcPause').textContent = state.paused ? '▶️ Weiter' : '⏸️ Pause';
    document.getElementById('mcPause').dataset.mc = state.paused ? 'resume' : 'pause';
    document.getElementById('mcLoop').classList.toggle('btn--primary', !!state.loop);
    if (!volDragging) { mcVol.value = state.volume; mcVolVal.textContent = state.volume + '%'; }
  }

  const q = state.queue || [];
  queueCount.textContent = q.length ? `(${q.length})` : '';
  queueList.innerHTML = q.length
    ? q
        .map(
          (t) => `<li>
        <span><b>${t.index + 1}.</b> ${escapeHtml(t.title)} <span class="muted">${fmtDur(t.duration, t.live)}${t.requestedBy ? ' · ' + escapeHtml(t.requestedBy) : ''}</span></span>
        <button class="btn btn--ghost btn--icon" data-rm="${t.index}" title="Entfernen" style="margin-left:auto;">${Dash.icon('trash', 'icon--sm')}</button>
      </li>`,
        )
        .join('')
    : '<li class="muted">Die Warteschlange ist leer.</li>';
}

async function refresh() {
  try {
    const state = await apiFor('GET', '/music');
    render(state);
    document.getElementById('ytBox').hidden = state.youtube !== false;
  } catch (e) {
    /* still */
  }
}

/* ---- Controls ---- */
npControls.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-mc]');
  if (!btn) return;
  mcStatus.textContent = '…';
  try {
    const r = await apiFor('POST', '/music/control', { action: btn.dataset.mc });
    render(r.state);
    mcStatus.textContent = '';
  } catch (err) {
    toast(err.message, 'error');
    mcStatus.textContent = err.message;
  }
});

mcVol.addEventListener('input', () => { volDragging = true; mcVolVal.textContent = mcVol.value + '%'; });
mcVol.addEventListener('change', async () => {
  try {
    const r = await apiFor('POST', '/music/volume', { volume: parseInt(mcVol.value, 10) });
    render(r.state);
  } catch (err) { toast(err.message, 'error'); }
  volDragging = false;
});

queueList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-rm]');
  if (!btn) return;
  try {
    const r = await apiFor('POST', '/music/queue/remove', { index: parseInt(btn.dataset.rm, 10) });
    toast(`Entfernt: ${r.removed}`, 'success');
    render(r.state);
  } catch (err) { toast(err.message, 'error'); }
});

/* ---- Play ---- */
document.getElementById('playForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = e.target.query.value.trim();
  if (!q) return;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const r = await apiFor('POST', '/music/play', { query: q });
    toast(r.added > 1 ? `${r.added} Titel hinzugefügt.` : r.startedNow ? `Spiele: ${r.title}` : `Zur Warteschlange: ${r.title}`, 'success');
    e.target.query.value = '';
    render(r.state);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('stationPlay').addEventListener('click', async () => {
  const name = document.getElementById('stationPick').value;
  if (!name) return;
  try {
    const r = await apiFor('POST', '/music/play', { query: name });
    toast(r.startedNow ? `Läuft: ${r.title}` : `Zur Warteschlange: ${r.title}`, 'success');
    render(r.state);
  } catch (err) { toast(err.message, 'error'); }
});

/* ---- Stations ---- */
async function loadStations() {
  const d = await apiFor('GET', '/music/stations');
  const pick = document.getElementById('stationPick');
  pick.innerHTML =
    '<optgroup label="Eingebaut">' +
    d.builtin.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}${s.genre ? ' · ' + escapeHtml(s.genre) : ''}</option>`).join('') +
    '</optgroup>' +
    (d.custom.length
      ? '<optgroup label="Eigene">' + d.custom.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('') + '</optgroup>'
      : '');
  document.getElementById('stList').innerHTML = d.custom.length
    ? d.custom
        .map(
          (s) => `<li><span><b>${escapeHtml(s.name)}</b> <span class="muted">${escapeHtml(s.url)}</span></span>
      <button class="btn btn--ghost btn--icon" data-delst="${s.id}" title="Löschen" style="margin-left:auto;">${Dash.icon('trash', 'icon--sm')}</button></li>`,
        )
        .join('')
    : '<li class="muted">Noch keine eigenen Sender.</li>';
}

document.getElementById('stForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = { name: e.target.name.value.trim(), url: e.target.url.value.trim() };
  try {
    await apiFor('POST', '/music/stations', a);
    toast('Sender hinzugefügt.', 'success');
    e.target.reset();
    await loadStations();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('stList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delst]');
  if (!btn) return;
  try {
    await apiFor('DELETE', '/music/stations/' + btn.dataset.delst);
    await loadStations();
  } catch (err) { toast(err.message, 'error'); }
});

/* ---- Poll ---- */
refresh();
loadStations().catch((e) => toast(e.message, 'error'));
pollTimer = setInterval(refresh, 5000);
window.addEventListener('beforeunload', () => clearInterval(pollTimer));
