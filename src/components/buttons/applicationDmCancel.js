'use strict';

const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const flow = require('../../services/applicationFlowService');

/** Button "app:dmcancel:<sessionId>" in der DM – laufende Bewerbung abbrechen. */
module.exports = {
  prefix: 'app:dmcancel',
  async execute(interaction) {
    const session = appModel.getSession(Number.parseInt(interaction.customId.split(':')[2], 10));
    if (session && session.user_id === interaction.user.id) await flow.cancel(interaction.user, session, true);
    await interaction.update({ embeds: [embeds.warning('Bewerbung abgebrochen', 'Du kannst jederzeit neu starten.')], components: [] });
  },
};
