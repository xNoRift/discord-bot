'use strict';

const automodModel = require('../database/models/automodRules');
const moderationService = require('./moderationService');
const logService = require('./logService');
const logger = require('../utils/logger');
const config = require('../../config/config');
const { isManager } = require('../utils/permissions');

/**
 * AutoMod: prüft eingehende Nachrichten gegen die aktivierten Filter des
 * Servers. Löscht bei Treffer die Nachricht und führt optional zusätzlich
 * eine moderationService-Aktion aus (warn/timeout/kick/ban) – keine eigene,
 * parallele Aktions-Logik.
 *
 * Spam/Flood-Erkennung braucht einen kurzen Nachrichtenverlauf pro Nutzer;
 * der liegt bewusst nur im Arbeitsspeicher (wie musicService/tempVoiceService)
 * und geht bei einem Neustart verloren – das ist für einen Rate-Limit-Zähler
 * über wenige Sekunden unproblematisch.
 */

const LABELS = {
  spam: 'Spam / Flooding',
  caps: 'Übermäßige Großschreibung',
  links: 'Links',
  invites: 'Discord-Einladung',
  mention_spam: 'Erwähnungs-Spam',
  wordlist: 'Wortfilter',
};

const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const LINK_RE = /https?:\/\/[^\s<>]+/gi;

/** `${guildId}:${userId}` -> Liste von Zeitstempeln der letzten Nachrichten. */
const recentMessages = new Map();

function safeArray(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeConfig(json) {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function checkSpam(message, rule) {
  const cfg = safeConfig(rule.config_json);
  const maxMessages = Math.max(2, Number(cfg.maxMessages) || 5);
  const windowMs = Math.max(1, Number(cfg.windowSeconds) || 5) * 1000;
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const arr = (recentMessages.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  recentMessages.set(key, arr);
  return arr.length > maxMessages ? `${arr.length} Nachrichten in ${windowMs / 1000}s.` : null;
}

function checkCaps(message, rule) {
  const cfg = safeConfig(rule.config_json);
  const minLength = Math.max(1, Number(cfg.minLength) || 10);
  const maxPercent = Math.min(100, Math.max(1, Number(cfg.maxPercent) || 70));
  const letters = (message.content || '').replace(/[^a-zA-Z]/g, '');
  if (letters.length < minLength) return null;
  const upper = letters.replace(/[^A-Z]/g, '');
  const percent = (upper.length / letters.length) * 100;
  return percent >= maxPercent ? `${Math.round(percent)}% Großbuchstaben.` : null;
}

function checkLinks(message, rule) {
  const content = message.content || '';
  const matches = content.match(LINK_RE);
  if (!matches) return null;
  const cfg = safeConfig(rule.config_json);
  const allowlist = (Array.isArray(cfg.allowlist) ? cfg.allowlist : []).map((d) => String(d).trim().toLowerCase()).filter(Boolean);
  const blocked = matches.some((url) => {
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return true;
    }
    return !allowlist.some((d) => host === d || host.endsWith(`.${d}`));
  });
  return blocked ? 'Nicht erlaubter Link.' : null;
}

function checkInvites(message) {
  return INVITE_RE.test(message.content || '') ? 'Einladungslink zu einem anderen Server.' : null;
}

function checkMentionSpam(message, rule) {
  const cfg = safeConfig(rule.config_json);
  const max = Math.max(1, Number(cfg.maxMentions) || 5);
  const count = message.mentions.users.size + message.mentions.roles.size;
  return count > max ? `${count} Erwähnungen in einer Nachricht.` : null;
}

function checkWordlist(message, rule) {
  const cfg = safeConfig(rule.config_json);
  const words = (Array.isArray(cfg.words) ? cfg.words : []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  if (!words.length) return null;
  const content = (message.content || '').toLowerCase();
  return words.some((w) => content.includes(w)) ? 'Verbotenes Wort.' : null;
}

const CHECKS = {
  spam: checkSpam,
  caps: checkCaps,
  links: checkLinks,
  invites: checkInvites,
  mention_spam: checkMentionSpam,
  wordlist: checkWordlist,
};

function isRuleExempt(member, rule) {
  const roles = safeArray(rule.except_role_ids);
  return roles.some((rid) => member.roles.cache.has(rid));
}

function isChannelExempt(channelId, rule) {
  return safeArray(rule.except_channel_ids).includes(channelId);
}

async function applyAction(message, rule, reasonText) {
  const guild = message.guild;
  const userId = message.author.id;

  await message.delete().catch(() => null);

  await logService
    .log({
      guildId: guild.id,
      category: 'automod',
      type: `automod_${rule.type}`,
      title: `🤖 AutoMod: ${LABELS[rule.type] || rule.type}`,
      description: reasonText,
      color: config.branding.warning,
      fields: [
        { name: 'Nutzer', value: `<@${userId}> (${userId})`, inline: true },
        { name: 'Kanal', value: `<#${message.channelId}>`, inline: true },
      ],
      targetId: userId,
    })
    .catch(() => null);

  if (!rule.action || rule.action === 'none') return;

  try {
    await moderationService.act(guild, {
      action: rule.action,
      userId,
      reason: `AutoMod (${LABELS[rule.type] || rule.type}): ${reasonText}`,
      minutes: rule.timeout_minutes,
      actorTag: 'AutoMod',
    });
  } catch (err) {
    logger.warn(`[automod] Aktion „${rule.action}" fehlgeschlagen: ${err.message}`);
  }
}

/**
 * @returns {Promise<boolean>} true, wenn die Nachricht gelöscht wurde (Aufrufer
 *   sollte sie dann nicht mehr an Zähl-Spiel/Vorschläge weiterreichen).
 */
async function handleMessage(message) {
  if (!message.guildId || message.author?.bot) return false;

  const rules = automodModel.listEnabled(message.guildId);
  if (!rules.length) return false;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isManager(member)) return false;

  for (const rule of rules) {
    if (isChannelExempt(message.channelId, rule)) continue;
    if (isRuleExempt(member, rule)) continue;
    const check = CHECKS[rule.type];
    if (!check) continue;
    const reason = check(message, rule);
    if (reason) {
      await applyAction(message, rule, reason);
      return true;
    }
  }
  return false;
}

/** Entfernt alte Einträge aus dem Spam-Tracking (aufgerufen vom 60s-Sweep). */
function pruneMemory() {
  const cutoff = Date.now() - 60_000;
  for (const [key, arr] of recentMessages) {
    const kept = arr.filter((t) => t > cutoff);
    if (kept.length) recentMessages.set(key, kept);
    else recentMessages.delete(key);
  }
}

module.exports = { handleMessage, pruneMemory, LABELS };
