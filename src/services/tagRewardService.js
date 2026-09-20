'use strict';

const client = require('../core/client');
const config = require('../../config/config');
const moduleSettings = require('../database/models/moduleSettings');
const logger = require('../utils/logger');

/**
 * Server-Tag-Belohnung: Mitglieder, die den Server-Tag dieses Servers tragen (Discord-Profil),
 * erhalten eine Rolle; wer ihn ablegt, verliert sie wieder. Läuft periodisch und braucht den
 * „Server Members"-Intent.
 */

async function syncGuild(guild, cfg) {
  const role = guild.roles.cache.get(cfg.tagRoleId);
  if (!role) return { added: 0, removed: 0 };
  const members = await guild.members.fetch();
  let added = 0;
  let removed = 0;
  for (const m of members.values()) {
    if (m.user.bot) continue;
    const pg = m.user.primaryGuild;
    const wears = Boolean(pg && pg.identityEnabled !== false && pg.identityGuildId === guild.id);
    const has = m.roles.cache.has(role.id);
    try {
      if (wears && !has) { await m.roles.add(role, 'Server-Tag-Belohnung'); added++; }
      else if (!wears && has) { await m.roles.remove(role, 'Server-Tag nicht mehr getragen'); removed++; }
    } catch (err) {
      logger.warn(`[tagReward] ${guild.id}/${m.id}: ${err.message}`);
      return { added, removed, error: err.message };
    }
  }
  return { added, removed };
}

async function sweep() {
  if (!config.discord.intentGuildMembers) return;
  for (const guild of client.guilds.cache.values()) {
    const cfg = moduleSettings.get(guild.id, 'levels');
    if (!cfg.tagRewardEnabled || !cfg.tagRoleId) continue;
    await syncGuild(guild, cfg).catch((err) => logger.warn(`[tagReward] ${guild.id}: ${err.message}`));
  }
}

module.exports = { sweep, syncGuild };
