/* global document, Dash */
'use strict';

document.querySelectorAll('#protTabs .tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#protTabs .tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== btn.dataset.tab; });
  });
});

Dash.moduleForm('protection', document.getElementById('protForm'), {
  on: 'Guild Protection ist aktiv. Die unten eingestellten Schutzfunktionen greifen.',
  off: 'Guild Protection ist deaktiviert. Aktiviere das Modul, damit die Schutzfunktionen greifen.',
}).catch((e) => Dash.toast(e.message, 'error'));

Dash.moduleForm('verification', document.getElementById('verifyForm'), {
  statusId: 'verifyStatus',
  on: 'Die Verifizierung ist aktiv. Mitglieder erhalten die Rolle per Klick auf den Button.',
  off: 'Die Verifizierung ist deaktiviert. Der Button in Discord reagiert nicht, solange sie aus ist.',
}).then((mf) => {
  document.getElementById('verifyPost').addEventListener('click', async () => {
    const st = document.getElementById('verifyMsg');
    try {
      st.textContent = 'Wird gesendet…';
      await Dash.apiFor('POST', '/verification/post', {});
      Dash.toast('Verifizierungs-Nachricht gesendet.', 'success');
      st.textContent = 'Gesendet ✓';
      await mf.reload();
    } catch (err) { Dash.toast(err.message, 'error'); st.textContent = err.message; }
  });
}).catch((e) => Dash.toast(e.message, 'error'));
