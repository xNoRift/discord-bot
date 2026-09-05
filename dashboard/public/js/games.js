/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, applyToForm, toast } = Dash;

const form = document.getElementById('cntForm');
const statusEl = document.getElementById('cntStatus');

function paintStats(s) {
  document.getElementById('cntCurrent').textContent = s.current ?? 0;
  document.getElementById('cntBest').textContent = s.best ?? 0;
  document.getElementById('cntTotal').textContent = s.totalCounts ?? 0;
}

function paintIntent(active) {
  const box = document.getElementById('intentBox');
  box.hidden = false;
  box.classList.toggle('is-off', !active);
  document.getElementById('intentTitle').textContent = active
    ? 'Message-Content-Intent aktiv'
    : 'Message-Content-Intent FEHLT – das Zähl-Spiel kann nicht funktionieren';
  document.getElementById('intentText').textContent = active
    ? 'Der Bot kann Nachrichten lesen. Zahlen werden erkannt.'
    : 'Aktiviere im Discord Developer Portal → Bot → „MESSAGE CONTENT INTENT" und setze in der .env INTENT_MESSAGE_CONTENT=true (bzw. entferne die Zeile), dann Bot neu starten.';
}

let cntEnabled = true;
const cntTextOn = 'Das Zähl-Spiel ist aktiviert. Im gewählten Kanal wird abwechselnd hochgezählt.';
const cntTextOff = 'Das Zähl-Spiel ist deaktiviert. Aktiviere es und wähle unten einen Kanal.';

async function load() {
  const s = await apiFor('GET', '/games/counting');
  paintIntent(s.intentActive);
  await fillSelectors({ channelId: s.channelId });
  applyToForm(form, {
    channelId: s.channelId || '',
    allowSameUser: s.allowSameUser,
    resetOnFail: s.resetOnFail,
    reactEmoji: s.reactEmoji,
  });
  cntEnabled = !!s.enabled;
  Dash.renderModuleStatus(cntEnabled, { on: cntTextOn, off: cntTextOff });
  paintStats(s);
}

async function postCounting(overrides) {
  const a = readForm(form);
  return apiFor('POST', '/games/counting', {
    enabled: cntEnabled,
    channelId: a.channelId || '',
    allowSameUser: !!a.allowSameUser,
    resetOnFail: !!a.resetOnFail,
    reactEmoji: a.reactEmoji || '✅',
    ...overrides,
  });
}

document.getElementById('msToggle').addEventListener('click', async () => {
  try {
    const s = await postCounting({ enabled: !cntEnabled });
    cntEnabled = !!s.enabled;
    Dash.renderModuleStatus(cntEnabled, { on: cntTextOn, off: cntTextOff });
    paintStats(s);
    toast('Gespeichert.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function saveCounting() {
  try {
    const s = await postCounting();
    paintStats(s);
    toast('Zähl-Spiel gespeichert.', 'success');
    statusEl.textContent = 'Gespeichert ✓';
  } catch (err) {
    toast(err.message, 'error');
    statusEl.textContent = err.message;
    throw err;
  }
}

document.getElementById('cntPanel').addEventListener('click', async () => {
  try {
    statusEl.textContent = 'Panel wird gesendet…';
    const r = await apiFor('POST', '/games/counting/panel', {});
    toast('Info-Panel in den Kanal gesendet.', 'success');
    statusEl.innerHTML = r.url ? `Gesendet ✓ <a href="${r.url}" target="_blank" rel="noopener">ansehen</a>` : 'Gesendet ✓';
  } catch (err) {
    toast(err.message, 'error');
    statusEl.textContent = err.message;
  }
});

document.getElementById('cntReset').addEventListener('click', async () => {
  if (!(await Dash.confirmModal('Den Zähler wirklich auf 0 zurücksetzen? Der Rekord bleibt erhalten.'))) return;
  try {
    const s = await apiFor('POST', '/games/counting/reset', {});
    paintStats(s);
    toast('Zähler zurückgesetzt.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

load()
  .then(() => Dash.trackForm(form, saveCounting, { reset: load }))
  .catch((e) => toast(e.message, 'error'));
