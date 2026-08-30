'use strict';

const { MessageFlags } = require('discord.js');

const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const { matchComponent } = require('../handlers/loaders');
const settingsModel = require('../database/models/settings');

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    logger.warn('[interaction] Antwort fehlgeschlagen:', err.message);
  }
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      // Kontext fuer Handler bereitstellen
      if (interaction.inGuild()) {
        interaction.settings = settingsModel.get(interaction.guildId);
      }

      /* ---------- Slash Commands ---------- */
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction, client);
        return;
      }

      /* ---------- Autocomplete ---------- */
      if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command?.autocomplete) await command.autocomplete(interaction, client);
        return;
      }

      /* ---------- Buttons ---------- */
      if (interaction.isButton()) {
        const handler = matchComponent(client.buttons, interaction.customId);
        if (!handler) return;
        await handler.execute(interaction, client);
        return;
      }

      /* ---------- Select Menus ---------- */
      if (interaction.isAnySelectMenu()) {
        const handler = matchComponent(client.selectMenus, interaction.customId);
        if (!handler) return;
        await handler.execute(interaction, client);
        return;
      }

      /* ---------- Modals ---------- */
      if (interaction.isModalSubmit()) {
        const handler = matchComponent(client.modals, interaction.customId);
        if (!handler) return;
        await handler.execute(interaction, client);
        return;
      }
    } catch (err) {
      logger.error(`[interaction] Fehler bei ${interaction.type}/${interaction.customId ?? interaction.commandName}:`, err);
      await safeReply(interaction, {
        embeds: [embeds.error('❌ Es ist ein Fehler aufgetreten', err.message?.slice(0, 500) || 'Unbekannter Fehler.')],
      });
    }
  },
};
