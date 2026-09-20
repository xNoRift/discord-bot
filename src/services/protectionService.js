'use strict';

const { PermissionFlagsBits } = require('discord.js');
const moduleSettings = require('../database/models/moduleSettings');
const logService = require('./logService');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Guild Protection: Mindest-Kontoalter, Raid-Erkennung, Einladungs-/Link-Filter, Spam-Schutz.
 * Alles pro Server im Dashboard einstellbar (Modul "protection"). Zustand für Raid/Spam
 * liegt nur im Arbeitsspeicher (bewusst: keine Nachrichteninhalte werden gespeichert).
 */

const joinLog = new Map(); // guildId -> [timestamps]
const msgLog = new Map(); // guildId:userId -> [timestamps]

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[\w-]+/i;
const LINK_RE = /https?:\/\/([^\s/<>]+)[^\s<>]*/gi;

function csv(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function report(guild, cfg, title, description) {
  await logService
    .log({
      guildId: guild.id,
      category: 'moderation',
      type: 'protection',
      title: `🛡️ ${title}`,
      description,
      color: config.branding.warning,
      overrideChannelId: cfg.logChannelId || undefined,
    })
    .catch(() => null);
}

async function punish(member, action, reason, minutes = 60) {
  if (action === 'timeout') {
    await member.timeout(minutes * 60 * 1000, reason);
  } else {
    await member.kick(reason);
  }
}

/** Beitritt: Mindest-Kontoalter + Raid-Erkennung. */
async function onMemberJoin(member) {
  if (member.user.bot) return;
  const cfg = moduleSettings.get(member.guild.id, 'protection');
  if (!cfg.enabled) return;

  try {
    if (cfg.minAccountAgeDays > 0) {
      const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
      if (ageDays < cfg.minAccountAgeDays) {
        await punish(member, cfg.accountAgeAction, `Guild Protection: Konto jünger als ${cfg.minAccountAgeDays} Tage`, 60 * 24);
        await report(member.guild, cfg, 'Konto zu neu', `${member.user.tag} (<@${member.id}>) – Konto ${Math.floor(ageDays)} Tage alt → ${cfg.accountAgeAction === 'kick' ? 'gekickt' : 'stummgeschaltet'}.`);
        return;
      }
    }

    if (cfg.raidEnabled) {
      const now = Date.now();
      const list = (joinLog.get(member.guild.id) || []).filter((t) => now - t < cfg.raidSeconds * 1000);
      list.push(now);
      joinLog.set(member.guild.id, list);
      if (list.length >= cfg.raidJoins) {
        await punish(member, cfg.raidAction, 'Guild Protection: Raid-Erkennung', 30);
        await report(member.guild, cfg, 'Raid erkannt', `${list.length} Beitritte in ${cfg.raidSeconds}s – ${member.user.tag} (<@${member.id}>) → ${cfg.raidAction === 'kick' ? 'gekickt' : 'stummgeschaltet'}.`);
      }
    }
  } catch (err) {
    logger.warn(`[protection] Aktion bei Beitritt fehlgeschlagen: ${err.message}`);
  }
}

function isExempt(message, cfg) {
  const m = message.member;
  if (!m) return true;
  if (m.permissions.has(PermissionFlagsBits.ManageMessages) || m.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const exempt = csv(cfg.exemptRoleIds);
  return exempt.some((id) => m.roles.cache.has(id));
}

/** Nachrichten: Einladungs-/Link-Filter + Spam. */
async function onMessage(message) {
  if (!message.guild || message.author.bot) return;
  const cfg = moduleSettings.get(message.guild.id, 'protection');
  if (!cfg.enabled) return;
  if (!(cfg.blockInvites || cfg.blockLinks || cfg.spamEnabled)) return;
  if (isExempt(message, cfg)) return;

  try {
    const text = message.content || '';

    if (cfg.blockInvites && INVITE_RE.test(text)) {
      await message.delete().catch(() => null);
      const note = await message.channel.send(`⛔ <@${message.author.id}>, Einladungslinks sind hier nicht erlaubt.`).catch(() => null);
      setTimeout(() => note?.delete().catch(() => null), 6000);
      await report(message.guild, cfg, 'Einladungslink entfernt', `<@${message.author.id}> in <#${message.channelId}>.`);
      return;
    }

    if (cfg.blockLinks) {
      const allowed = csv(cfg.linkWhitelist).map((d) => d.toLowerCase().replace(/^www\./, ''));
      const hosts = [...text.matchAll(LINK_RE)].map((m) => m[1].toLowerCase().replace(/^www\./, ''));
      const bad = hosts.filter((h) => !allowed.some((a) => h === a || h.endsWith(`.${a}`)));
      if (bad.length) {
        await message.delete().catch(() => null);
        const note = await message.channel.send(`⛔ <@${message.author.id}>, Links sind hier nicht erlaubt.`).catch(() => null);
        setTimeout(() => note?.delete().catch(() => null), 6000);
        await report(message.guild, cfg, 'Link entfernt', `<@${message.author.id}> in <#${message.channelId}> (${bad[0]}).`);
        return;
      }
    }

    if (cfg.spamEnabled) {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const list = (msgLog.get(key) || []).filter((t) => now - t < cfg.spamSeconds * 1000);
      list.push(now);
      msgLog.set(key, list);
      if (list.length >= cfg.spamMessages) {
        msgLog.delete(key);
        await message.member.timeout(cfg.spamTimeoutMinutes * 60 * 1000, 'Guild Protection: Spam').catch(() => null);
        await report(message.guild, cfg, 'Spam erkannt', `<@${message.author.id}> → ${cfg.spamTimeoutMinutes} Min. stummgeschaltet.`);
      }
    }
  } catch (err) {
    logger.warn(`[protection] Nachrichten-Prüfung fehlgeschlagen: ${err.message}`);
  }
}

// Speicher aufräumen
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of msgLog) if (!v.length || now - v[v.length - 1] > 120_000) msgLog.delete(k);
  for (const [k, v] of joinLog) if (!v.length || now - v[v.length - 1] > 300_000) joinLog.delete(k);
}, 60_000).unref?.();

module.exports = { onMemberJoin, onMessage };
