'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const rolePanelService = require('../../services/rolePanelService');

/**
 * Rollen-Panel-Auswahlmenü "rolepanel:select:<panelId>". interaction.values
 * ist die vollständige gewünschte Auswahl (nicht nur die Änderung).
 */
module.exports = {
  prefix: 'rolepanel:select',
  async execute(interaction) {
    const panelId = Number.parseInt(interaction.customId.split(':')[2], 10);

    try {
      const { granted, removed } = await rolePanelService.applySelection(interaction, panelId, interaction.values);
      const parts = [];
      if (granted.length) parts.push(`Erhalten: **${granted.join(', ')}**`);
      if (removed.length) parts.push(`Entfernt: **${removed.join(', ')}**`);
      await interaction.reply({
        embeds: [
          parts.length
            ? embeds.success('✅ Rollen aktualisiert', parts.join('\n'))
            : embeds.warning('Keine Änderung', 'Es wurde nichts geändert.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await interaction.reply({ embeds: [embeds.error(undefined, err.message)], flags: MessageFlags.Ephemeral });
    }
  },
};
