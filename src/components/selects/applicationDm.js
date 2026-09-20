'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const flow = require('../../services/applicationFlowService');

/** Auswahlmenü "app:dmsel:<sessionId>:<step>" in der DM – Antwort auf eine Auswahl-Frage. */
module.exports = {
  prefix: 'app:dmsel',
  async execute(interaction) {
    const [, , sessionId, step] = interaction.customId.split(':');
    const session = appModel.getSession(Number.parseInt(sessionId, 10));
    if (!session || session.user_id !== interaction.user.id || session.step !== Number.parseInt(step, 10)) {
      return interaction.reply({ embeds: [embeds.warning(undefined, 'Diese Frage ist nicht mehr aktuell.')], flags: MessageFlags.Ephemeral });
    }
    const q = appModel.listQuestions(session.type_id)[session.step];
    const value = q?.options[Number.parseInt(interaction.values[0], 10)];
    if (!value) return interaction.reply({ embeds: [embeds.error(undefined, 'Ungültige Auswahl.')], flags: MessageFlags.Ephemeral });

    await interaction.update({ components: [] }); // Menü sperren
    await flow.acceptAnswer(interaction.user, session, value);
  },
};
