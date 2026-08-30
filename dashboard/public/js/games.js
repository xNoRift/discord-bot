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

async function load() {
  const s = await apiFor('GET', '/games/counting');
  await fillSelectors({ channelId: s.channelId });
  applyToForm(form, {
    enabled: s.enabled,
    channelId: s.channelId || '',
    allowSameUser: s.allowSameUser,
    resetOnFail: s.resetOnFail,
    reactEmoji: s.reactEmoji,
  });
  paintStats(s);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(form);
  try {
    const s = await apiFor('POST', '/games/counting', {
      enabled: !!a.enabled,
      channelId: a.channelId || '',
      allowSameUser: !!a.allowSameUser,
      resetOnFail: !!a.resetOnFail,
      reactEmoji: a.reactEmoji || '✅',
    });
    paintStats(s);
    toast('Zähl-Spiel gespeichert.', 'success');
    statusEl.textContent = 'Gespeichert ✓';
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

load().catch((e) => toast(e.message, 'error'));
