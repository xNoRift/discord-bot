'use strict';

const moduleSettings = require('../database/models/moduleSettings');
const levels = require('../database/models/levels');
const logger = require('../utils/logger');

/**
 * Beteiligungs-Belohnungen: XP für Nachrichten (mit Cooldown) und Sprachzeit,
 * Level-Aufstiegs-Nachricht und Rollen-Belohnungen.
 */

const cooldowns = new Map(); // guild:user -> timestamp
const voiceJoined = new Map(); // guild:user -> timestamp

function csv(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function applyRewards(guild, member, level) {
  const rewards = levels.listRewards(guild.id).filter((r) => r.level <= level);
  for (const r of rewards) {
    if (member.roles.cache.has(r.role_id)) continue;
    await member.roles.add(r.role_id, `Level ${r.level} erreicht`).catch((err) =>
      logger.warn(`[levels] Rolle ${r.role_id} nicht vergeben: ${err.message}`),
    );
  }
}

async function handleLevelUp(guild, member, res, cfg, fallbackChannel) {
  await applyRewards(guild, member, res.level);
  const text = cfg.announceMessage
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{level}', String(res.level));
  const channel = (cfg.announceChannelId && guild.channels.cache.get(cfg.announceChannelId)) || fallbackChannel;
  if (channel?.isTextBased?.()) {
    await channel.send({ content: text, allowedMentions: { users: [member.id] } }).catch(() => null);
  }
}

async function onMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return;
  const cfg = moduleSettings.get(message.guild.id, 'levels');
  if (!cfg.enabled) return;
  if (csv(cfg.noXpChannelIds).includes(message.channelId)) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (cooldowns.get(key) || 0) < cfg.cooldownSec * 1000) return;
  cooldowns.set(key, now);

  const lo = Math.min(cfg.xpMin, cfg.xpMax);
  const hi = Math.max(cfg.xpMin, cfg.xpMax);
  const amount = lo + Math.floor(Math.random() * (hi - lo + 1));
  const res = levels.addXp(message.guild.id, message.author.id, amount, { messages: 1 });
  if (res.leveledUp) await handleLevelUp(message.guild, message.member, res, cfg, message.channel);
}

async function onVoice(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!guild || !member || member.user.bot) return;
  const cfg = moduleSettings.get(guild.id, 'levels');
  const key = `${guild.id}:${member.id}`;

  if (!cfg.enabled || !cfg.voiceXp) {
    voiceJoined.delete(key);
    return;
  }

  const wasIn = oldState.channelId && oldState.channelId !== guild.afkChannelId;
  const isIn = newState.channelId && newState.channelId !== guild.afkChannelId;

  if (!wasIn && isIn) voiceJoined.set(key, Date.now());
  if (wasIn && !isIn) {
    const since = voiceJoined.get(key);
    voiceJoined.delete(key);
    if (!since) return;
    const minutes = Math.floor((Date.now() - since) / 60000);
    if (minutes < 1) return;
    const res = levels.addXp(guild.id, member.id, minutes * cfg.voiceXpPerMinute, { voiceMinutes: minutes });
    if (res.leveledUp) await handleLevelUp(guild, member, res, cfg, null);
  }
}

setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [k, t] of cooldowns) if (t < cutoff) cooldowns.delete(k);
}, 600_000).unref?.();

module.exports = { onMessage, onVoice };
