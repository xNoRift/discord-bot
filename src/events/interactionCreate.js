'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const i18n = require('../utils/i18n');
const { matchComponent } = require('../handlers/loaders');
const settingsModel = require('../database/models/settings');
const commandSettingsModel = require('../database/models/commandSettings');

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

/**
 * Seite „Befehle“: jeder Slash-Befehl ist pro Server einzeln an/aus (Standard: aus) und
 * kann zusätzlich auf bestimmte Kanäle beschränkt werden (Threads zählen über ihren Eltern-Kanal;
 * leer = überall erlaubt). Mitglieder mit „Server verwalten“ sind von der Kanal-Beschränkung ausgenommen.
 * @returns {null|{type:'disabled'}|{type:'channel', allowed:string[]}}
 */
function commandBlockReason(interaction) {
  const cfg = commandSettingsModel.forCommand(interaction.guildId, interaction.commandName);
  if (!cfg.enabled) return { type: 'disabled' };
  const allowed = cfg.channel_ids ? cfg.channel_ids.split(',').filter(Boolean) : [];
  if (!allowed.length) return null;
  const channel = interaction.channel;
  if (allowed.includes(interaction.channelId) || (channel?.parentId && allowed.includes(channel.parentId))) return null;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return null;
  return { type: 'channel', allowed };
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
        const block = interaction.inGuild() ? commandBlockReason(interaction) : null;
        if (block) {
          const tg = i18n.forGuild(interaction.guildId);
          await safeReply(interaction, {
            embeds: [
              block.type === 'disabled'
                ? embeds.error(tg('common.command_disabled_title'), tg('common.command_disabled_desc'))
                : embeds.error(tg('common.command_channel_title'), tg('common.command_channel_desc', { channels: block.allowed.map((id) => `<#${id}>`).join(', ') })),
            ],
          });
          return;
        }
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
      const tg = i18n.forGuild(interaction.guildId);
      await safeReply(interaction, {
        embeds: [embeds.error(tg('common.error_generic_title'), err.message?.slice(0, 500) || tg('common.error_generic_desc'))],
      });
    }
  },
};
