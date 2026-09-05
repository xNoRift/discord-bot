/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, toast } = Dash;

const form = document.getElementById('sugForm');

async function load() {
  const s = await apiFor('GET', '/settings');
  await fillSelectors(s);
  form.suggestions_channel_id.value = s.suggestions_channel_id || '';
}

async function save() {
  const a = readForm(form);
  try {
    await apiFor('PATCH', '/settings', { suggestions_channel_id: a.suggestions_channel_id });
    toast('Gespeichert.', 'success');
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

Dash.initModuleStatus('suggestions_enabled', {
  on: 'Vorschläge sind aktiviert. Mitglieder-Nachrichten im gewählten Kanal werden in Abstimmungs-Embeds umgewandelt.',
  off: 'Vorschläge sind deaktiviert. Aktiviere das Modul und wähle unten einen Kanal.',
});

load()
  .then(() => Dash.trackForm(form, save, { reset: load }))
  .catch((e) => toast(e.message, 'error'));
