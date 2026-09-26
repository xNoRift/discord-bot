'use strict';

const embeds = require('../../utils/embeds');
const { L } = require('../../utils/i18n');

/** Button "app:cancel" – Bestätigung einer Bewerbung abbrechen. */
module.exports = {
  prefix: 'app:cancel',
  async execute(interaction) {
    await interaction.update({ embeds: [embeds.info(L('Abgebrochen', 'Cancelled'), L('Du hast die Bewerbung nicht gestartet.', 'You did not start the application.'))], components: [] });
  },
};
