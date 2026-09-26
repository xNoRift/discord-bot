'use strict';

const { PermissionFlagsBits } = require('discord.js');
const logService = require('./logService');
const config = require('../../config/config');
const moduleSettings = require('../database/models/moduleSettings');
const modWarns = require('../database/models/modWarns');
const { L } = require('../utils/i18n');

/**
 * Einfache Moderations-Aktionen fürs Dashboard: Timeout, Kick, Ban
 * (jeweils per Discord-User-ID) und Nachrichten löschen (Purge).
 * Alles wird in den Moderations-Log-Kanal geschrieben.
 */

const ACTIONS = ['timeout', 'untimeout', 'kick', 'ban', 'unban'];
const MAX_TIMEOUT_MIN = 40320; // 28 Tage (Discord-Limit)

function assertBotCan(me, flag, label) {
  if (!me?.permissions.has(flag)) {
    throw new Error(`Dem Bot fehlt die Berechtigung „${label}".`);
  }
}

/** Kann der Bot dieses Mitglied moderieren (Rollen-Hierarchie)? */
function assertHierarchy(me, member) {
  if (member.id === me.guild.ownerId) throw new Error(L('Der Server-Inhaber kann nicht moderiert werden.', 'The server owner cannot be moderated.'));
  if (member.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
    throw new Error(L('Die höchste Rolle des Mitglieds steht über (oder gleich) der Bot-Rolle.', 'The member\'s highest role is above (or equal to) the bot role.'));
  }
}

const idList = (str) => String(str || '').split(',').map((x) => x.trim()).filter(Boolean);

/** Ist das Mitglied laut Moderations-Einstellungen von Mod-Aktionen ausgenommen? */
function assertNotIgnored(cfg, member) {
  const ignored = idList(cfg.ignoredRoleIds);
  if (ignored.some((id) => member.roles.cache.has(id))) {
    throw new Error(L('Dieses Mitglied hat eine ignorierte Rolle und kann nicht moderiert werden.', 'This member has an ignored role and cannot be moderated.'));
  }
}

const NEEDS = {
  mute: ['muteRoleIds', PermissionFlagsBits.ModerateMembers],
  warn: ['warnRoleIds', PermissionFlagsBits.ModerateMembers],
  kick: ['kickRoleIds', PermissionFlagsBits.KickMembers],
  ban: ['banRoleIds', PermissionFlagsBits.BanMembers],
};

/**
 * Darf dieses Mitglied die Aktion per Slash-Befehl ausführen?
 * Sind für die Aktion Rollen gesetzt, zählen nur diese (plus Administratoren);
 * sonst gilt das passende Discord-Recht.
 */
function canUse(member, action, cfg) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const [key, flag] = NEEDS[action];
  const roles = idList(cfg[key]);
  if (roles.length) return roles.some((id) => member.roles.cache.has(id));
  return member.permissions.has(flag);
}

async function act(guild, { action, userId, reason, minutes, actorTag }) {
  if (!ACTIONS.includes(action)) throw new Error(L('Unbekannte Aktion.', 'Unknown action.'));
  if (!/^\d{5,25}$/.test(String(userId || ''))) throw new Error(L('Bitte eine gültige Discord-User-ID angeben.', 'Please provide a valid Discord user ID.'));
  const why = String(reason || '').trim().slice(0, 400) || L('Kein Grund angegeben', 'No reason given');
  const auditReason = `${why} — via Dashboard${actorTag ? ` (${actorTag})` : ''}`;

  const cfg = moduleSettings.get(guild.id, 'moderation');
  const me = guild.members.me ?? (await guild.members.fetchMe());
  let summary;

  if (action === 'timeout' || action === 'untimeout') {
    assertBotCan(me, PermissionFlagsBits.ModerateMembers, 'Mitglieder timeouten');
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error(L('Mitglied ist nicht auf dem Server.', 'Member is not on the server.'));
    assertHierarchy(me, member);
    assertNotIgnored(cfg, member);
    if (action === 'untimeout') {
      await member.timeout(null, auditReason);
      summary = `Timeout für ${member.user.tag} aufgehoben`;
    } else {
      const mins = Math.max(1, Math.min(MAX_TIMEOUT_MIN, Number.parseInt(minutes, 10) || 10));
      await member.timeout(mins * 60 * 1000, auditReason);
      if (cfg.dmOnAction) await member.send(`Du wurdest auf **${guild.name}** für ${mins} Min. stummgeschaltet.
Grund: ${why}`).catch(() => null);
      summary = `${member.user.tag} für ${mins} Min. getimeoutet`;
    }
  } else if (action === 'kick') {
    assertBotCan(me, PermissionFlagsBits.KickMembers, 'Mitglieder kicken');
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error(L('Mitglied ist nicht auf dem Server.', 'Member is not on the server.'));
    assertHierarchy(me, member);
    assertNotIgnored(cfg, member);
    if (cfg.dmOnAction) await member.send(`Du wurdest von **${guild.name}** gekickt.\nGrund: ${why}`).catch(() => null);
    await member.kick(auditReason);
    summary = `${member.user.tag} gekickt`;
  } else if (action === 'ban') {
    assertBotCan(me, PermissionFlagsBits.BanMembers, 'Mitglieder bannen');
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      assertHierarchy(me, member);
      assertNotIgnored(cfg, member);
      if (cfg.dmOnAction) await member.send(`Du wurdest von **${guild.name}** gebannt.\nGrund: ${why}`).catch(() => null);
    }
    await guild.bans.create(userId, { reason: auditReason, deleteMessageSeconds: 0 });
    summary = `${member?.user.tag || userId} gebannt`;
  } else if (action === 'unban') {
    assertBotCan(me, PermissionFlagsBits.BanMembers, 'Mitglieder bannen');
    await guild.bans.remove(userId, auditReason).catch(() => {
      throw new Error(L('Dieser Nutzer ist nicht gebannt.', 'This user is not banned.'));
    });
    summary = `Bann für ${userId} aufgehoben`;
  }

  await logService
    .log({
      guildId: guild.id,
      category: 'moderation',
      type: `mod_${action}`,
      title: `🛡️ Moderation: ${action}`,
      color: config.branding.warning,
      fields: [
        { name: L('Nutzer', 'User'), value: `<@${userId}> (${userId})`, inline: false },
        { name: L('Aktion', 'Action'), value: summary, inline: true },
        { name: L('Grund', 'Reason'), value: why, inline: true },
        ...(actorTag ? [{ name: L('Von', 'From'), value: actorTag, inline: true }] : []),
      ],
      targetId: userId,
    })
    .catch(() => null);

  return summary;
}

/**
 * Verwarnt ein Mitglied und wendet bei Erreichen des Warnlimits die eingestellte Aktion an.
 * @returns {Promise<{summary:string, count:number, limitHit:string|null}>}
 */
async function warn(guild, { userId, reason, moderatorId, actorTag }) {
  if (!/^\d{5,25}$/.test(String(userId || ''))) throw new Error(L('Bitte eine gültige Discord-User-ID angeben.', 'Please provide a valid Discord user ID.'));
  const cfg = moduleSettings.get(guild.id, 'moderation');
  const why = String(reason || '').trim().slice(0, 400) || L('Kein Grund angegeben', 'No reason given');
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error(L('Mitglied ist nicht auf dem Server.', 'Member is not on the server.'));
  assertNotIgnored(cfg, member);
  const count = modWarns.add(guild.id, userId, moderatorId, why);
  if (cfg.dmOnAction) await member.send(`Du wurdest auf **${guild.name}** verwarnt (${count}. Verwarnung).
Grund: ${why}`).catch(() => null);
  await logService.log({
    guildId: guild.id, category: 'moderation', type: 'mod_warn', title: L('⚠️ Verwarnung', '⚠️ Warning'),
    color: config.branding.warning,
    fields: [
      { name: L('Nutzer', 'User'), value: `<@${userId}> (${userId})`, inline: false },
      { name: 'Verwarnungen', value: String(count), inline: true },
      { name: L('Grund', 'Reason'), value: why, inline: true },
      ...(actorTag ? [{ name: L('Von', 'From'), value: actorTag, inline: true }] : []),
    ],
    targetId: userId,
  }).catch(() => null);

  let limitHit = null;
  if (cfg.warnLimitEnabled && count >= cfg.warnLimit) {
    limitHit = cfg.warnLimitAction;
    const note = `Warnlimit (${cfg.warnLimit}) erreicht`;
    await act(guild, {
      action: cfg.warnLimitAction === 'timeout' ? 'timeout' : cfg.warnLimitAction,
      userId, reason: note, minutes: cfg.warnLimitTimeoutMinutes, actorTag: 'Warnlimit',
    }).catch(() => { limitHit = null; });
    if (limitHit) modWarns.clear(guild.id, userId);
  }
  return { summary: `${member.user.tag} verwarnt (${count}. Verwarnung)`, count, limitHit };
}

/**
 * Löscht die letzten `count` Nachrichten in einem Kanal (max. 100, < 14 Tage).
 * @returns {Promise<number>} Anzahl gelöschter Nachrichten
 */
async function purge(guild, channelId, count, filterUserId) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const channel = guild.channels.cache.get(String(channelId || ''));
  if (!channel || !channel.isTextBased()) throw new Error(L('Kanal nicht gefunden.', 'Channel not found.'));
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
    throw new Error(L('Dem Bot fehlt „Nachrichten verwalten" in diesem Kanal.', 'The bot is missing “Manage Messages” in this channel.'));
  }
  const n = Math.max(1, Math.min(100, Number.parseInt(count, 10) || 10));
  let msgs = await channel.messages.fetch({ limit: n });
  if (/^\d{5,25}$/.test(String(filterUserId || ''))) {
    msgs = msgs.filter((m) => m.author.id === String(filterUserId));
  }
  const deleted = await channel.bulkDelete(msgs, true); // true = zu alte überspringen
  await logService
    .log({
      guildId: guild.id,
      category: 'moderation',
      type: 'mod_purge',
      title: L('🧹 Nachrichten gelöscht', '🧹 Messages deleted'),
      color: config.branding.warning,
      fields: [
        { name: L('Kanal', 'Channel'), value: `<#${channel.id}>`, inline: true },
        { name: L('Anzahl', 'Count'), value: String(deleted.size), inline: true },
      ],
    })
    .catch(() => null);
  return deleted.size;
}

module.exports = { act, warn, purge, canUse, ACTIONS };
