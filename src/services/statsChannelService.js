'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const client = require('../core/client');
const moduleSettings = require('../database/models/moduleSettings');
const logger = require('../utils/logger');

/**
 * Server-Statistiken als Sprachkanäle ("👥 Mitglieder: 128"), die nur angezeigt und
 * nicht betreten werden können. Namen werden regelmäßig (alle 10 Min.) aktualisiert.
 */

const STATS = [
  { show: 'showMembers', id: 'membersChannelId', label: '👥 Mitglieder', value: (g) => g.memberCount ?? 0 },
  { show: 'showBoosts', id: 'boostsChannelId', label: '🚀 Boosts', value: (g) => g.premiumSubscriptionCount ?? 0 },
  { show: 'showBots', id: 'botsChannelId', label: '🤖 Bots', value: (g) => g.members.cache.filter((m) => m.user.bot).size },
  { show: 'showRoles', id: 'rolesChannelId', label: '🎭 Rollen', value: (g) => Math.max(0, g.roles.cache.size - 1) },
];

const nameOf = (stat, guild) => `${stat.label}: ${stat.value(guild)}`;

/** Legt fehlende Kanäle an, entfernt abgewählte und lässt vorhandene bestehen. */
async function create(guild) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('Dem Bot fehlt die Berechtigung „Kanäle verwalten".');
  }
  const cfg = moduleSettings.get(guild.id, 'stats');
  if (!STATS.some((s) => cfg[s.show])) throw new Error('Bitte mindestens eine Statistik aktivieren und speichern.');

  const patch = {};
  let created = 0;
  for (const stat of STATS) {
    const existing = cfg[stat.id] ? guild.channels.cache.get(cfg[stat.id]) : null;
    if (!cfg[stat.show]) {
      if (existing) await existing.delete('Statistik deaktiviert').catch(() => null);
      if (cfg[stat.id]) patch[stat.id] = '';
      continue;
    }
    if (existing) continue;
    const channel = await guild.channels.create({
      name: nameOf(stat, guild),
      type: ChannelType.GuildVoice,
      parent: cfg.categoryId || null,
      reason: 'Server-Statistiken',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
      ],
    });
    patch[stat.id] = channel.id;
    created++;
  }
  if (Object.keys(patch).length) moduleSettings.update(guild.id, 'stats', patch);
  return created;
}

/** Aktualisiert die Kanalnamen, wenn sich der Wert geändert hat. */
async function update(guild) {
  const cfg = moduleSettings.get(guild.id, 'stats');
  for (const stat of STATS) {
    if (!cfg[stat.show] || !cfg[stat.id]) continue;
    const channel = guild.channels.cache.get(cfg[stat.id]);
    if (!channel) continue;
    const name = nameOf(stat, guild);
    if (channel.name !== name) await channel.setName(name, 'Statistik aktualisiert').catch((e) => logger.warn(`[stats] ${e.message}`));
  }
}

async function sweep() {
  for (const guild of client.guilds.cache.values()) {
    if (!moduleSettings.get(guild.id, 'stats').enabled) continue;
    await update(guild).catch((err) => logger.warn(`[stats] ${guild.id}: ${err.message}`));
  }
}

module.exports = { create, update, sweep, STATS };
