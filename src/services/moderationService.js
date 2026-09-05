'use strict';

const { PermissionFlagsBits } = require('discord.js');
const logService = require('./logService');
const config = require('../../config/config');
const settingsModel = require('../database/models/settings');
const warningsModel = require('../database/models/warnings');

/**
 * Einfache Moderations-Aktionen fürs Dashboard: Timeout, Kick, Ban, Verwarnen
 * (jeweils per Discord-User-ID) und Nachrichten löschen (Purge).
 * Alles wird in den Moderations-Log-Kanal geschrieben.
 */

const ACTIONS = ['timeout', 'untimeout', 'kick', 'ban', 'unban', 'warn'];
const MAX_TIMEOUT_MIN = 40320; // 28 Tage (Discord-Limit)
const ESCALATABLE = ['notice', 'timeout', 'kick', 'ban']; // welche Aktionen eine Eskalationsregel auslösen darf

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

async function act(guild, { action, userId, reason, minutes, actorTag, actorId }) {
  if (!ACTIONS.includes(action)) throw new Error('Unbekannte Aktion.');
  if (!/^\d{5,25}$/.test(String(userId || ''))) throw new Error('Bitte eine gültige Discord-User-ID angeben.');
  const why = String(reason || '').trim().slice(0, 400) || 'Kein Grund angegeben';
  const auditReason = `${why} — via Dashboard${actorTag ? ` (${actorTag})` : ''}`;

  const me = guild.members.me ?? (await guild.members.fetchMe());
  let summary;
  let warnCount = null;

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
  } else if (action === 'warn') {
    const member = await guild.members.fetch(userId).catch(() => null);
    warningsModel.add({ guildId: guild.id, userId, moderatorId: actorId, moderatorTag: actorTag, reason: why });
    warnCount = warningsModel.countActive(guild.id, userId);
    summary = `${member?.user.tag || userId} verwarnt (${warnCount}. aktive Verwarnung)`;
    await member?.send(`Du wurdest auf **${guild.name}** verwarnt.\nGrund: ${why}\nAktive Verwarnungen: ${warnCount}`).catch(() => null);
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
      actorId,
      targetId: userId,
    })
    .catch(() => null);

  if (action === 'warn' && warnCount != null) {
    const escalated = await maybeEscalate(guild, userId, warnCount);
    if (escalated) summary += ` → automatisch eskaliert: ${escalated}`;
  }

  return summary;
}

/**
 * Prüft die konfigurierten Eskalationsregeln (guild_settings.warn_escalation)
 * und löst bei Treffer automatisch die hinterlegte Aktion aus.
 * Regeln: [{ count: 3, action: 'kick', minutes?: 60 }, ...]
 */
async function maybeEscalate(guild, userId, warnCount) {
  const settings = settingsModel.get(guild.id);
  let rules;
  try {
    rules = JSON.parse(settings.warn_escalation || '[]');
  } catch {
    rules = [];
  }
  if (!Array.isArray(rules) || !rules.length) return null;

  const rule = rules.find((r) => Number(r.count) === warnCount && ESCALATABLE.includes(r.action));
  if (!rule) return null;

  // "Hinweis": keine zusätzliche Discord-Aktion, die Verwarnung selbst hat
  // den Nutzer bereits per DM informiert – nur zur Konfiguration erwähnt.
  if (rule.action === 'notice') return 'Hinweis (keine weitere Aktion)';

  try {
    return await act(guild, {
      action: rule.action,
      userId,
      reason: `Automatische Eskalation nach ${warnCount} Verwarnungen`,
      minutes: rule.minutes,
      actorTag: 'Auto-Eskalation',
    });
  } catch (err) {
    return `Eskalation fehlgeschlagen (${err.message})`;
  }
}

/**
 * Löscht die letzten `count` Nachrichten in einem Kanal (max. 100, < 14 Tage).
 * @returns {Promise<number>} Anzahl gelöschter Nachrichten
 */
async function purge(guild, channelId, count, filterUserId, actorId) {
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
      actorId,
      targetId: /^\d{5,25}$/.test(String(filterUserId || '')) ? String(filterUserId) : undefined,
    })
    .catch(() => null);
  return deleted.size;
}

module.exports = { act, purge, ACTIONS };
