/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, toast } = Dash;

(async function init() {
  try {
    const s = await apiFor('GET', '/settings');
    await fillSelectors(s);
    const form = document.getElementById('sugForm');
    form.suggestions_enabled.checked = !!s.suggestions_enabled;
    if (s.suggestions_channel_id) form.suggestions_channel_id.value = s.suggestions_channel_id;
  } catch (e) { toast(e.message, 'error'); }
})();

document.getElementById('sugForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm(e.target);
  try {
    await apiFor('PATCH', '/settings', {
      suggestions_enabled: a.suggestions_enabled ? 1 : 0,
      suggestions_channel_id: a.suggestions_channel_id,
    });
    toast('Gespeichert.', 'success');
  } catch (err) { toast(err.message, 'error'); }
});
