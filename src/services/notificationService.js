'use strict';

const client = require('../core/client');
const config = require('../../config/config');
const logger = require('../utils/logger');
const { EmbedBuilder } = require('discord.js');

/**
 * Bot-weite ("Besitzer"-)Benachrichtigungen per DM: Server hinzugefügt/
 * verlassen, Bot-Fehler, Backup erstellt/wiederhergestellt.
 *
 * Guild-bezogene Benachrichtigungen laufen dagegen über logService (Kanal
 * und/oder Dashboard-Postfach, siehe models/notifications.js).
 */

// Anti-Spam: pro (key) höchstens alle 5 Minuten eine Fehler-DM.
const lastSent = new Map();
const ERROR_THROTTLE_MS = 5 * 60 * 1000;

async function dmOwners(embed) {
  for (const ownerId of config.ownerIds) {
    try {
      const user = await client.users.fetch(ownerId);
      await user.send({ embeds: [embed] }).catch(() => null);
    } catch {
      /* Owner nicht erreichbar */
    }
  }
}

async function notifyOwners(title, body, { color } = {}) {
  if (!config.ownerIds.length || !client.isReady?.()) return;
  const embed = new EmbedBuilder()
    .setColor(color ?? config.branding.info)
    .setTitle(title)
    .setTimestamp();
  if (body) embed.setDescription(String(body).slice(0, 2000));
  await dmOwners(embed);
}

/** Fehler-Benachrichtigung mit Drosselung pro Modul/Ursache. */
async function notifyError(source, error) {
  const key = `${source}:${(error?.message || '').slice(0, 60)}`;
  const now = Date.now();
  if (lastSent.has(key) && now - lastSent.get(key) < ERROR_THROTTLE_MS) return;
  lastSent.set(key, now);

  await notifyOwners(
    '⚠️ Bot-Fehler',
    `**Modul:** ${source}\n**Fehler:** ${(error?.message || String(error)).slice(0, 500)}`,
    { color: config.branding.danger },
  ).catch(() => null);
  logger.error(`[notify] Bot-Fehler in ${source}:`, error?.message || error);
}

module.exports = { notifyOwners, notifyError };
