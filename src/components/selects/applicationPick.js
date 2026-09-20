'use strict';

const applicationService = require('../../services/applicationService');

/** Auswahlmenü "app:pick" am Panel (Wert = Bewerbungs-ID). */
module.exports = {
  prefix: 'app:pick',
  async execute(interaction) {
    await applicationService.beginApplication(interaction, Number.parseInt(interaction.values[0], 10));
    // Menü zurücksetzen, damit die zuletzt gewählte Option nicht stehen bleibt
    applicationService.refreshPanelMessage(interaction.message).catch(() => null);
  },
};
