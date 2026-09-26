'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const moduleSettings = require('../database/models/moduleSettings');
const config = require('../../config/config');
const buttonEmojis = require('../utils/buttonEmojis');
const { L, D } = require('../utils/i18n');

/** Verifizierung per Button: vergibt eine Rolle (und entfernt optional eine "Unverifiziert"-Rolle). */

/** Sendet (oder aktualisiert) die Verifizierungs-Nachricht im gewählten Kanal. */
async function postPanel(guild) {
  const cfg = moduleSettings.get(guild.id, 'verification');
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Bitte einen Kanal wählen und speichern.');
  if (!cfg.roleId || !guild.roles.cache.has(cfg.roleId)) throw new Error('Bitte die Rolle wählen, die nach der Verifizierung vergeben wird.');
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
    throw new Error('Dem Bot fehlt „Nachrichten senden" / „Links einbetten" in diesem Kanal.');
  }

  const payload = {
    embeds: [new EmbedBuilder().setColor(config.branding.color).setTitle(D(cfg.title || 'Verifizierung')).setDescription(D(cfg.message) || '​')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:go').setLabel(D(cfg.buttonLabel) || L('Verifizieren', 'Verify')).setEmoji(buttonEmojis.forGuild(guild.id, 'verification')('verify')).setStyle(ButtonStyle.Success),
    )],
  };
  let msg = null;
  if (cfg.messageId) msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
  msg = msg ? await msg.edit(payload) : await channel.send(payload);
  moduleSettings.update(guild.id, 'verification', { messageId: msg.id });
  return msg;
}

module.exports = { postPanel };
