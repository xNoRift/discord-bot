'use strict';

const { PermissionsBitField } = require('discord.js');
const config = require('../../config/config');
const client = require('../../src/core/client');
const dashboardUsers = require('../../src/database/models/dashboardUsers');
const oauth = require('./discordOAuth');
const logger = require('../../src/utils/logger');

/**
 * Ermittelt, welche Server ein Dashboard-Nutzer verwalten darf.
 *
 * Regel: Nutzer braucht auf dem Server "Administrator" ODER "Server verwalten"
 * (oder ist Server-Inhaber). Zusaetzlich muss der Bot auf dem Server sein,
 * damit tatsaechlich etwas konfiguriert werden kann.
 */

const MANAGE_GUILD = PermissionsBitField.Flags.ManageGuild; // 0x20
const ADMINISTRATOR = PermissionsBitField.Flags.Administrator; // 0x8
const CACHE_TTL = 5 * 60 * 1000;

function canManage(guild) {
  if (guild.owner) return true;
  let perms;
  try {
    perms = BigInt(guild.permissions ?? '0');
  } catch {
    return false;
  }
  return (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD;
}

async function getUserGuilds(userId, { force = false } = {}) {
  const cached = dashboardUsers.getGuildCache(userId);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.guilds;
  }

  const token = await oauth.getValidAccessToken(userId);
  if (!token) return cached?.guilds ?? [];

  try {
    const guilds = await oauth.fetchUserGuilds(token);
    dashboardUsers.saveGuildCache(userId, guilds);
    return guilds;
  } catch (err) {
    if (err.message === 'rate_limited') {
      logger.warn('[guildAccess] Discord rate limit, nutze Cache.');
      return cached?.guilds ?? [];
    }
    logger.warn(`[guildAccess] Guilds laden fehlgeschlagen: ${err.message}`);
    return cached?.guilds ?? [];
  }
}

/**
 * Liefert { managed: [...], invitable: [...] }
 *  managed   -> Bot ist da UND Nutzer darf verwalten
 *  invitable -> Nutzer darf verwalten, aber Bot fehlt
 */
async function getManageableGuilds(userId, opts = {}) {
  const userGuilds = await getUserGuilds(userId, opts);
  const isBotOwner = config.ownerIds.includes(String(userId));

  const managed = [];
  const invitable = [];

  for (const g of userGuilds) {
    const allowed = isBotOwner || canManage(g);
    if (!allowed) continue;

    const botGuild = client.guilds.cache.get(g.id);
    const entry = {
      id: g.id,
      name: g.name,
      icon: g.icon,
      owner: Boolean(g.owner),
      botPresent: Boolean(botGuild),
      memberCount: botGuild?.memberCount ?? null,
    };
    if (botGuild) managed.push(entry);
    else invitable.push(entry);
  }

  // Bot-Owner: auch Server anzeigen, auf denen der Owner evtl. nicht ist
  if (isBotOwner) {
    const known = new Set(managed.map((m) => m.id));
    for (const bg of client.guilds.cache.values()) {
      if (!known.has(bg.id)) {
        managed.push({
          id: bg.id,
          name: bg.name,
          icon: bg.icon,
          owner: false,
          botPresent: true,
          memberCount: bg.memberCount,
        });
      }
    }
  }

  managed.sort((a, b) => a.name.localeCompare(b.name));
  invitable.sort((a, b) => a.name.localeCompare(b.name));
  return { managed, invitable };
}

async function userCanManageGuild(userId, guildId) {
  const { managed } = await getManageableGuilds(userId);
  return managed.some((g) => g.id === guildId);
}

module.exports = { getManageableGuilds, userCanManageGuild, getUserGuilds, canManage };
