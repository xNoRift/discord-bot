'use strict';

const client = require('../core/client');
const tempRoles = require('../database/models/temporaryRoles');
const settingsModel = require('../database/models/settings');
const { botCanManageRole } = require('../utils/permissions');
const { formatDuration, discordTimestamp } = require('../utils/time');
const embeds = require('../utils/embeds');
const logService = require('./logService');
const logger = require('../utils/logger');

/**
 * Verwaltung temporaerer Rollen (Giveaway-Gewinnerrolle).
 *
 * Wichtige Eigenschaften:
 *  - Der Ablaufzeitpunkt (expires_at) steht in der DB. Nach einem Neustart
 *    stellt restoreAll() alle offenen Timer wieder her.
 *  - Gewinnt ein Nutzer mehrere Giveaways, wird KEIN zweiter Timer auf dieselbe
 *    Rolle gesetzt, sondern der bestehende Eintrag auf die spaetere Ablaufzeit
 *    verlaengert. Die Rolle wird erst entfernt, wenn KEIN aktiver Eintrag mehr
 *    existiert.
 *  - Bei Ablauf mehrerer paralleler Eintraege entfernt nur der letzte die Rolle.
 */

// id (temporary_roles.id) -> NodeJS.Timeout
const timers = new Map();

const MAX_TIMEOUT = 2_147_483_000; // ~24.8 Tage (setTimeout-Limit)

function clearTimer(id) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function schedule(row) {
  clearTimer(row.id);
  const delay = Math.max(0, row.expires_at - Date.now());

  if (delay > MAX_TIMEOUT) {
    // Zu weit in der Zukunft -> in Etappen planen. Der Sweep uebernimmt zusaetzlich.
    const t = setTimeout(() => schedule(tempRoles.get(row.id)), MAX_TIMEOUT);
    timers.set(row.id, t);
    return;
  }

  const t = setTimeout(() => {
    removeExpired(row.id).catch((err) =>
      logger.error(`[tempRole] Entfernen von #${row.id} fehlgeschlagen:`, err.message),
    );
  }, delay);
  timers.set(row.id, t);
}

/**
 * Vergibt die Giveaway-Gewinnerrolle an einen Nutzer (falls konfiguriert).
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {object} options
 * @param {number} [options.giveawayId]
 * @param {string} [options.roleId]         ueberschreibt die Server-Einstellung
 * @param {number} [options.durationMs]     ueberschreibt die Server-Einstellung
 * @returns {Promise<{ok: boolean, reason?: string, expiresAt?: number, extended?: boolean}>}
 */
async function grantGiveawayRole(guild, userId, options = {}) {
  const settings = settingsModel.get(guild.id);
  const roleId = options.roleId || settings.giveaway_winner_role_id;
  const durationMs =
    options.durationMs ||
    settings.giveaway_winner_role_duration_ms ||
    24 * 60 * 60 * 1000;

  if (!roleId) return { ok: false, reason: 'Keine Giveaway-Gewinnerrolle konfiguriert.' };

  const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) return { ok: false, reason: 'Die konfigurierte Gewinnerrolle existiert nicht mehr.' };

  const can = botCanManageRole(guild, role);
  if (!can.ok) return { ok: false, reason: can.reason };

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, reason: 'Mitglied nicht auf dem Server gefunden.' };

  await member.roles.add(role, 'Giveaway-Gewinnerrolle').catch((err) => {
    throw new Error(`roles.add: ${err.message}`);
  });

  const now = Date.now();
  const newExpiry = now + durationMs;

  const existing = tempRoles.findActive(guild.id, userId, roleId);
  let rowId;
  let extended = false;
  let expiresAt = newExpiry;

  if (existing) {
    // Verlaengern auf den spaeteren Zeitpunkt.
    expiresAt = Math.max(existing.expires_at, newExpiry);
    tempRoles.extend(existing.id, expiresAt);
    rowId = existing.id;
    extended = true;
  } else {
    const row = tempRoles.create({
      userId,
      guildId: guild.id,
      roleId,
      giveawayId: options.giveawayId ?? null,
      durationMs,
    });
    rowId = row.id;
    expiresAt = row.expires_at;
  }

  schedule(tempRoles.get(rowId));

  // Nutzer informieren
  await member
    .send({
      embeds: [
        embeds
          .success(
            '🏆 Giveaway Gewinnerrolle erhalten',
            `Du hast auf **${guild.name}** die Rolle **${role.name}** erhalten.\n` +
              `Sie wird automatisch entfernt: ${discordTimestamp(expiresAt, 'F')} (${discordTimestamp(expiresAt, 'R')}).`,
          ),
      ],
    })
    .catch(() => null);

  await logService.log({
    guildId: guild.id,
    category: 'giveaway',
    type: 'giveaway_role_granted',
    title: '🎉 Gewinnerrolle vergeben',
    color: require('../../config/config').branding.success,
    fields: [
      { name: 'Nutzer', value: `<@${userId}>`, inline: true },
      { name: 'Rolle', value: `<@&${roleId}>`, inline: true },
      { name: 'Dauer', value: formatDuration(durationMs), inline: true },
      { name: 'Entfernt am', value: discordTimestamp(expiresAt, 'F'), inline: false },
    ],
    targetId: userId,
    meta: { roleId, expiresAt, giveawayId: options.giveawayId ?? null, extended },
  });

  return { ok: true, expiresAt, extended };
}

/**
 * Entfernt eine abgelaufene temporaere Rolle (sofern zulaessig).
 * @param {number} id  temporary_roles.id
 */
async function removeExpired(id) {
  clearTimer(id);
  const row = tempRoles.get(id);
  if (!row || row.removed) return;

  // Falls (durch Verlaengerung) doch noch nicht abgelaufen -> neu planen.
  if (row.expires_at > Date.now() + 1000) {
    schedule(row);
    return;
  }

  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) {
    // Guild nicht verfuegbar (Bot entfernt?) -> Eintrag schliessen, damit er nicht ewig bleibt.
    tempRoles.markRemoved(id);
    return;
  }

  // Existiert noch ein anderer aktiver Eintrag fuer dieselbe Rolle? Dann Rolle behalten.
  const keepRole = tempRoles.otherActiveExists(id, row.guild_id, row.user_id, row.role_id);

  tempRoles.markRemoved(id);

  if (keepRole) {
    logger.info(
      `[tempRole] #${id} abgelaufen, Rolle bleibt (weiterer aktiver Eintrag vorhanden).`,
    );
    return;
  }

  const role = guild.roles.cache.get(row.role_id) ?? (await guild.roles.fetch(row.role_id).catch(() => null));
  const member = await guild.members.fetch(row.user_id).catch(() => null);

  if (role && member && member.roles.cache.has(role.id)) {
    const can = botCanManageRole(guild, role);
    if (can.ok) {
      await member.roles.remove(role, 'Giveaway-Gewinnerrolle abgelaufen').catch((err) =>
        logger.warn(`[tempRole] roles.remove fehlgeschlagen: ${err.message}`),
      );
    } else {
      logger.warn(`[tempRole] Rolle #${id} kann nicht entfernt werden: ${can.reason}`);
    }
  }

  if (member) {
    await member
      .send({
        embeds: [
          embeds.info(
            '⏰ Giveaway Gewinnerrolle entfernt',
            `Deine temporäre Rolle **${role ? role.name : row.role_id}** auf **${guild.name}** ist abgelaufen und wurde entfernt.`,
          ),
        ],
      })
      .catch(() => null);
  }

  await logService.log({
    guildId: row.guild_id,
    category: 'giveaway',
    type: 'giveaway_role_removed',
    title: '⏰ Gewinnerrolle entfernt',
    color: require('../../config/config').branding.warning,
    fields: [
      { name: 'Nutzer', value: `<@${row.user_id}>`, inline: true },
      { name: 'Rolle', value: `<@&${row.role_id}>`, inline: true },
    ],
    targetId: row.user_id,
    meta: { roleId: row.role_id, giveawayId: row.giveaway_id },
  });
}

/**
 * Beim Bot-Start: alle aktiven Eintraege wiederherstellen.
 */
async function restoreAll() {
  const rows = tempRoles.listActive();
  logger.info(`[tempRole] ${rows.length} aktive temporäre Rolle(n) werden wiederhergestellt.`);
  for (const row of rows) {
    if (row.expires_at <= Date.now()) {
      await removeExpired(row.id).catch((err) =>
        logger.error(`[tempRole] restore/remove #${row.id}:`, err.message),
      );
    } else {
      schedule(row);
    }
  }
}

/**
 * Sicherheitsnetz: regelmaessig nach abgelaufenen, aber nicht entfernten Eintraegen suchen.
 */
async function sweep() {
  const rows = tempRoles.listActive();
  for (const row of rows) {
    if (row.expires_at <= Date.now() && !timers.has(row.id)) {
      await removeExpired(row.id).catch(() => null);
    } else if (!timers.has(row.id)) {
      schedule(row);
    }
  }
}

module.exports = { grantGiveawayRole, removeExpired, restoreAll, sweep, schedule };
