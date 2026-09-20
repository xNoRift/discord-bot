/* global document, Dash */
'use strict';

Dash.moduleForm('protection', document.getElementById('protForm'), {
  on: 'Guild Protection ist aktiv. Die unten eingestellten Schutzfunktionen greifen.',
  off: 'Guild Protection ist deaktiviert. Aktiviere das Modul, damit die Schutzfunktionen greifen.',
}).catch((e) => Dash.toast(e.message, 'error'));
