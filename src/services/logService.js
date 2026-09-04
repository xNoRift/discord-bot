'use strict';

const { EmbedBuilder } = require('discord.js');
const client = require('../core/client');
const settingsModel = require('../database/models/settings');
const activity = require('../database/models/activity');
const logger = require('../utils/logger');
const config = require('../../config/config');

/**
 * Zentrales Logging.
 * - Schreibt einen Eintrag ins activity_log (fuer das Dashboard).
 * - Postet ein Embed in den passenden Discord-Log-Channel.
 *
 * Kategorien -> Channel-Feld in guild_settings:
 *   ticket      -> ticket_log_channel_id     (Fallback: log_channel_id)
 *   giveaway    -> giveaway_log_channel_id    (Fallback: log_channel_id)
 *   application -> application_log_channel_id (Fallback: log_channel_id)
 *   general     -> log_channel_id
 */

const CATEGORY_FIELDS = {
  ticket: 'ticket_log_channel_id',
  giveaway: 'giveaway_log_channel_id',
  application: 'application_log_channel_id',
  moderation: 'mod_log_channel_id',
  general: 'log_channel_id',
};

function resolveChannelId(settings, category) {
  const field = CATEGORY_FIELDS[category] ?? 'log_channel_id';
  return settings[field] || settings.log_channel_id || null;
}

function parseHexColor(hex) {
  if (!hex) return null;
  const m = String(hex).match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}

/**
 * @param {object} opts
 * @param {string} opts.guildId
 * @param {'ticket'|'giveaway'|'application'|'general'} opts.category
 * @param {string} opts.type            Kurz-Typ fuer das Dashboard-Log (z.B. 'ticket_create')
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {Array}  [opts.fields]        EmbedField[]
 * @param {number} [opts.color]
 * @param {string} [opts.actorId]
 * @param {string} [opts.targetId]
 * @param {object} [opts.meta]
 */
async function log(opts) {
  const {
    guildId,
    category = 'general',
    type,
    title,
    description,
    fields = [],
    color,
    actorId,
    targetId,
    meta,
    overrideChannelId,
  } = opts;

  // 1) Dashboard-Aktivitaetslog
  try {
    activity.add({
      guildId,
      category,
      type: type ?? category,
      actorId,
      targetId,
      message: title,
      meta,
    });
  } catch (err) {
    logger.error('[log] activity.add fehlgeschlagen:', err.message);
  }

  // 2) Discord-Channel
  try {
    const settings = settingsModel.get(guildId);
    const channelId = overrideChannelId || resolveChannelId(settings, category);
    if (!channelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return;

    const defaultColor = parseHexColor(settings.embed_color) ?? config.branding.color;
    const embed = new EmbedBuilder()
      .setColor(color ?? defaultColor)
      .setTitle(title)
      .setTimestamp();
    if (description) embed.setDescription(description);
    if (fields.length) embed.addFields(fields.slice(0, 25));

    await channel.send({ embeds: [embed] }).catch((err) => {
      logger.warn(`[log] Konnte nicht in Log-Channel ${channelId} senden: ${err.message}`);
    });
  } catch (err) {
    logger.error('[log] Discord-Log fehlgeschlagen:', err.message);
  }
}

module.exports = { log };
