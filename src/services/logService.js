'use strict';

const { EmbedBuilder } = require('discord.js');
const client = require('../core/client');
const settingsModel = require('../database/models/settings');
const moduleSettings = require('../database/models/moduleSettings');
const activity = require('../database/models/activity');
const logger = require('../utils/logger');
const logEvents = require('../utils/logEvents');
const config = require('../../config/config');
const { L } = require('../utils/i18n');

/**
 * Zentrales Logging.
 * 1) Jeder Eintrag landet im Aktivitäts-Verlauf des Dashboards (Seite „Logs“) – immer.
 * 2) Zusätzlich als Embed in einen Discord-Kanal, sofern das Ereignis auf der Logs-Seite an ist.
 *
 * Kanal: Ereignis-Kanal > overrideChannelId (z. B. Log-Kanal eines Ticket-Panels)
 *        > Kanal der Gruppe > allgemeiner Log-Kanal. Welche Ereignisse es gibt: utils/logEvents.js
 */

/** Kanal der Gruppe (Tickets, Moderation, …) – leer = kein eigener. */
function groupChannelId(group, settings, cfg, guildId) {
  if (!group) return null;
  if (group.settingsField) return settings[group.settingsField] || null;
  if (cfg[`g_${group.key}`]) return cfg[`g_${group.key}`];
  // Früher hatte Guild Protection einen eigenen Log-Kanal in ihren Einstellungen
  if (group.key === 'protection') {
    return moduleSettings.get(guildId, 'protection').logChannelId || settings.mod_log_channel_id || null;
  }
  return null;
}

/**
 * Wohin würde dieses Ereignis geloggt? (auch fürs Dashboard, um „Standard: #kanal“ anzuzeigen)
 * @returns {{ enabled: boolean, channelId: string|null }}
 */
function resolve(guildId, type, category, overrideChannelId) {
  const settings = settingsModel.get(guildId);
  const cfg = moduleSettings.get(guildId, 'logs');
  const known = logEvents.EVENTS.has(type);
  const group = logEvents.groupOf(type, category);
  return {
    enabled: known ? cfg[`e_${type}`] !== false : true,
    channelId:
      (known && cfg[`c_${type}`]) || overrideChannelId || groupChannelId(group, settings, cfg, guildId) || settings.log_channel_id || null,
  };
}

/** Steht der Auslöser schon irgendwo in den Feldern? Dann nicht doppelt anzeigen. */
const mentions = (fields, description, id) =>
  (description || '').includes(id) || fields.some((f) => String(f.value).includes(id));

/**
 * @param {object} opts
 * @param {string} opts.guildId
 * @param {string} opts.type              Ereignis-Typ, z. B. 'ticket_create' (siehe utils/logEvents.js)
 * @param {'ticket'|'giveaway'|'application'|'moderation'|'general'} [opts.category]  nur Fallback für unbekannte Typen
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {Array}  [opts.fields]          EmbedField[]
 * @param {number} [opts.color]
 * @param {string} [opts.actorId]         wer es ausgelöst hat
 * @param {string} [opts.targetId]
 * @param {object} [opts.meta]
 * @param {string} [opts.overrideChannelId]  spezieller Kanal (z. B. Ticket-Panel), wird vom Ereignis-Kanal übersteuert
 * @param {boolean} [opts.suppressDiscord]   nur Verlauf, keine Discord-Nachricht (z. B. Panel hat Logs aus)
 */
async function log(opts) {
  const { guildId, category = 'general', type, title, description, fields = [], color, actorId, targetId, meta, overrideChannelId, suppressDiscord } = opts;

  // 1) Dashboard-Verlauf
  try {
    activity.add({ guildId, type: type ?? category, actorId, targetId, message: title, meta });
  } catch (err) {
    logger.error('[log] activity.add fehlgeschlagen:', err.message);
  }

  // 2) Discord
  if (suppressDiscord) return;
  try {
    const { enabled, channelId } = resolve(guildId, type, category, overrideChannelId);
    if (!enabled || !channelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return;

    const group = logEvents.groupOf(type, category);
    const eventLabel = logEvents.eventName(type);
    const embed = new EmbedBuilder()
      .setColor(color ?? group?.color ?? config.branding.color)
      .setTitle(String(title).slice(0, 256))
      .setTimestamp();
    if (group) embed.setAuthor({ name: `${group.emoji} ${logEvents.groupName(group)}${eventLabel ? ' · ' + eventLabel : ''}`.slice(0, 256) });
    if (description) embed.setDescription(String(description).slice(0, 4096));
    const allFields = [...fields];
    if (actorId && !mentions(fields, description, actorId)) {
      allFields.push({ name: L('Ausgelöst von', 'Triggered by'), value: `<@${actorId}>`, inline: true });
    }
    if (allFields.length) embed.addFields(allFields.slice(0, 25));

    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((err) => {
      logger.warn(`[log] Konnte nicht in Log-Channel ${channelId} senden: ${err.message}`);
    });
  } catch (err) {
    logger.error('[log] Discord-Log fehlgeschlagen:', err.message);
  }
}

module.exports = { log, resolve };
