'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const antiNukeModel = require('../database/models/antiNukeSettings');
const moderationService = require('./moderationService');
const logService = require('./logService');
const client = require('../core/client');
const logger = require('../utils/logger');
const config = require('../../config/config');

/**
 * Anti-Nuke: überwacht gefährliche Server-Aktionen (Channels/Rollen
 * löschen/erstellen, gefährliche Rechteänderungen, Massenban/-kick,
 * Webhooks, Bot-Additions) über einen Zähler pro (Server, Aktionstyp,
 * Täter) und reagiert erst, wenn das konfigurierte Limit überschritten
 * wird – nicht bei jeder einzelnen Aktion (sonst wäre jede normale
 * Admin-Tätigkeit ein Alarm).
 *
 * Der Täter wird über Discords Audit-Log ermittelt (kein Gateway-Event
 * liefert den Ausführenden direkt). Ohne "Audit-Log anzeigen"-Recht oder
 * ohne passenden Eintrag bleibt die Aktion unzählbar (kein False-Positive
 * durch Rätselei) – das ist eine bewusste Grenze dieses Systems.
 *
 * Serverbesitzer und der Bot selbst sind IMMER geschützt, unabhängig von
 * der Konfiguration.
 */

const DANGEROUS_PERMS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
];

const LABELS = {
  channel_delete: 'Kanal gelöscht',
  channel_create: 'Kanal erstellt',
  role_delete: 'Rolle gelöscht',
  role_create: 'Rolle erstellt',
  role_dangerous_permission: 'Gefährliche Rechteänderung',
  ban: 'Massenban',
  kick: 'Massenkick',
  webhook_create: 'Webhook erstellt',
  webhook_delete: 'Webhook gelöscht',
  bot_add: 'Bot hinzugefügt',
};

/** `${guildId}:${type}:${executorId}` -> Zeitstempel-Array (nur im Arbeitsspeicher). */
const counters = new Map();

function safeIds(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function findExecutor(guild, auditType, targetId, maxAgeMs = 10_000) {
  try {
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 });
    const now = Date.now();
    for (const entry of logs.entries.values()) {
      if (now - entry.createdTimestamp > maxAgeMs) continue;
      if (targetId != null && String(entry.targetId) !== String(targetId)) continue;
      return entry.executorId;
    }
  } catch (err) {
    logger.warn(`[antiNuke] Audit-Log-Abfrage fehlgeschlagen: ${err.message}`);
  }
  return null;
}

/** Webhook-Events liefern keine Ziel-ID vom Gateway – wir nehmen den neuesten Create/Delete-Eintrag. */
async function findWebhookExecutor(guild, maxAgeMs = 10_000) {
  try {
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    const [created, deleted] = await Promise.all([
      guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 3 }).catch(() => null),
      guild.fetchAuditLogs({ type: AuditLogEvent.WebhookDelete, limit: 3 }).catch(() => null),
    ]);
    const now = Date.now();
    const all = [
      ...(created ? [...created.entries.values()].map((e) => ({ e, type: 'webhook_create' })) : []),
      ...(deleted ? [...deleted.entries.values()].map((e) => ({ e, type: 'webhook_delete' })) : []),
    ].filter(({ e }) => now - e.createdTimestamp <= maxAgeMs);
    all.sort((a, b) => b.e.createdTimestamp - a.e.createdTimestamp);
    if (!all.length) return null;
    return { executorId: all[0].e.executorId, targetId: all[0].e.targetId, type: all[0].type };
  } catch (err) {
    logger.warn(`[antiNuke] Webhook-Audit-Log fehlgeschlagen: ${err.message}`);
    return null;
  }
}

function isExempt(executorId, member, settings) {
  if (safeIds(settings.exempt_user_ids).includes(executorId)) return true;
  if (member) {
    const roles = safeIds(settings.exempt_role_ids);
    if (roles.some((rid) => member.roles.cache.has(rid))) return true;
  }
  return false;
}

async function notifyOwner(guild, text) {
  try {
    const owner = await guild.fetchOwner();
    await owner.send(text).catch(() => null);
  } catch {
    /* Owner nicht ladbar - ignorieren */
  }
}

async function punish(guild, executorId, settings, reason) {
  if (executorId === guild.ownerId) return 'übersprungen (Serverbesitzer geschützt)';
  if (executorId === client.user.id) return 'übersprungen (Bot selbst)';

  if (settings.action === 'strip_roles') {
    try {
      const member = await guild.members.fetch(executorId);
      const me = guild.members.me ?? (await guild.members.fetchMe());
      if (member.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
        return 'fehlgeschlagen (Rollen-Hierarchie: Täter steht über/gleich dem Bot)';
      }
      await member.roles.set([], `Anti-Nuke: ${reason}`);
      return 'Rollen entfernt';
    } catch (err) {
      return `fehlgeschlagen (${err.message})`;
    }
  }

  try {
    await moderationService.act(guild, {
      action: settings.action,
      userId: executorId,
      reason: `Anti-Nuke: ${reason}`,
      actorTag: 'Anti-Nuke',
    });
    return settings.action === 'kick' ? 'gekickt' : 'gebannt';
  } catch (err) {
    return `fehlgeschlagen (${err.message})`;
  }
}

/**
 * Zentrale Prüfung + Reaktion. Wird von jedem Event-Einstiegspunkt mit dem
 * bereits ermittelten Täter (oder null, wenn nicht ermittelbar) aufgerufen.
 * @returns {Promise<boolean>} true, wenn das Limit überschritten wurde.
 */
async function evaluate(guild, type, executorId, { revertFn, revertLabel, extra } = {}) {
  const settings = antiNukeModel.get(guild.id);
  if (!settings.enabled) return false;
  if (!executorId) return false; // Täter unbekannt - nichts zählbar, kein Rätselraten
  if (executorId === client.user.id) return false; // eigene Aktionen (z. B. AutoMod) nie zählen
  if (executorId === guild.ownerId) return false; // Serverbesitzer wird nie gezählt/bestraft

  let member = null;
  try {
    member = guild.members.cache.get(executorId) ?? (await guild.members.fetch(executorId).catch(() => null));
  } catch {
    /* ignore */
  }
  if (isExempt(executorId, member, settings)) return false;

  const limit = antiNukeModel.limitFor(settings, type);
  const key = `${guild.id}:${type}:${executorId}`;
  const now = Date.now();
  const windowMs = limit.windowSeconds * 1000;
  const arr = (counters.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  counters.set(key, arr);

  if (arr.length <= limit.max) return false;

  const reason = `${LABELS[type] || type} – Limit überschritten (${arr.length}/${limit.max} in ${limit.windowSeconds}s)`;
  const punishResult = await punish(guild, executorId, settings, reason);

  let revertResult;
  if (!settings.revert) {
    revertResult = 'deaktiviert';
  } else if (!revertFn) {
    revertResult = revertLabel || 'nicht möglich (Aktion ist unumkehrbar)';
  } else {
    try {
      await revertFn();
      revertResult = 'durchgeführt';
    } catch (err) {
      revertResult = `fehlgeschlagen (${err.message})`;
    }
  }

  await logService
    .log({
      guildId: guild.id,
      category: 'security',
      type: `antinuke_${type}`,
      title: '🚨 Anti-Nuke Alarm',
      description: reason,
      color: config.branding.danger,
      fields: [
        { name: 'Täter', value: `<@${executorId}> (${executorId})`, inline: true },
        { name: 'Bestrafung', value: punishResult, inline: true },
        { name: 'Wiederherstellen', value: revertResult, inline: true },
        ...(extra || []),
      ],
      actorId: executorId,
    })
    .catch(() => null);

  if (settings.notify_owner) {
    await notifyOwner(
      guild,
      `🚨 **Anti-Nuke Alarm** auf **${guild.name}**\n${reason}\nTäter: <@${executorId}>\nBestrafung: ${punishResult}\nWiederherstellen: ${revertResult}`,
    );
  }

  return true;
}

/* ---------------- Öffentliche Einstiegspunkte pro Discord-Event ---------------- */

async function onChannelDelete(channel) {
  if (!channel.guild) return;
  const executorId = await findExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  await evaluate(channel.guild, 'channel_delete', executorId, {
    extra: [{ name: 'Kanal', value: `#${channel.name}`, inline: true }],
    revertLabel: 'nicht möglich (gelöschte Kanäle können nicht wiederhergestellt werden)',
  });
}

async function onChannelCreate(channel) {
  if (!channel.guild) return;
  const executorId = await findExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  await evaluate(channel.guild, 'channel_create', executorId, {
    extra: [{ name: 'Kanal', value: `<#${channel.id}>`, inline: true }],
    revertFn: () => channel.delete('Anti-Nuke: automatisch entfernt'),
  });
}

async function onRoleDelete(role) {
  const executorId = await findExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
  await evaluate(role.guild, 'role_delete', executorId, {
    extra: [{ name: 'Rolle', value: role.name, inline: true }],
    revertLabel: 'nicht möglich (gelöschte Rollen können nicht wiederhergestellt werden)',
  });
}

async function onRoleCreate(role) {
  const executorId = await findExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
  await evaluate(role.guild, 'role_create', executorId, {
    extra: [{ name: 'Rolle', value: `<@&${role.id}>`, inline: true }],
    revertFn: () => role.delete('Anti-Nuke: automatisch entfernt'),
  });
}

function gainedDangerousPermission(oldRole, newRole) {
  return DANGEROUS_PERMS.some((flag) => !oldRole.permissions.has(flag) && newRole.permissions.has(flag));
}

async function onRoleUpdate(oldRole, newRole) {
  if (!gainedDangerousPermission(oldRole, newRole)) return;
  const executorId = await findExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  await evaluate(newRole.guild, 'role_dangerous_permission', executorId, {
    extra: [{ name: 'Rolle', value: `<@&${newRole.id}>`, inline: true }],
    revertFn: () => newRole.setPermissions(oldRole.permissions, 'Anti-Nuke: Rechte zurückgesetzt'),
  });
}

async function onBanAdd(ban) {
  const guild = ban.guild;
  const executorId = await findExecutor(guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  await evaluate(guild, 'ban', executorId, {
    extra: [{ name: 'Gebannt', value: `<@${ban.user.id}>`, inline: true }],
    revertFn: () => guild.bans.remove(ban.user.id, 'Anti-Nuke: Bann automatisch aufgehoben'),
  });
}

/** Aufgerufen von guildMemberRemove – prüft per Audit-Log, ob es sich um einen Kick handelte. */
async function onMemberRemove(member) {
  const executorId = await findExecutor(member.guild, AuditLogEvent.MemberKick, member.id, 5_000);
  if (!executorId) return; // freiwilliges Verlassen, kein Kick
  await evaluate(member.guild, 'kick', executorId, {
    extra: [{ name: 'Gekickt', value: `<@${member.id}>`, inline: true }],
    revertLabel: 'nicht möglich (Gekickte müssen selbst wieder beitreten)',
  });
}

async function onWebhookChannelUpdate(channel) {
  if (!channel.guild) return;
  const found = await findWebhookExecutor(channel.guild);
  if (!found) return;
  const extra = [{ name: 'Kanal', value: `<#${channel.id}>`, inline: true }];
  if (found.type === 'webhook_create') {
    await evaluate(channel.guild, 'webhook_create', found.executorId, {
      extra,
      revertFn: async () => {
        const hooks = await channel.fetchWebhooks();
        const hook = hooks.get(found.targetId);
        if (hook) await hook.delete('Anti-Nuke: automatisch entfernt');
      },
    });
  } else {
    await evaluate(channel.guild, 'webhook_delete', found.executorId, {
      extra,
      revertLabel: 'nicht möglich (gelöschte Webhooks können nicht wiederhergestellt werden)',
    });
  }
}

/** Aufgerufen von guildMemberAdd, nur wenn member.user.bot === true. */
async function onBotAdd(member) {
  const executorId = await findExecutor(member.guild, AuditLogEvent.BotAdd, member.id);
  await evaluate(member.guild, 'bot_add', executorId, {
    extra: [{ name: 'Bot', value: `<@${member.id}>`, inline: true }],
    revertFn: () => member.kick('Anti-Nuke: automatisch entfernt'),
  });
}

module.exports = {
  onChannelDelete,
  onChannelCreate,
  onRoleDelete,
  onRoleCreate,
  onRoleUpdate,
  onBanAdd,
  onMemberRemove,
  onWebhookChannelUpdate,
  onBotAdd,
};
