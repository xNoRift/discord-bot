/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, applyToForm, toast } = Dash;

const form = document.getElementById('tvForm');
const statusEl = document.getElementById('tvStatus');

async function load() {
  const s = await apiFor('GET', '/settings');
  await fillSelectors(s);
  applyToForm(form, s);
}

async function saveTv() {
  const a = readForm(form);
  try {
    await apiFor('PATCH', '/settings', {
      tempvoice_hub_channel_id: a.tempvoice_hub_channel_id || null,
      tempvoice_category_id: a.tempvoice_category_id || null,
      tempvoice_name_format: a.tempvoice_name_format || null,
      tempvoice_user_limit: Math.max(0, Math.min(99, parseInt(a.tempvoice_user_limit, 10) || 0)),
    });
    toast('Temp-Voice gespeichert.', 'success');
    statusEl.textContent = 'Gespeichert ✓';
    await load();
  } catch (err) {
    toast(err.message, 'error');
    statusEl.textContent = err.message;
    throw err;
  }
}

document.getElementById('tvMakeHub').addEventListener('click', async () => {
  try {
    statusEl.textContent = 'Kanal wird erstellt…';
    const r = await apiFor('POST', '/tempvoice/create-hub', {});
    toast(`Kanal „${r.name}" erstellt und als Hub gesetzt.`, 'success');
    // Kanäle-Cache verwerfen, damit die neue Option auftaucht
    await load();
    const sel = form.querySelector('[name="tempvoice_hub_channel_id"]');
    if (sel) {
      // Falls der frische Kanal noch nicht im Cache ist, Option manuell ergänzen
      if (![...sel.options].some((o) => o.value === r.id)) {
        sel.insertAdjacentHTML('beforeend', `<option value="${r.id}">🔊 ${r.name}</option>`);
      }
      sel.value = r.id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    statusEl.textContent = 'Nicht vergessen zu speichern.';
  } catch (err) {
    toast(err.message, 'error');
    statusEl.textContent = err.message;
  }
});

Dash.initModuleStatus('tempvoice_enabled', {
  on: 'Temp-Voice ist aktiviert. Wer den Hub-Kanal betritt, bekommt einen eigenen Sprachkanal.',
  off: 'Temp-Voice ist deaktiviert. Aktiviere es und wähle unten einen Hub-Kanal.',
});

load()
  .then(() => Dash.trackForm(form, saveTv, { reset: load }))
  .catch((e) => toast(e.message, 'error'));
