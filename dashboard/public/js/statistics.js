/* global document, Dash */
'use strict';

const { apiFor, toast } = Dash;

Dash.moduleForm('stats', document.getElementById('statsForm'), {
  on: 'Die Statistik-Kanäle sind aktiv und werden alle 10 Minuten aktualisiert.',
  off: 'Die Statistik-Kanäle sind deaktiviert – vorhandene Kanäle werden nicht mehr aktualisiert.',
}).then((mf) => {
  document.getElementById('statsCreate').addEventListener('click', async () => {
    const st = document.getElementById('statsStatus');
    try {
      st.textContent = 'Wird erstellt…';
      const r = await apiFor('POST', '/stats/create', {}, { timeout: 60000 });
      toast(r.created ? `${r.created} Kanal/Kanäle erstellt.` : 'Kanäle sind aktuell.', 'success');
      st.textContent = 'Fertig ✓';
      await mf.reload();
    } catch (err) { toast(err.message, 'error'); st.textContent = err.message; }
  });
}).catch((e) => toast(e.message, 'error'));
