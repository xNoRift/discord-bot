'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const rolePanelService = require('../../services/rolePanelService');

/**
 * Rollen-Panel-Button "rolepanel:toggle:<panelId>:<roleId>".
 */
module.exports = {
  prefix: 'rolepanel:toggle',
  async execute(interaction) {
    const [, , panelIdRaw, roleId] = interaction.customId.split(':');
    const panelId = Number.parseInt(panelIdRaw, 10);

    try {
      const result = await rolePanelService.toggleRole(interaction, panelId, roleId);
      await interaction.reply({
        embeds: [
          result.granted
            ? embeds.success('✅ Rolle erhalten', `Du hast jetzt die Rolle **${result.name}**.`)
            : embeds.warning('➖ Rolle entfernt', `Du hast die Rolle **${result.name}** nicht mehr.`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await interaction.reply({ embeds: [embeds.error(undefined, err.message)], flags: MessageFlags.Ephemeral });
    }
  },
};
