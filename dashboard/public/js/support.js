/* global document, Dash */
'use strict';

Dash.moduleForm('voicesupport', document.getElementById('vsForm'), {
  on: 'Voice-Support ist aktiv. Das Team wird gepingt, sobald jemand den Warteraum betritt.',
  off: 'Voice-Support ist deaktiviert. Aktiviere das Modul und wähle Warteraum, Kanal und Rolle.',
}).catch((e) => Dash.toast(e.message, 'error'));
