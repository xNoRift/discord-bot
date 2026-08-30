/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, readForm, toast } = Dash;

(async function init() {
  try {
    const s = await apiFor('GET', '/settings');
    await fillSelectors(s);
    const el = document.querySelector('#modForm [name=mod_log_channel_id]');
    if (el && s.mod_log_channel_id) el.value = s.mod_log_channel_id;
  } catch (e) { toast(e.message, 'error'); }
})();

document.getElementById('modForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await apiFor('PATCH', '/settings', readForm(e.target)); toast('Gespeichert.', 'success'); }
  catch (err) { toast(err.message, 'error'); }
});
