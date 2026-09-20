'use strict';

const embeds = require('../../utils/embeds');

/** Button "app:cancel" – Bestätigung einer Bewerbung abbrechen. */
module.exports = {
  prefix: 'app:cancel',
  async execute(interaction) {
    await interaction.update({ embeds: [embeds.info('Abgebrochen', 'Du hast die Bewerbung nicht gestartet.')], components: [] });
  },
};
