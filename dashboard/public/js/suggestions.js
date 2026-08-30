/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, toast } = Dash;

const form = document.getElementById('sugForm');

async function load() {
  const s = await apiFor('GET', '/settings');
  await fillSelectors(s);
  form.suggestions_enabled.checked = !!s.suggestions_enabled;
  form.suggestions_channel_id.value = s.suggestions_channel_id || '';
}

async function save() {
  const a = readForm(form);
  try {
    await apiFor('PATCH', '/settings', {
      suggestions_enabled: a.suggestions_enabled ? 1 : 0,
      suggestions_channel_id: a.suggestions_channel_id,
    });
    toast('Gespeichert.', 'success');
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

load()
  .then(() => Dash.trackForm(form, save, { reset: load }))
  .catch((e) => toast(e.message, 'error'));
