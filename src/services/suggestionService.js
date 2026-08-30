'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const settingsModel = require('../database/models/settings');
const logService = require('./logService');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Vorschlagssystem: Schreibt jemand in den Vorschläge-Kanal, wird die
 * Nachricht in ein sauberes Embed umgewandelt (mit 👍 / 👎 zum Abstimmen)
 * und die Originalnachricht gelöscht.
 */

async function handleMessage(message) {
  if (message.author?.bot || !message.inGuild()) return;

  const s = settingsModel.get(message.guild.id);
  if (!s.suggestions_enabled || !s.suggestions_channel_id) return;
  if (message.channelId !== s.suggestions_channel_id) return;

  const text = (message.content || '').trim();
  if (!text) {
    // Nur Anhang / leer -> ignorieren, aber aufräumen wenn möglich
    await message.delete().catch(() => null);
    return;
  }

  const me = message.guild.members.me ?? (await message.guild.members.fetchMe().catch(() => null));
  const perms = me && message.channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.SendMessages)) return;

  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
    .setDescription(text.slice(0, 4000))
    .setFooter({ text: 'Vorschlag • 👍 dafür · 👎 dagegen' })
    .setTimestamp();

  let posted;
  try {
    posted = await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    await posted.react('👍').catch(() => null);
    await posted.react('👎').catch(() => null);
    if (perms.has(PermissionFlagsBits.CreatePublicThreads)) {
      await posted.startThread({ name: `Vorschlag von ${message.author.username}`.slice(0, 90) }).catch(() => null);
    }
  } catch (err) {
    logger.warn('[suggestion] posten fehlgeschlagen:', err.message);
    return;
  }

  if (perms.has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => null);
  }

  await logService
    .log({
      guildId: message.guild.id,
      category: 'general',
      type: 'suggestion',
      title: '💡 Neuer Vorschlag',
      color: config.branding.color,
      fields: [
        { name: 'Von', value: `<@${message.author.id}>`, inline: true },
        { name: 'Vorschlag', value: text.slice(0, 1000) },
      ],
      targetId: message.author.id,
    })
    .catch(() => null);
}

module.exports = { handleMessage };
