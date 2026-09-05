'use strict';

const { PermissionFlagsBits } = require('discord.js');
const logService = require('./logService');
const config = require('../../config/config');

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
  if (member.id === me.guild.ownerId) throw new Error('Der Server-Inhaber kann nicht moderiert werden.');
  if (member.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
    throw new Error('Die höchste Rolle des Mitglieds steht über (oder gleich) der Bot-Rolle.');
  }
}

async function act(guild, { action, userId, reason, minutes, actorTag }) {
  if (!ACTIONS.includes(action)) throw new Error('Unbekannte Aktion.');
  if (!/^\d{5,25}$/.test(String(userId || ''))) throw new Error('Bitte eine gültige Discord-User-ID angeben.');
  const why = String(reason || '').trim().slice(0, 400) || 'Kein Grund angegeben';
  const auditReason = `${why} — via Dashboard${actorTag ? ` (${actorTag})` : ''}`;

  const me = guild.members.me ?? (await guild.members.fetchMe());
  let summary;

  if (action === 'timeout' || action === 'untimeout') {
    assertBotCan(me, PermissionFlagsBits.ModerateMembers, 'Mitglieder timeouten');
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error('Mitglied ist nicht auf dem Server.');
    assertHierarchy(me, member);
    if (action === 'untimeout') {
      await member.timeout(null, auditReason);
      summary = `Timeout für ${member.user.tag} aufgehoben`;
    } else {
      const mins = Math.max(1, Math.min(MAX_TIMEOUT_MIN, Number.parseInt(minutes, 10) || 10));
      await member.timeout(mins * 60 * 1000, auditReason);
      summary = `${member.user.tag} für ${mins} Min. getimeoutet`;
    }
  } else if (action === 'kick') {
    assertBotCan(me, PermissionFlagsBits.KickMembers, 'Mitglieder kicken');
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error('Mitglied ist nicht auf dem Server.');
    assertHierarchy(me, member);
    await member.send(`Du wurdest von **${guild.name}** gekickt.\nGrund: ${why}`).catch(() => null);
    await member.kick(auditReason);
    summary = `${member.user.tag} gekickt`;
  } else if (action === 'ban') {
    assertBotCan(me, PermissionFlagsBits.BanMembers, 'Mitglieder bannen');
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      assertHierarchy(me, member);
      await member.send(`Du wurdest von **${guild.name}** gebannt.\nGrund: ${why}`).catch(() => null);
    }
    await guild.bans.create(userId, { reason: auditReason, deleteMessageSeconds: 0 });
    summary = `${member?.user.tag || userId} gebannt`;
  } else if (action === 'unban') {
    assertBotCan(me, PermissionFlagsBits.BanMembers, 'Mitglieder bannen');
    await guild.bans.remove(userId, auditReason).catch(() => {
      throw new Error('Dieser Nutzer ist nicht gebannt.');
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
        { name: 'Nutzer', value: `<@${userId}> (${userId})`, inline: false },
        { name: 'Aktion', value: summary, inline: true },
        { name: 'Grund', value: why, inline: true },
        ...(actorTag ? [{ name: 'Von', value: actorTag, inline: true }] : []),
      ],
      targetId: userId,
    })
    .catch(() => null);

  return summary;
}

/**
 * Löscht die letzten `count` Nachrichten in einem Kanal (max. 100, < 14 Tage).
 * @returns {Promise<number>} Anzahl gelöschter Nachrichten
 */
async function purge(guild, channelId, count, filterUserId) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const channel = guild.channels.cache.get(String(channelId || ''));
  if (!channel || !channel.isTextBased()) throw new Error('Kanal nicht gefunden.');
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
    throw new Error('Dem Bot fehlt „Nachrichten verwalten" in diesem Kanal.');
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
      title: '🧹 Nachrichten gelöscht',
      color: config.branding.warning,
      fields: [
        { name: 'Kanal', value: `<#${channel.id}>`, inline: true },
        { name: 'Anzahl', value: String(deleted.size), inline: true },
      ],
    })
    .catch(() => null);
  return deleted.size;
}

module.exports = { act, purge, ACTIONS };
